// Qwen adapter - handles DOM interaction for chat.qwen.ai

export const QwenAdapter = {
  name: "qwen",
  url: "https://chat.qwen.ai",
  
  selectors: {
    input: "textarea",
    sendBtn: 'button[type="submit"], .send-button, [aria-label="Send"]',
    response: ".markdown-body, .message-text, .response-content",
    loadingIndicator: ".typing-indicator, [class*='loading']",
  },

  inject(prompt) {
    const input = document.querySelector(this.selectors.input);
    if (!input) return { error: "Qwen input not found" };

    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(input, prompt);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    
    setTimeout(() => {
      const btn = document.querySelector(this.selectors.sendBtn);
      if (btn && !btn.disabled) btn.click();
    }, 500);
    
    return { success: true };
  },

  getResponse() {
    const responses = document.querySelectorAll(this.selectors.response);
    if (!responses.length) return { response: null, done: false };
    
    const last = responses[responses.length - 1];
    const text = last?.innerText || "";
    const isLoading = !!document.querySelector(this.selectors.loadingIndicator);
    
    return { response: text, done: !isLoading && text.length > 0 };
  },
};
