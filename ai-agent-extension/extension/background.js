// Background service worker — orchestrates the multi-AI agent system
// Handles: tab management, AI injection, approval queue, state relay,
//          5s checkpoint loop, crash recovery, token budgeting

import { StateMachine } from "./core/stateMachine.js";
import { Router } from "./core/router.js";
import { budgetPrompt } from "./core/tokenManager.js";

let CONFIG = null;
const sm = new StateMachine("IDLE");
const router = new Router();

// Approval queue: id -> resolve fn
const approvalQueue = new Map();
// All pending approval payloads: id -> payload
const pendingApprovals = new Map();

// ─── Config ───────────────────────────────────────────────────────────────────

async function loadConfig() {
  if (CONFIG) return CONFIG;
  const url = chrome.runtime.getURL("config.json");
  const r = await fetch(url);
  CONFIG = await r.json();
  const stored = await chrome.storage.local.get(["backendUrl", "wsUrl"]);
  if (stored.backendUrl) CONFIG.backendUrl = stored.backendUrl;
  if (stored.wsUrl) CONFIG.wsUrl = stored.wsUrl;
  return CONFIG;
}

// ─── Crash recovery — startup restore ────────────────────────────────────────

async function restoreCheckpoint() {
  try {
    const snap = await chrome.storage.local.get(["__agent_checkpoint"]);
    const cp = snap.__agent_checkpoint;
    if (!cp) return;
    if (cp.state && cp.state !== "IDLE") {
      sm.force(cp.state);
      console.log("[background] Restored state from checkpoint:", cp.state);
    }
    if (Array.isArray(cp.pendingApprovals)) {
      for (const p of cp.pendingApprovals) {
        pendingApprovals.set(p.id, p);
      }
    }
    if (cp.config) CONFIG = cp.config;
  } catch (e) {
    console.warn("[background] Checkpoint restore failed:", e.message);
  }
}

// ─── Checkpoint loop (every 5 seconds) ───────────────────────────────────────

function startCheckpointLoop() {
  const cfg = CONFIG;
  const interval = cfg?.loop?.checkpointIntervalMs ?? 5000;
  setInterval(() => {
    const checkpoint = {
      state: sm.state,
      pendingApprovals: Array.from(pendingApprovals.values()),
      config: CONFIG,
      savedAt: Date.now(),
    };
    chrome.storage.local.set({ __agent_checkpoint: checkpoint }).catch(() => {});
  }, interval);
}

// Startup: restore checkpoint then begin loop
restoreCheckpoint().then(() => {
  loadConfig().then(startCheckpointLoop);
});

// ─── Backend API ───────────────────────────────────────────────────────────────

async function backendRequest(endpoint, method = "GET", data = null) {
  const cfg = await loadConfig();
  try {
    const options = { method, headers: { "Content-Type": "application/json" } };
    if (data) options.body = JSON.stringify(data);
    const response = await fetch(`${cfg.backendUrl}${endpoint}`, options);
    const text = await response.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { success: response.ok, data: json, status: response.status };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─── Token-budgeted prompt dispatch ───────────────────────────────────────────

/**
 * Send a prompt to the best available AI provider for the given task.
 * Applies token budgeting before dispatch, with automatic fallback.
 *
 * @param {string} rawPrompt   - The untruncated prompt
 * @param {string} taskKind    - "planning" | "coding" | "debugging" | "long_context"
 * @param {number} [timeoutMs] - Per-attempt timeout (default from config)
 * @returns {Promise<{text:string, model:string, truncated:boolean}|null>}
 */
async function sendPromptToProvider(rawPrompt, taskKind = "coding", timeoutMs = null) {
  const cfg = await loadConfig();
  const timeout = timeoutMs ?? cfg.loop?.stepTimeoutMs ?? 120000;
  const route = router.route("auto", taskKind);
  const fallbacks = router.getFallbackOrder();
  const attempts = [route, ...fallbacks.filter(r => r.model !== route.model)];

  for (const attempt of attempts) {
    const { prompt, truncated, model: m } = budgetPrompt(rawPrompt, attempt.model, {
      reserved: cfg.tokens?.reservedReply ?? 1024,
    });

    try {
      const tabInfo = await openAITab(attempt.url);
      if (!tabInfo?.tabId) continue;

      // Wait for tab to be ready
      await new Promise(r => setTimeout(r, 3000));

      const inject = await injectPromptToTab(tabInfo.tabId, prompt, attempt.model);
      if (inject?.error) continue;

      const response = await pollResponse(tabInfo.tabId, attempt.model, timeout);
      if (response) return { text: response, model: attempt.model, truncated };
    } catch (err) {
      console.warn(`[background] sendPromptToProvider ${attempt.model} failed:`, err.message);
    }
  }
  return null;
}

// ─── Tab / AI injection ────────────────────────────────────────────────────────

async function openAITab(url) {
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(t => t.url && t.url.startsWith(url));
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    return { tabId: existing.id };
  }
  const tab = await chrome.tabs.create({ url, active: false });
  return { tabId: tab.id };
}

async function injectPromptToTab(tabId, prompt, adapter) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (prompt, adapter) => window.__agentInject?.(prompt, adapter) ?? { error: "content script not ready" },
    args: [prompt, adapter],
  });
  return results[0]?.result ?? { error: "injection failed" };
}

async function getResponseFromTab(tabId, adapter) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (adapter) => window.__agentGetResponse?.(adapter) ?? { response: null, done: false },
    args: [adapter],
  });
  return results[0]?.result ?? { response: null, done: false };
}

// ─── State broadcasting ────────────────────────────────────────────────────────

function broadcastState(state) {
  chrome.runtime.sendMessage({ type: "status", payload: { state } }).catch(() => {});
  backendRequest(`/state/${state}`, "POST");
}

sm.subscribe((state) => broadcastState(state));

// ─── Approval system ───────────────────────────────────────────────────────────

function makeApprovalKey(payload) {
  if (payload.kind === "write_file") return `write:${payload.path}`;
  if (payload.kind === "execute_command") return `cmd:${payload.cmd}`;
  return payload.id;
}

async function requestApproval(payload) {
  const cfg = await loadConfig();
  if (payload.kind === "write_file" && !cfg.approval?.requireForWrites) return true;
  if (payload.kind === "execute_command" && !cfg.approval?.requireForCommands) return true;

  const id = payload.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  payload.id = id;

  const history = await getApprovalHistory();
  const key = makeApprovalKey(payload);
  const prevEntries = history.filter(e => e.key === key);
  const last = prevEntries.sort((a, b) => b.timestamp - a.timestamp)[0] || null;
  payload.previous = {
    total: prevEntries.length,
    approved: prevEntries.filter(e => e.decision === "approve").length,
    rejected: prevEntries.filter(e => e.decision === "reject").length,
    last,
  };
  if (last?.decision === "reject") return false;

  pendingApprovals.set(id, payload);
  chrome.runtime.sendMessage({ type: "approval_request", payload }).catch(() => {});

  return new Promise((resolve) => {
    approvalQueue.set(id, resolve);
  });
}

async function getApprovalHistory() {
  const r = await backendRequest("/memory/approval_history", "GET");
  return Array.isArray(r.data?.data) ? r.data.data : [];
}

async function recordApprovalDecision(payload, decision) {
  const history = await getApprovalHistory();
  history.push({
    key: makeApprovalKey(payload),
    kind: payload.kind,
    path: payload.path || null,
    cmd: payload.cmd || null,
    project: payload.project || null,
    decision,
    timestamp: Date.now(),
  });
  if (history.length > 500) history.splice(0, history.length - 500);
  await backendRequest("/memory/save", "POST", { file: "approval_history", data: history });
}

// ─── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => sendResponse({ error: err.message }));
  return true;
});

async function handleMessage(message) {
  switch (message.type) {

    case "OPEN_AI_TAB":
      return openAITab(message.url);

    case "INJECT_PROMPT":
      return injectPromptToTab(message.tabId, message.prompt, message.adapter);

    case "GET_RESPONSE":
      return getResponseFromTab(message.tabId, message.adapter);

    case "BACKEND_REQUEST":
      return backendRequest(message.endpoint, message.method || "GET", message.data || null);

    case "ROUTE_MODEL":
      return router.route(message.taskType || "auto", message.taskHint || "coding");

    case "SEND_PROMPT_TO_PROVIDER":
      return sendPromptToProvider(message.prompt, message.taskKind || "coding", message.timeoutMs);

    case "AGENT_PAUSE":
      try { sm.to("PAUSED"); } catch { sm.force("PAUSED"); }
      return { ok: true };

    case "AGENT_RESUME":
      try { sm.to("EXECUTING"); } catch { sm.force("EXECUTING"); }
      return { ok: true };

    case "AGENT_STOP":
      sm.force("IDLE");
      pendingApprovals.clear();
      approvalQueue.forEach(resolve => resolve(false));
      approvalQueue.clear();
      return { ok: true };

    case "AGENT_RUN_PROMPT": {
      const result = await sendPromptToProvider(
        message.prompt,
        message.taskKind || "coding",
        message.timeoutMs
      );
      return result ? { ok: true, ...result } : { ok: false, error: "All providers failed or timed out" };
    }

    case "AGENT_APPROVAL_RESPONSE": {
      const { id, decision } = message;
      const payload = pendingApprovals.get(id);
      if (payload) {
        await recordApprovalDecision(payload, decision);
        pendingApprovals.delete(id);
      }
      const resolve = approvalQueue.get(id);
      if (resolve) {
        resolve(decision === "approve");
        approvalQueue.delete(id);
      }
      chrome.runtime.sendMessage({ type: "approval_resolved", payload: { id, decision } }).catch(() => {});
      return { ok: true };
    }

    case "_INTERNAL_REQUEST_APPROVAL":
      return requestApproval(message.approval);

    case "AGENT_LIST_APPROVALS":
      return { items: Array.from(pendingApprovals.values()) };

    case "GET_STATE":
      return { state: sm.state };

    case "GET_CONFIG": {
      const c = await loadConfig();
      return { config: c };
    }

    default:
      return { error: `Unknown message type: ${message.type}` };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function pollResponse(tabId, adapter, timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await new Promise(r => setTimeout(r, 2000));
    const result = await getResponseFromTab(tabId, adapter);
    if (result?.done && result?.response) return result.response;
  }
  return null;
}
