// Content script - runs in AI chat pages to inject prompts and extract responses

(function () {
  let lastResponseText = "";
  let isWaiting = false;

  // Detect which AI interface we're on
  function detectAdapter() {
    const host = window.location.hostname;
    if (host.includes("openai.com")) return "chatgpt";
    if (host.includes("deepseek.com")) return "deepseek";
    if (host.includes("qwen.ai")) return "qwen";
    if (host.includes("gemini.google.com")) return "gemini";
    return "unknown";
  }

  const adapter = detectAdapter();

  // Adapter-specific selectors
  const ADAPTERS = {
    chatgpt: {
      inputSelector: "#prompt-textarea",
      sendSelector: '[data-testid="send-button"]',
      responseSelector: "[data-message-author-role='assistant'] .markdown",
    },
    deepseek: {
      inputSelector: "textarea",
      sendSelector: '[aria-label="Send"], button[type="submit"]',
      responseSelector: ".ds-markdown, .message-content",
    },
    qwen: {
      inputSelector: "textarea",
      sendSelector: 'button[type="submit"], .send-button',
      responseSelector: ".markdown-body, .message-text",
    },
    gemini: {
      inputSelector: "[contenteditable='true']",
      sendSelector: "button[aria-label='Send message']",
      responseSelector: ".model-response-text, .response-content",
    },
  };

  // Inject a prompt into the AI chat input
  window.__agentInject = function (prompt) {
    const cfg = ADAPTERS[adapter];
    if (!cfg) return { error: `Unsupported adapter: ${adapter}` };

    const input = document.querySelector(cfg.inputSelector);
    if (!input) return { error: "Input not found" };

    // Set value and trigger React/Vue events
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, "value"
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLElement.prototype, "innerHTML"
    )?.set;

    if (input.tagName === "TEXTAREA") {
      nativeSetter?.call(input, prompt);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      // ContentEditable
      input.textContent = prompt;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // Mark start time for response tracking
    lastResponseText = "";
    isWaiting = true;

    // Click send button after short delay
    setTimeout(() => {
      const sendBtn = document.querySelector(cfg.sendSelector);
      if (sendBtn && !sendBtn.disabled) {
        sendBtn.click();
      }
    }, 500);

    return { success: true, message: "Prompt injected" };
  };

  // Extract the latest AI response
  window.__agentGetResponse = function () {
    const cfg = ADAPTERS[adapter];
    if (!cfg) return { response: null, error: `Unsupported adapter: ${adapter}` };

    const responses = document.querySelectorAll(cfg.responseSelector);
    if (!responses || responses.length === 0) return { response: null, done: false };

    const lastResponse = responses[responses.length - 1];
    const text = lastResponse?.innerText || lastResponse?.textContent || "";

    // Detect if still loading (streaming)
    const hasLoadingIndicator = !!document.querySelector(
      '[aria-label="Stop generating"], .loading-dots, .typing-indicator, [data-testid="stop-button"]'
    );

    if (!hasLoadingIndicator && text && text !== lastResponseText) {
      lastResponseText = text;
      isWaiting = false;
      return { response: text, done: true };
    }

    return { response: text, done: !hasLoadingIndicator };
  };

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "INJECT") {
      sendResponse(window.__agentInject(message.prompt));
    } else if (message.type === "GET_RESPONSE") {
      sendResponse(window.__agentGetResponse());
    }
    return true;
  });

  console.log(`[Agent] Content script loaded on ${adapter}`);
})();
