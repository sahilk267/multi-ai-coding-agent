// Executor - runs plan steps via the backend API

export class Executor {
  constructor({ backendUrl = "http://localhost:8000", projectId = null } = {}) {
    this.backendUrl = backendUrl;
    this.projectId = projectId;
  }

  async execute(step) {
    switch (step.action) {
      case "write_file":
        return this.writeFile(step.path, step.content);
      case "read_file":
        return this.readFile(step.path);
      case "execute_command":
        return this.executeCommand(step.cmd);
      case "install_package":
        return this.installPackage(step.package, step.manager || "npm");
      case "run_tests":
        return this.runTests();
      default:
        return { success: false, error: `Unknown action: ${step.action}` };
    }
  }

  async writeFile(path, content) {
    try {
      const res = await fetch(`${this.backendUrl}/write_file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content }),
      });
      const data = await res.json();
      return { success: data.success, result: data, error: data.error };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async readFile(path) {
    try {
      const res = await fetch(`${this.backendUrl}/read_file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = await res.json();
      return { success: true, result: data.content };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async executeCommand(cmd) {
    try {
      const res = await fetch(`${this.backendUrl}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await res.json();
      return {
        success: data.success,
        result: { stdout: data.stdout, stderr: data.stderr },
        error: data.success ? null : data.stderr,
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async installPackage(pkg, manager = "npm") {
    const cmds = {
      npm: `npm install ${pkg}`,
      pip: `pip install ${pkg}`,
      pnpm: `pnpm add ${pkg}`,
      yarn: `yarn add ${pkg}`,
    };
    return this.executeCommand(cmds[manager] || `npm install ${pkg}`);
  }

  async runTests(projectId = null) {
    try {
      const endpoint = projectId
        ? `${this.backendUrl}/projects/${projectId}/tests`
        : `${this.backendUrl}/run_tests`;
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      return {
        success: data.success,
        passed: data.passed,
        failed: data.failed,
        output: data.output,
      };
    } catch (err) {
      return { success: false, error: err.message, passed: 0, failed: 0 };
    }
  }

  async listFiles(path = ".") {
    try {
      const res = await fetch(`${this.backendUrl}/list_files?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      return { success: true, files: data.files };
    } catch (err) {
      return { success: false, error: err.message, files: [] };
    }
  }
}
