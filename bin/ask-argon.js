#!/usr/bin/env node

const fs = require('node:fs/promises');
const { listTargetTabs, queryArgon } = require('../src/cdp-client');

const DEFAULT_TIMEOUT_SEC = 600;

function printUsage() {
  process.stdout.write(`Gemini Argon Bridge CLI (experimental)\n\nUsage:\n  ask-argon [prompt text]\n  ask-argon --prompt "<prompt>" [--context "<context>"]\n  ask-argon --file <path-to-prompt-file>\n  ask-argon --list-tabs [--json]\n  ask-argon --cdp <http://127.0.0.1:9222> [--tab <cdp-target-id>]\n\nOptions:\n  -p, --prompt    Prompt to send\n  -c, --context   Additional context\n  -f, --file      Read prompt as UTF-8 from a file\n  -e, --cdp       CDP endpoint (or ARGON_CDP_ENDPOINT)\n      --tab       Explicit CDP target id if several Gemini tabs are open\n      --list-tabs List supported Gemini Web tab IDs without sending a prompt\n  -t, --timeout   Maximum total time in seconds (or ARGON_TIMEOUT_SEC; default: 600)\n      --json      Write one JSON result/error to stdout\n  -h, --help      Show this help message\n`);
}

function parsePositiveSeconds(value, source) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(seconds * 1000)) {
    throw new Error(`${source} must be a finite positive number of seconds.`);
  }
  return seconds;
}

function takeValue(args, index, flag) {
  const value = args[index + 1];
  if (value === undefined || value === '' || value.startsWith('-')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseArgs(args, env = process.env) {
  if (args.includes('-h') || args.includes('--help')) return { help: true };
  let explicitPrompt;
  let promptFile;
  let context = '';
  let cdpEndpoint = env.ARGON_CDP_ENDPOINT || 'http://127.0.0.1:9222';
  let tabId = env.ARGON_TAB_ID || undefined;
  const environmentTimeout = env.ARGON_TIMEOUT_SEC ?? DEFAULT_TIMEOUT_SEC;
  let explicitTimeout;
  let listTabs = false;
  let jsonOutput = false;
  const positional = [];
  let endOfOptions = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (endOfOptions) {
      positional.push(arg);
    } else if (arg === '--') {
      endOfOptions = true;
    } else if (arg === '-p' || arg === '--prompt') {
      explicitPrompt = takeValue(args, index++, arg);
    } else if (arg === '-c' || arg === '--context') {
      context = takeValue(args, index++, arg);
    } else if (arg === '-f' || arg === '--file') {
      promptFile = takeValue(args, index++, arg);
    } else if (arg === '-e' || arg === '--cdp') {
      cdpEndpoint = takeValue(args, index++, arg);
    } else if (arg === '--tab') {
      tabId = takeValue(args, index++, arg);
    } else if (arg === '--list-tabs') {
      listTabs = true;
    } else if (arg === '-t' || arg === '--timeout') {
      explicitTimeout = takeValue(args, index++, arg);
    } else if (arg === '--json') {
      jsonOutput = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  // Validate only the effective value: a valid explicit option overrides even
  // a malformed environment default, while the environment is checked when it
  // is actually selected.
  const timeoutSec = parsePositiveSeconds(explicitTimeout ?? environmentTimeout, explicitTimeout === undefined ? 'ARGON_TIMEOUT_SEC' : '--timeout');

  return {
    help: false,
    prompt: explicitPrompt,
    promptFile,
    fallbackPrompt: positional.join(' '),
    context,
    cdpEndpoint,
    tabId,
    timeoutMs: timeoutSec * 1000,
    listTabs,
    jsonOutput
  };
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  // Let Node's StringDecoder preserve multi-byte characters split across
  // separate pipe reads (for example, an emoji split between Buffer chunks).
  process.stdin.setEncoding('utf8');
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

async function loadPrompt(options) {
  if (options.prompt !== undefined) return options.prompt;
  if (options.promptFile) return fs.readFile(options.promptFile, 'utf8');
  if (options.fallbackPrompt) return options.fallbackPrompt;
  if (process.env.ARGON_PROMPT_FILE) {
    try {
      return await fs.readFile(process.env.ARGON_PROMPT_FILE, 'utf8');
    } catch (error) {
      throw new Error(`Cannot read ARGON_PROMPT_FILE: ${error.message}`, { cause: error });
    }
  }
  return readStdin();
}

async function main() {
  let jsonOutput = process.argv.includes('--json');
  let controller;
  let signalExitCode = 0;
  try {
    const options = parseArgs(process.argv.slice(2));
    jsonOutput = options.jsonOutput;
    if (options.help) {
      printUsage();
      return;
    }
    controller = new AbortController();
    process.once('SIGINT', () => { signalExitCode = 130; controller.abort(); });
    process.once('SIGTERM', () => { signalExitCode = 143; controller.abort(); });
    if (options.listTabs) {
      const tabs = await listTargetTabs({ cdpEndpoint: options.cdpEndpoint, timeoutMs: options.timeoutMs, signal: controller.signal });
      if (options.jsonOutput) process.stdout.write(`${JSON.stringify({ tabs })}\n`);
      else if (!tabs.length) process.stdout.write('No supported Gemini Web tabs found.\n');
      else for (const tab of tabs) process.stdout.write(`${tab.tabId}\t${tab.title}\t${tab.url}\n`);
      return;
    }
    const prompt = await loadPrompt(options);
    if (!prompt.trim()) throw new Error('No prompt provided. Use --prompt, --file, a positional prompt, or stdin.');

    const result = await queryArgon({
      prompt,
      context: options.context,
      timeoutMs: options.timeoutMs,
      cdpEndpoint: options.cdpEndpoint,
      tabId: options.tabId,
      signal: controller.signal,
      onProgress: event => {
        if (!options.jsonOutput && event.message) process.stderr.write(`[Argon Bridge] ${event.message}\n`);
      }
    });
    if (options.jsonOutput) process.stdout.write(`${JSON.stringify(result)}\n`);
    else process.stdout.write(`\n================ GEMINI ARGON RESPONSE ================\n\n${result.text}\n\n========================================================\n`);
  } catch (error) {
    const payload = { success: false, error: error.message, code: error.code || 'CLI_ERROR' };
    if (jsonOutput) process.stdout.write(`${JSON.stringify(payload)}\n`);
    else process.stderr.write(`[Argon Bridge Error] ${error.message}\n`);
    process.exitCode = signalExitCode || (error.code === 'CONNECT_FAILED' ? 2 : error.code === 'CANCELLED' ? 130 : 1);
  }
}

if (require.main === module) main();

module.exports = { parseArgs, parsePositiveSeconds, loadPrompt };
