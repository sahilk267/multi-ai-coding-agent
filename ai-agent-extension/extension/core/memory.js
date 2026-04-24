// Memory System — short-term session memory + long-term via backend
export class Memory {
  constructor({ backendUrl = "http://127.0.0.1:8765" } = {}) {
    this.backendUrl = backendUrl;
    this.shortTerm = [];
    this.errorMemory = new Set();
  }

  // Short-term
  addAction(action) {
    this.shortTerm.push({ ...action, timestamp: Date.now() });
    if (this.shortTerm.length > 50) this.shortTerm = this.shortTerm.slice(-50);
  }
  getRecentActions(n = 10) { return this.shortTerm.slice(-n); }
  hasSeenError(error) { return this.errorMemory.has(error); }
  rememberError(error) { this.errorMemory.add(error); }

  // Long-term — persisted via backend named memory files
  async store({ type, key, value, projectId = null }) {
    try {
      // Also sync to named memory file
      const ltm = await this._getNamedMemory("long_term_memory") || {};
      ltm[`${type}:${key}`] = { type, key, value, projectId, updatedAt: Date.now() };
      await this._saveNamedMemory("long_term_memory", ltm);
    } catch {}
    // Also POST to the Node.js API server
    try {
      await fetch(`${this.backendUrl}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, key, value, project_id: projectId }),
      });
    } catch {}
  }

  async getProjectMemory(projectId) {
    try {
      const res = await fetch(`${this.backendUrl}/memory?project_id=${projectId}`);
      return await res.json();
    } catch { return []; }
  }

  async _getNamedMemory(name) {
    try {
      const res = await fetch(`${this.backendUrl}/memory/${name}`);
      const data = await res.json();
      return data.data;
    } catch { return null; }
  }

  async _saveNamedMemory(name, data) {
    try {
      await fetch(`${this.backendUrl}/memory/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: name, data }),
      });
    } catch {}
  }

  buildContextSummary(entries = []) {
    if (!entries.length) return "";
    const grouped = entries.reduce((acc, e) => {
      acc[e.type] = acc[e.type] || [];
      acc[e.type].push(`${e.key}: ${e.value}`);
      return acc;
    }, {});
    return Object.entries(grouped)
      .map(([type, items]) => `${type.toUpperCase()}:\n${items.map(i => `  - ${i}`).join("\n")}`)
      .join("\n\n");
  }
}
