import AIAdapter from "./baseAdapter.js";

export default class GeminiAdapter extends AIAdapter {
  constructor(utils) {
    super(utils || _stubUtils);
    this.name = "gemini";
    this.selectors = {
      input: ["[contenteditable='true'].ql-editor", "rich-textarea [contenteditable='true']", "[contenteditable='true']"],
      sendButton: ["button[aria-label='Send message']", "button.send-button", ".send-button", "button[mattooltip='Send message']"],
      responseContainer: [".model-response-text", ".response-content", "model-response", ".chat-turn-container"],
      lastResponse: [".model-response-text p", ".response-content p", ".markdown p", "model-response p"],
      spinner: ["mat-spinner", "[aria-label='Loading']", ".loading", ".thinking-indicator"],
      loginIndicator: ["[aria-label='Sign in']", "a[href*='accounts.google.com']", ".sign-in-button"],
      captcha: [".captcha", "[data-recaptcha-anchor]"],
      rateLimit: [],
    };
  }
}

const _stubUtils = {
  findFirst: () => null,
  findAll: () => [],
  setNativeValue: () => {},
  setContentEditable: (el, val) => { if (el) el.textContent = val; },
  clipboardPaste: async () => false,
  sleep: () => Promise.resolve(),
  waitFor: async () => true,
  waitForStable: async () => "",
};

export const geminiAdapter = new GeminiAdapter(_stubUtils);

if (typeof window !== "undefined") {
  window.__adapters = window.__adapters || {};
  window.__adapters.gemini = geminiAdapter;
}
