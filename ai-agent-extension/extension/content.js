// Content script — runs in every AI chat page
// Detects the provider, loads the right adapter, exposes __agentInject / __agentGetResponse

(function () {
  const host = window.location.hostname;

  function detectProvider() {
    if (host.includes("openai.com") || host.includes("chatgpt.com")) return "chatgpt";
    if (host.includes("deepseek.com")) return "deepseek";
    if (host.includes("qwen.ai")) return "qwen";
    if (host.includes("gemini.google.com")) return "gemini";
    return null;
  }

  const provider = detectProvider();
  if (!provider) return; // Not an AI page we handle

  // Selectors per provider — kept inline so content script is self-contained (no ES module import)
  const SELECTORS = {
    chatgpt: {
      inputs: ["#prompt-textarea", "textarea[data-id='root']"],
      sends: ['[data-testid="send-button"]', 'button[aria-label="Send prompt"]'],
      responses: ["[data-message-author-role='assistant'] .markdown", "[data-message-author-role='assistant'] p"],
      spinners: ['[data-testid="stop-button"]', ".result-streaming"],
    },
    deepseek: {
      inputs: ["textarea#chat-input", "textarea"],
      sends: ["[aria-label='Send']", "button[type='submit']"],
      responses: [".ds-markdown", ".message-content"],
      spinners: [".loading-dots", ".typing-indicator"],
    },
    qwen: {
      inputs: ["textarea", ".input-area textarea"],
      sends: ["button[type='submit']", ".send-button"],
      responses: [".markdown-body", ".message-text"],
      spinners: [".typing-indicator", ".ellipsis"],
    },
    gemini: {
      inputs: ["[contenteditable='true'].ql-editor", "[contenteditable='true']"],
      sends: ["button[aria-label='Send message']"],
      responses: [".model-response-text p", ".response-content p"],
      spinners: ["mat-spinner", "[aria-label='Loading']"],
    },
  };

  const sel = SELECTORS[provider];

  function findFirst(sels) {
    for (const s of sels) {
      const el = document.querySelector(s);
      if (el) return el;
    }
    return null;
  }

  function setNativeValue(el, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }
  }

  // ─── Inject prompt ─────────────────────────────────────────────────────────

  window.__agentInject = function (prompt) {
    const input = findFirst(sel.inputs);
    if (!input) return { error: `${provider}: input not found` };

    if (input.isContentEditable || input.getAttribute("contenteditable") === "true") {
      input.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, prompt);
    } else {
      setNativeValue(input, prompt);
    }

    input.dispatchEvent(new InputEvent("input", { bubbles: true, data: prompt }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    setTimeout(() => {
      const btn = findFirst(sel.sends);
      if (btn && !btn.disabled) {
        btn.click();
      } else {
        // Fallback: Enter key
        input.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Enter", code: "Enter", which: 13, keyCode: 13, bubbles: true,
        }));
      }
    }, 400);

    return { success: true, provider };
  };

  // ─── Get response ──────────────────────────────────────────────────────────

  window.__agentGetResponse = function () {
    const responses = document.querySelectorAll(sel.responses.join(","));
    if (!responses.length) return { response: null, done: false };

    const last = responses[responses.length - 1];
    const text = (last?.innerText || last?.textContent || "").trim();
    const isStreaming = !!findFirst(sel.spinners);

    return { response: text, done: !isStreaming && text.length > 0, provider };
  };

  // ─── Detect issues ─────────────────────────────────────────────────────────

  window.__agentStatus = function () {
    const isLoggedIn = !!findFirst(sel.inputs);
    const isRateLimited = !!document.querySelector(".rate-limit, [class*='rate-limit']");
    const hasCaptcha = !!document.querySelector(".captcha, #challenge-form");
    return { provider, isLoggedIn, isRateLimited, hasCaptcha };
  };

  // ─── Listen for direct messages from background ────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "INJECT") sendResponse(window.__agentInject(message.prompt));
    else if (message.type === "GET_RESPONSE") sendResponse(window.__agentGetResponse());
    else if (message.type === "STATUS") sendResponse(window.__agentStatus());
    return true;
  });

  console.log(`[Agent] Content script loaded on ${provider}`);
})();
