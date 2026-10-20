const assert = require('node:assert/strict');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const test = require('node:test');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.resolve(__dirname, '..');
const serverPath = path.join(root, 'src', 'mcp-server.js');

test('MCP stdio survives malformed JSON and invalid JSON-RPC values', { timeout: 10000 }, async () => {
  const child = spawn(process.execPath, [serverPath], {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, ARGON_CDP_ENDPOINT: 'http://127.0.0.1:19991' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const requests = [
    '{not-json',
    'null',
    JSON.stringify({ jsonrpc: '1.0', id: 99, method: 'ping' }),
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'unit-test', version: '1' } } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' }),
    JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'ask_gemini_argon', arguments: { prompt: 'SHOULD_NOT_SEND', timeoutSeconds: 0 } } }),
    JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'method/unknown' }),
    JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'ping' }),
    JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'ping' }),
    JSON.stringify({ jsonrpc: '2.0', method: 'ping' })
  ];
  child.stdin.write(`${requests.join('\n')}\n`);
  child.stdin.end();
  const [exitCode] = await once(child, 'close');
  assert.equal(exitCode, 0, stderr);
  const responses = stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(responses.length, 10);
  assert.deepEqual(responses.slice(0, 3).map(response => response.error.code), [-32700, -32600, -32600]);
  assert.equal(responses.find(response => response.id === 1).result.serverInfo.name, 'gemini-argon-bridge');
  assert.equal(responses.find(response => response.id === 2).result.tools[0].name, 'ask_gemini_argon');
  assert.deepEqual(responses.find(response => response.id === 3).result, {});
  assert.equal(responses.find(response => response.id === 4).error.code, -32602);
  assert.equal(responses.find(response => response.id === 5).error.code, -32601);
  assert.equal(responses.filter(response => response.id === 6).length, 2);
  assert.equal(responses.filter(response => response.id === 6 && response.error?.code === -32600).length, 1);
  assert.equal(responses.filter(response => response.id === 6 && response.result && !response.error).length, 1);
  assert.doesNotMatch(stdout, /\[MCP Argon\]/);
});

test('MCP exit notification aborts active work and exits while stdin stays open', { timeout: 10000 }, async () => {
  const child = spawn(process.execPath, [serverPath], {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, ARGON_CDP_ENDPOINT: 'http://127.0.0.1:19991' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });

  const requests = [
    JSON.stringify({ jsonrpc: '2.0', id: 'active', method: 'tools/call', params: { name: 'ask_gemini_argon', arguments: { prompt: 'MUST_NOT_BE_SUBMITTED', timeoutSeconds: 60 } } }),
    JSON.stringify({ jsonrpc: '2.0', method: 'exit' })
  ];
  const closed = once(child, 'close');
  const watchdog = setTimeout(() => child.kill(), 4000);
  child.stdin.write(`${requests.join('\n')}\n`);
  // Keep the input pipe open: the server's lifecycle notification must close
  // its read side and finish shutdown without waiting for stdin EOF.
  const [exitCode] = await closed;
  clearTimeout(watchdog);

  assert.equal(exitCode, 0, stderr);
  const responses = stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(responses.length, 1);
  assert.equal(responses[0].id, 'active');
  assert.equal(responses[0].result.isError, true);
  assert.equal(responses[0].result.structuredContent.errorCode, 'CANCELLED');
});

test('MCP shutdown bounds a pending CDP discovery socket after cancellation settles', { timeout: 9000 }, async () => {
  const stub = net.createServer();
  await new Promise((resolve, reject) => stub.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = stub.address().port;
  let notifyRequest;
  const requestSeen = new Promise(resolve => { notifyRequest = resolve; });
  const sockets = new Set();
  stub.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.on('data', () => notifyRequest());
    // Keep HTTP discovery pending to model connectOverCDP leaving an open
    // socket after the query's AbortSignal has already settled its job.
  });

  const child = spawn(process.execPath, [serverPath], {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, ARGON_CDP_ENDPOINT: `http://127.0.0.1:${port}` },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  let buffered = '';
  const responses = [];
  const waiters = [];
  child.stdout.on('data', chunk => {
    stdout += chunk.toString('utf8');
    buffered += chunk.toString('utf8');
    for (;;) {
      const newline = buffered.indexOf('\n');
      if (newline < 0) break;
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      responses.push(JSON.parse(line));
      for (const wake of waiters.splice(0)) wake();
    }
  });
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
  const waitForResponse = async id => {
    const until = Date.now() + 2500;
    while (Date.now() < until) {
      const found = responses.find(response => response.id === id);
      if (found) return found;
      await Promise.race([new Promise(resolve => waiters.push(resolve)), delay(Math.min(50, until - Date.now()))]);
    }
    throw new Error(`Timed out waiting for MCP response ${id}; got ${JSON.stringify(responses)}`);
  };
  const closePromise = once(child, 'close');
  try {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'connect', method: 'tools/call', params: { name: 'ask_gemini_argon', arguments: { prompt: 'SYNTHETIC_ONLY', timeoutSeconds: 20 } } })}\n`);
    await Promise.race([requestSeen, delay(1500).then(() => { throw new Error('MCP child did not begin local CDP discovery'); })]);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'connect' } })}\n`);
    const cancelled = await waitForResponse('connect');
    assert.equal(cancelled.result?.structuredContent?.errorCode, 'CANCELLED', JSON.stringify(cancelled));

    const exitStartedAt = Date.now();
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'exit' })}\n`);
    const closed = await Promise.race([
      closePromise.then(([code]) => ({ code })),
      delay(7000).then(() => ({ timedOut: true }))
    ]);
    assert.equal(closed.timedOut, undefined, `MCP child did not honor its shutdown bound; stderr=${stderr}; stdout=${stdout}`);
    assert.equal(closed.code, 0, stderr);
    assert.ok(Date.now() - exitStartedAt <= 6500, 'shutdown must finish within the documented six-second bound');
  } finally {
    if (child.exitCode === null) child.kill();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => stub.close(resolve));
  }
});

