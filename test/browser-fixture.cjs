#!/usr/bin/env node
// Real Chromium + real CDP, but every navigation is intercepted and served
// synthetic local HTML. This fixture never uses the user's port 9222.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { chromium } = require('playwright-core');
const { listTargetTabs, queryArgon, _internals } = require('../src/cdp-client');

const root = path.resolve(__dirname, '..');
const results = [];

function fixtureHtml() {
  return `<!doctype html><meta charset="utf-8"><title>Local Argon Bridge Fixture</title>
    <style>body{font:16px sans-serif}button{display:inline-block;margin:8px;padding:8px}.ql-editor{width:600px;min-height:80px;border:1px solid #888;margin:12px 0}.ql-editor p{margin:1em 0}.markdown{white-space:pre-wrap}model-response{display:block;padding:8px;border:1px solid #ddd;margin:8px}message-content{display:block}.response-footer{display:none}.fixture-hidden{display:none!important}</style>
    <button id="model" aria-label="Mở công cụ chọn chế độ, hiện tại là Argon Cao">Argon Cao</button>
    <rich-textarea id="visible-input"><div id="visible-editor" class="ql-editor" contenteditable="true" role="textbox" aria-label="prompt"></div></rich-textarea>
    <button id="send" aria-label="Send">Send</button><div id="stop-controls"></div>
    <div class="prose" id="user-echo"></div><section id="answers"></section>
    <script>
      const params = new URL(location.href).searchParams;
      window.__mode = params.get('mode') || 'complete';
      window.__delayMs = Number(params.get('delay') || 200);
      window.__modelSetting = params.get('model') || 'argon';
      window.__submitted = [];
      window.__submittedInputInnerText = [];
      window.__submittedParagraphCounts = [];
      window.__nextTurn = 1;
      const input = document.querySelector('#visible-editor');
      const modelButton = document.querySelector('#model');
      const sendButton = document.querySelector('#send');
      window.__serializeEditor = () => {
        const paragraphs = [...input.children].filter(node => node.tagName === 'P');
        if (!paragraphs.length) return input.innerText ?? input.textContent ?? '';
        const inlineText = paragraph => {
          if (paragraph.childNodes.length === 1 && paragraph.firstChild.nodeName === 'BR') return '';
          return [...paragraph.childNodes].map(node => {
            if (node.nodeType === Node.TEXT_NODE) return node.textContent;
            if (node.nodeName === 'BR') return '\\n';
            return node.textContent ?? '';
          }).join('');
        };
        return paragraphs.map(inlineText).join('\\n');
      };
      if (window.__mode === 'hidden-input') {
        const hiddenInput = document.createElement('rich-textarea');
        hiddenInput.className = 'fixture-hidden';
        hiddenInput.innerHTML = '<div class="ql-editor" contenteditable="true" role="textbox" aria-label="hidden prompt"></div>';
        document.body.insertBefore(hiddenInput, document.querySelector('#visible-input'));
      }
      if (window.__mode === 'hidden-send') {
        const hiddenSend = sendButton.cloneNode(true);
        hiddenSend.removeAttribute('id');
        hiddenSend.className = 'fixture-hidden';
        sendButton.parentNode.insertBefore(hiddenSend, sendButton);
      }
      if (window.__mode === 'disabled-send') {
        const disabledSend = sendButton.cloneNode(true);
        disabledSend.removeAttribute('id');
        disabledSend.disabled = true;
        sendButton.parentNode.insertBefore(disabledSend, sendButton);
      }
      if (window.__mode === 'model-unrelated-button') {
        modelButton.innerText = 'NOT_ARGON';
        modelButton.setAttribute('aria-label', 'Mở công cụ chọn chế độ, hiện tại là NOT_ARGON');
        const unrelated = document.createElement('button');
        unrelated.innerText = 'Argon Cao';
        unrelated.setAttribute('aria-label', 'Argon Cao');
        modelButton.parentNode.insertBefore(unrelated, modelButton.nextSibling);
      }
      if (window.__modelSetting !== 'argon') {
        if (window.__mode !== 'model-unrelated-button') {
          modelButton.innerText = 'NOT_ARGON';
          modelButton.setAttribute('aria-label', 'Current model: NOT_ARGON');
        }
      }
      function appendOldTurn() {
        const response = document.createElement('model-response');
        const message = document.createElement('message-content');
        message.id = 'message-content-id-r_old_fixture';
        const markdown = document.createElement('div');
        markdown.className = 'markdown markdown-main-panel';
        markdown.setAttribute('aria-live', 'polite');
        markdown.setAttribute('aria-busy', window.__mode === 'busy-existing' ? 'true' : 'false');
        markdown.innerText = 'STALE_ANSWER';
        const announcer = document.createElement('div');
        announcer.className = 'model-response-label-announcer';
        announcer.setAttribute('aria-busy', 'false');
        const footer = document.createElement('div');
        footer.className = window.__mode === 'busy-existing' ? 'response-footer gap' : 'response-footer complete gap';
        message.append(markdown);
        response.append(message, announcer, footer);
        document.querySelector('#answers').append(response);
        if (window.__mode === 'busy-existing') {
          const stop = document.createElement('button');
          stop.id = 'active-stop';
          stop.setAttribute('aria-label', 'Stop generating');
          stop.innerText = 'Stop';
          document.querySelector('#stop-controls').append(stop);
        }
      }
      appendOldTurn();
      document.querySelector('#send').addEventListener('click', () => {
        const prompt = window.__serializeEditor();
        window.__submittedInputInnerText.push(input.innerText ?? '');
        window.__submittedParagraphCounts.push(input.querySelectorAll(':scope > p').length);
        window.__submitted.push(prompt);
        document.querySelector('#user-echo').innerText = 'USER_TURN: ' + prompt;
        if (window.__mode === 'route-change') history.pushState({}, '', '/app/after-submit?mode=route-change');
        if (window.__mode === 'navigate-after-submit') {
          location.href = 'https://gemini.google.com/app/new-document?mode=complete';
          return;
        }
        if (window.__mode === 'no-start') return;
        input.innerText = '';
        const createTurn = () => {
          const response = document.createElement('model-response');
          const message = document.createElement('message-content');
          if (window.__mode !== 'no-id') message.id = 'message-content-id-r_new_fixture_' + window.__nextTurn++;
          const markdown = document.createElement('div');
          markdown.className = 'markdown markdown-main-panel';
          markdown.setAttribute('aria-live', 'polite');
          markdown.setAttribute('aria-busy', 'true');
          markdown.innerText = window.__mode === 'partial' ? 'PARTIAL_ANSWER' : 'STREAMING';
          const announcer = document.createElement('div');
          announcer.className = 'model-response-label-announcer';
          announcer.setAttribute('aria-busy', 'true');
          const footer = document.createElement('div');
          footer.className = 'response-footer gap';
          message.append(markdown);
          response.append(message, announcer, footer);
          document.querySelector('#answers').append(response);
          const stop = document.createElement('button');
          stop.id = 'active-stop';
          stop.setAttribute('aria-label', 'Stop generating');
          stop.innerText = 'Stop';
          document.querySelector('#stop-controls').append(stop);
          if (window.__mode === 'partial') return;
          setTimeout(() => {
            if (window.__mode === 'error') {
              const alert = document.createElement('div');
              alert.setAttribute('role', 'alert');
              alert.innerText = 'Synthetic provider error';
              response.append(alert);
              return;
            }
            markdown.innerText = window.__mode === 'echo' ? prompt : 'ANSWER:' + prompt;
            markdown.setAttribute('aria-busy', 'false');
            announcer.setAttribute('aria-busy', 'false');
            footer.classList.add('complete');
            stop.remove();
          }, window.__delayMs);
        };
        if (window.__mode === 'late-start') setTimeout(createTurn, window.__delayMs);
        else createTurn();
      });
    </script>`;
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function browserPath() {
  const candidates = [
    process.env.AUDIT_BROWSER_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);
  return candidates.find(candidate => require('node:fs').existsSync(candidate));
}

async function record(id, requirement, action) {
  const startedAt = Date.now();
  try {
    const observed = await action();
    results.push({ id, requirement, status: 'PASS', durationMs: Date.now() - startedAt, observed });
  } catch (error) {
    results.push({ id, requirement, status: 'FAIL', durationMs: Date.now() - startedAt, observed: { error: error.message, code: error.code || null } });
  }
}

async function expectQueryFailure(options, code) {
  await assert.rejects(queryArgon(options), error => error.code === code);
  return { code };
}

async function withQuillParagraphNormalization(page, { edit = false } = {}, action) {
  const locatorPrototype = Object.getPrototypeOf(page.locator('.ql-editor'));
  const originalFill = locatorPrototype.fill;
  locatorPrototype.fill = async function(value, options) {
    const result = await originalFill.call(this, value, options);
    await this.evaluate((editor, { logicalText, appendUserEdit }) => {
      const lines = logicalText.replace(/\r\n/g, '\n').split('\n');
      const paragraph = line => {
        const node = document.createElement('p');
        if (line) node.textContent = line;
        else node.append(document.createElement('br'));
        return node;
      };
      editor.replaceChildren();
      if (lines.length > 1) {
        const first = document.createElement('p');
        first.append(document.createTextNode(lines[0]), document.createElement('br'), document.createTextNode(lines[1]));
        editor.append(first, ...lines.slice(2).map(paragraph));
      } else {
        editor.append(paragraph(lines[0]));
      }
      if (appendUserEdit) {
        const target = [...editor.querySelectorAll(':scope > p')].find(node => node.textContent.trim());
        target.append(document.createTextNode(' USER_EDIT'));
      }
    }, { logicalText: String(value), appendUserEdit: edit });
    return result;
  };
  try {
    return await action();
  } finally {
    locatorPrototype.fill = originalFill;
  }
}

function runChild(args, endpoint, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, ARGON_CDP_ENDPOINT: endpoint, ...env },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const close = once(child, 'close').then(([code]) => ({ code, stdout, stderr }));
  return { child, close };
}

function parseJsonResult(output) {
  try { return JSON.parse(output.trim()); }
  catch (error) { throw new Error(`Expected JSON stdout, received ${JSON.stringify(output)} (${error.message})`); }
}

function startMcp(endpoint) {
  const { child, close } = runChild(['src/mcp-server.js'], endpoint);
  let pending = '';
  const waiters = new Map();
  const parsedLines = [];
  child.stdout.on('data', chunk => {
    pending += chunk.toString();
    let newline;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      parsedLines.push(message);
      if (message.id !== undefined && waiters.has(message.id)) {
        waiters.get(message.id)(message);
        waiters.delete(message.id);
      }
    }
  });
  return {
    child,
    parsedLines,
    send(message) { child.stdin.write(`${JSON.stringify(message)}\n`); },
    wait(id, timeoutMs = 10000) {
      if (parsedLines.some(message => message.id === id)) return Promise.resolve(parsedLines.find(message => message.id === id));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiters.delete(id); reject(new Error(`Timed out waiting for MCP id ${id}`)); }, timeoutMs);
        waiters.set(id, message => { clearTimeout(timer); resolve(message); });
      });
    },
    close
  };
}

(async () => {
  const executablePath = browserPath();
  if (!executablePath) throw new Error('Set AUDIT_BROWSER_PATH to an installed Chrome/Edge executable; this fixture does not download browsers.');
  const port = await reservePort();
  if (port === 9222) throw new Error('Fixture unexpectedly reserved the user browser port 9222.');
  const endpoint = `http://127.0.0.1:${port}`;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'argon-fixture-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath,
    headless: true,
    args: [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'],
    timeout: 20000
  });
  let page;
  try {
    await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixtureHtml() }));
    page = context.pages()[0] || await context.newPage();
    const url = (mode = 'complete', options = '') => `https://gemini.google.com/app/local-fixture?mode=${mode}${options ? `&${options}` : ''}`;
    const reset = async (mode = 'complete', options = '') => {
      await page.goto(url(mode, options));
      await page.waitForSelector('#send');
    };

    await reset('complete');
    let tabs = await listTargetTabs({ cdpEndpoint: endpoint, timeoutMs: 5000 });
    assert.equal(tabs.length, 1);
    const primaryTabId = tabs[0].tabId;
    const cliPrompt = `CLI_FIXTURE_${Date.now()}`;
    const cli = runChild(['bin/ask-argon.js', '--prompt', cliPrompt, '--cdp', endpoint, '--tab', primaryTabId, '--timeout', '8', '--json'], endpoint);
    cli.child.stdin.end();
    const cliResult = await cli.close;
    const parsedCli = parseJsonResult(cliResult.stdout);
    results.push({ id: 'BROWSER-01', requirement: 'Real CLI reaches a real local CDP browser and returns a fresh fixture turn', status: cliResult.code === 0 && parsedCli.text === `ANSWER:${cliPrompt}` ? 'PASS' : 'FAIL', observed: { code: cliResult.code, text: parsedCli.text, provider: parsedCli.provider, modelLabelObserved: parsedCli.modelLabelObserved } });

    results.push({ id: 'BROWSER-02', requirement: 'CDP detach leaves the fixture browser page alive', status: !page.isClosed() && await page.title() === 'Local Argon Bridge Fixture' ? 'PASS' : 'FAIL', observed: { pageClosed: page.isClosed(), title: await page.title() } });

    await record('MODEL-01', 'A non-Argon model label is rejected before submit', async () => {
      await reset('complete', 'model=other');
      const before = await page.evaluate(() => window.__submitted.length);
      const failed = await expectQueryFailure({ prompt: 'Argon Cao should not be inferred from this prompt', timeoutMs: 3000, cdpEndpoint: endpoint }, 'MODEL_UNCONFIRMED');
      const after = await page.evaluate(() => window.__submitted.length);
      assert.equal(after, before);
      return { ...failed, submittedCount: after };
    });

    await record('MODEL-02', 'An unrelated Argon-labelled button cannot override the selected non-Argon model', async () => {
      await reset('model-unrelated-button');
      const failed = await expectQueryFailure({ prompt: 'MODEL_CONTROL_FALSE_POSITIVE', timeoutMs: 3000, cdpEndpoint: endpoint }, 'MODEL_UNCONFIRMED');
      assert.deepEqual(await page.evaluate(() => window.__submitted), []);
      return { ...failed, unrelatedButtonVisible: await page.getByRole('button', { name: 'Argon Cao' }).isVisible(), submittedCount: 0 };
    });

    await record('INPUT-02', 'A hidden matching input before the visible input is ignored', async () => {
      await reset('hidden-input');
      const prompt = 'VISIBLE_INPUT_ONLY';
      const result = await queryArgon({ prompt, timeoutMs: 5000, cdpEndpoint: endpoint });
      assert.equal(result.text, `ANSWER:${prompt}`);
      assert.deepEqual(await page.evaluate(() => window.__submitted), [prompt]);
      return { text: result.text, submitted: await page.evaluate(() => window.__submitted) };
    });

    await record('SEND-02', 'A hidden matching send button before the valid button is ignored', async () => {
      await reset('hidden-send');
      const prompt = 'VISIBLE_SEND_ONLY';
      const result = await queryArgon({ prompt, timeoutMs: 5000, cdpEndpoint: endpoint });
      assert.equal(result.text, `ANSWER:${prompt}`);
      assert.deepEqual(await page.evaluate(() => window.__submitted), [prompt]);
      return { text: result.text, submitted: await page.evaluate(() => window.__submitted) };
    });

    await record('SEND-03', 'A disabled matching send button before the valid button is ignored', async () => {
      await reset('disabled-send');
      const prompt = 'ENABLED_SEND_ONLY';
      const result = await queryArgon({ prompt, timeoutMs: 5000, cdpEndpoint: endpoint });
      assert.equal(result.text, `ANSWER:${prompt}`);
      assert.deepEqual(await page.evaluate(() => window.__submitted), [prompt]);
      return { text: result.text, submitted: await page.evaluate(() => window.__submitted) };
    });

    await record('STATE-01', 'An unsent draft is preserved and no prompt is submitted', async () => {
      await reset();
      await page.locator('.ql-editor').fill('MY_UNSENT_DRAFT');
      const failed = await expectQueryFailure({ prompt: 'SHOULD_NOT_OVERWRITE_DRAFT', timeoutMs: 3000, cdpEndpoint: endpoint }, 'DRAFT_PRESENT');
      assert.equal(await page.locator('.ql-editor').innerText(), 'MY_UNSENT_DRAFT');
      assert.equal(await page.evaluate(() => window.__submitted.length), 0);
      return { ...failed, draft: await page.locator('.ql-editor').innerText() };
    });

    await record('INPUT-RICHTEXT-01', 'Quill-style paragraphs, empty paragraphs, inline breaks, Unicode, and code indentation submit as the exact logical prompt', async () => {
      await reset('richtext');
      const context = 'Résumé 🧪 source:\ninline break is represented in the same paragraph\n\n\nSynthetic records:\n  const label = "café";\n  return "🙂";';
      const prompt = 'Return the requested records exactly.';
      const fullPrompt = `${context}\n\n---\n\n${prompt}`;
      const result = await withQuillParagraphNormalization(page, {}, () =>
        queryArgon({ prompt, context, timeoutMs: 7000, cdpEndpoint: endpoint }));
      assert.equal(result.text, `ANSWER:${fullPrompt}`);
      assert.deepEqual(await page.evaluate(() => window.__submitted), [fullPrompt]);
      const submissionView = await page.evaluate(() => ({ innerText: window.__submittedInputInnerText[0], paragraphCount: window.__submittedParagraphCounts[0] }));
      assert.notEqual(submissionView.innerText, fullPrompt, 'fixture should expose the browser innerText extra paragraph spacing');
      return {
        expectedLength: fullPrompt.length,
        submittedLength: (await page.evaluate(() => window.__submitted[0])).length,
        innerTextLength: submissionView.innerText.length,
        paragraphCount: submissionView.paragraphCount
      };
    });

    await record('INPUT-RICHTEXT-02', 'A user edit made during rich-text normalization is detected and not submitted', async () => {
      await reset('richtext-edit');
      const context = 'Synthetic context:\n  const value = "original";';
      const prompt = 'Do not overwrite a concurrent user edit.';
      const expected = `${context}\n\n---\n\n${prompt}`;
      const failed = await withQuillParagraphNormalization(page, { edit: true }, () =>
        expectQueryFailure({ prompt, context, timeoutMs: 5000, cdpEndpoint: endpoint }, 'INPUT_CHANGED'));
      assert.deepEqual(await page.evaluate(() => window.__submitted), []);
      assert.match(await page.locator('.ql-editor').innerText(), /USER_EDIT/);
      const serializedDraft = await page.evaluate(() => window.__serializeEditor());
      assert.notEqual(serializedDraft, expected);
      return { ...failed, submittedCount: 0, editedDraftPreserved: true, serializedLength: serializedDraft.length };
    });

    await record('STATE-02', 'A pre-existing active response is rejected before the prompt is filled', async () => {
      await reset('busy-existing');
      const failed = await expectQueryFailure({ prompt: 'BUSY_TAB_QUERY', timeoutMs: 3000, cdpEndpoint: endpoint }, 'BUSY');
      assert.equal(await page.locator('.ql-editor').innerText(), '');
      assert.equal(await page.evaluate(() => window.__submitted.length), 0);
      return { ...failed, promptFieldEmpty: true, submittedCount: 0 };
    });

    await record('BROWSER-05', 'Old answer and generic user-turn echo are not returned', async () => {
      await reset('complete');
      const result = await queryArgon({ prompt: 'FRESH_QUERY', timeoutMs: 5000, cdpEndpoint: endpoint });
      assert.equal(result.text, 'ANSWER:FRESH_QUERY');
      assert.equal(result.text.includes('STALE_ANSWER'), false);
      assert.equal(result.text.includes('USER_TURN'), false);
      assert.equal(result.modelVerified, undefined);
      assert.equal(result.completionEvidence.markdownBusy, 'false');
      return { text: result.text, assistantIdentity: result.completionEvidence.assistantIdentity, modelLabelObserved: result.modelLabelObserved };
    });

    await record('TARGET-01', 'A same-tab URL change after submit does not invalidate the locked target identity', async () => {
      await reset('route-change');
      const result = await queryArgon({ prompt: 'URL_CHANGED_AFTER_SUBMIT', timeoutMs: 5000, cdpEndpoint: endpoint, tabId: primaryTabId });
      assert.equal(result.text, 'ANSWER:URL_CHANGED_AFTER_SUBMIT');
      assert.match(result.tabUrl, /local-fixture/);
      assert.match(await page.evaluate(() => location.pathname), /after-submit/);
      return { text: result.text, targetId: result.tabId, finalPath: await page.evaluate(() => location.pathname) };
    });

    await record('TAB-LOCK-NAV-01', 'Navigation while waiting for the tab lock is rejected before prompt fill', async () => {
      await reset('complete');
      const releaseHeldLock = await _internals.acquireTabLock(endpoint, primaryTabId, _internals.createDeadline(5000));
      let signalWaiting;
      const waitingForLock = new Promise(resolve => { signalWaiting = resolve; });
      const pending = queryArgon({
        prompt: 'MUST_NOT_ENTER_REPLACED_DOCUMENT', timeoutMs: 5000, cdpEndpoint: endpoint, tabId: primaryTabId,
        onProgress: event => { if (event.status === 'waiting_lock') signalWaiting(); }
      });
      await waitingForLock;
      await page.goto('https://gemini.google.com/app/replaced-document?mode=complete');
      await releaseHeldLock();
      await assert.rejects(pending, error => error.code === 'TAB_CHANGED');
      assert.equal(await page.locator('.ql-editor').innerText(), '');
      assert.equal(await page.evaluate(() => window.__submitted.length), 0);
      return { code: 'TAB_CHANGED', promptFieldEmpty: true, submittedCount: 0 };
    });

    await record('TAB-NAV-01', 'A new full document after submission cannot supply a candidate answer', async () => {
      await reset('navigate-after-submit');
      return expectQueryFailure({ prompt: 'FULL_NAVIGATION_QUERY', timeoutMs: 5000, cdpEndpoint: endpoint }, 'TAB_CHANGED');
    });

    await record('BROWSER-06', 'A stale answer is rejected if no new assistant turn starts', async () => {
      await reset('no-start');
      return expectQueryFailure({ prompt: 'NO_START_QUERY', timeoutMs: 1100, cdpEndpoint: endpoint }, 'TIMEOUT_START');
    });

    await record('IDENTITY-01', 'A new DOM node without a stable assistant identity is not returned as a fresh turn', async () => {
      await reset('no-id');
      return expectQueryFailure({ prompt: 'MISSING_ID_QUERY', timeoutMs: 1100, cdpEndpoint: endpoint }, 'TIMEOUT_INCOMPLETE');
    });

    await record('CANCEL-01', 'Cancellation before filling does not submit or leave a late draft', async () => {
      await reset('complete');
      const controller = new AbortController();
      await assert.rejects(queryArgon({
        prompt: 'CANCEL_BEFORE_FILL', timeoutMs: 5000, cdpEndpoint: endpoint, signal: controller.signal,
        onProgress: event => { if (event.status === 'filling') controller.abort(); }
      }), error => error.code === 'CANCELLED');
      assert.equal(await page.locator('.ql-editor').innerText(), '');
      assert.equal(await page.evaluate(() => window.__submitted.length), 0);
      const followup = await queryArgon({ prompt: 'AFTER_CANCEL', timeoutMs: 5000, cdpEndpoint: endpoint });
      assert.equal(followup.text, 'ANSWER:AFTER_CANCEL');
      return { cancelled: true, submittedCountBeforeFollowup: 0, followupText: followup.text };
    });

    await record('BROWSER-04', 'An incomplete active stream fails at the shared deadline', async () => {
      await reset('partial');
      return expectQueryFailure({ prompt: 'PARTIAL_QUERY', timeoutMs: 1200, cdpEndpoint: endpoint }, 'TIMEOUT_INCOMPLETE');
    });

    await record('RESP-01', 'An assistant response equal to the submitted prompt is rejected', async () => {
      await reset('echo');
      return expectQueryFailure({ prompt: 'ECHO_QUERY', timeoutMs: 4000, cdpEndpoint: endpoint }, 'INVALID_RESPONSE');
    });

    await record('PROVIDER-01', 'Provider errors do not return successful text', async () => {
      await reset('error');
      return expectQueryFailure({ prompt: 'PROVIDER_ERROR_QUERY', timeoutMs: 4000, cdpEndpoint: endpoint }, 'PROVIDER_ERROR');
    });

    await record('TAB-01', 'Multiple Gemini tabs require an explicit target id', async () => {
      await reset();
      const second = await context.newPage();
      await second.goto(url('complete'));
      tabs = await listTargetTabs({ cdpEndpoint: endpoint, timeoutMs: 5000 });
      assert.equal(tabs.length, 2);
      await expectQueryFailure({ prompt: 'AMBIGUOUS_TAB_QUERY', timeoutMs: 3000, cdpEndpoint: endpoint }, 'AMBIGUOUS_TAB');
      const selected = tabs.find(tab => tab.tabId === primaryTabId);
      assert.ok(selected);
      const result = await queryArgon({ prompt: 'SELECTED_TAB_QUERY', timeoutMs: 5000, cdpEndpoint: endpoint, tabId: primaryTabId });
      assert.equal(result.tabId, primaryTabId);
      assert.equal(result.text, 'ANSWER:SELECTED_TAB_QUERY');
      await second.close();
      return { listedTabIds: tabs.map(tab => tab.tabId), selectedTabId: result.tabId };
    });

    await record('TAB-02', 'A hostname suffix lookalike is rejected', async () => {
      await page.goto('https://gemini.google.com.attacker.invalid/app/local-fixture');
      await expectQueryFailure({ prompt: 'WRONG_HOST_QUERY', timeoutMs: 3000, cdpEndpoint: endpoint }, 'UNSUPPORTED_PROVIDER');
      return { code: 'UNSUPPORTED_PROVIDER' };
    });

    await record('LOCK-01', 'Two CLI processes sharing a tab return their own serialized responses', async () => {
      await reset('complete', 'delay=350');
      const promptA = `PROCESS_A_${Date.now()}`;
      const promptB = `PROCESS_B_${Date.now()}`;
      const args = prompt => ['bin/ask-argon.js', '--prompt', prompt, '--cdp', endpoint, '--tab', primaryTabId, '--timeout', '8', '--json'];
      const first = runChild(args(promptA), endpoint);
      first.child.stdin.end();
      const second = runChild(args(promptB), endpoint);
      second.child.stdin.end();
      const [one, two] = await Promise.all([first.close, second.close]);
      const firstJson = parseJsonResult(one.stdout);
      const secondJson = parseJsonResult(two.stdout);
      const resultsByText = new Set([firstJson.text, secondJson.text]);
      assert.deepEqual(resultsByText, new Set([`ANSWER:${promptA}`, `ANSWER:${promptB}`]));
      assert.equal(one.code, 0, one.stderr);
      assert.equal(two.code, 0, two.stderr);
      return { processA: firstJson.text, processB: secondJson.text };
    });

    await record('MCP-01', 'MCP stdio child returns the same fresh completion metadata', async () => {
      await reset('complete');
      const mcp = startMcp(endpoint);
      mcp.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'local-fixture', version: '1' } } });
      const initialized = await mcp.wait(1);
      assert.equal(initialized.result.serverInfo.name, 'gemini-argon-bridge');
      mcp.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ask_gemini_argon', arguments: { prompt: 'MCP_FIXTURE_QUERY', timeoutSeconds: 8, tabId: primaryTabId } } });
      const response = await mcp.wait(2);
      assert.equal(response.result.content[0].text, 'ANSWER:MCP_FIXTURE_QUERY');
      assert.equal(response.result.structuredContent.modelLabelObserved.includes('Argon'), true);
      mcp.child.stdin.end();
      const closed = await mcp.close;
      assert.equal(closed.code, 0, closed.stderr);
      return { text: response.result.content[0].text, evidence: response.result.structuredContent.completionEvidence };
    });

    await record('MCP-LOCK-01', 'Concurrent MCP tool calls serialize on the same browser tab', async () => {
      await reset('complete', 'delay=250');
      const mcp = startMcp(endpoint);
      mcp.send({ jsonrpc: '2.0', id: 70, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'local-fixture', version: '1' } } });
      await mcp.wait(70);
      mcp.send({ jsonrpc: '2.0', id: 71, method: 'tools/call', params: { name: 'ask_gemini_argon', arguments: { prompt: 'MCP_PARALLEL_A', timeoutSeconds: 8, tabId: primaryTabId } } });
      mcp.send({ jsonrpc: '2.0', id: 72, method: 'tools/call', params: { name: 'ask_gemini_argon', arguments: { prompt: 'MCP_PARALLEL_B', timeoutSeconds: 8, tabId: primaryTabId } } });
      const [a, b] = await Promise.all([mcp.wait(71), mcp.wait(72)]);
      const answerTexts = new Set([a.result.content[0].text, b.result.content[0].text]);
      assert.deepEqual(answerTexts, new Set(['ANSWER:MCP_PARALLEL_A', 'ANSWER:MCP_PARALLEL_B']));
      assert.equal(a.result.isError || false, false);
      assert.equal(b.result.isError || false, false);
      mcp.child.stdin.end();
      const closed = await mcp.close;
      assert.equal(closed.code, 0, closed.stderr);
      return { answers: [a.result.content[0].text, b.result.content[0].text], count: answerTexts.size };
    });

    await record('MCP-CANCEL-01', 'MCP cancellation aborts an active wait and the server remains alive', async () => {
      await reset('partial');
      const mcp = startMcp(endpoint);
      mcp.send({ jsonrpc: '2.0', id: 51, method: 'tools/call', params: { name: 'ask_gemini_argon', arguments: { prompt: 'CANCEL_FIXTURE_QUERY', timeoutSeconds: 8, tabId: primaryTabId } } });
      await page.waitForFunction(() => window.__submitted.length > 0, null, { timeout: 5000 });
      mcp.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 51, reason: 'fixture cancellation' } });
      const cancelled = await mcp.wait(51);
      assert.equal(cancelled.result.isError, true);
      assert.match(cancelled.result.content[0].text, /CANCELLED/);
      mcp.send({ jsonrpc: '2.0', id: 52, method: 'ping' });
      assert.deepEqual((await mcp.wait(52)).result, {});
      mcp.child.stdin.end();
      const closed = await mcp.close;
      assert.equal(closed.code, 0, closed.stderr);
      return { error: cancelled.result.structuredContent.errorCode, serverAnsweredPing: true };
    });

    const report = {
      generatedAt: new Date().toISOString(),
      scope: 'Installed browser and real CDP; all navigations intercepted to local synthetic HTML; no provider inference or user browser used.',
      browser: { executable: path.basename(executablePath), temporaryProfile: true, cdpPort: port, userPort9222Used: false },
      summary: Object.fromEntries(['PASS', 'FAIL'].map(status => [status, results.filter(result => result.status === status).length])),
      results
    };
    const outputDir = path.join(root, 'audit', 'postfix');
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, 'browser-fixture.json'), `${JSON.stringify(report, null, 2)}\n`);
    for (const result of results) process.stdout.write(`${result.status} ${result.id}: ${result.requirement}\n`);
    process.stdout.write(`${JSON.stringify(report.summary)}\n`);
    if (report.summary.FAIL) process.exitCode = 1;
  } finally {
    await context.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 2;
});
