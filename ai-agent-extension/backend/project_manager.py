"""
Project Manager — project registry + file operations + command execution
"""
import os
import json
import time
import subprocess
from typing import Optional, List, Dict
from pathlib import Path


class ProjectManager:
    def __init__(self, base_path: str = "./projects"):
        self.base_path = Path(os.path.abspath(base_path))
        self.base_path.mkdir(parents=True, exist_ok=True)
        self._active: Optional[Path] = None
        self._projects: Dict[str, Path] = {}
        self._scan_existing()

    def _scan_existing(self):
        for entry in self.base_path.iterdir():
            if entry.is_dir() and not entry.name.startswith("."):
                self._projects[entry.name] = entry

    def create_project(self, name: str) -> Path:
        path = self.base_path / name
        path.mkdir(parents=True, exist_ok=True)
        self._projects[name] = path
        return path

    def set_active(self, name: str) -> Path:
        if name not in self._projects:
            self.create_project(name)
        self._active = self._projects[name]
        return self._active

    def get_active(self) -> Path:
        if self._active:
            return self._active
        return self.base_path

    def get_active_name(self) -> Optional[str]:
        if not self._active:
            return None
        return self._active.name

    def list_projects(self) -> List[dict]:
        return [{"name": n, "path": str(p)} for n, p in self._projects.items()]

    def write_file(self, path: str, content: str, create_dirs: bool = True) -> dict:
        try:
            abs_path = Path(path) if os.path.isabs(path) else self.get_active() / path
            if create_dirs:
                abs_path.parent.mkdir(parents=True, exist_ok=True)
            abs_path.write_text(content, encoding="utf-8")
            return {"success": True, "ok": True, "message": f"Written: {path}", "path": str(abs_path)}
        except Exception as e:
            return {"success": False, "ok": False, "error": str(e)}

    def read_file(self, path: str) -> Optional[str]:
        try:
            abs_path = Path(path) if os.path.isabs(path) else self.get_active() / path
            return abs_path.read_text(encoding="utf-8")
        except Exception:
            return None

    def execute_command(self, command: str, cwd: str, timeout: int = 30) -> dict:
        start = time.time()
        try:
            result = subprocess.run(
                command, shell=True, cwd=cwd,
                capture_output=True, text=True, timeout=timeout,
            )
            duration = int((time.time() - start) * 1000)
            return {
                "stdout": result.stdout, "stderr": result.stderr,
                "exit_code": result.returncode, "success": result.returncode == 0,
                "ok": result.returncode == 0, "duration": duration,
            }
        except subprocess.TimeoutExpired:
            return {"stdout": "", "stderr": f"Timed out after {timeout}s", "exit_code": -1, "success": False, "ok": False, "duration": timeout * 1000}
        except Exception as e:
            return {"stdout": "", "stderr": str(e), "exit_code": -1, "success": False, "ok": False, "duration": 0}
