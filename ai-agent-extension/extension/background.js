// Background service worker — orchestrates the multi-AI agent system
// Handles: tab management, AI injection, approval queue, state relay

import { StateMachine } from "./core/stateMachine.js";
import { Router } from "./core/router.js";

let CONFIG = null;
const sm = new StateMachine("IDLE");
const router = new Router();

// Approval queue: id -> {resolve, reject}
const approvalQueue = new Map();
// All pending approval payloads: id -> payload (for panel restore)
const pendingApprovals = new Map();

// ─── Config ───────────────────────────────────────────────────────────────────

async function loadConfig() {
  if (CONFIG) return CONFIG;
  const url = chrome.runtime.getURL("config.json");
  const r = await fetch(url);
  CONFIG = await r.json();
  // Allow user overrides from storage
  const stored = await chrome.storage.local.get(["backendUrl", "wsUrl"]);
  if (stored.backendUrl) CONFIG.backendUrl = stored.backendUrl;
  if (stored.wsUrl) CONFIG.wsUrl = stored.wsUrl;
  return CONFIG;
}

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
  // Auto-approve if config disables approval for this kind
  if (payload.kind === "write_file" && !cfg.approval?.requireForWrites) return true;
  if (payload.kind === "execute_command" && !cfg.approval?.requireForCommands) return true;

  const id = payload.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  payload.id = id;

  // Check rejection history
  const history = await getApprovalHistory();
  const key = makeApprovalKey(payload);
  const prevEntries = history.filter(e => e.key === key);
  const approved = prevEntries.filter(e => e.decision === "approve").length;
  const rejected = prevEntries.filter(e => e.decision === "reject").length;
  const last = prevEntries.sort((a, b) => b.timestamp - a.timestamp)[0] || null;
  payload.previous = { total: prevEntries.length, approved, rejected, last };

  // If last decision was reject, skip (planner should avoid this)
  if (last?.decision === "reject") return false;

  pendingApprovals.set(id, payload);

  // Notify panel/popup
  chrome.runtime.sendMessage({ type: "approval_request", payload }).catch(() => {});

  return new Promise((resolve) => {
    approvalQueue.set(id, resolve);
  });
}

async function getApprovalHistory() {
  const r = await backendRequest("/memory/approval_history", "GET");
  return Array.isArray(r.data?.data) ? r.data.data : [];
}

async function saveApprovalHistory(history) {
  await backendRequest("/memory/save", "POST", { file: "approval_history", data: history });
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
  // keep last 500 records
  if (history.length > 500) history.splice(0, history.length - 500);
  await saveApprovalHistory(history);
}

// ─── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => sendResponse({ error: err.message }));
  return true;
});

async function handleMessage(message) {
  switch (message.type) {

    // Tab / injection
    case "OPEN_AI_TAB":
      return openAITab(message.url);

    case "INJECT_PROMPT":
      return injectPromptToTab(message.tabId, message.prompt, message.adapter);

    case "GET_RESPONSE":
      return getResponseFromTab(message.tabId, message.adapter);

    // Backend proxy
    case "BACKEND_REQUEST":
      return backendRequest(message.endpoint, message.method || "GET", message.data || null);

    // Routing
    case "ROUTE_MODEL":
      return router.route(message.taskType || "auto", message.taskHint || "coding");

    // Agent lifecycle
    case "AGENT_PAUSE":
      try { sm.to("PAUSED"); } catch {}
      return { ok: true };

    case "AGENT_RESUME":
      try { sm.to("EXECUTING"); } catch { sm.force("EXECUTING"); }
      return { ok: true };

    case "AGENT_STOP":
      sm.force("IDLE");
      return { ok: true };

    case "AGENT_RUN_PROMPT": {
      const cfg = await loadConfig();
      const route = router.route("auto", message.taskKind || "coding");
      const tabInfo = await openAITab(route.url);
      if (!tabInfo.tabId) return { ok: false, error: "Could not open tab" };
      await new Promise(r => setTimeout(r, 3000));
      const inject = await injectPromptToTab(tabInfo.tabId, message.prompt, route.model);
      if (!inject.success) return { ok: false, error: inject.error };
      // Poll for response
      const response = await pollResponse(tabInfo.tabId, route.model, 90000);
      return response ? { ok: true, text: response } : { ok: false, error: "Timed out" };
    }

    // Approval responses from panel/popup
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
