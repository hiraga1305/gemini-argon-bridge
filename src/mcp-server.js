#!/usr/bin/env node

const readline = require('node:readline');
const { queryArgon } = require('./cdp-client');
const { version: SERVER_VERSION } = require('../package.json');

const PROTOCOL_VERSION = '2024-11-05';
const DEFAULT_TIMEOUT_SECONDS = 600;
const SHUTDOWN_DRAIN_MS = 5000;
const FORCE_EXIT_GRACE_MS = 1000;
const SHUTDOWN_HARD_EXIT_MS = SHUTDOWN_DRAIN_MS + FORCE_EXIT_GRACE_MS;
const activeRequests = new Map();
const activeRequestIds = new Set();
const jobs = new Set();
let shuttingDown = false;
let shutdownPromise;
let shutdownExitCode = 0;

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });

function sendResponse(id, result, error = null) {
  const response = { jsonrpc: '2.0', id };
  if (error) response.error = error;
  else response.result = result;
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function sendRpcError(id, code, message, data) {
  sendResponse(id, null, { code, message, ...(data === undefined ? {} : { data }) });
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validId(id) {
  return typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id)) || id === null;
}

function parseToolArguments(value) {
  if (!isRecord(value)) throw Object.assign(new Error('arguments must be an object.'), { code: 'INVALID_PARAMS' });
  const allowed = new Set(['prompt', 'context', 'timeoutSeconds', 'tabId']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw Object.assign(new Error(`Unknown argument: ${key}`), { code: 'INVALID_PARAMS' });
  }
  if (typeof value.prompt !== 'string' || !value.prompt.trim()) {
    throw Object.assign(new Error('prompt must be a non-empty string.'), { code: 'INVALID_PARAMS' });
  }
  if (value.context !== undefined && typeof value.context !== 'string') {
    throw Object.assign(new Error('context must be a string.'), { code: 'INVALID_PARAMS' });
  }
  if (value.tabId !== undefined && (typeof value.tabId !== 'string' || !value.tabId.trim())) {
    throw Object.assign(new Error('tabId must be a non-empty string.'), { code: 'INVALID_PARAMS' });
  }
  const timeoutSeconds = value.timeoutSeconds === undefined ? DEFAULT_TIMEOUT_SECONDS : value.timeoutSeconds;
  if (typeof timeoutSeconds !== 'number' || !Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || !Number.isFinite(timeoutSeconds * 1000)) {
    throw Object.assign(new Error('timeoutSeconds must be a finite positive number.'), { code: 'INVALID_PARAMS' });
  }
  return { prompt: value.prompt, context: value.context || '', timeoutMs: timeoutSeconds * 1000, tabId: value.tabId };
}

function toolDefinition() {
  return {
    name: 'ask_gemini_argon',
    description: 'Ask the Argon model selected in a Gemini Web tab through the local browser. Experimental; reports visible UI labels and explicit completion evidence.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        prompt: { type: 'string', minLength: 1, description: 'Question or task to send to Gemini Web.' },
        context: { type: 'string', description: 'Relevant context. Only include content the current user permits sending to Gemini Web.' },
        timeoutSeconds: { type: 'number', exclusiveMinimum: 0, description: 'Total wall-clock deadline, including CDP connect and tab lock. Default: 600.' },
        tabId: { type: 'string', description: 'Optional exact CDP target id required when more than one Gemini Web tab is open.' }
      },
      required: ['prompt']
    }
  };
}

function toolResult(result) {
  return {
    content: [{ type: 'text', text: result.text }],
    structuredContent: {
      provider: result.provider,
      providerEvidenceLevel: result.providerEvidenceLevel,
      modelLabelObserved: result.modelLabelObserved,
      thinkingLabelObserved: result.thinkingLabelObserved,
      modelEvidenceSource: result.modelEvidenceSource,
      completionEvidence: result.completionEvidence,
      tabId: result.tabId,
      elapsedMs: result.elapsedMs
    }
  };
}

function handleNotification(method, params) {
  if (method === 'notifications/cancelled') {
    const requestId = params?.requestId;
    const controller = activeRequests.get(requestId);
    if (controller) controller.abort();
    return true;
  }
  if (method === 'notifications/initialized') return true;
  return false;
}

function beginShutdown(exitCode = 0) {
  if (exitCode !== 0) shutdownExitCode = exitCode;
  if (shuttingDown) return shutdownPromise;
  shuttingDown = true;
  // Stop accepting input before draining so no new request can outlive the
  // shutdown snapshot. Destroying stdin happens after active requests settle.
  rl.close();
  process.stdin.pause();
  for (const controller of activeRequests.values()) controller.abort();

  // Some CDP connection attempts can leave an underlying socket alive after
  // their cancelled query promise has settled. Keep one unref'ed process-level
  // bound from the start of shutdown; it will not keep a clean process alive,
  // but it will terminate the MCP child if any orphaned handle survives.
  const hardExitTimer = setTimeout(() => {
    process.exit(jobs.size ? (shutdownExitCode || 1) : shutdownExitCode);
  }, SHUTDOWN_HARD_EXIT_MS);
  hardExitTimer.unref();

  shutdownPromise = (async () => {
    const pending = Promise.allSettled([...jobs]);
    let timer;
    const settled = await Promise.race([
      pending.then(() => true),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), SHUTDOWN_DRAIN_MS); })
    ]);
    clearTimeout(timer);
    process.stdin.destroy();
    process.exitCode = shutdownExitCode;
    if (settled) {
      process.stdout.end();
      process.stderr.end();
      return;
    }

    // Queries normally unwind immediately after AbortSignal. This final
    // watchdog keeps shutdown bounded if a browser API ignores cancellation;
    // allowing the OS to release this process's lock is safer than hanging the
    // MCP host forever. The browser itself is a separate process and remains open.
    const forceTimer = setTimeout(() => process.exit(shutdownExitCode || 1), FORCE_EXIT_GRACE_MS);
    pending.then(() => {
      clearTimeout(forceTimer);
      process.exitCode = shutdownExitCode;
      process.stdout.end();
      process.stderr.end();
    });
  })().catch(error => {
    process.stderr.write(`[MCP shutdown] ${error.message}\n`);
    process.stdin.destroy();
    process.exitCode = shutdownExitCode || 1;
    process.stdout.end();
    process.stderr.end();
  });
  return shutdownPromise;
}

async function dispatch(request) {
  const { id, method, params } = request;
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    handleNotification(method, params);
    return;
  }
  // JSON-RPC notifications never receive a response, even if their method is
  // normally request/response based.
  if (id === undefined) return;
  if (method === 'ping') return sendResponse(id, {});
  if (method === 'initialize') {
    return sendResponse(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'gemini-argon-bridge', version: SERVER_VERSION }
    });
  }
  if (method === 'tools/list') return sendResponse(id, { tools: [toolDefinition()] });
  if (method === 'tools/call') {
    if (id === undefined) return;
    if (!isRecord(params)) return sendRpcError(id, -32602, 'params must be an object.');
    if (params.name !== 'ask_gemini_argon') return sendRpcError(id, -32601, `Tool not found: ${String(params.name)}`);
    let parsed;
    try {
      parsed = parseToolArguments(params.arguments);
    } catch (error) {
      return sendRpcError(id, -32602, error.message, { code: error.code || 'INVALID_PARAMS' });
    }
    const controller = activeRequests.get(id) || new AbortController();
    if (!activeRequests.has(id)) activeRequests.set(id, controller);
    try {
      const result = await queryArgon({
        ...parsed,
        cdpEndpoint: process.env.ARGON_CDP_ENDPOINT || 'http://127.0.0.1:9222',
        signal: controller.signal,
        onProgress: event => {
          if (event.message) process.stderr.write(`[MCP Argon] ${event.message}\n`);
        }
      });
      return sendResponse(id, toolResult(result));
    } catch (error) {
      return sendResponse(id, {
        content: [{ type: 'text', text: `${error.code || 'ERROR'}: ${error.message}` }],
        isError: true,
        structuredContent: { errorCode: error.code || 'ERROR' }
      });
    } finally {
      activeRequests.delete(id);
    }
  }
  if (id !== undefined) sendRpcError(id, -32601, `Method not found: ${method}`);
}

function acceptLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request;
  try {
    request = JSON.parse(trimmed);
  } catch (error) {
    sendRpcError(null, -32700, 'Parse error.');
    return;
  }
  if (!isRecord(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string' || (request.id !== undefined && !validId(request.id)) || (request.params !== undefined && !isRecord(request.params) && !Array.isArray(request.params))) {
    sendRpcError(isRecord(request) && validId(request.id) ? request.id : null, -32600, 'Invalid Request.');
    return;
  }
  if (request.id !== undefined && activeRequestIds.has(request.id)) {
    sendRpcError(request.id, -32600, 'A request with this id is already running.');
    return;
  }
  if (shuttingDown) {
    if (request.id !== undefined) sendRpcError(request.id, -32600, 'Server is shutting down.');
    return;
  }
  if (request.method === 'exit') {
    if (request.id !== undefined) sendRpcError(request.id, -32600, 'exit must be sent as a notification.');
    else beginShutdown();
    return;
  }
  if (request.id !== undefined) {
    activeRequestIds.add(request.id);
    if (request.method === 'tools/call') activeRequests.set(request.id, new AbortController());
  }
  const task = Promise.resolve().then(() => dispatch(request)).catch(error => {
    if (request.id !== undefined) sendRpcError(request.id, -32603, 'Internal error.', { message: error.message });
  }).finally(() => {
    if (request.id !== undefined) {
      activeRequestIds.delete(request.id);
      activeRequests.delete(request.id);
    }
  });
  jobs.add(task);
  task.finally(() => jobs.delete(task));
}

rl.on('line', acceptLine);
rl.on('close', () => {
  beginShutdown();
});
process.on('SIGINT', () => beginShutdown(130));
process.on('SIGTERM', () => beginShutdown(143));

module.exports = { parseToolArguments, toolDefinition, acceptLine };
