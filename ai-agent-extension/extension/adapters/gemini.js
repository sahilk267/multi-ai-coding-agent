// Gemini adapter - handles DOM interaction for gemini.google.com

export const GeminiAdapter = {
  name: "gemini",
  url: "https://gemini.google.com/app",
  
  selectors: {
    input: "[contenteditable='true']",
    sendBtn: "button[aria-label='Send message']",
    response: ".model-response-text, .response-content, .markdown",
    loadingIndicator: "mat-spinner, .loading, [aria-label='Loading']",
  },

  inject(prompt) {
    const input = document.querySelector(this.selectors.input);
    if (!input) return { error: "Gemini input not found" };

    // ContentEditable needs special handling
    input.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, prompt);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    
    setTimeout(() => {
      const btn = document.querySelector(this.selectors.sendBtn);
      if (btn) btn.click();
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
