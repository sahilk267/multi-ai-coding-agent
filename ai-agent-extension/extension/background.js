// Background service worker - orchestrates the agent system

const BACKEND_URL = "http://localhost:8000";

// Message router between popup/content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    sendResponse({ error: err.message });
  });
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case "INJECT_PROMPT":
      return await injectPromptToTab(message.tabId, message.prompt, message.adapter);
    case "GET_RESPONSE":
      return await getResponseFromTab(message.tabId, message.adapter);
    case "BACKEND_REQUEST":
      return await callBackend(message.endpoint, message.method, message.data);
    case "OPEN_AI_TAB":
      return await openAITab(message.url);
    case "ROUTE_MODEL":
      return routeModel(message.taskType);
    default:
      return { error: `Unknown message type: ${message.type}` };
  }
}

// Open or focus an AI tab
async function openAITab(url) {
  const tabs = await chrome.tabs.query({ url: url + "*" });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    return { tabId: tabs[0].id };
  } else {
    const tab = await chrome.tabs.create({ url, active: false });
    return { tabId: tab.id };
  }
}

// Inject a prompt into an AI chat tab
async function injectPromptToTab(tabId, prompt, adapter) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (prompt, adapter) => {
      return window.__agentInject?.(prompt, adapter) ?? { error: "Content script not ready" };
    },
    args: [prompt, adapter],
  });
  return result[0]?.result ?? { error: "Injection failed" };
}

// Get latest response from AI tab
async function getResponseFromTab(tabId, adapter) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (adapter) => {
      return window.__agentGetResponse?.(adapter) ?? { response: null };
    },
    args: [adapter],
  });
  return result[0]?.result ?? { response: null };
}

// Call the local FastAPI backend
async function callBackend(endpoint, method = "GET", data = null) {
  try {
    const options = {
      method,
      headers: { "Content-Type": "application/json" },
    };
    if (data) options.body = JSON.stringify(data);
    
    const response = await fetch(`${BACKEND_URL}${endpoint}`, options);
    const json = await response.json();
    return { success: true, data: json, status: response.status };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Smart model routing based on task type
function routeModel(taskType) {
  const routes = {
    coding: { model: "deepseek", url: "https://chat.deepseek.com" },
    debugging: { model: "qwen", url: "https://chat.qwen.ai" },
    fast: { model: "gemini", url: "https://gemini.google.com/app" },
    fallback: { model: "chatgpt", url: "https://chat.openai.com" },
    auto: { model: "deepseek", url: "https://chat.deepseek.com" },
  };
  return routes[taskType] || routes.fallback;
}
