import AIAdapter from "./baseAdapter.js";

export default class ChatGPTAdapter extends AIAdapter {
  constructor(utils) {
    super(utils || _stubUtils);
    this.name = "chatgpt";
    this.selectors = {
      input: ["#prompt-textarea", "textarea[data-id='root']", "div[contenteditable='true'][data-placeholder]"],
      sendButton: ['[data-testid="send-button"]', 'button[aria-label="Send prompt"]', 'button[aria-label="Send message"]'],
      responseContainer: ["[data-message-author-role='assistant']", ".group\\/conversation-turn"],
      lastResponse: ["[data-message-author-role='assistant'] .markdown", "[data-message-author-role='assistant'] p", "[data-message-author-role='assistant']"],
      spinner: ['[data-testid="stop-button"]', ".result-streaming", '[aria-label="Stop generating"]'],
      loginIndicator: ['[data-testid="login-button"]', 'a[href="/auth/login"]', '[class*="login"]'],
      captcha: [".captcha", "#challenge-form"],
      rateLimit: ['[data-testid="rate-limit-message"]', '[class*="rate-limit"]'],
    };
  }
}

// Minimal stub so the class can be instantiated in Node (check-selectors script)
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

export const chatgptAdapter = new ChatGPTAdapter(_stubUtils);

// Browser-only: register on window
if (typeof window !== "undefined") {
  window.__adapters = window.__adapters || {};
  window.__adapters.chatgpt = chatgptAdapter;
}
