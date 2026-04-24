// Agent Loop — main orchestration engine using all core modules
import { StateMachine } from "./stateMachine.js";
import { Planner } from "./planner.js";
import { ToolRegistry } from "./toolRegistry.js";
import { ContextEngine } from "./contextEngine.js";
import { Memory } from "./memory.js";
import { Router } from "./router.js";
import { Logger } from "./logger.js";
import { budgetPrompt } from "./tokenManager.js";

export class AgentLoop {
  constructor({ backendUrl = "http://127.0.0.1:8765", maxIterations = 25, maxRetries = 3, stepTimeoutMs = 120000 } = {}) {
    this.backendUrl = backendUrl;
    this.maxIterations = maxIterations;
    this.maxRetries = maxRetries;
    this.stepTimeoutMs = stepTimeoutMs;

    this.sm = new StateMachine("IDLE");
    this.planner = new Planner();
    this.tools = new ToolRegistry(backendUrl);
    this.context = new ContextEngine(backendUrl);
    this.memory = new Memory({ backendUrl });
    this.router = new Router();
    this.log = new Logger("agentLoop");

    // Notify background of state changes
    this.sm.subscribe((state) => {
      chrome.runtime.sendMessage({ type: "status", payload: { state } }).catch(() => {});
    });
  }

  // ─── Main entry ────────────────────────────────────────────────────────────

  async run({ goal, model = "auto", projectId = null }) {
    if (!this.sm.can("PLANNING")) {
      this.log.warn("Agent already running");
      return;
    }
    this.sm.to("PLANNING");
    this.log.info(`Goal: ${goal}`, { task_id: "init" });

    // Load project context
    const memoryEntries = projectId ? await this.memory.getProjectMemory(projectId) : [];
    this.log.info(`Memory entries: ${memoryEntries.length}`);

    // Route to best AI model for planning
    const planRoute = this.router.route("chatgpt", "planning");
    this.log.info(`Planning via: ${planRoute.model}`);

    const tabInfo = await this._openTab(planRoute.url);
    if (!tabInfo?.tabId) {
      this.log.error("Could not open AI tab");
      this.sm.force("FAILED");
      return;
    }

    await this._sleep(3000);

    // Build planning prompt with memory context
    const memCtx = this.memory.buildContextSummary(memoryEntries);
    const rawPrompt = this.planner.buildPlanPrompt(goal, memoryEntries);
    const { prompt } = budgetPrompt(rawPrompt, planRoute.model);

    this.log.info("Sending plan request to AI...");
    const planText = await this._sendAndWait(tabInfo.tabId, prompt, planRoute.model);

    if (!planText) {
      this.log.error("No response from AI planner");
      this.sm.force("FAILED");
      return;
    }

    const plan = this.planner.parsePlan(planText);
    if (!plan) {
      this.log.error("Could not parse plan JSON from AI response");
      this.sm.force("FAILED");
      return;
    }

    this.log.info(`Plan: ${plan.tasks.length} tasks`, { task_id: "plan" });
    chrome.runtime.sendMessage({ type: "plan", payload: plan }).catch(() => {});

    // Switch to best coding model for execution
    const execRoute = this.router.route(model, "coding");

    this.sm.to("EXECUTING");

    let stepNum = 0;
    const totalSteps = plan.tasks.reduce((acc, t) => acc + (t.steps?.length || 0), 0);

    for (const task of plan.tasks) {
      if (this.sm.state === "PAUSED") { await this._waitUntilResumed(); }
      if (!["EXECUTING", "FIXING"].includes(this.sm.state)) break;

      this.log.info(`Task: ${task.name}`);

      for (const step of task.steps || []) {
        if (this.sm.state === "PAUSED") { await this._waitUntilResumed(); }
        if (!["EXECUTING", "FIXING"].includes(this.sm.state)) break;
        if (stepNum >= this.maxIterations) {
          this.log.warn("Max iterations reached");
          break;
        }

        stepNum++;
        this.log.info(`Step ${stepNum}/${totalSteps}: ${step.action} ${step.path || step.cmd || ""}`);

        // Request approval if needed
        const approved = await this._requestApproval(step, plan);
        if (!approved) {
          this.log.warn(`Step rejected by user: ${step.action} ${step.path || step.cmd || ""}`);
          continue;
        }

        let success = false;
        let retries = 0;

        while (!success && retries < this.maxRetries) {
          try {
            const result = await this.tools.run(step);
            success = result.ok !== false && !result.error;
            if (success) {
              this.log.info(`Step OK: ${step.action}`);
            } else {
              throw new Error(result.detail || result.error || "step failed");
            }
          } catch (err) {
            retries++;
            this.log.warn(`Step failed (attempt ${retries}/${this.maxRetries}): ${err.message}`);

            if (retries < this.maxRetries) {
              this.sm.force("FIXING");
              const fixRoute = this.router.route("qwen", "debugging");
              const fixPrompt = this.planner.buildFixPrompt(step, err.message);
              const { prompt: fp } = budgetPrompt(fixPrompt, fixRoute.model);
              const fixText = await this._sendAndWait(tabInfo.tabId, fp, fixRoute.model);
              if (fixText) {
                const fixed = this.planner.parseFixedStep(fixText);
                if (fixed) { Object.assign(step, fixed); this.log.info("Applied AI fix"); }
              }
              this.sm.force("EXECUTING");
            } else {
              this.log.error(`Permanently failed: ${step.action}`);
              await this.memory.store({ type: "error_pattern", key: `fail:${step.action}:${step.path || step.cmd}`, value: err.message, projectId });
            }
          }
        }
      }
    }

    this.log.info("Agent run complete");
    try { this.sm.to("DONE"); } catch { this.sm.force("DONE"); }
  }

  pause() {
    try { this.sm.to("PAUSED"); } catch {}
    this.log.info("Paused");
  }

  resume() {
    try { this.sm.to("EXECUTING"); } catch { this.sm.force("EXECUTING"); }
    this.log.info("Resumed");
  }

  stop() {
    this.sm.force("IDLE");
    this.log.info("Stopped");
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  async _openTab(url) {
    return new Promise(resolve => chrome.runtime.sendMessage({ type: "OPEN_AI_TAB", url }, resolve));
  }

  async _sendAndWait(tabId, prompt, adapter) {
    await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "INJECT_PROMPT", tabId, prompt, adapter }, resolve);
    });
    return this._pollResponse(tabId, adapter, this.stepTimeoutMs);
  }

  async _pollResponse(tabId, adapter, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      await this._sleep(2000);
      if (this.sm.state === "PAUSED") continue;
      const result = await new Promise(r => chrome.runtime.sendMessage({ type: "GET_RESPONSE", tabId, adapter }, r));
      if (result?.done && result?.response) return result.response;
    }
    return null;
  }

  async _requestApproval(step, plan) {
    const needsApproval = step.action === "write_file" || step.action === "execute_command";
    if (!needsApproval) return true;

    // Get old content for diff
    let oldContent = "";
    if (step.action === "write_file" && step.path) {
      try {
        const r = await this.tools._post("/read_file", { path: step.path });
        oldContent = r.content || "";
      } catch {}
    }

    const approval = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind: step.action === "write_file" ? "write_file" : "execute_command",
      path: step.path,
      cmd: step.cmd,
      oldContent,
      newContent: step.content,
      step,
    };

    this.sm.force("WAITING_APPROVAL");
    const result = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "AGENT_APPROVAL_RESPONSE", ...approval }, () => {});
      // Ask background to handle this approval
      chrome.runtime.sendMessage({ type: "_INTERNAL_REQUEST_APPROVAL", approval }, resolve);
    });
    this.sm.force("EXECUTING");
    return result === true;
  }

  async _waitUntilResumed() {
    while (this.sm.state === "PAUSED") {
      await this._sleep(1000);
    }
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}
