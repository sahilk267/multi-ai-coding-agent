import AIAdapter from "./baseAdapter.js";

export default class QwenAdapter extends AIAdapter {
  constructor(utils) {
    super(utils || _stubUtils);
    this.name = "qwen";
    this.selectors = {
      input: ["textarea", ".input-area textarea", "#user-input", "div[contenteditable='true']"],
      sendButton: ["button[type='submit']", ".send-button", "[aria-label='Send']", "button.send"],
      responseContainer: [".markdown-body", ".message-text", ".response-content", ".chat-message-list-item--assistant"],
      lastResponse: [".markdown-body p", ".message-text", ".response-content p", ".message-content"],
      spinner: [".typing-indicator", "[class*='loading']", ".ellipsis", ".thinking"],
      loginIndicator: [".login-btn", "[href*='login']", "button[class*='login']"],
      captcha: [".captcha", "#challenge-form"],
      rateLimit: [".rate-limit", "[class*='rate']"],
    };
  }
}

const _stubUtils = {
  findFirst: () => null,
  findAll: () => [],
  setNativeValue: () => {},
  setContentEditable: () => {},
  clipboardPaste: async () => false,
  sleep: () => Promise.resolve(),
  waitFor: async () => true,
  waitForStable: async () => "",
};

export const qwenAdapter = new QwenAdapter(_stubUtils);

if (typeof window !== "undefined") {
  window.__adapters = window.__adapters || {};
  window.__adapters.qwen = qwenAdapter;
}
