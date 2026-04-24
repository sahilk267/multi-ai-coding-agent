// Popup script — quick launcher that links to the full panel
let CONFIG = null;

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const goalInput = document.getElementById("goalInput");
const modelSelect = document.getElementById("modelSelect");
const logContainer = document.getElementById("logContainer");
const statusDot = document.getElementById("statusDot");

function log(message, level = "info") {
  const entry = document.createElement("div");
  entry.className = `log-entry ${level}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;
}

async function loadConfig() {
  try {
    const url = chrome.runtime.getURL("config.json");
    const r = await fetch(url);
    CONFIG = await r.json();
    return CONFIG;
  } catch {
    CONFIG = { backendUrl: "http://127.0.0.1:8765" };
    return CONFIG;
  }
}

async function checkBackend() {
  try {
    const cfg = await loadConfig();
    const res = await fetch(`${cfg.backendUrl}/health`);
    const data = await res.json();
    if (data.status === "ok") {
      statusDot.className = "status-dot connected";
      startBtn.disabled = false;
      log("Backend connected", "success");
      return true;
    }
  } catch {
    statusDot.className = "status-dot disconnected";
    startBtn.disabled = true;
    log("Backend offline — run: uvicorn backend.server:app --host 127.0.0.1 --port 8765", "error");
    return false;
  }
}

// Open panel in a new tab
function openPanel() {
  const panelUrl = chrome.runtime.getURL("ui/panel.html");
  chrome.tabs.create({ url: panelUrl });
}

// Open dashboard
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("openPanel")?.addEventListener("click", openPanel);
  document.getElementById("openDashboard")?.addEventListener("click", () => {
    chrome.tabs.create({ url: "http://localhost:5173" });
  });
});

startBtn?.addEventListener("click", async () => {
  const goal = goalInput?.value?.trim();
  if (!goal) { log("Please enter a goal", "error"); return; }

  log(`Starting: "${goal}"`, "info");
  const model = modelSelect?.value || "auto";

  // Create session via backend
  chrome.runtime.sendMessage({
    type: "BACKEND_REQUEST",
    endpoint: "/sessions",
    method: "POST",
    data: { goal, model },
  }, (response) => {
    if (response?.success) {
      log(`Session #${response.data?.id} created`, "success");
      log("Opening panel for full monitoring...", "info");
      setTimeout(openPanel, 1000);
    } else {
      log(`Error: ${response?.error || response?.data?.detail || "failed"}`, "error");
    }
  });
});

stopBtn?.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "AGENT_STOP" }, () => {
    log("Agent stopped", "info");
  });
});

// Get current agent state
chrome.runtime.sendMessage({ type: "GET_STATE" }, (res) => {
  if (res?.state) log(`State: ${res.state}`, "info");
});

// Listen for state updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "status") log(`State → ${msg.payload?.state}`, "info");
  else if (msg.type === "approval_request") {
    log(`Approval needed: ${msg.payload?.kind} ${msg.payload?.path || msg.payload?.cmd || ""}`, "info");
    openPanel();
  }
});

checkBackend();
