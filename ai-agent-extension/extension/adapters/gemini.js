import AIAdapter from "./baseAdapter.js";

const utils = {
  findFirst: (sels) => sels.map(s => document.querySelector(s)).find(Boolean) || null,
  setNativeValue: () => {},
  setContentEditable: (el, val) => {
    el.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, val);
  },
  clipboardPaste: async (el, text) => {
    try {
      await navigator.clipboard.writeText(text);
      el.focus();
      document.execCommand("paste");
      return true;
    } catch { return false; }
  },
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

export class GeminiAdapter extends AIAdapter {
  constructor() {
    super(utils);
    this.name = "gemini";
    this.selectors = {
      input: ["[contenteditable='true'].ql-editor", "[contenteditable='true']", "rich-textarea"],
      sendButton: ["button[aria-label='Send message']", "button.send-button", "mat-icon[data-mat-icon-name='send']"],
      responseContainer: [".model-response-text", ".response-content", "model-response"],
      lastResponse: [".model-response-text p", ".response-content p", ".markdown p"],
      spinner: ["mat-spinner", ".loading", "[aria-label='Loading']"],
      loginIndicator: ["[aria-label='Sign in']"],
      captcha: [".captcha"],
      rateLimit: [],
    };
  }
}

export const geminiAdapter = new GeminiAdapter();
window.__adapters = window.__adapters || {};
window.__adapters.gemini = geminiAdapter;
