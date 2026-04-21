import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, projectsTable } from "@workspace/db";
import {
  ReadFileBody,
  WriteFileBody,
  ListFilesQueryParams,
  ReadFileParams,
  WriteFileParams,
} from "@workspace/api-zod";
import fs from "fs";
import path from "path";

const router: IRouter = Router();

const ALLOWED_ROOT = process.env.PROJECTS_ROOT || "/tmp/agent-projects";

function sanitizePath(projectPath: string, filePath: string): string | null {
  const resolved = path.resolve(projectPath, filePath);
  if (!resolved.startsWith(path.resolve(projectPath))) {
    return null;
  }
  return resolved;
}

function getLanguage(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".js": "javascript",
    ".ts": "typescript",
    ".jsx": "javascript",
    ".tsx": "typescript",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".java": "java",
    ".cpp": "cpp",
    ".c": "c",
    ".cs": "csharp",
    ".rb": "ruby",
    ".php": "php",
    ".html": "html",
    ".css": "css",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".md": "markdown",
    ".sh": "shell",
    ".sql": "sql",
  };
  return map[ext] || null;
}

function buildFileTree(dirPath: string, maxDepth = 4, depth = 0): object[] {
  if (depth >= maxDepth) return [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const ignored = new Set(["node_modules", ".git", "__pycache__", ".next", "dist", "build", ".venv"]);

    return entries
      .filter(e => !ignored.has(e.name) && !e.name.startsWith("."))
      .map(entry => {
        const fullPath = path.join(dirPath, entry.name);
        const relPath = entry.name;
        if (entry.isDirectory()) {
          return {
            name: entry.name,
            path: relPath,
            type: "directory",
            size: null,
            children: buildFileTree(fullPath, maxDepth, depth + 1),
          };
        } else {
          let size = null;
          try {
            size = fs.statSync(fullPath).size;
          } catch { }
          return {
            name: entry.name,
            path: relPath,
            type: "file",
            size,
            children: null,
          };
        }
      });
  } catch {
    return [];
  }
}

router.get("/projects/:id/files", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  const queryParsed = ListFilesQueryParams.safeParse(req.query);

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const projectDir = path.join(ALLOWED_ROOT, project.path);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  const subPath = queryParsed.success && queryParsed.data.path
    ? path.join(projectDir, queryParsed.data.path)
    : projectDir;

  const tree = buildFileTree(subPath);
  res.json(tree);
});

router.post("/projects/:id/files/read", async (req, res): Promise<void> => {
  const params = ReadFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const bodyParsed = ReadFileBody.safeParse(req.body);
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
  const filePath = sanitizePath(projectDir, bodyParsed.data.path);
  if (!filePath) {
    res.status(400).json({ error: "Invalid file path" });
    return;
  }

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const size = fs.statSync(filePath).size;

  res.json({
    path: bodyParsed.data.path,
    content,
    language: getLanguage(bodyParsed.data.path),
    size,
  });
});

router.post("/projects/:id/files/write", async (req, res): Promise<void> => {
  const params = WriteFileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const bodyParsed = WriteFileBody.safeParse(req.body);
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
  const filePath = sanitizePath(projectDir, bodyParsed.data.path);
  if (!filePath) {
    res.status(400).json({ error: "Invalid file path" });
    return;
  }

  if (bodyParsed.data.createDirs) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  fs.writeFileSync(filePath, bodyParsed.data.content, "utf-8");

  res.json({ success: true, message: `File written: ${bodyParsed.data.path}` });
});

export default router;
