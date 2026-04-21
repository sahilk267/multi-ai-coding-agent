// Router - smart AI model routing based on task type

export class Router {
  constructor() {
    this.routes = {
      coding: {
        model: "deepseek",
        url: "https://chat.deepseek.com",
        reason: "Best for writing and refactoring code",
      },
      debugging: {
        model: "qwen",
        url: "https://chat.qwen.ai",
        reason: "Best for analyzing errors and debugging",
      },
      fast: {
        model: "gemini",
        url: "https://gemini.google.com/app",
        reason: "Fast responses for simple tasks",
      },
      fallback: {
        model: "chatgpt",
        url: "https://chat.openai.com",
        reason: "Reliable fallback for any task",
      },
      auto: null, // Will be determined dynamically
    };

    // Keywords for task classification
    this.classifiers = {
      debugging: ["error", "bug", "fix", "crash", "exception", "debug", "broken", "fail"],
      fast: ["summarize", "explain", "simple", "quick", "brief", "just"],
      coding: ["write", "create", "implement", "build", "add", "refactor", "migrate"],
    };
  }

  route(requestedModel, taskHint = "coding") {
    if (requestedModel !== "auto" && this.routes[requestedModel]) {
      return this.routes[requestedModel];
    }

    // Auto-route based on task
    const classified = this.classify(taskHint);
    return this.routes[classified] || this.routes.fallback;
  }

  classify(text) {
    const lower = text.toLowerCase();

    for (const [type, keywords] of Object.entries(this.classifiers)) {
      if (keywords.some(kw => lower.includes(kw))) {
        return type;
      }
    }

    return "coding"; // Default
  }

  // Multi-AI collaboration: get best response from multiple models
  async getBestResponse(responses) {
    // Simple strategy: pick longest non-empty response
    return responses
      .filter(r => r && r.length > 0)
      .sort((a, b) => b.length - a.length)[0] || null;
  }
}
