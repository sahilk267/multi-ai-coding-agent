// Memory System - short-term and long-term memory management

export class Memory {
  constructor({ backendUrl = "http://localhost:8000" } = {}) {
    this.backendUrl = backendUrl;
    this.shortTerm = []; // Current session actions
    this.errorMemory = new Set(); // Track seen errors to avoid loops
  }

  // Short-term memory - current session context
  addAction(action) {
    this.shortTerm.push({ ...action, timestamp: Date.now() });
    if (this.shortTerm.length > 50) {
      this.shortTerm = this.shortTerm.slice(-50); // Keep last 50
    }
  }

  getRecentActions(n = 10) {
    return this.shortTerm.slice(-n);
  }

  // Error memory - avoid repeating mistakes
  hasSeenError(error) {
    return this.errorMemory.has(error);
  }

  rememberError(error) {
    this.errorMemory.add(error);
  }

  // Long-term memory - persisted via backend
  async store({ type, key, value, projectId = null }) {
    try {
      const res = await fetch(`${this.backendUrl}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, key, value, project_id: projectId }),
      });
      return await res.json();
    } catch (err) {
      console.error("[Memory] Store failed:", err);
      return null;
    }
  }

  async getProjectMemory(projectId) {
    try {
      const res = await fetch(`${this.backendUrl}/memory?project_id=${projectId}`);
      return await res.json();
    } catch {
      return [];
    }
  }

  async getAllMemory() {
    try {
      const res = await fetch(`${this.backendUrl}/memory`);
      return await res.json();
    } catch {
      return [];
    }
  }

  // Build a context summary for AI prompts
  buildContextSummary(entries = []) {
    if (!entries.length) return "";

    const grouped = entries.reduce((acc, e) => {
      acc[e.type] = acc[e.type] || [];
      acc[e.type].push(`${e.key}: ${e.value}`);
      return acc;
    }, {});

    const sections = Object.entries(grouped).map(([type, items]) =>
      `${type.replace("_", " ").toUpperCase()}:\n${items.map(i => `  - ${i}`).join("\n")}`
    );

    return sections.join("\n\n");
  }
}
