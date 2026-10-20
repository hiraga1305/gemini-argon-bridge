const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const test = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { _internals, queryArgon } = require('../src/cdp-client');
const { parseArgs } = require('../bin/ask-argon');

const root = path.resolve(__dirname, '..');

test('provider selection is exact HTTPS Gemini Web only', () => {
  assert.equal(_internals.exactSupportedUrl('https://gemini.google.com/app').name, 'gemini-web');
  assert.equal(_internals.exactSupportedUrl('https://gemini.google.com.attacker.invalid/app'), null);
  assert.equal(_internals.exactSupportedUrl('http://gemini.google.com/app'), null);
  assert.equal(_internals.exactSupportedUrl('https://aistudio.google.com/app'), null);
  assert.equal(_internals.exactSupportedUrl('https://lmarena.ai/'), null);
});

test('timeouts and endpoints reject malformed values', () => {
  for (const value of [0, -1, Infinity, NaN, '1000', null]) {
    assert.throws(() => _internals.validateTimeout(value), { code: 'INVALID_TIMEOUT' });
  }
  assert.equal(_internals.validateTimeout(1), 1);
  assert.throws(() => _internals.validateEndpoint('file:///tmp/cdp'), { code: 'INVALID_ENDPOINT' });
  assert.equal(_internals.validateEndpoint('http://127.0.0.1:9333/'), 'http://127.0.0.1:9333');
});

test('CDP aliases share a lock key while different targets do not', () => {
  assert.equal(_internals.canonicalEndpoint('http://localhost:9222'), _internals.canonicalEndpoint('http://127.0.0.1:9222'));
  assert.equal(_internals.lockPath('http://localhost:9222', 'target-a'), _internals.lockPath('http://127.0.0.1:9222', 'target-a'));
  assert.notEqual(_internals.lockPath('http://localhost:9222', 'target-a'), _internals.lockPath('http://localhost:9222', 'target-b'));
});

test('CLI accepts documented environment defaults and rejects invalid flags before query', () => {
  const fromEnvironment = parseArgs([], { ARGON_TIMEOUT_SEC: '75', ARGON_CDP_ENDPOINT: 'http://127.0.0.1:9333', ARGON_TAB_ID: 'tab-1' });
  assert.equal(fromEnvironment.timeoutMs, 75000);
  assert.equal(fromEnvironment.cdpEndpoint, 'http://127.0.0.1:9333');
  assert.equal(fromEnvironment.tabId, 'tab-1');
  assert.equal(parseArgs(['--timeout', '3'], { ARGON_TIMEOUT_SEC: 'NaN' }).timeoutMs, 3000);
  assert.throws(() => parseArgs([], { ARGON_TIMEOUT_SEC: 'NaN' }), /ARGON_TIMEOUT_SEC must be a finite positive/);
  assert.throws(() => parseArgs(['--timeout', 'Infinity'], {}), /finite positive/);
  assert.throws(() => parseArgs(['--timeout', '-1'], {}), /requires a value/);
  assert.throws(() => parseArgs(['--mystery'], {}), /Unknown option/);
  assert.equal(parseArgs(['--prompt', 'x', '--timeout', '2'], {}).timeoutMs, 2000);
});

test('empty prompt is rejected before any browser connection', async () => {
  await assert.rejects(queryArgon({ prompt: ' \n\t', timeoutMs: 1000, cdpEndpoint: 'http://127.0.0.1:1' }), { code: 'EMPTY_PROMPT' });
});

test('CLI child process rejects malformed input before trying the configured CDP endpoint', { timeout: 10000 }, async () => {
  const cases = [
    { args: ['--prompt', 'DO_NOT_SEND', '--cdp', 'http://127.0.0.1:1', '--timeout', 'NaN', '--json'], expected: /finite positive/ },
    { args: ['--mystery', '--prompt', 'DO_NOT_SEND', '--cdp', 'http://127.0.0.1:1', '--json'], expected: /Unknown option/ },
    { args: ['--prompt', '  ', '--cdp', 'http://127.0.0.1:1', '--json'], expected: /No prompt provided/ },
    { args: ['--prompt', '  ', '--cdp', 'http://127.0.0.1:1', '--timeout', '3', '--json'], env: { ARGON_TIMEOUT_SEC: 'NaN' }, expected: /No prompt provided/ }
  ];
  for (const item of cases) {
    const child = spawn(process.execPath, ['bin/ask-argon.js', ...item.args], { cwd: root, windowsHide: true, env: { ...process.env, ...item.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.end();
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    const [code] = await once(child, 'close');
    assert.equal(code, 1, stderr);
    const result = JSON.parse(stdout.trim());
    assert.equal(result.success, false);
    assert.match(result.error, item.expected);
    assert.notEqual(result.code, 'CONNECT_FAILED');
  }
});

test('CLI stdin preserves UTF-8 characters split across separate pipe chunks', { timeout: 10000 }, async () => {
  const source = "const { loadPrompt } = require('./bin/ask-argon'); loadPrompt({}).then(value => process.stdout.write(JSON.stringify(value))).catch(error => { console.error(error); process.exitCode = 1; });";
  const child = spawn(process.execPath, ['-e', source], {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, ARGON_PROMPT_FILE: '' },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const input = Buffer.from('Tuyệt 😊', 'utf8');
  child.stdin.write(input.subarray(0, 9));
  await delay(50);
  child.stdin.end(input.subarray(9));
  const [code] = await once(child, 'close');
  assert.equal(code, 0, stderr);
  assert.equal(JSON.parse(stdout), 'Tuyệt 😊');
});

function waitForLine(child, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let buffered = '';
    const timer = setTimeout(() => {
      child.stdout.off('data', onData);
      reject(new Error('Timed out waiting for child-process lock output.'));
    }, timeoutMs);
    const onData = chunk => {
      buffered += chunk.toString();
      const found = buffered.split(/\r?\n/).find(predicate);
      if (found) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        resolve(found);
      }
    };
    child.stdout.on('data', onData);
  });
}

test('cross-process tab lock serializes two independent Node processes', { timeout: 10000 }, async () => {
  const targetId = `node-test-${process.pid}-${Date.now()}`;
  const endpoint = 'http://localhost:19222';
  const childSource = [
    "const { _internals } = require('./src/cdp-client');",
    "const [endpoint, targetId, holdMs] = process.argv.slice(1);",
    "(async () => { const deadline = _internals.createDeadline(5000); const release = await _internals.acquireTabLock(endpoint, targetId, deadline, undefined); console.log(`LOCKED ${Date.now()}`); await new Promise(r => setTimeout(r, Number(holdMs))); await release(); console.log(`RELEASED ${Date.now()}`); })().catch(e => { console.error(e); process.exitCode = 1; });"
  ].join('\n');
  const first = spawn(process.execPath, ['-e', childSource, endpoint, targetId, '500'], { cwd: root, windowsHide: true });
  let firstOutput = '';
  first.stdout.on('data', chunk => { firstOutput += chunk.toString(); });
  first.stderr.on('data', chunk => { firstOutput += chunk.toString(); });
  const firstExit = once(first, 'exit');
  const firstLockedPromise = waitForLine(first, line => line.startsWith('LOCKED '));
  const firstLocked = await firstLockedPromise;
  const second = spawn(process.execPath, ['-e', childSource, 'http://127.0.0.1:19222', targetId, '0'], { cwd: root, windowsHide: true });
  let secondOutput = '';
  second.stdout.on('data', chunk => { secondOutput += chunk.toString(); });
  second.stderr.on('data', chunk => { secondOutput += chunk.toString(); });
  const secondExit = once(second, 'exit');
  await Promise.all([firstExit, secondExit]);
  const firstReleasedAt = Number(firstOutput.match(/RELEASED (\d+)/)?.[1]);
  const secondLockedAt = Number(secondOutput.match(/LOCKED (\d+)/)?.[1]);
  assert.ok(firstReleasedAt, `first child output: ${firstOutput}`);
  assert.ok(secondLockedAt, `second child output: ${secondOutput}`);
  assert.ok(secondLockedAt >= firstReleasedAt, `first=${firstLocked}, released=${firstReleasedAt}, second=${secondLockedAt}`);
  assert.equal(first.exitCode, 0, firstOutput);
  assert.equal(second.exitCode, 0, secondOutput);
});

test('dead-process lock owner can be atomically reclaimed', async () => {
  const endpoint = 'http://127.0.0.1:19333';
  const targetId = `stale-${process.pid}-${Date.now()}`;
  const lockDir = _internals.lockPath(endpoint, targetId);
  await fs.mkdir(lockDir, { recursive: true });
  await fs.writeFile(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: 2147483647, nonce: 'dead-owner' }));
  const release = await _internals.acquireTabLock(endpoint, targetId, _internals.createDeadline(1000));
  try {
    assert.equal(JSON.parse(await fs.readFile(path.join(lockDir, 'owner.json'), 'utf8')).nonce !== 'dead-owner', true);
  } finally {
    await release();
  }
});

test('concurrent stale-lock reclaimers cannot remove a replacement owner lock', { timeout: 10000 }, async () => {
  const endpoint = `http://127.0.0.1:${await new Promise(resolve => {
    const server = require('node:net').createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  })}`;
  const targetId = `stale-race-${process.pid}-${Date.now()}`;
  const lockDir = _internals.lockPath(endpoint, targetId);
  const ownerPath = path.join(lockDir, 'owner.json');
  await fs.mkdir(lockDir, { recursive: true });
  await fs.writeFile(ownerPath, JSON.stringify({ pid: 2147483647, nonce: 'dead-race-owner' }));

  const originalReadFile = fs.readFile;
  let staleReads = 0;
  let unlockReads;
  const bothInitialReads = new Promise(resolve => { unlockReads = resolve; });
  fs.readFile = async function(file, ...args) {
    const value = await originalReadFile.call(fs, file, ...args);
    if (path.resolve(String(file)) === path.resolve(ownerPath) && staleReads < 2) {
      staleReads++;
      if (staleReads === 2) unlockReads();
      await bothInitialReads;
    }
    return value;
  };
  let active = 0;
  let maximumActive = 0;
  try {
    const criticalSection = async () => {
      const release = await _internals.acquireTabLock(endpoint, targetId, _internals.createDeadline(5000));
      active++;
      maximumActive = Math.max(maximumActive, active);
      await delay(120);
      active--;
      await release();
    };
    await Promise.all([criticalSection(), criticalSection()]);
  } finally {
    fs.readFile = originalReadFile;
    await fs.rm(lockDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(`${lockDir}.reclaim-guard`, { recursive: true, force: true }).catch(() => {});
  }
  assert.equal(staleReads, 2, 'both contenders observed the dead owner before serialization');
  assert.equal(maximumActive, 1, 'only one process may own the tab lock at a time');
});

test('a paused ownerless lock initializer cannot be reclaimed by another claimant', { timeout: 10000 }, async () => {
  const endpoint = `http://127.0.0.1:${await new Promise(resolve => {
    const server = require('node:net').createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  })}`;
  const targetId = `init-race-${process.pid}-${Date.now()}`;
  const lockDir = _internals.lockPath(endpoint, targetId);
  const ownerPath = path.join(lockDir, 'owner.json');
  const originalWriteFile = fs.writeFile;
  const originalUtimes = fs.utimes;
  let resumeFirstWrite;
  let announceFirstWrite;
  const firstWriteGate = new Promise(resolve => { resumeFirstWrite = resolve; });
  const firstWriteStarted = new Promise(resolve => { announceFirstWrite = resolve; });
  let firstRelease;
  let firstAcquire;

  fs.writeFile = async function(file, data, ...args) {
    if (path.resolve(String(file)) === path.resolve(ownerPath)) {
      announceFirstWrite();
      await firstWriteGate;
    }
    return originalWriteFile.call(fs, file, data, ...args);
  };
  try {
    firstAcquire = _internals.acquireTabLock(endpoint, targetId, _internals.createDeadline(5000));
    await Promise.race([firstWriteStarted, delay(1500).then(() => { throw new Error('first claimant did not pause before owner metadata'); })]);
    const oldTime = new Date(Date.now() - 6000);
    await originalUtimes(lockDir, oldTime, oldTime);

    await assert.rejects(
      _internals.acquireTabLock(endpoint, targetId, _internals.createDeadline(300)),
      { code: 'TIMEOUT' }
    );
    await assert.rejects(fs.readFile(ownerPath, 'utf8'), { code: 'ENOENT' });

    resumeFirstWrite();
    firstRelease = await firstAcquire;
    const owner = JSON.parse(await fs.readFile(ownerPath, 'utf8'));
    assert.equal(owner.pid, process.pid);
    assert.ok(owner.nonce);
  } finally {
    resumeFirstWrite();
    if (firstAcquire) {
      firstRelease ||= await firstAcquire.catch(() => undefined);
    }
    fs.writeFile = originalWriteFile;
    await firstRelease?.().catch(() => {});
    await fs.rm(lockDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(`${lockDir}.reclaim-guard`, { recursive: true, force: true }).catch(() => {});
  }
});

test('initial owner metadata write failure never removes a different lock owner', async () => {
  const endpoint = `http://127.0.0.1:${await new Promise(resolve => {
    const server = require('node:net').createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  })}`;
  const targetId = `init-write-failure-${process.pid}-${Date.now()}`;
  const lockDir = _internals.lockPath(endpoint, targetId);
  const ownerPath = path.join(lockDir, 'owner.json');
  const originalWriteFile = fs.writeFile;
  const otherOwner = { pid: process.pid, nonce: 'already-installed-owner' };

  fs.writeFile = async function(file, data, ...args) {
    if (path.resolve(String(file)) === path.resolve(ownerPath)) {
      await originalWriteFile.call(fs, file, JSON.stringify(otherOwner), ...args);
      const error = new Error('simulated metadata write failure after a competing owner appeared');
      error.code = 'EIO';
      throw error;
    }
    return originalWriteFile.call(fs, file, data, ...args);
  };
  try {
    await assert.rejects(
      _internals.acquireTabLock(endpoint, targetId, _internals.createDeadline(1000)),
      { code: 'EIO' }
    );
    assert.deepEqual(JSON.parse(await fs.readFile(ownerPath, 'utf8')), otherOwner);
  } finally {
    fs.writeFile = originalWriteFile;
    await fs.rm(lockDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('old lock directories with malformed owner metadata fail closed', async () => {
  const endpoint = `http://127.0.0.1:${await new Promise(resolve => {
    const server = require('node:net').createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  })}`;
  const targetId = `malformed-owner-${process.pid}-${Date.now()}`;
  const lockDir = _internals.lockPath(endpoint, targetId);
  await fs.mkdir(lockDir, { recursive: true });
  await fs.writeFile(path.join(lockDir, 'owner.json'), '{not-json');
  const oldTime = new Date(Date.now() - 6000);
  await fs.utimes(lockDir, oldTime, oldTime);
  try {
    await assert.rejects(
      _internals.acquireTabLock(endpoint, targetId, _internals.createDeadline(300)),
      { code: 'TIMEOUT' }
    );
    assert.equal(await fs.readFile(path.join(lockDir, 'owner.json'), 'utf8'), '{not-json');
  } finally {
    await fs.rm(lockDir, { recursive: true, force: true }).catch(() => {});
  }
});
