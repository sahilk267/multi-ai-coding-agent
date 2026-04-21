import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, projectsTable, logsTable, sessionsTable } from "@workspace/db";
import {
  ExecuteCommandBody,
  ExecuteCommandParams,
  RunTestsParams,
  GitInitParams,
  GitCommitParams,
  GitCommitBody,
} from "@workspace/api-zod";
import { execSync, spawn } from "child_process";
import path from "path";
import fs from "fs";

const router: IRouter = Router();

const ALLOWED_ROOT = process.env.PROJECTS_ROOT || "/tmp/agent-projects";

const BLOCKED_COMMANDS = [
  /\brm\s+-rf\s+\//, /\bformat\b/, /\bshutdown\b/, /\breboot\b/, /\bpoweroff\b/,
  /\bmkfs\b/, /\bdd\s+if=/, /\bsudo\s+rm\s+-rf\b/, />\s*\/dev\/sd/,
];

function isCommandSafe(cmd: string): boolean {
  return !BLOCKED_COMMANDS.some(pattern => pattern.test(cmd));
}

function runCommand(cmd: string, cwd: string, timeout = 30000): {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
  duration: number;
} {
  const start = Date.now();
  try {
    const result = execSync(cmd, {
      cwd,
      timeout,
      maxBuffer: 1024 * 1024 * 10,
      encoding: "utf-8",
    });
    const duration = Date.now() - start;
    return { stdout: result, stderr: "", exitCode: 0, success: true, duration };
  } catch (err: unknown) {
    const duration = Date.now() - start;
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout || "",
      stderr: e.stderr || String(err),
      exitCode: e.status ?? 1,
      success: false,
      duration,
    };
  }
}

router.post("/projects/:id/execute", async (req, res): Promise<void> => {
  const params = ExecuteCommandParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const bodyParsed = ExecuteCommandBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }

  if (!isCommandSafe(bodyParsed.data.command)) {
    res.status(400).json({ error: "Command blocked by security policy" });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const projectDir = path.join(ALLOWED_ROOT, project.path);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  const timeout = (bodyParsed.data.timeout ?? 30) * 1000;
  const result = runCommand(bodyParsed.data.command, projectDir, timeout);

  res.json(result);
});

router.post("/projects/:id/tests", async (req, res): Promise<void> => {
  const params = RunTestsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const projectDir = path.join(ALLOWED_ROOT, project.path);

  let testCmd = "npm test 2>&1 || true";
  if (project.language === "python") {
    testCmd = "python -m pytest 2>&1 || true";
  } else if (fs.existsSync(path.join(projectDir, "package.json"))) {
    testCmd = "npm test 2>&1 || true";
  }

  const result = runCommand(testCmd, projectDir, 60000);

  const output = result.stdout + result.stderr;
  const passedMatch = output.match(/(\d+)\s+pass(?:ing|ed)/i);
  const failedMatch = output.match(/(\d+)\s+fail(?:ing|ed)/i);

  const passed = parseInt(passedMatch?.[1] || "0", 10);
  const failed = parseInt(failedMatch?.[1] || "0", 10);
  const total = passed + failed || (result.success ? 1 : 0);

  res.json({
    passed,
    failed,
    total,
    success: result.success && failed === 0,
    output,
    duration: result.duration,
  });
});

router.post("/projects/:id/git/init", async (req, res): Promise<void> => {
  const params = GitInitParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const projectDir = path.join(ALLOWED_ROOT, project.path);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  const result = runCommand("git init && git config user.email 'agent@ai.local' && git config user.name 'AI Agent'", projectDir, 10000);

  res.json({
    success: result.success,
    message: result.success ? "Git repository initialized" : result.stderr,
  });
});

router.post("/projects/:id/git/commit", async (req, res): Promise<void> => {
  const params = GitCommitParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const bodyParsed = GitCommitBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const projectDir = path.join(ALLOWED_ROOT, project.path);
  const message = bodyParsed.data.message.replace(/"/g, '\\"');
  const result = runCommand(`git add -A && git commit -m "${message}"`, projectDir, 15000);

  res.json({
    success: result.success,
    message: result.success ? "Changes committed" : result.stderr,
  });
});

export default router;
