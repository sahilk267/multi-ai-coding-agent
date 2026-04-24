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

export class DeepSeekAdapter extends AIAdapter {
  constructor() {
    super(utils);
    this.name = "deepseek";
    this.selectors = {
      input: ["textarea#chat-input", "textarea", ".chat-input textarea"],
      sendButton: ["[aria-label='Send']", "button[type='submit']", ".send-button"],
      responseContainer: [".ds-markdown", ".message-content"],
      lastResponse: [".ds-markdown", ".message-content p"],
      spinner: [".loading-dots", "[class*='loading']", ".typing-indicator"],
      loginIndicator: [".login-btn", "[href*='login']"],
      captcha: [".captcha", "#challenge-form"],
      rateLimit: [".rate-limit-tip"],
    };
  }
}

export const deepseekAdapter = new DeepSeekAdapter();
window.__adapters = window.__adapters || {};
window.__adapters.deepseek = deepseekAdapter;
