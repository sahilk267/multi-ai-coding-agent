import AIAdapter from "./baseAdapter.js";

const utils = {
  findFirst: (sels) => sels.map(s => document.querySelector(s)).find(Boolean) || null,
  setNativeValue: (el, val) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(el, val);
  },
  setContentEditable: (el, val) => { el.textContent = val; },
  clipboardPaste: async () => false, // fallback: use setNativeValue
  sleep: (ms) => new Promise(r => setTimeout(r, ms)),
  waitFor: (fn, { timeout = 30000, interval = 500 } = {}) => {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (fn()) return resolve(true);
        if (Date.now() - start > timeout) return reject(new Error("waitFor timeout"));
        setTimeout(check, interval);
      };
      check();
    });
  },
  waitForStable: (fn, { settleMs = 1500, timeout = 60000 } = {}) => {
    return new Promise((resolve) => {
      let last = "";
      let stableAt = null;
      const start = Date.now();
      const check = () => {
        const cur = fn();
        if (cur !== last) { last = cur; stableAt = Date.now(); }
        if (stableAt && Date.now() - stableAt >= settleMs && cur) return resolve(cur);
        if (Date.now() - start > timeout) return resolve(cur);
        setTimeout(check, 500);
      };
      check();
    });
  },
};

export class ChatGPTAdapter extends AIAdapter {
  constructor() {
    super(utils);
    this.name = "chatgpt";
    this.selectors = {
      input: ["#prompt-textarea", "textarea[data-id='root']"],
      sendButton: ['[data-testid="send-button"]', 'button[aria-label="Send prompt"]'],
      responseContainer: ["[data-message-author-role='assistant']"],
      lastResponse: ["[data-message-author-role='assistant'] .markdown", "[data-message-author-role='assistant'] p"],
      spinner: ['[data-testid="stop-button"]', ".result-streaming"],
      loginIndicator: ['[data-testid="login-button"]'],
      captcha: [".captcha", "#challenge-form"],
      rateLimit: ['[data-testid="rate-limit-message"]'],
    };
  }
}

export const chatgptAdapter = new ChatGPTAdapter();

// Legacy compatibility — content.js uses these globals
window.__adapters = window.__adapters || {};
window.__adapters.chatgpt = chatgptAdapter;
