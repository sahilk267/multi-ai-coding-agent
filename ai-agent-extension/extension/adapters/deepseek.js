import AIAdapter from "./baseAdapter.js";

export default class DeepSeekAdapter extends AIAdapter {
  constructor(utils) {
    super(utils || _stubUtils);
    this.name = "deepseek";
    this.selectors = {
      input: ["textarea#chat-input", "textarea.chat-input", "textarea", ".chat-input textarea"],
      sendButton: ["[aria-label='Send']", "button[type='submit']", ".send-button", "button.send-button"],
      responseContainer: [".ds-markdown", ".message-content", ".chat-message--assistant"],
      lastResponse: [".ds-markdown", ".message-content p", ".chat-message--assistant .content"],
      spinner: [".loading-dots", "[class*='loading']", ".typing-indicator", ".generating"],
      loginIndicator: [".login-btn", "[href*='login']", "a[href='/sign_in']"],
      captcha: [".captcha", "#challenge-form"],
      rateLimit: [".rate-limit-tip", "[class*='rate-limit']"],
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

export const deepseekAdapter = new DeepSeekAdapter(_stubUtils);

if (typeof window !== "undefined") {
  window.__adapters = window.__adapters || {};
  window.__adapters.deepseek = deepseekAdapter;
}
