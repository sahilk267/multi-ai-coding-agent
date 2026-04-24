// Router — smart AI model routing based on task type
export class Router {
  constructor() {
    this.routes = {
      chatgpt:  { model: "chatgpt",  url: "https://chatgpt.com/",              reason: "Planning and fallback" },
      deepseek: { model: "deepseek", url: "https://chat.deepseek.com/",         reason: "Best for coding" },
      qwen:     { model: "qwen",     url: "https://chat.qwen.ai/",              reason: "Best for debugging" },
      gemini:   { model: "gemini",   url: "https://gemini.google.com/app",      reason: "Long context tasks" },
    };

    this.taskRouting = {
      planning:     "chatgpt",
      coding:       "deepseek",
      debugging:    "qwen",
      long_context: "gemini",
      fast:         "gemini",
      fallback:     "chatgpt",
      auto:         "deepseek",
    };

    this.classifiers = {
      debugging:    ["error", "bug", "fix", "crash", "exception", "debug", "broken", "fail", "issue"],
      long_context: ["large", "all files", "whole project", "entire codebase", "summarize all"],
      fast:         ["summarize", "explain", "simple", "quick", "brief"],
      planning:     ["plan", "design", "architect", "structure", "outline"],
      coding:       ["write", "create", "implement", "build", "add", "refactor", "migrate", "code"],
    };

    this.fallbackOrder = ["deepseek", "chatgpt", "gemini", "qwen"];
  }

  route(requestedModel, taskHint = "coding") {
    // Explicit model requested
    if (requestedModel && requestedModel !== "auto" && this.routes[requestedModel]) {
      return this.routes[requestedModel];
    }
    // Auto-route by task hint
    const classified = this.classify(taskHint || "coding");
    const modelName = this.taskRouting[classified] || "deepseek";
    return this.routes[modelName] || this.routes.deepseek;
  }

  classify(text) {
    const lower = (text || "").toLowerCase();
    for (const [type, keywords] of Object.entries(this.classifiers)) {
      if (keywords.some(kw => lower.includes(kw))) return type;
    }
    return "coding";
  }

  getFallbackOrder() { return this.fallbackOrder.map(m => this.routes[m]); }
}
