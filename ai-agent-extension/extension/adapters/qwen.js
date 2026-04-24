import AIAdapter from "./baseAdapter.js";

const utils = {
  findFirst: (sels) => sels.map(s => document.querySelector(s)).find(Boolean) || null,
  setNativeValue: (el, val) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(el, val);
  },
  setContentEditable: (el, val) => { el.textContent = val; },
  clipboardPaste: async () => false,
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

export class QwenAdapter extends AIAdapter {
  constructor() {
    super(utils);
    this.name = "qwen";
    this.selectors = {
      input: ["textarea", ".input-area textarea", "#user-input"],
      sendButton: ["button[type='submit']", ".send-button", "[aria-label='Send']"],
      responseContainer: [".markdown-body", ".message-text", ".response-content"],
      lastResponse: [".markdown-body p", ".message-text"],
      spinner: [".typing-indicator", "[class*='loading']", ".ellipsis"],
      loginIndicator: [".login-btn"],
      captcha: [".captcha"],
      rateLimit: [".rate-limit"],
    };
  }
}

export const qwenAdapter = new QwenAdapter();
window.__adapters = window.__adapters || {};
window.__adapters.qwen = qwenAdapter;
