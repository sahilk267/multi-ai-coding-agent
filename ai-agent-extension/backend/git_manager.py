"""
Git Manager - handles version control operations
"""

import subprocess
import os
from typing import Optional


class GitManager:
    def _run(self, cmd: str, cwd: str) -> dict:
        try:
            result = subprocess.run(
                cmd, shell=True, cwd=cwd, capture_output=True, text=True, timeout=30
            )
            return {
                "success": result.returncode == 0,
                "stdout": result.stdout.strip(),
                "stderr": result.stderr.strip(),
                "message": result.stdout.strip() or result.stderr.strip(),
            }
        except subprocess.TimeoutExpired:
            return {"success": False, "message": "Git operation timed out", "stdout": "", "stderr": ""}
        except Exception as e:
            return {"success": False, "message": str(e), "stdout": "", "stderr": ""}

    def init(self, cwd: str) -> dict:
        """Initialize a new git repository"""
        result = self._run("git init", cwd)
        if result["success"]:
            self._run('git config user.email "agent@ai.local"', cwd)
            self._run('git config user.name "AI Agent"', cwd)
        return {"success": result["success"], "message": result["message"]}

    def commit(self, cwd: str, message: str) -> dict:
        """Stage all changes and commit"""
        self._run("git add -A", cwd)
        clean_msg = message.replace('"', '\\"').replace("'", "\\'")
        result = self._run(f'git commit -m "{clean_msg}"', cwd)
        return {"success": result["success"], "message": result["message"]}

    def rollback(self, cwd: str, steps: int = 1) -> dict:
        """Rollback N commits"""
        result = self._run(f"git reset --hard HEAD~{steps}", cwd)
        return {"success": result["success"], "message": result["message"]}

    def status(self, cwd: str) -> dict:
        """Get git status"""
        result = self._run("git status --short", cwd)
        return {
            "success": result["success"],
            "status": result["stdout"],
            "message": result["message"],
        }

    def log(self, cwd: str, limit: int = 10) -> dict:
        """Get recent commit log"""
        result = self._run(f'git log --oneline -n {limit}', cwd)
        entries = [line for line in result["stdout"].split("\n") if line]
        return {"success": result["success"], "commits": entries}

    def diff(self, cwd: str, path: Optional[str] = None) -> dict:
        """Get diff of current changes"""
        cmd = f"git diff {path}" if path else "git diff"
        result = self._run(cmd, cwd)
        return {"success": result["success"], "diff": result["stdout"]}
