"""
Project Manager - handles project creation, file ops, and command execution
"""

import os
import subprocess
import json
import time
from typing import Optional, List, Dict, Any
from pathlib import Path


class ProjectManager:
    def __init__(self, base_path: str = "./projects"):
        self.base_path = os.path.abspath(base_path)
        self._projects: Dict[int, dict] = {}
        self._id_counter = 0
        os.makedirs(self.base_path, exist_ok=True)

        # Load existing projects from disk
        self._load_projects()

    def _load_projects(self):
        index_path = os.path.join(self.base_path, ".projects.json")
        if os.path.exists(index_path):
            try:
                with open(index_path) as f:
                    data = json.load(f)
                    self._projects = {int(k): v for k, v in data.get("projects", {}).items()}
                    self._id_counter = data.get("counter", 0)
            except Exception:
                pass

    def _save_projects(self):
        index_path = os.path.join(self.base_path, ".projects.json")
        with open(index_path, "w") as f:
            json.dump({
                "projects": {str(k): v for k, v in self._projects.items()},
                "counter": self._id_counter,
            }, f, indent=2)

    def create_project(self, name: str, path: Optional[str] = None, language: Optional[str] = None, description: Optional[str] = None) -> dict:
        self._id_counter += 1
        proj_id = self._id_counter
        proj_path = path or name.lower().replace(" ", "-")
        abs_path = os.path.join(self.base_path, proj_path)
        os.makedirs(abs_path, exist_ok=True)

        project = {
            "id": proj_id,
            "name": name,
            "path": abs_path,
            "relative_path": proj_path,
            "language": language,
            "description": description,
            "created_at": time.time(),
        }
        self._projects[proj_id] = project
        self._save_projects()
        return project

    def get_project(self, project_id: int) -> Optional[dict]:
        return self._projects.get(project_id)

    def get_project_path(self, project_id: Optional[int]) -> str:
        if project_id and project_id in self._projects:
            return self._projects[project_id]["path"]
        return self.base_path

    def list_projects(self) -> List[dict]:
        return list(self._projects.values())

    def write_file(self, path: str, content: str, create_dirs: bool = True) -> dict:
        try:
            abs_path = path if os.path.isabs(path) else os.path.join(self.base_path, path)
            if create_dirs:
                os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            with open(abs_path, "w", encoding="utf-8") as f:
                f.write(content)
            return {"success": True, "message": f"File written: {path}", "path": abs_path}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def read_file(self, path: str) -> Optional[str]:
        try:
            abs_path = path if os.path.isabs(path) else os.path.join(self.base_path, path)
            with open(abs_path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception:
            return None

    def list_files(self, directory: str) -> List[dict]:
        result = []
        ignored = {"node_modules", ".git", "__pycache__", ".next", "dist", "build", ".venv"}
        
        try:
            for entry in sorted(Path(directory).iterdir()):
                if entry.name.startswith(".") or entry.name in ignored:
                    continue
                info = {
                    "name": entry.name,
                    "path": str(entry.relative_to(self.base_path)),
                    "type": "directory" if entry.is_dir() else "file",
                    "size": entry.stat().st_size if entry.is_file() else None,
                }
                if entry.is_dir():
                    info["children"] = self.list_files(str(entry))
                result.append(info)
        except Exception:
            pass

        return result

    def execute_command(self, command: str, cwd: str, timeout: int = 30) -> dict:
        start = time.time()
        try:
            result = subprocess.run(
                command,
                shell=True,
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            duration = int((time.time() - start) * 1000)
            return {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "exit_code": result.returncode,
                "success": result.returncode == 0,
                "duration": duration,
            }
        except subprocess.TimeoutExpired:
            return {
                "stdout": "",
                "stderr": f"Command timed out after {timeout}s",
                "exit_code": -1,
                "success": False,
                "duration": timeout * 1000,
            }
        except Exception as e:
            return {
                "stdout": "",
                "stderr": str(e),
                "exit_code": -1,
                "success": False,
                "duration": int((time.time() - start) * 1000),
            }
