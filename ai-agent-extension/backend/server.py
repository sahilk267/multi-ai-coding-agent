"""
Multi-AI Autonomous Coding Agent - FastAPI Backend
Handles file operations, command execution, git, and tests
Run with: uvicorn server:app --reload --port 8000
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Any
import logging
import os

from project_manager import ProjectManager
from file_indexer import FileIndexer
from test_runner import TestRunner
from git_manager import GitManager
from security import SecurityManager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Multi-AI Coding Agent API",
    description="Backend for the autonomous coding agent",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize managers
security = SecurityManager()
project_manager = ProjectManager(base_path=os.environ.get("PROJECTS_ROOT", "./projects"))
test_runner = TestRunner()
git_manager = GitManager()
file_indexer = FileIndexer()

# ─────────── Request/Response Models ───────────

class WriteFileRequest(BaseModel):
    path: str
    content: str
    create_dirs: bool = True

class ReadFileRequest(BaseModel):
    path: str

class ExecuteRequest(BaseModel):
    command: str
    timeout: int = 30
    cwd: Optional[str] = None

class CreateProjectRequest(BaseModel):
    name: str
    path: Optional[str] = None
    language: Optional[str] = None
    description: Optional[str] = None

class GitCommitRequest(BaseModel):
    message: str

class MemoryEntry(BaseModel):
    type: str
    key: str
    value: str
    project_id: Optional[int] = None

class CreateSessionRequest(BaseModel):
    goal: str
    model: str = "auto"
    project_id: Optional[int] = None


# ─────────── Health ───────────

@app.get("/health")
def health_check():
    return {"status": "ok", "version": "1.0.0"}


# ─────────── Projects ───────────

@app.get("/projects")
def list_projects():
    return project_manager.list_projects()

@app.post("/projects")
def create_project(req: CreateProjectRequest):
    return project_manager.create_project(req.name, req.path, req.language, req.description)

@app.get("/projects/{project_id}")
def get_project(project_id: int):
    project = project_manager.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


# ─────────── File Operations ───────────

@app.post("/write_file")
def write_file(req: WriteFileRequest):
    safe_path = security.validate_path(req.path)
    if not safe_path:
        raise HTTPException(status_code=400, detail="Invalid or unsafe file path")
    
    result = project_manager.write_file(safe_path, req.content, req.create_dirs)
    return result

@app.post("/read_file")
def read_file(req: ReadFileRequest):
    safe_path = security.validate_path(req.path)
    if not safe_path:
        raise HTTPException(status_code=400, detail="Invalid file path")
    
    result = project_manager.read_file(safe_path)
    if result is None:
        raise HTTPException(status_code=404, detail="File not found")
    return {"path": req.path, "content": result}

@app.get("/list_files")
def list_files(path: str = ".", project_id: Optional[int] = None):
    base = project_manager.get_project_path(project_id) if project_id else project_manager.base_path
    return {"files": project_manager.list_files(os.path.join(base, path))}


# ─────────── Command Execution ───────────

@app.post("/execute")
def execute_command(req: ExecuteRequest):
    if not security.is_command_safe(req.command):
        raise HTTPException(status_code=400, detail="Command blocked by security policy")
    
    cwd = req.cwd or project_manager.base_path
    safe_cwd = security.validate_path(cwd)
    
    result = project_manager.execute_command(req.command, safe_cwd, req.timeout)
    return result


# ─────────── Package Installation ───────────

@app.post("/install_package")
def install_package(package: str, manager: str = "npm"):
    managers = {
        "npm": f"npm install {package}",
        "pip": f"pip install {package}",
        "pnpm": f"pnpm add {package}",
        "yarn": f"yarn add {package}",
    }
    cmd = managers.get(manager, f"npm install {package}")
    
    if not security.is_command_safe(cmd):
        raise HTTPException(status_code=400, detail="Install command blocked")
    
    return project_manager.execute_command(cmd, project_manager.base_path, 120)


# ─────────── Tests ───────────

@app.post("/run_tests")
def run_tests(project_id: Optional[int] = None):
    cwd = project_manager.get_project_path(project_id) if project_id else project_manager.base_path
    return test_runner.run(cwd)

@app.post("/projects/{project_id}/tests")
def run_project_tests(project_id: int):
    project = project_manager.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return test_runner.run(project["path"], language=project.get("language"))


# ─────────── Git ───────────

@app.post("/projects/{project_id}/git/init")
def git_init(project_id: int):
    project = project_manager.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return git_manager.init(project["path"])

@app.post("/projects/{project_id}/git/commit")
def git_commit(project_id: int, req: GitCommitRequest):
    project = project_manager.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return git_manager.commit(project["path"], req.message)

@app.post("/projects/{project_id}/git/rollback")
def git_rollback(project_id: int, steps: int = 1):
    project = project_manager.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return git_manager.rollback(project["path"], steps)


# ─────────── File Indexer ───────────

@app.post("/projects/{project_id}/index")
def index_project(project_id: int):
    project = project_manager.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return file_indexer.index(project["path"])

@app.get("/projects/{project_id}/index")
def get_index(project_id: int):
    project = project_manager.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return file_indexer.get_cached_index(project["path"])


# ─────────── Memory ───────────

memory_store: List[dict] = []
_memory_id_counter = 0

@app.get("/memory")
def get_memory(project_id: Optional[int] = None):
    if project_id:
        return [m for m in memory_store if m.get("project_id") == project_id]
    return memory_store

@app.post("/memory")
def add_memory(entry: MemoryEntry):
    global _memory_id_counter
    _memory_id_counter += 1
    record = {
        "id": _memory_id_counter,
        "type": entry.type,
        "key": entry.key,
        "value": entry.value,
        "project_id": entry.project_id,
    }
    memory_store.append(record)
    return record

@app.delete("/memory/{memory_id}")
def delete_memory(memory_id: int):
    global memory_store
    memory_store = [m for m in memory_store if m["id"] != memory_id]
    return {"success": True}


# ─────────── Sessions ───────────

sessions_store: List[dict] = []
_session_id_counter = 0

@app.get("/sessions")
def list_sessions():
    return sessions_store

@app.post("/sessions")
def create_session(req: CreateSessionRequest):
    global _session_id_counter
    _session_id_counter += 1
    session = {
        "id": _session_id_counter,
        "goal": req.goal,
        "model": req.model,
        "project_id": req.project_id,
        "status": "idle",
    }
    sessions_store.append(session)
    return session

@app.patch("/sessions/{session_id}")
def update_session(session_id: int, status: str):
    for s in sessions_store:
        if s["id"] == session_id:
            s["status"] = status
            return s
    raise HTTPException(status_code=404, detail="Session not found")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
