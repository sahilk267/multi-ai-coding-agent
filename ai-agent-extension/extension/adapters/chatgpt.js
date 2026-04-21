// ChatGPT adapter - handles DOM interaction for chat.openai.com

export const ChatGPTAdapter = {
  name: "chatgpt",
  url: "https://chat.openai.com",
  
  selectors: {
    input: "#prompt-textarea",
    sendBtn: '[data-testid="send-button"]',
    response: "[data-message-author-role='assistant'] .markdown",
    stopBtn: '[data-testid="stop-button"]',
    loadingIndicator: ".result-streaming",
  },

  inject(prompt) {
    const input = document.querySelector(this.selectors.input);
    if (!input) return { error: "ChatGPT input not found" };

    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(input, prompt);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    
    setTimeout(() => {
      const btn = document.querySelector(this.selectors.sendBtn);
      if (btn && !btn.disabled) btn.click();
    }, 400);
    
    return { success: true };
  },

  getResponse() {
    const responses = document.querySelectorAll(this.selectors.response);
    if (!responses.length) return { response: null, done: false };
    
    const last = responses[responses.length - 1];
    const text = last?.innerText || "";
    const isStreaming = !!document.querySelector(this.selectors.loadingIndicator);
    
    return { response: text, done: !isStreaming && text.length > 0 };
  },
};
