"""
Multi-AI Autonomous Coding Agent — FastAPI Backend
Fully merged: file ops, command execution (streaming), WebSocket, git, tests,
named memory, state machine, routing config, project management, approval history.

Run: uvicorn backend.server:app --reload --host 127.0.0.1 --port 8765
  or: uvicorn server:app --reload --host 127.0.0.1 --port 8765  (from inside backend/)
"""

import asyncio
import json
import os
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .ai_router import get_routing_config
from .file_indexer import FileIndexer
from .git_manager import GitManager
from .logger import get_logger
from .orchestrator import Orchestrator
from .project_manager import ProjectManager
from .security import SecurityManager
from .test_runner import TestRunner
from .websocket_manager import ws_manager

log = get_logger("server")

ROOT = Path(__file__).resolve().parent.parent
PROJECTS_ROOT = ROOT / "projects"
MEMORY_DIR = ROOT / "memory"
PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)
MEMORY_DIR.mkdir(parents=True, exist_ok=True)

security = SecurityManager(str(PROJECTS_ROOT))
pm = ProjectManager(str(PROJECTS_ROOT))
test_runner = TestRunner()
git_manager = GitManager()
file_indexer = FileIndexer()

app = FastAPI(title="AI Agent Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)

# ── Agent state ────────────────────────────────────────────────────────────────
VALID_STATES = {"IDLE", "PLANNING", "EXECUTING", "WAITING_APPROVAL", "FIXING", "PAUSED", "DONE", "FAILED"}
STATE: Dict[str, Any] = {
    "agent_state": "IDLE",
    "current_task_id": None,
    "cancel_requested": False,
    "started_at": None,
}
RUNNING_PROCS: Dict[str, subprocess.Popen] = {}
MAIN_LOOP: Optional[asyncio.AbstractEventLoop] = None
ALLOWED_MEMORY = {"long_term_memory", "session_memory", "error_memory", "approval_history"}


@app.on_event("startup")
async def _capture_loop():
    global MAIN_LOOP
    MAIN_LOOP = asyncio.get_running_loop()


def _schedule(coro):
    loop = MAIN_LOOP
    if loop and not loop.is_closed():
        try: asyncio.run_coroutine_threadsafe(coro, loop)
        except RuntimeError: pass


def _set_state(s: str):
    STATE["agent_state"] = s
    _schedule(ws_manager.broadcast("status", {"state": s}))


# ── Pydantic models ────────────────────────────────────────────────────────────

class ProjectSelect(BaseModel):
    name: str

class FileRead(BaseModel):
    path: str

class FileWrite(BaseModel):
    path: str
    content: str
    create_dirs: bool = True

class FileList(BaseModel):
    path: Optional[str] = ""

class ExecuteCmd(BaseModel):
    cmd: str
    timeout: int = 60
    task_id: Optional[str] = None

class GitCommit(BaseModel):
    message: str = "agent commit"

class GitRollback(BaseModel):
    sha: Optional[str] = None

class MemoryWrite(BaseModel):
    file: str
    data: Any

class CreateSessionRequest(BaseModel):
    goal: str
    model: str = "auto"
    project_id: Optional[int] = None


class OrchestratorRunRequest(BaseModel):
    goal: str
    session_id: int
    agent_ids: Dict[str, int] = {}    # role → DB agent row id
    task_ids: Dict[int, int] = {}     # taskIndex → DB agent_task row id
    callback_url: str = "http://localhost:8080"


# ── Orchestrator (multi-agent pipeline) ────────────────────────────────────────

_active_orchestrator: Optional[Orchestrator] = None
_active_pipeline_task: Optional[asyncio.Task] = None


@app.post("/orchestrator/run")
async def orchestrator_run(req: OrchestratorRunRequest):
    global _active_orchestrator, _active_pipeline_task

    if _active_orchestrator and _active_orchestrator.is_running:
        raise HTTPException(409, "An orchestrator pipeline is already running. Cancel it first.")

    project_root: Optional[str] = None
    try:
        active = pm.get_active()
        if active:
            project_root = str(active)
    except Exception:
        pass

    _active_orchestrator = Orchestrator(
        memory_dir=str(MEMORY_DIR),
        project_root=project_root,
    )

    async def run_pipeline():
        try:
            await _active_orchestrator.run(
                goal=req.goal,
                session_id=str(req.session_id),
                agent_ids=req.agent_ids,
                task_ids=req.task_ids,
                callback_url=req.callback_url,
            )
        except asyncio.CancelledError:
            log.info("Pipeline task cancelled")
        except Exception as e:
            log.exception(f"Pipeline failed with exception: {e}")

    _active_pipeline_task = asyncio.create_task(run_pipeline())
    return {"status": "started", "session_id": req.session_id, "run_id": "pending"}


@app.get("/orchestrator/status")
def orchestrator_status():
    if not _active_orchestrator:
        return {"running": False, "current_run": None, "history": [], "history_count": 0}
    return _active_orchestrator.get_status()


@app.post("/orchestrator/cancel")
async def orchestrator_cancel():
    global _active_pipeline_task
    if _active_orchestrator:
        await _active_orchestrator.cancel()
    if _active_pipeline_task and not _active_pipeline_task.done():
        _active_pipeline_task.cancel()
    return {"status": "cancel_requested"}


# ── Approval queue ─────────────────────────────────────────────────────────────
# Keyed by id; resolved ones are removed

class ApprovalAdd(BaseModel):
    id: Optional[str] = None
    kind: str
    path: Optional[str] = None
    cmd: Optional[str] = None
    old_content: Optional[str] = None
    new_content: Optional[str] = None
    step: Optional[dict] = None

class ApprovalDecision(BaseModel):
    decision: str  # "approve" | "reject"

_approval_queue: Dict[str, dict] = {}
_approval_results: Dict[str, str] = {}  # id -> "approve" | "reject"


# ── Sessions in-memory ─────────────────────────────────────────────────────────
sessions_store: List[dict] = []
_session_counter = 0


# ── Health / Status ────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"ok": True, "service": "ai-agent-backend", "version": "1.0.0"}

@app.get("/health")
def health():
    return {"status": "ok", "version": "1.0.0"}

@app.get("/status")
def status():
    return {
        **STATE,
        "active_project": pm.get_active_name(),
        "projects": pm.list_projects(),
    }

@app.get("/routing")
def routing():
    return get_routing_config()


# ── Project ────────────────────────────────────────────────────────────────────

@app.get("/project/list")
def project_list():
    return {"projects": pm.list_projects()}

@app.post("/project/create")
def project_create(p: ProjectSelect):
    path = pm.create_project(p.name)
    return {"ok": True, "path": str(path)}

@app.post("/project/select")
def project_select(p: ProjectSelect):
    path = pm.set_active(p.name)
    git_manager.init(str(path))
    return {"ok": True, "active": str(path)}

@app.get("/project/index")
def project_index():
    active = pm.get_active()
    return file_indexer.index(str(active))

@app.post("/project/summary")
def project_summary(req: FileRead):
    """
    Return a structured code summary for a file: functions, classes, imports,
    and top-level constants. Language detection by extension.
    """
    import re as _re
    active = pm.get_active()
    full = security.validate_path(req.path, str(active))
    if not full or not Path(full).exists():
        raise HTTPException(404, "not found")
    try:
        content = Path(full).read_text(encoding="utf-8", errors="ignore")
    except Exception as e:
        raise HTTPException(400, str(e))

    lines = content.split("\n")
    ext = Path(req.path).suffix.lower()
    lang = {
        ".py": "python", ".js": "javascript", ".ts": "typescript",
        ".tsx": "typescript", ".jsx": "javascript", ".go": "go",
        ".rs": "rust", ".java": "java", ".rb": "ruby", ".php": "php",
        ".cpp": "cpp", ".c": "c", ".cs": "csharp",
    }.get(ext, "unknown")

    functions, classes, imports_, constants = [], [], [], []

    if lang in ("python",):
        for i, line in enumerate(lines, 1):
            s = line.strip()
            if s.startswith("def ") or s.startswith("async def "):
                name = _re.split(r"[\s(]", s, 2)[1]
                functions.append({"name": name, "line": i})
            elif s.startswith("class "):
                name = _re.split(r"[\s(:]", s, 2)[1]
                classes.append({"name": name, "line": i})
            elif s.startswith("import ") or s.startswith("from "):
                imports_.append({"statement": s, "line": i})
    elif lang in ("javascript", "typescript"):
        fn_pat = _re.compile(r"(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function")
        cls_pat = _re.compile(r"(?:export\s+)?(?:default\s+)?class\s+(\w+)")
        import_pat = _re.compile(r"^import\s")
        const_pat = _re.compile(r"^(?:export\s+)?const\s+([A-Z][A-Z0-9_]+)\s*=")
        for i, line in enumerate(lines, 1):
            s = line.strip()
            m = fn_pat.search(s)
            if m:
                name = m.group(1) or m.group(2) or m.group(3)
                if name:
                    functions.append({"name": name, "line": i})
            m = cls_pat.search(s)
            if m:
                classes.append({"name": m.group(1), "line": i})
            if import_pat.match(s):
                imports_.append({"statement": s[:120], "line": i})
            m = const_pat.match(s)
            if m:
                constants.append({"name": m.group(1), "line": i})

    return {
        "path": req.path,
        "language": lang,
        "lines": len(lines),
        "functions": functions,
        "classes": classes,
        "imports": imports_,
        "constants": constants,
        "size_bytes": Path(full).stat().st_size,
    }

# ── File Ops ───────────────────────────────────────────────────────────────────

@app.post("/read_file")
def read_file(req: FileRead):
    active = pm.get_active()
    full = security.validate_path(req.path, str(active))
    if not full:
        raise HTTPException(400, "invalid path (path traversal blocked)")
    p = Path(full)
    if not p.exists() or not p.is_file():
        raise HTTPException(404, "not found")
    try:
        content = p.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raise HTTPException(400, "binary file")
    return {"path": req.path, "content": content, "size": p.stat().st_size}


@app.post("/write_file")
async def write_file(req: FileWrite):
    active = pm.get_active()
    full = security.validate_path(req.path, str(active))
    if not full:
        raise HTTPException(400, "invalid path")
    p = Path(full)
    if req.create_dirs:
        p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(req.content, encoding="utf-8")
    await ws_manager.broadcast("file_written", {"path": req.path, "size": len(req.content)})
    return {"ok": True, "path": req.path, "size": len(req.content)}


@app.post("/list_files")
def list_files(req: FileList):
    active = pm.get_active()
    target = security.validate_path(req.path or "", str(active))
    if not target:
        raise HTTPException(400, "invalid path")
    p = Path(target)
    if not p.exists():
        raise HTTPException(404, "not found")
    entries = []
    ignored = {"node_modules", ".git", "__pycache__", ".next", "dist", "build", ".venv", "venv"}
    for c in sorted(p.iterdir()):
        if c.name.startswith(".") or c.name in ignored:
            continue
        try:
            entries.append({"name": c.name, "is_dir": c.is_dir(), "size": c.stat().st_size if c.is_file() else 0})
        except OSError:
            continue
    return {"path": req.path or "", "entries": entries}


# ── Execute (streaming via WebSocket) ─────────────────────────────────────────

@app.post("/execute")
async def execute(req: ExecuteCmd):
    ok, msg = security.is_command_safe(req.cmd)
    if not ok:
        await ws_manager.broadcast("error", {"source": "execute", "message": msg, "cmd": req.cmd})
        raise HTTPException(400, msg)

    cwd = pm.get_active()
    task_id = req.task_id or uuid.uuid4().hex[:8]
    STATE["current_task_id"] = task_id
    STATE["cancel_requested"] = False
    _set_state("EXECUTING")

    await ws_manager.broadcast("command_started", {"task_id": task_id, "cmd": req.cmd})

    proc = subprocess.Popen(
        req.cmd, shell=True, cwd=str(cwd),
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1,
    )
    RUNNING_PROCS[task_id] = proc
    output_lines = []
    start = time.time()

    try:
        while True:
            if STATE.get("cancel_requested"):
                proc.terminate()
                try: proc.wait(timeout=3)
                except subprocess.TimeoutExpired: proc.kill()
                await ws_manager.broadcast("command_output", {"task_id": task_id, "line": "[CANCELLED]"})
                break
            if time.time() - start > req.timeout:
                proc.terminate()
                try: proc.wait(timeout=3)
                except subprocess.TimeoutExpired: proc.kill()
                await ws_manager.broadcast("command_output", {"task_id": task_id, "line": "[TIMEOUT]"})
                break
            line = proc.stdout.readline()
            if not line:
                if proc.poll() is not None:
                    break
                await asyncio.sleep(0.05)
                continue
            stripped = line.rstrip("\n")
            output_lines.append(stripped)
            await ws_manager.broadcast("command_output", {"task_id": task_id, "line": stripped})
    finally:
        RUNNING_PROCS.pop(task_id, None)
        _set_state("IDLE")

    code = proc.returncode if proc.returncode is not None else -1
    await ws_manager.broadcast("command_finished", {"task_id": task_id, "code": code})
    return {"ok": code == 0, "success": code == 0, "code": code, "task_id": task_id,
            "stdout": "\n".join(output_lines)[-50000:], "stderr": "", "output": "\n".join(output_lines)[-50000:]}


@app.post("/cancel")
async def cancel():
    STATE["cancel_requested"] = True
    killed = []
    for tid, proc in list(RUNNING_PROCS.items()):
        try: proc.terminate(); killed.append(tid)
        except Exception: pass
    await ws_manager.broadcast("status", {"state": "PAUSED", "cancelled": killed})
    return {"ok": True, "cancelled": killed}


# ── Tests ──────────────────────────────────────────────────────────────────────

@app.post("/run_tests")
async def run_tests_endpoint():
    cwd = pm.get_active()
    _set_state("EXECUTING")
    result = await asyncio.get_event_loop().run_in_executor(None, lambda: test_runner.run(str(cwd)))
    _set_state("IDLE")
    await ws_manager.broadcast("test_result", result)
    return result


# ── Git ────────────────────────────────────────────────────────────────────────

@app.post("/git/commit")
async def git_commit(req: GitCommit):
    result = git_manager.commit(str(pm.get_active()), req.message)
    await ws_manager.broadcast("git", {"action": "commit", "ok": result["success"], "info": result.get("message", "")})
    if not result["success"]:
        raise HTTPException(500, result.get("message", "git commit failed"))
    return {"ok": True, "sha": result.get("stdout", "")[:40]}

@app.post("/git/rollback")
async def git_rollback(req: GitRollback):
    result = git_manager.rollback(str(pm.get_active()), steps=1)
    await ws_manager.broadcast("git", {"action": "rollback", "ok": result["success"]})
    if not result["success"]:
        raise HTTPException(500, result.get("message", "rollback failed"))
    return {"ok": True, "info": result.get("message", "")}

@app.get("/git/log")
def git_log_endpoint(n: int = 20):
    result = git_manager.log(str(pm.get_active()), n)
    if not result["success"]:
        raise HTTPException(500, result.get("message", "git log failed"))
    return {"ok": True, "log": result.get("commits", [])}


# ── State ──────────────────────────────────────────────────────────────────────

@app.post("/state/{new_state}")
async def set_state(new_state: str):
    if new_state not in VALID_STATES:
        raise HTTPException(400, f"invalid state '{new_state}'. Valid: {', '.join(VALID_STATES)}")
    STATE["agent_state"] = new_state
    await ws_manager.broadcast("status", {"state": new_state})
    return {"ok": True, "state": new_state}


# ── Memory (named JSON files) ──────────────────────────────────────────────────

@app.get("/memory/{name}")
def memory_get(name: str):
    if name not in ALLOWED_MEMORY:
        raise HTTPException(400, f"invalid memory file '{name}'")
    f = MEMORY_DIR / f"{name}.json"
    if not f.exists():
        return {"data": None}
    try:
        return {"data": json.loads(f.read_text(encoding="utf-8"))}
    except Exception:
        return {"data": None}

@app.post("/memory/save")
def memory_save(req: MemoryWrite):
    if req.file not in ALLOWED_MEMORY:
        raise HTTPException(400, f"invalid memory file '{req.file}'")
    f = MEMORY_DIR / f"{req.file}.json"
    f.write_text(json.dumps(req.data, indent=2, ensure_ascii=False), encoding="utf-8")
    return {"ok": True}


# ── Sessions ───────────────────────────────────────────────────────────────────

@app.get("/sessions")
def list_sessions():
    return sessions_store

@app.post("/sessions")
def create_session(req: CreateSessionRequest):
    global _session_counter
    _session_counter += 1
    session = {"id": _session_counter, "goal": req.goal, "model": req.model, "project_id": req.project_id, "status": "idle"}
    sessions_store.append(session)
    return session

@app.patch("/sessions/{session_id}")
def update_session(session_id: int, status: str):
    for s in sessions_store:
        if s["id"] == session_id:
            s["status"] = status
            return s
    raise HTTPException(404, "session not found")


# ── Approval Queue API ─────────────────────────────────────────────────────────

@app.get("/approvals")
def list_approvals():
    return {"items": list(_approval_queue.values())}

@app.post("/approvals/add")
async def add_approval(req: ApprovalAdd):
    approval_id = req.id or uuid.uuid4().hex[:12]
    item = {
        "id": approval_id,
        "kind": req.kind,
        "path": req.path,
        "cmd": req.cmd,
        "oldContent": req.old_content,
        "newContent": req.new_content,
        "step": req.step,
        "receivedAt": int(time.time() * 1000),
    }
    _approval_queue[approval_id] = item
    await ws_manager.broadcast("approval_request", item)
    _set_state("WAITING_APPROVAL")
    return {"ok": True, "id": approval_id}

@app.post("/approvals/{approval_id}")
async def resolve_approval(approval_id: str, req: ApprovalDecision):
    if req.decision not in ("approve", "reject"):
        raise HTTPException(400, "decision must be 'approve' or 'reject'")
    item = _approval_queue.pop(approval_id, None)
    _approval_results[approval_id] = req.decision
    if item:
        await ws_manager.broadcast("approval_resolved", {
            "id": approval_id, "decision": req.decision,
            "kind": item.get("kind"), "path": item.get("path"), "cmd": item.get("cmd"),
        })
        # Persist to approval_history memory file
        history_file = MEMORY_DIR / "approval_history.json"
        try:
            history = json.loads(history_file.read_text()) if history_file.exists() else []
            history.append({"id": approval_id, "decision": req.decision, "item": item, "timestamp": int(time.time() * 1000)})
            if len(history) > 500: history = history[-500:]
            history_file.write_text(json.dumps(history, indent=2, ensure_ascii=False))
        except Exception: pass
    # If no more approvals, return to executing state
    if not _approval_queue:
        _set_state("EXECUTING")
    return {"ok": True, "id": approval_id, "decision": req.decision}

@app.get("/approvals/{approval_id}/result")
def get_approval_result(approval_id: str):
    if approval_id in _approval_results:
        return {"id": approval_id, "decision": _approval_results[approval_id], "resolved": True}
    if approval_id in _approval_queue:
        return {"id": approval_id, "resolved": False}
    raise HTTPException(404, "approval not found")


# ── WebSocket ──────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws_manager.connect(ws)
    try:
        await ws_manager.broadcast("status", {"state": STATE["agent_state"]})
        while True:
            msg = await ws.receive_text()
            try:
                data = json.loads(msg)
            except Exception:
                data = {"type": "ping", "raw": msg}
            await ws_manager.broadcast("log", {"source": "ws_in", "message": str(data)})
    except WebSocketDisconnect:
        await ws_manager.disconnect(ws)
    except Exception as e:
        log.warning(f"ws error: {e}")
        await ws_manager.disconnect(ws)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.server:app", host="127.0.0.1", port=8765, reload=True)
