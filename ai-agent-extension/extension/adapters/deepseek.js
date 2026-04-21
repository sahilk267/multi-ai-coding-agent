// DeepSeek adapter - handles DOM interaction for chat.deepseek.com

export const DeepSeekAdapter = {
  name: "deepseek",
  url: "https://chat.deepseek.com",
  
  selectors: {
    input: "textarea",
    sendBtn: '[aria-label="Send"], button[type="submit"]',
    response: ".ds-markdown, .message-content",
    loadingIndicator: ".loading-dots, [class*='loading']",
  },

  inject(prompt) {
    const input = document.querySelector(this.selectors.input);
    if (!input) return { error: "DeepSeek input not found" };

    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(input, prompt);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    
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
