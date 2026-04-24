// Executor — delegates to ToolRegistry; kept for backwards compatibility
import { ToolRegistry } from "./toolRegistry.js";

export class Executor {
  constructor({ backendUrl = "http://127.0.0.1:8765" } = {}) {
    this.registry = new ToolRegistry(backendUrl);
  }

  async execute(step) {
    try {
      const result = await this.registry.run(step);
      return { success: result.ok !== false && !result.error, result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // Convenience wrappers
  async writeFile(path, content) { return this.execute({ action: "write_file", path, content }); }
  async readFile(path) { return this.execute({ action: "read_file", path }); }
  async executeCommand(cmd) { return this.execute({ action: "execute_command", cmd }); }
  async runTests() { return this.execute({ action: "run_tests" }); }
  async gitCommit(message) { return this.execute({ action: "git_commit", message }); }
}
