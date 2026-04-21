// Agent Loop - main orchestration engine
// Runs the plan-execute-debug cycle

import { Planner } from "./planner.js";
import { Executor } from "./executor.js";
import { Memory } from "./memory.js";
import { Router } from "./router.js";

export class AgentLoop {
  constructor({ backendUrl = "http://localhost:8000", maxRetries = 3 } = {}) {
    this.backendUrl = backendUrl;
    this.maxRetries = maxRetries;
    this.isRunning = false;
    this.isPaused = false;
    this.sessionId = null;
    this.planner = new Planner();
    this.executor = new Executor({ backendUrl });
    this.memory = new Memory({ backendUrl });
    this.router = new Router();
    this.onLog = null; // Callback for log events
  }

  log(message, level = "info") {
    console.log(`[AgentLoop][${level}] ${message}`);
    this.onLog?.({ message, level, timestamp: new Date().toISOString() });
  }

  async start({ goal, model = "auto", projectId = null }) {
    if (this.isRunning) {
      this.log("Agent is already running", "warn");
      return;
    }

    this.isRunning = true;
    this.isPaused = false;

    this.log(`Starting agent: ${goal}`, "info");
    this.log(`Model: ${model}`, "info");

    // Load project memory
    const projectMemory = projectId ? await this.memory.getProjectMemory(projectId) : [];
    this.log(`Loaded ${projectMemory.length} memory entries`, "info");

    // Route to correct AI
    const route = this.router.route(model, "coding");
    this.log(`Routing to: ${route.model}`, "info");

    // Open AI tab
    const tabInfo = await this.openAITab(route.url);
    if (!tabInfo) {
      this.log("Failed to open AI tab", "error");
      this.isRunning = false;
      return;
    }

    await this.sleep(3000); // Let page load

    // Step 1: Planning
    this.log("Planning...", "info");
    const planPrompt = this.planner.buildPlanPrompt(goal, projectMemory);
    const planResponse = await this.sendToAI(tabInfo.tabId, planPrompt, route.model);

    if (!planResponse) {
      this.log("Planning failed - no AI response", "error");
      this.isRunning = false;
      return;
    }

    const plan = this.planner.parsePlan(planResponse);
    if (!plan) {
      this.log("Could not parse plan from AI", "error");
      this.isRunning = false;
      return;
    }

    this.log(`Plan created: ${plan.tasks.length} tasks`, "success");

    // Step 2: Execute plan
    let stepNum = 0;
    const totalSteps = plan.tasks.reduce((acc, t) => acc + t.steps.length, 0);

    for (const task of plan.tasks) {
      if (!this.isRunning) break;

      this.log(`Task: ${task.name}`, "info");

      for (const step of task.steps) {
        if (!this.isRunning) break;
        while (this.isPaused) {
          await this.sleep(1000);
        }

        stepNum++;
        this.log(`Step ${stepNum}/${totalSteps}: ${step.action} ${step.path || step.cmd || ""}`, "info");

        let retries = 0;
        let success = false;

        while (!success && retries < this.maxRetries) {
          const result = await this.executor.execute(step);

          if (result.success) {
            success = true;
            this.log(`Step succeeded`, "success");
          } else {
            retries++;
            this.log(`Step failed (attempt ${retries}/${this.maxRetries}): ${result.error}`, "warn");

            if (retries < this.maxRetries) {
              // Ask AI to fix the error
              const fixPrompt = this.planner.buildFixPrompt(step, result.error, planResponse);
              const fixResponse = await this.sendToAI(tabInfo.tabId, fixPrompt, route.model);
              if (fixResponse) {
                const fixedStep = this.planner.parseFixedStep(fixResponse);
                if (fixedStep) {
                  Object.assign(step, fixedStep);
                  this.log("Applying AI fix...", "info");
                }
              }
            }
          }
        }

        if (!success) {
          this.log(`Step permanently failed after ${this.maxRetries} attempts`, "error");
          await this.memory.store({
            type: "error_pattern",
            key: `failed_${step.action}`,
            value: `${step.action} on ${step.path} failed: check command syntax`,
            projectId,
          });
        }
      }
    }

    // Step 3: Run tests
    if (projectId) {
      this.log("Running tests...", "info");
      const testResult = await this.executor.runTests(projectId);
      if (!testResult.success) {
        this.log(`Tests failed: ${testResult.failed} failures`, "warn");
      } else {
        this.log(`Tests passed: ${testResult.passed} passing`, "success");
      }
    }

    this.isRunning = false;
    this.log("Agent run complete", "success");
  }

  pause() {
    this.isPaused = true;
    this.log("Agent paused", "info");
  }

  resume() {
    this.isPaused = false;
    this.log("Agent resumed", "info");
  }

  stop() {
    this.isRunning = false;
    this.isPaused = false;
    this.log("Agent stopped", "info");
  }

  async openAITab(url) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "OPEN_AI_TAB", url }, resolve);
    });
  }

  async sendToAI(tabId, prompt, adapter) {
    return new Promise(async (resolve) => {
      chrome.runtime.sendMessage({ type: "INJECT_PROMPT", tabId, prompt, adapter }, (injectResult) => {
        if (!injectResult?.success) {
          resolve(null);
          return;
        }
      });

      // Poll for response
      const timeout = 90000;
      const start = Date.now();
      const poll = setInterval(async () => {
        if (Date.now() - start > timeout) {
          clearInterval(poll);
          resolve(null);
          return;
        }
        const result = await new Promise(r => {
          chrome.runtime.sendMessage({ type: "GET_RESPONSE", tabId, adapter }, r);
        });
        if (result?.done && result?.response) {
          clearInterval(poll);
          resolve(result.response);
        }
      }, 2000);
    });
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
