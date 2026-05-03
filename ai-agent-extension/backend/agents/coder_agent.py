"""
Coder Agent — generates, modifies, and writes code files.
Preferred model: DeepSeek → Ollama → rule-based fallback.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..ai_providers import call_model
from .base_agent import BaseAgent


class CoderAgent(BaseAgent):

    ROLE = "coder"
    DEFAULT_MODEL = "deepseek"

    def __init__(self, memory_system, bus, session_id: str):
        super().__init__(self.ROLE, self.DEFAULT_MODEL, memory_system, bus, session_id)
        self._project_root: Optional[str] = None

    @property
    def system_prompt(self) -> str:
        return (
            "You are an elite software engineer. Write clean, efficient, well-commented code. "
            "Given a task and research context, produce exact file changes. "
            "Use the project journal to learn from past code changes and review feedback. "
            "Output ONLY valid JSON — no prose, no markdown fences. "
            'Schema: {"files": [{"path": "...", "content": "...", "action": "create|modify|delete"}], '
            '"commands": ["..."], "implementation_notes": "..."}'
        )

    def set_project_root(self, root: str) -> None:
        self._project_root = root

    async def run(self, task: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        description = task.get("description", "")
        await self._set_status("running", f"Coding: {description[:60]}")
        await self._log(f"[CODER] Starting implementation: {description}")

        start = time.time()
        research = context.get("research", {})
        review_feedback = context.get("review_feedback", [])

        if review_feedback:
            await self._log(f"[CODER] Incorporating {len(review_feedback)} reviewer feedback items")
            for fb in review_feedback:
                self._mem.add("review_feedback", fb, category="feedback")

        changes = self._plan_changes(description, research, review_feedback)
        prompt = self._build_prompt(task, context)
        provider_result = call_model(self.ai_model, self.system_prompt, prompt, {"changes": changes})

        if isinstance(provider_result, dict):
            if isinstance(provider_result.get("files"), list):
                changes["files"] = provider_result["files"]
                await self._log(f"[CODER] LLM produced {len(changes['files'])} file(s)")
            if isinstance(provider_result.get("commands"), list):
                changes["commands"] = provider_result["commands"]
            if provider_result.get("implementation_notes"):
                changes["implementation_notes"] = provider_result["implementation_notes"]

        written_files = []
        if self._project_root:
            written_files = await self._apply_changes(changes)

        self._mem.set_context("last_changes", changes)
        self._ltm.append("shared", "code_changes", {
            "task": description,
            "files_modified": [f.get("path", "") for f in changes.get("files", [])],
            "timestamp": time.time(),
        })

        await self._send("orchestrator", "task_result", {
            "agent": self.ROLE,
            "changes": changes,
            "written_files": written_files,
            "task_id": task.get("id"),
        })
        await self._set_status("completed", None)
        elapsed = time.time() - start
        await self._log(
            f"[CODER] Done in {elapsed:.1f}s — "
            f"{len(changes.get('files', []))} files planned, {len(written_files)} written"
        )

        return {
            "success": True,
            "output": json.dumps(changes, indent=2, default=str),
            "changes": changes,
            "written_files": written_files,
            "agent": self.ROLE,
        }

    def _plan_changes(
        self,
        description: str,
        research: Dict[str, Any],
        review_feedback: List[str],
    ) -> Dict[str, Any]:
        relevant = research.get("relevant_files", [])
        tech = research.get("tech_stack", [])

        feedback_note = ""
        if review_feedback:
            feedback_note = "Reviewer feedback to address:\n" + "\n".join(f"- {f}" for f in review_feedback)

        commands = []
        if "Python" in tech:
            commands.append("pip install -r requirements.txt 2>/dev/null || true")
        if "Node.js" in tech or "TypeScript" in tech:
            commands.append("pnpm install 2>/dev/null || npm install 2>/dev/null || true")

        return {
            "task": description,
            "relevant_files": relevant,
            "tech_stack": tech,
            "feedback_addressed": feedback_note,
            "files": [],
            "commands": commands,
            "implementation_notes": (
                f"Implementation plan for: {description}\n"
                f"Target files: {', '.join(relevant[:3]) if relevant else 'To be determined'}\n"
                f"Stack: {', '.join(tech) if tech else 'Unknown'}"
            ),
        }

    async def _apply_changes(self, changes: Dict[str, Any]) -> List[str]:
        written = []
        root = Path(self._project_root)
        for file_change in changes.get("files", []):
            path = file_change.get("path", "")
            content = file_change.get("content", "")
            action = file_change.get("action", "modify")
            if not path or not content:
                continue
            try:
                full_path = root / path
                if action == "delete":
                    if full_path.exists():
                        full_path.unlink()
                        await self._log(f"[CODER] Deleted: {path}")
                else:
                    full_path.parent.mkdir(parents=True, exist_ok=True)
                    full_path.write_text(content)
                    written.append(path)
                    await self._log(f"[CODER] Written: {path} ({len(content)} bytes)")
            except Exception as e:
                await self._log(f"[CODER] Failed to write {path}: {e}", "error")
                self.error_count += 1
        return written
