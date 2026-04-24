"""
Project Manager — project registry + optional watchdog file watcher.

If watchdog is installed the manager can watch the active project directory
and fire a callback whenever files change (used to broadcast file_changed
events over WebSocket so the IDE panel stays in sync).
"""

import os
import time
import subprocess
from pathlib import Path
from typing import Optional, List, Dict, Callable

try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler, FileSystemEvent
    _WATCHDOG_AVAILABLE = True
except ImportError:
    _WATCHDOG_AVAILABLE = False


# ── Watchdog handler ───────────────────────────────────────────────────────────

if _WATCHDOG_AVAILABLE:
    class _AgentEventHandler(FileSystemEventHandler):
        def __init__(self, callback: Callable[[str, str], None]):
            super().__init__()
            self._cb = callback
            self._ignored = {"node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build"}

        def _should_ignore(self, path: str) -> bool:
            parts = Path(path).parts
            return any(p in self._ignored for p in parts)

        def on_modified(self, event: "FileSystemEvent"):
            if not event.is_directory and not self._should_ignore(event.src_path):
                self._cb("modified", event.src_path)

        def on_created(self, event: "FileSystemEvent"):
            if not event.is_directory and not self._should_ignore(event.src_path):
                self._cb("created", event.src_path)

        def on_deleted(self, event: "FileSystemEvent"):
            if not event.is_directory and not self._should_ignore(event.src_path):
                self._cb("deleted", event.src_path)


class ProjectManager:
    def __init__(self, base_path: str = "./projects"):
        self.base_path = Path(os.path.abspath(base_path))
        self.base_path.mkdir(parents=True, exist_ok=True)
        self._active: Optional[Path] = None
        self._projects: Dict[str, Path] = {}
        self._observer: Optional[object] = None  # watchdog Observer | None
        self._watch_callback: Optional[Callable[[str, str], None]] = None
        self._scan_existing()

    # ── Project registry ───────────────────────────────────────────────────────

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
        self._restart_watcher()
        return self._active

    def get_active(self) -> Path:
        return self._active if self._active else self.base_path

    def get_active_name(self) -> Optional[str]:
        return self._active.name if self._active else None

    def list_projects(self) -> List[dict]:
        return [{"name": n, "path": str(p)} for n, p in self._projects.items()]

    # ── File ops ───────────────────────────────────────────────────────────────

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
            return {"stdout": "", "stderr": f"Timed out after {timeout}s",
                    "exit_code": -1, "success": False, "ok": False, "duration": timeout * 1000}
        except Exception as e:
            return {"stdout": "", "stderr": str(e), "exit_code": -1,
                    "success": False, "ok": False, "duration": 0}

    # ── Watchdog ───────────────────────────────────────────────────────────────

    def set_watch_callback(self, callback: Callable[[str, str], None]):
        """Register a callback(event_type, path) for file system events."""
        self._watch_callback = callback
        self._restart_watcher()

    def _restart_watcher(self):
        self._stop_watcher()
        if not _WATCHDOG_AVAILABLE or not self._watch_callback or not self._active:
            return
        try:
            handler = _AgentEventHandler(self._watch_callback)
            self._observer = Observer()
            self._observer.schedule(handler, str(self._active), recursive=True)
            self._observer.start()
        except Exception as e:
            self._observer = None
            print(f"[project_manager] watchdog failed to start: {e}")

    def _stop_watcher(self):
        if self._observer:
            try:
                self._observer.stop()
                self._observer.join(timeout=2)
            except Exception:
                pass
            finally:
                self._observer = None

    def __del__(self):
        self._stop_watcher()

    @property
    def watchdog_available(self) -> bool:
        return _WATCHDOG_AVAILABLE
