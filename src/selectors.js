// Gemini Web adapter selectors. Keep this list provider-specific: generic
// Markdown containers can also match user messages, nested blocks, or pages
// from an unrelated provider.
const GEMINI_WEB = Object.freeze({
  name: 'gemini-web',
  host: 'gemini.google.com',
  assistantSelector: 'model-response',
  // Only these observed semantic labels identify Gemini's current-model
  // control. A random visible button whose text says "Argon" is insufficient.
  modelControlSelector: [
    'button[aria-label^="Mở công cụ chọn chế độ" i]',
    '[role="button"][aria-label^="Mở công cụ chọn chế độ" i]',
    'button[aria-label^="Current model:" i]',
    '[role="button"][aria-label^="Current model:" i]'
  ].join(','),
  inputSelectors: [
    'rich-textarea div.ql-editor[contenteditable="true"]',
    'rich-textarea textarea',
    'textarea[aria-label*="prompt" i]',
    'div[contenteditable="true"][role="textbox"]'
  ],
  submitSelectors: [
    'button[aria-label*="Send" i]',
    'button[aria-label*="Gửi" i]',
    'button[data-test-id="send-button"]'
  ],
  stopSelector: 'button,[role="button"]',
  answerSelector: 'message-content div.markdown.markdown-main-panel[aria-live="polite"]',
  completeSelector: '.response-footer.complete.gap',
  evidenceLevel: 'observed-ui'
});

module.exports = { GEMINI_WEB };
