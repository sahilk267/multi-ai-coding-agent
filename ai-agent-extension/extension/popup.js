// Popup script - manages the extension UI and agent state

const BACKEND_URL = "http://localhost:8000";

let isRunning = false;
let sessionId = null;

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

async function checkBackend() {
  try {
    const res = await fetch(`${BACKEND_URL}/health`);
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
    log("Backend not running. Start server with: uvicorn server:app", "error");
    return false;
  }
}

startBtn.addEventListener("click", async () => {
  const goal = goalInput.value.trim();
  if (!goal) { log("Please enter a goal", "error"); return; }

  isRunning = true;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  log(`Starting agent: "${goal}"`, "info");

  const model = modelSelect.value;
  log(`Using model: ${model}`, "info");

  // Create session via backend
  chrome.runtime.sendMessage({
    type: "BACKEND_REQUEST",
    endpoint: "/sessions",
    method: "POST",
    data: { goal, model },
  }, (response) => {
    if (response?.success) {
      sessionId = response.data.id;
      log(`Session created: #${sessionId}`, "success");
      startAgentLoop(goal, model);
    } else {
      log(`Failed to create session: ${response?.error}`, "error");
      isRunning = false;
      startBtn.disabled = false;
    }
  });
});

stopBtn.addEventListener("click", () => {
  isRunning = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  log("Agent stopped", "info");
  if (sessionId) {
    chrome.runtime.sendMessage({
      type: "BACKEND_REQUEST",
      endpoint: `/sessions/${sessionId}`,
      method: "PATCH",
      data: { status: "paused" },
    });
  }
});

async function startAgentLoop(goal, model) {
  // Route to correct AI model
  const route = await new Promise(resolve => {
    chrome.runtime.sendMessage({ type: "ROUTE_MODEL", taskType: model }, resolve);
  });

  log(`Opening ${route.model} at ${route.url}`, "info");

  // Open AI tab
  const tabResult = await new Promise(resolve => {
    chrome.runtime.sendMessage({ type: "OPEN_AI_TAB", url: route.url }, resolve);
  });

  if (!tabResult?.tabId) {
    log("Failed to open AI tab", "error");
    isRunning = false;
    startBtn.disabled = false;
    return;
  }

  const tabId = tabResult.tabId;
  log(`Tab opened: ${tabId}`, "info");

  // Give tab time to load
  await sleep(3000);

  // Build initial planning prompt
  const prompt = buildPlanningPrompt(goal);
  log("Sending planning prompt...", "info");

  const injectResult = await new Promise(resolve => {
    chrome.runtime.sendMessage({ type: "INJECT_PROMPT", tabId, prompt, adapter: route.model }, resolve);
  });

  if (!injectResult?.success) {
    log(`Inject failed: ${injectResult?.error}`, "error");
    isRunning = false;
    startBtn.disabled = false;
    return;
  }

  log("Waiting for AI response...", "info");

  // Poll for response
  const response = await pollForResponse(tabId, route.model, 60000);
  if (response) {
    log("Received plan from AI", "success");
    await processAgentResponse(response, tabId, route.model);
  } else {
    log("Timed out waiting for AI response", "error");
  }

  if (sessionId) {
    chrome.runtime.sendMessage({
      type: "BACKEND_REQUEST",
      endpoint: `/sessions/${sessionId}`,
      method: "PATCH",
      data: { status: "completed" },
    });
  }

  isRunning = false;
  startBtn.disabled = false;
  log("Agent run complete", "success");
}

function buildPlanningPrompt(goal) {
  return `You MUST respond ONLY in valid JSON. No explanations.

Create an execution plan for the following goal:
"${goal}"

Respond with this exact JSON structure:
{
  "goal": "${goal}",
  "tasks": [
    {
      "name": "Task name",
      "steps": [
        {
          "action": "write_file | read_file | execute_command | run_tests",
          "path": "optional file path",
          "content": "optional file content",
          "cmd": "optional shell command"
        }
      ]
    }
  ]
}`;
}

async function pollForResponse(tabId, adapter, timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout && isRunning) {
    await sleep(2000);
    const result = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "GET_RESPONSE", tabId, adapter }, resolve);
    });
    if (result?.done && result?.response) {
      return result.response;
    }
  }
  return null;
}

async function processAgentResponse(responseText, tabId, adapter) {
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log("Could not parse JSON from response", "error");
      return;
    }
    const plan = JSON.parse(jsonMatch[0]);
    log(`Plan parsed: ${plan.tasks?.length || 0} tasks`, "success");

    for (const task of plan.tasks || []) {
      if (!isRunning) break;
      log(`Executing task: ${task.name}`, "info");

      for (const step of task.steps || []) {
        if (!isRunning) break;
        await executeStep(step, tabId, adapter);
      }
    }
  } catch (err) {
    log(`Error processing response: ${err.message}`, "error");
  }
}

async function executeStep(step, tabId, adapter) {
  log(`Step: ${step.action} ${step.path || step.cmd || ""}`, "info");

  switch (step.action) {
    case "write_file":
      if (step.path && step.content !== undefined) {
        chrome.runtime.sendMessage({
          type: "BACKEND_REQUEST",
          endpoint: "/write_file",
          method: "POST",
          data: { path: step.path, content: step.content },
        }, (res) => {
          log(`Wrote: ${step.path} — ${res?.success ? "OK" : res?.error}`, res?.success ? "success" : "error");
        });
      }
      break;
    case "read_file":
      if (step.path) {
        chrome.runtime.sendMessage({
          type: "BACKEND_REQUEST",
          endpoint: "/read_file",
          method: "POST",
          data: { path: step.path },
        });
      }
      break;
    case "execute_command":
      if (step.cmd) {
        chrome.runtime.sendMessage({
          type: "BACKEND_REQUEST",
          endpoint: "/execute",
          method: "POST",
          data: { command: step.cmd },
        }, (res) => {
          log(`Command: ${step.cmd} — exit ${res?.data?.exit_code}`, res?.data?.success ? "success" : "error");
        });
      }
      break;
    case "run_tests":
      chrome.runtime.sendMessage({
        type: "BACKEND_REQUEST",
        endpoint: "/run_tests",
        method: "POST",
        data: {},
      }, (res) => {
        const r = res?.data;
        log(`Tests: ${r?.passed} passed, ${r?.failed} failed`, r?.success ? "success" : "error");
      });
      break;
  }

  await sleep(1000);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Initialize
checkBackend();
