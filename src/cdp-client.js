const { chromium } = require('playwright-core');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { GEMINI_WEB } = require('./selectors');

const DEFAULT_CDP_ENDPOINT = 'http://127.0.0.1:9222';
const GEMINI_HOST = 'gemini.google.com';
const POLL_INTERVAL_MS = 250;
const LOCK_DIRECTORY = path.join(os.tmpdir(), 'gemini-argon-bridge-locks');

function bridgeError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function validateTimeout(timeoutMs) {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw bridgeError('INVALID_TIMEOUT', 'timeoutMs must be a finite positive number.');
  }
  return timeoutMs;
}

function validateEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch (error) {
    throw bridgeError('INVALID_ENDPOINT', 'cdpEndpoint must be an absolute HTTP(S) URL.', error);
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw bridgeError('INVALID_ENDPOINT', 'cdpEndpoint must be an absolute HTTP(S) URL.');
  }
  return url.toString().replace(/\/$/, '');
}

function createDeadline(timeoutMs, signal) {
  const endsAt = performance.now() + validateTimeout(timeoutMs);
  return {
    remaining() {
      throwIfAborted(signal);
      const remaining = Math.ceil(endsAt - performance.now());
      if (remaining <= 0) throw bridgeError('TIMEOUT', 'The request deadline expired.');
      return remaining;
    }
  };
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw bridgeError('CANCELLED', 'The request was cancelled.');
  }
}

async function withinDeadline(operation, deadline, signal, label = 'Browser operation') {
  const timeoutMs = deadline.remaining();
  throwIfAborted(signal);
  let timer;
  let abortHandler;
  const timed = new Promise((_, reject) => {
    timer = setTimeout(() => reject(bridgeError('TIMEOUT', `${label} exceeded the request deadline.`)), timeoutMs);
    if (signal) {
      abortHandler = () => reject(bridgeError('CANCELLED', 'The request was cancelled.'));
      signal.addEventListener('abort', abortHandler, { once: true });
    }
  });
  try {
    return await Promise.race([Promise.resolve().then(operation), timed]);
  } finally {
    clearTimeout(timer);
    if (signal && abortHandler) signal.removeEventListener('abort', abortHandler);
  }
}

async function sleepWithinDeadline(ms, deadline, signal) {
  await withinDeadline(() => new Promise(resolve => setTimeout(resolve, Math.min(ms, deadline.remaining()))), deadline, signal, 'Wait');
}

function canonicalEndpoint(endpoint) {
  const url = new URL(validateEndpoint(endpoint));
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  const host = localHosts.has(url.hostname.toLowerCase()) ? '<loopback>' : url.hostname.toLowerCase();
  return `${url.protocol}//${host}:${url.port || (url.protocol === 'https:' ? '443' : '80')}${url.pathname.replace(/\/$/, '')}`;
}

function exactSupportedUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && url.hostname.toLowerCase() === GEMINI_HOST ? GEMINI_WEB : null;
  } catch {
    return null;
  }
}

async function getTargetId(page, deadline, signal) {
  const session = await withinDeadline(() => page.context().newCDPSession(page), deadline, signal, 'Create CDP session');
  try {
    const info = await withinDeadline(() => session.send('Target.getTargetInfo'), deadline, signal, 'Read tab identity');
    const targetId = info?.targetInfo?.targetId;
    if (!targetId || typeof targetId !== 'string') throw bridgeError('TAB_ID_UNAVAILABLE', 'Could not read the browser tab identity.');
    return targetId;
  } finally {
    await session.detach().catch(() => {});
  }
}

async function readDocumentToken(page, deadline, signal) {
  return withinDeadline(() => page.evaluate(() => performance.timeOrigin), deadline, signal, 'Read tab document identity');
}

async function assertSameDocument(page, targetId, documentToken, initialUrl, deadline, signal, { allowSameDocumentUrlChange = false } = {}) {
  const currentUrl = page.url();
  if (!exactSupportedUrl(currentUrl)) {
    throw bridgeError('TAB_CHANGED', 'The selected tab navigated away from supported Gemini Web; the request was stopped.');
  }
  if (!allowSameDocumentUrlChange && currentUrl !== initialUrl) {
    throw bridgeError('TAB_CHANGED', 'The selected tab URL changed before submission; the request was not sent.');
  }
  const currentTargetId = await getTargetId(page, deadline, signal);
  if (currentTargetId !== targetId) {
    throw bridgeError('TAB_CHANGED', 'The selected CDP target changed during the request.');
  }
  const currentDocumentToken = await readDocumentToken(page, deadline, signal);
  if (currentDocumentToken !== documentToken) {
    throw bridgeError('TAB_CHANGED', 'The selected tab loaded a different document during the request.');
  }
}

async function findTargetPage(browser, options = {}) {
  const { tabId, deadline = createDeadline(600000), signal } = options;
  throwIfAborted(signal);
  const pages = browser.contexts().flatMap(context => context.pages());
  const candidates = pages.map(page => ({ page, adapter: exactSupportedUrl(page.url()) })).filter(item => item.adapter);
  if (!candidates.length) {
    throw bridgeError('UNSUPPORTED_PROVIDER', `No HTTPS Gemini Web tab was found. Supported host: ${GEMINI_HOST}.`);
  }

  const identified = await Promise.all(candidates.map(async item => ({
    ...item,
    targetId: await getTargetId(item.page, deadline, signal)
  })));
  if (tabId) {
    const selected = identified.find(item => item.targetId === tabId);
    if (!selected) throw bridgeError('TAB_NOT_FOUND', `No supported tab has CDP target id ${tabId}.`);
    return selected;
  }
  if (identified.length > 1) {
    throw bridgeError('AMBIGUOUS_TAB', 'More than one Gemini Web tab is open. Pass tabId/--tab to choose one.');
  }
  return identified[0];
}

async function listTargetTabs({ cdpEndpoint = process.env.ARGON_CDP_ENDPOINT || DEFAULT_CDP_ENDPOINT, timeoutMs = 10000, signal } = {}) {
  const deadline = createDeadline(timeoutMs, signal);
  const endpoint = validateEndpoint(cdpEndpoint);
  const browser = await connectBrowser(endpoint, { deadline, signal });
  try {
    const pages = browser.contexts().flatMap(context => context.pages());
    const supported = pages.filter(page => exactSupportedUrl(page.url()));
    return await Promise.all(supported.map(async page => ({
      tabId: await getTargetId(page, deadline, signal),
      title: await withinDeadline(() => page.title(), deadline, signal, 'Read tab title'),
      url: page.url(),
      provider: GEMINI_WEB.name
    })));
  } finally {
    await detachBrowser(browser).catch(() => {});
  }
}

async function connectBrowser(cdpEndpoint = DEFAULT_CDP_ENDPOINT, options = {}) {
  const endpoint = validateEndpoint(cdpEndpoint);
  const deadline = options.deadline || createDeadline(options.timeoutMs ?? 600000, options.signal);
  const signal = options.signal;
  throwIfAborted(signal);
  let connectionSettled = false;
  const connecting = chromium.connectOverCDP(endpoint, { timeout: deadline.remaining() });
  // connectOverCDP has no AbortSignal support. If cancellation wins the race,
  // detach a connection that completes later without touching its browser.
  const guardedConnection = connecting.then(connectedBrowser => {
    if (connectionSettled) detachBrowser(connectedBrowser).catch(() => {});
    return connectedBrowser;
  });
  guardedConnection.catch(() => {});
  try {
    return await withinDeadline(() => guardedConnection, deadline, signal, 'CDP connection');
  } catch (error) {
    if (error.code === 'TIMEOUT' || error.code === 'CANCELLED') throw error;
    throw bridgeError('CONNECT_FAILED', `Cannot connect to CDP on ${endpoint}. Ensure Chromium is running with remote debugging enabled. ${error.message}`, error);
  } finally {
    connectionSettled = true;
  }
}

async function detachBrowser(browser) {
  if (typeof browser?.disconnect === 'function') return browser.disconnect();
  // Playwright Browser.close() on a CDP connection detaches the client; the
  // baseline browser fixture verified it leaves the externally launched
  // Chromium process and window alive.
  if (typeof browser?.close === 'function') return browser.close();
}

async function visibleControlMetadata(page, deadline, signal) {
  return withinDeadline(async () => page.locator('button,[role="button"]').evaluateAll(elements => elements
    .filter(element => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    })
    .map(element => ({
      text: (element.innerText || '').trim(),
      label: (element.getAttribute('aria-label') || '').trim(),
      title: (element.getAttribute('title') || '').trim()
    }))), deadline, signal, 'Read model controls');
}

async function readModelEvidence(page, deadline, signal) {
  const controls = await withinDeadline(() => page.locator(GEMINI_WEB.modelControlSelector).evaluateAll(elements => elements
    .filter(element => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    })
    .map(element => ({
      text: (element.innerText || '').replace(/\s+/g, ' ').trim(),
      label: (element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()
    }))), deadline, signal, 'Read selected-model control');
  if (!controls.length) {
    throw bridgeError('MODEL_UNCONFIRMED', 'No visible model control identifies Argon; the request was not submitted.');
  }
  if (controls.length > 1) {
    throw bridgeError('MODEL_AMBIGUOUS', 'More than one visible model control identifies Argon; the request was not submitted.');
  }
  const control = controls[0];
  const selected = control.label.match(/(?:hiện tại là|current model:)\s*(.+)$/i)?.[1]?.trim();
  if (!selected) {
    throw bridgeError('MODEL_UNCONFIRMED', 'The visible model control does not expose a recognized current-model label; the request was not submitted.');
  }
  const modelLabelObserved = selected;
  if (control.text && control.text.toLocaleLowerCase() !== modelLabelObserved.toLocaleLowerCase()) {
    throw bridgeError('MODEL_CONTROL_CONFLICT', 'The current-model control label and visible value disagree; the request was not submitted.');
  }
  if (!/\bargon\b/i.test(modelLabelObserved)) {
    throw bridgeError('MODEL_UNCONFIRMED', 'The selected-model control does not identify Argon; the request was not submitted.');
  }
  const thinkingLabelObserved = /\b(cao|high)\b/i.test(modelLabelObserved)
    ? (modelLabelObserved.match(/\b(cao|high)\b/i)?.[0] || null)
    : null;
  if (!thinkingLabelObserved) {
    throw bridgeError('THINKING_LABEL_UNCONFIRMED', 'The visible model control does not identify Argon Cao/High; the request was not submitted.');
  }
  return { modelLabelObserved, thinkingLabelObserved, modelEvidenceSource: 'selected-model-control-aria-label' };
}

async function currentStopControl(page, deadline, signal) {
  const controls = await visibleControlMetadata(page, deadline, signal);
  return controls.some(control => /\b(stop|dừng)(?:\s+(?:generating|generation|response|tạo))?\b/i.test(`${control.text} ${control.label}`));
}

async function assistantTurns(page, deadline, signal) {
  return withinDeadline(() => page.locator(GEMINI_WEB.assistantSelector).evaluateAll((elements, selectors) => {
    const topLevel = elements.filter(element => !element.parentElement?.closest(selectors.assistantSelector));
    return topLevel.map(element => {
      const message = element.querySelector('message-content');
      const markdown = element.querySelector(selectors.answerSelector);
      return {
        // Only stable DOM identifiers establish turn identity. A text/count or
        // WeakMap fallback would misclassify a rerender as a fresh answer.
        identity: message?.id || element.id || null,
        text: (markdown?.innerText || '').trim(),
        messageBusy: message?.getAttribute('aria-busy'),
        markdownBusy: markdown?.getAttribute('aria-busy'),
        labelAnnouncerBusy: element.querySelector('.model-response-label-announcer')?.getAttribute('aria-busy'),
        completionMarker: Boolean(element.querySelector(selectors.completeSelector)),
        errorText: (element.querySelector('[role="alert"], [data-error], .error-message')?.innerText || '').trim()
      };
    });
  }, { assistantSelector: GEMINI_WEB.assistantSelector, answerSelector: GEMINI_WEB.answerSelector, completeSelector: GEMINI_WEB.completeSelector }), deadline, signal, 'Read assistant turns');
}

function visibleEnabledSelector(selectors) {
  return selectors.map(selector => `${selector}:visible:not(:disabled):not([aria-disabled="true"])`).join(',');
}

async function locateInputBox(page, deadline, signal) {
  const selector = visibleEnabledSelector(GEMINI_WEB.inputSelectors);
  const inputs = await withinDeadline(() => page.locator(selector).evaluateAll(elements => elements.map(element => ({
    editable: element.isContentEditable || element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement,
    readOnly: Boolean(element.readOnly)
  })).filter(candidate => candidate.editable && !candidate.readOnly)), deadline, signal, 'Find prompt input');
  if (!inputs.length) throw bridgeError('INPUT_NOT_FOUND', 'Could not find the Gemini Web prompt input.');
  if (inputs.length > 1) throw bridgeError('INPUT_AMBIGUOUS', 'More than one visible prompt input was found.');
  return page.locator(selector).first();
}

async function readInputValue(inputBox, deadline, signal) {
  return withinDeadline(() => inputBox.evaluate(element => {
    if (element.value !== undefined && element.value !== null) return String(element.value);
    if (!element.isContentEditable) return String(element.innerText ?? element.textContent ?? '');

    // Rich-text editors such as Quill store logical lines as block elements.
    // Chromium's innerText may insert an extra LF between paragraphs when CSS
    // margins are present, while textContent drops paragraph boundaries.
    // Serialize the editable DOM structure instead: block siblings delimit
    // paragraphs and <br> represents an inline line break.
    const blockTags = new Set([
      'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT',
      'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'OL', 'P', 'PRE', 'SECTION', 'UL'
    ]);
    const isBlock = node => node.nodeType === Node.ELEMENT_NODE && blockTags.has(node.tagName);
    const isEmptyParagraphPlaceholder = node => isBlock(node) && node.childNodes.length === 1 &&
      node.firstChild.nodeType === Node.ELEMENT_NODE && node.firstChild.tagName === 'BR';

    function serialize(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      if (node.tagName === 'BR') return '\n';
      if (isEmptyParagraphPlaceholder(node)) return '';

      let output = '';
      let previousWasBlock = false;
      for (const child of node.childNodes) {
        const block = isBlock(child);
        if (block && previousWasBlock) output += '\n';
        output += serialize(child);
        previousWasBlock = block;
      }
      return output;
    }

    // A lone direct <br> is the browser's placeholder for an empty editor.
    if (element.childNodes.length === 1 && element.firstChild.nodeType === Node.ELEMENT_NODE && element.firstChild.tagName === 'BR') return '';
    return serialize(element);
  }), deadline, signal, 'Read prompt draft');
}

async function submitPrompt(page, inputBox, deadline, signal) {
  const selector = visibleEnabledSelector(GEMINI_WEB.submitSelectors);
  const buttons = await withinDeadline(() => page.locator(selector).evaluateAll(elements => elements.map(element => ({
    disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true'
  })).filter(button => !button.disabled)), deadline, signal, 'Find send control');
  if (buttons.length !== 1) {
    throw bridgeError(buttons.length ? 'SEND_AMBIGUOUS' : 'SEND_NOT_FOUND', 'Could not identify exactly one enabled Gemini Web send control.');
  }
  throwIfAborted(signal);
  const clickOperation = page.locator(selector).first().click({
    timeout: Math.max(1, Math.min(30000, deadline.remaining() - 50)),
    signal
  });
  try {
    await withinDeadline(() => clickOperation, deadline, signal, 'Submit prompt');
  } catch (error) {
    // Do not release the tab lock while a click that may submit is still in flight.
    await clickOperation.catch(() => {});
    throw error;
  }
}

function lockPath(endpoint, targetId) {
  const key = `${canonicalEndpoint(endpoint)}\n${targetId}`;
  const digest = createHash('sha256').update(key).digest('hex');
  return path.join(LOCK_DIRECTORY, `${digest}.lock`);
}

async function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'EPERM') return true;
    if (error.code === 'ESRCH') return false;
    return true;
  }
}

async function lockOwnerIsStale(lockDir) {
  let metadata;
  try {
    metadata = JSON.parse(await fs.readFile(path.join(lockDir, 'owner.json'), 'utf8'));
  } catch {
    // Missing or malformed owner metadata can be an initializer paused after
    // mkdir. Age cannot distinguish that live claimant from an orphan, so fail
    // closed and let the request deadline surface the stuck lock.
    return false;
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
      !Number.isSafeInteger(metadata.pid) || metadata.pid <= 0 ||
      typeof metadata.nonce !== 'string' || !metadata.nonce.trim()) return false;
  // Only a valid owner record with an OS-confirmed dead PID is reclaimable.
  return !(metadata && await processIsAlive(metadata.pid));
}

async function acquireRecoveryGuard(lockDir, deadline, signal) {
  const guardDirectory = `${lockDir}.reclaim-guard`;
  const owner = { pid: process.pid, nonce: randomUUID() };
  while (true) {
    throwIfAborted(signal);
    deadline.remaining();
    try {
      await fs.mkdir(guardDirectory);
      try {
        await fs.writeFile(path.join(guardDirectory, 'owner.json'), JSON.stringify(owner), { flag: 'wx' });
      } catch (error) {
        await fs.rm(guardDirectory, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
      return async () => {
        try {
          const current = JSON.parse(await fs.readFile(path.join(guardDirectory, 'owner.json'), 'utf8'));
          if (current.nonce === owner.nonce) await fs.rm(guardDirectory, { recursive: true, force: true });
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await sleepWithinDeadline(50, deadline, signal);
    }
  }
}

async function removeStaleLock(lockDir, deadline, signal) {
  // The optimistic read lets simultaneous reclaimers queue on the guard. The
  // owner is always re-read while holding that guard before any rename; a
  // contender that waited behind another reclaimer therefore sees its live
  // replacement and cannot move it aside.
  if (!await lockOwnerIsStale(lockDir)) return false;
  throwIfAborted(signal);
  deadline.remaining();
  const releaseGuard = await acquireRecoveryGuard(lockDir, deadline, signal);
  try {
    if (!await lockOwnerIsStale(lockDir)) return false;
    throwIfAborted(signal);
    deadline.remaining();
    const quarantine = `${lockDir}.stale-${randomUUID()}`;
    try {
      await fs.rename(lockDir, quarantine);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EEXIST' || error.code === 'EPERM') return false;
      throw error;
    }
    await fs.rm(quarantine, { recursive: true, force: true });
    return true;
  } finally {
    await releaseGuard().catch(() => {});
  }
}

async function acquireTabLock(endpoint, targetId, deadline, signal, onProgress = () => {}) {
  await fs.mkdir(LOCK_DIRECTORY, { recursive: true });
  const directory = lockPath(endpoint, targetId);
  const owner = { pid: process.pid, nonce: randomUUID(), createdAt: new Date().toISOString() };
  let announced = false;
  while (true) {
    throwIfAborted(signal);
    deadline.remaining();
    try {
      await fs.mkdir(directory);
      // Do not remove this path on a metadata-write error. During an interrupted
      // initialization another process or external actor may have installed a
      // different owner, and cleanup must never delete that claimant's lock.
      // Ownerless/malformed directories fail closed until manual recovery.
      await fs.writeFile(path.join(directory, 'owner.json'), JSON.stringify(owner), { flag: 'wx' });
      return async () => {
        try {
          const current = JSON.parse(await fs.readFile(path.join(directory, 'owner.json'), 'utf8'));
          if (current.nonce === owner.nonce) await fs.rm(directory, { recursive: true, force: true });
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    if (!announced) {
      announced = true;
      onProgress({ status: 'waiting_lock', message: 'Waiting for another request using this browser tab...' });
    }
    await removeStaleLock(directory, deadline, signal);
    await sleepWithinDeadline(100, deadline, signal);
  }
}

function failOnDeadline(error, phase) {
  if (error.code === 'TIMEOUT') {
    if (phase === 'start') throw bridgeError('TIMEOUT_START', 'The request deadline expired before a new assistant turn started.', error);
    if (phase === 'complete') throw bridgeError('TIMEOUT_INCOMPLETE', 'The request deadline expired before the assistant turn completed.', error);
    throw bridgeError('TIMEOUT', 'The request deadline expired before submission.', error);
  }
  throw error;
}

async function queryArgon({
  prompt,
  context = '',
  timeoutMs = 600000,
  cdpEndpoint = process.env.ARGON_CDP_ENDPOINT || DEFAULT_CDP_ENDPOINT,
  tabId,
  signal,
  onProgress = () => {}
}) {
  if (typeof prompt !== 'string' || (typeof context !== 'string')) {
    throw bridgeError('INVALID_INPUT', 'prompt and context must be strings.');
  }
  const cleanedPrompt = prompt.trim();
  const cleanedContext = context.trim();
  if (!cleanedPrompt) throw bridgeError('EMPTY_PROMPT', 'Prompt is empty. Please provide a prompt.');
  const fullPrompt = cleanedContext ? `${cleanedContext}\n\n---\n\n${cleanedPrompt}` : cleanedPrompt;
  const deadline = createDeadline(timeoutMs, signal);
  const endpoint = validateEndpoint(cdpEndpoint);
  const startedAt = performance.now();
  let browser;
  let releaseLock;
  let phase = 'preflight';

  try {
    throwIfAborted(signal);
    onProgress({ status: 'connecting', message: `Connecting to browser CDP on ${endpoint}...` });
    browser = await connectBrowser(endpoint, { deadline, signal });
    const selected = await findTargetPage(browser, { tabId, deadline, signal });
    const { page, adapter, targetId } = selected;
    const tabTitle = await withinDeadline(() => page.title(), deadline, signal, 'Read tab title');
    const tabUrl = page.url();
    const documentToken = await readDocumentToken(page, deadline, signal);
    if (!exactSupportedUrl(page.url()) || page.url() !== tabUrl) {
      throw bridgeError('TAB_CHANGED', 'The selected tab changed while the request was being prepared.');
    }
    page.setDefaultTimeout(deadline.remaining());
    onProgress({ status: 'connected', message: `Attached to Gemini Web tab: "${tabTitle}" (${tabUrl})` });

    releaseLock = await acquireTabLock(endpoint, targetId, deadline, signal, onProgress);
    // Every read below happens after lock acquisition so a queued request
    // revalidates the tab state left by the request ahead of it.
    page.setDefaultTimeout(deadline.remaining());
    await assertSameDocument(page, targetId, documentToken, tabUrl, deadline, signal);
    if (await currentStopControl(page, deadline, signal)) {
      throw bridgeError('BUSY', 'Gemini Web is already generating on the selected tab.');
    }
    const previousTurns = await assistantTurns(page, deadline, signal);
    if (previousTurns.some(turn => turn.messageBusy === 'true' || turn.markdownBusy === 'true' || turn.labelAnnouncerBusy === 'true')) {
      throw bridgeError('BUSY', 'An assistant turn is still marked busy on the selected tab.');
    }
    const model = await readModelEvidence(page, deadline, signal);
    const inputBox = await locateInputBox(page, deadline, signal);
    const draft = await readInputValue(inputBox, deadline, signal);
    if (draft.trim()) throw bridgeError('DRAFT_PRESENT', 'The Gemini Web input contains an unsent draft; it was left untouched.');

    await assertSameDocument(page, targetId, documentToken, tabUrl, deadline, signal);
    throwIfAborted(signal);
    onProgress({ status: 'filling', message: 'Inserting prompt into the empty Gemini Web input...' });
    const fillOperation = inputBox.fill(fullPrompt, {
      timeout: Math.max(1, Math.min(30000, deadline.remaining() - 50)),
      signal
    });
    try {
      await withinDeadline(() => fillOperation, deadline, signal, 'Fill prompt');
    } catch (error) {
      // Keep the cross-process lock until an in-flight edit settles. A cancelled
      // fill must not complete later after another request has acquired the tab.
      await fillOperation.catch(() => {});
      throw error;
    }
    throwIfAborted(signal);
    await assertSameDocument(page, targetId, documentToken, tabUrl, deadline, signal);
    if ((await readInputValue(inputBox, deadline, signal)).replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ') !== fullPrompt) {
      throw bridgeError('INPUT_CHANGED', 'The prompt input changed after it was filled; it was not submitted.');
    }
    if (await currentStopControl(page, deadline, signal)) {
      throw bridgeError('BUSY', 'Gemini Web started generating before this prompt could be submitted.');
    }
    const currentModel = await readModelEvidence(page, deadline, signal);
    if (currentModel.modelLabelObserved !== model.modelLabelObserved) {
      throw bridgeError('MODEL_CHANGED', 'The selected model changed before submission; the prompt was not sent.');
    }
    await assertSameDocument(page, targetId, documentToken, tabUrl, deadline, signal);
    phase = 'start';
    onProgress({ status: 'submitting', message: 'Submitting prompt...' });
    await submitPrompt(page, inputBox, deadline, signal);

    let generationStarted = false;
    while (!generationStarted) {
      try {
        const turns = await assistantTurns(page, deadline, signal);
        await assertSameDocument(page, targetId, documentToken, tabUrl, deadline, signal, { allowSameDocumentUrlChange: true });
        const fresh = turns.filter(turn => turn.identity && !previousTurns.some(previous => previous.identity === turn.identity));
        generationStarted = fresh.length > 0 || await currentStopControl(page, deadline, signal);
        if (generationStarted) break;
        await sleepWithinDeadline(POLL_INTERVAL_MS, deadline, signal);
      } catch (error) {
        failOnDeadline(error, 'start');
      }
    }

    phase = 'complete';
    onProgress({ status: 'generating', message: 'Waiting for a fresh assistant turn to complete...' });
    while (true) {
      try {
        throwIfAborted(signal);
        const turns = await assistantTurns(page, deadline, signal);
        await assertSameDocument(page, targetId, documentToken, tabUrl, deadline, signal, { allowSameDocumentUrlChange: true });
        const fresh = turns.filter(turn => turn.identity && !previousTurns.some(previous => previous.identity === turn.identity));
        const candidate = fresh[fresh.length - 1];
        const stopVisible = await currentStopControl(page, deadline, signal);
        if (candidate?.errorText) throw bridgeError('PROVIDER_ERROR', candidate.errorText);
        const complete = Boolean(candidate?.text && candidate.completionMarker && candidate.markdownBusy === 'false' && candidate.labelAnnouncerBusy === 'false' && candidate.messageBusy !== 'true' && !stopVisible);
        if (complete) {
          if (candidate.text === fullPrompt || candidate.text === cleanedPrompt) {
            throw bridgeError('INVALID_RESPONSE', 'The fresh assistant content is identical to the submitted prompt.');
          }
          throwIfAborted(signal);
          onProgress({ status: 'complete', length: candidate.text.length });
          return {
            success: true,
            text: candidate.text,
            provider: adapter.name,
            providerEvidenceLevel: adapter.evidenceLevel,
            modelLabelObserved: model.modelLabelObserved,
            thinkingLabelObserved: model.thinkingLabelObserved,
            modelEvidenceSource: model.modelEvidenceSource,
            completionEvidence: {
              type: 'fresh-assistant-turn-complete',
              assistantIdentity: candidate.identity,
              marker: GEMINI_WEB.completeSelector,
              messageBusy: candidate.messageBusy,
              markdownBusy: candidate.markdownBusy,
              labelAnnouncerBusy: candidate.labelAnnouncerBusy,
              stopControlVisible: false
            },
            tabId: targetId,
            tabTitle,
            tabUrl,
            elapsedMs: Math.round(performance.now() - startedAt)
          };
        }
        if (candidate?.text) onProgress({ status: 'streaming', length: candidate.text.length });
        await sleepWithinDeadline(POLL_INTERVAL_MS, deadline, signal);
      } catch (error) {
        failOnDeadline(error, phase);
      }
    }
  } catch (error) {
    if (error?.code === 'TIMEOUT') failOnDeadline(error, phase);
    if (error?.name === 'TimeoutError') {
      failOnDeadline(bridgeError('TIMEOUT', error.message, error), phase);
    }
    if (error?.code) throw error;
    throw bridgeError('BROWSER_ERROR', error?.message || 'A browser operation failed.', error);
  } finally {
    if (releaseLock) await releaseLock().catch(() => {});
    // disconnect() only detaches this Playwright client; it never closes the
    // user's Chromium window. Keep this explicit even on timeout/cancellation.
    await detachBrowser(browser).catch(() => {});
  }
}

module.exports = {
  connectBrowser,
  findTargetPage,
  listTargetTabs,
  queryArgon,
  _internals: {
    validateTimeout,
    validateEndpoint,
    canonicalEndpoint,
    exactSupportedUrl,
    createDeadline,
    lockPath,
    acquireTabLock,
    readInputValue,
    readModelEvidence,
    assistantTurns
  }
};
