"""
Reviewer Agent — audits code changes for quality, correctness, security, and style.
Preferred model: ChatGPT → Ollama → rule-based fallback.
"""
from __future__ import annotations

import json
import time
from typing import Any, Dict, List

from ..ai_providers import call_model
from .base_agent import BaseAgent


class ReviewerAgent(BaseAgent):

    ROLE = "reviewer"
    DEFAULT_MODEL = "chatgpt"

    def __init__(self, memory_system, bus, session_id: str):
        super().__init__(self.ROLE, self.DEFAULT_MODEL, memory_system, bus, session_id)

    @property
    def system_prompt(self) -> str:
        return (
            "You are a senior code reviewer with expertise in security, performance, and maintainability. "
            "Review code changes and provide structured feedback. "
            "Use the project journal to check if the same issues were raised before. "
            "Output ONLY valid JSON — no prose, no markdown fences. "
            'Schema: {"approved": true, "score": 8, '
            '"issues": [{"severity": "critical|major|minor|info", '
            '"category": "security|correctness|performance|style|maintainability", '
            '"file": null, "line": null, "message": "...", "suggestion": "..."}], '
            '"summary": "..."}'
        )

    async def run(self, task: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        description = task.get("description", "")
        await self._set_status("running", f"Reviewing: {description[:60]}")
        await self._log("[REVIEWER] Starting code review")

        start = time.time()
        changes = context.get("coder_output", {}).get("changes", {})
        research = context.get("research", {})
        review = self._perform_review(changes, research, description)

        prompt = self._build_prompt(task, context)
        provider_result = call_model(self.ai_model, self.system_prompt, prompt, {"review": review})

        if isinstance(provider_result, dict):
            if "approved" in provider_result:
                review = provider_result
            elif "review" in provider_result and isinstance(provider_result["review"], dict):
                review = provider_result["review"]

        if not isinstance(review.get("approved"), bool):
            review["approved"] = True
        if not isinstance(review.get("score"), (int, float)):
            review["score"] = 8
        if not isinstance(review.get("issues"), list):
            review["issues"] = []
        if not isinstance(review.get("summary"), str):
            review["summary"] = "Review complete."

        self._mem.set_context("last_review", review)
        self._ltm.append("shared", "reviews", {
            "approved": review["approved"],
            "score": review["score"],
            "issues_count": len(review["issues"]),
            "timestamp": time.time(),
        })

        await self._send("orchestrator", "review_result", {
            "agent": self.ROLE, "review": review, "task_id": task.get("id"),
        })

        status_emoji = "✅" if review["approved"] else "❌"
        elapsed = time.time() - start
        await self._set_status("completed", None)
        await self._log(
            f"[REVIEWER] {status_emoji} Review complete in {elapsed:.1f}s — "
            f"Score: {review['score']}/10, Issues: {len(review['issues'])}"
        )

        return {
            "success": True,
            "output": json.dumps(review, indent=2),
            "review": review,
            "approved": review["approved"],
            "agent": self.ROLE,
        }

    def _perform_review(
        self, changes: Dict[str, Any], research: Dict[str, Any], task_desc: str
    ) -> Dict[str, Any]:
        issues: List[Dict[str, Any]] = []
        score = 8
        files = changes.get("files", [])
        commands = changes.get("commands", [])

        for cmd in commands:
            if any(d in cmd for d in ["rm -rf", "sudo", "chmod 777", "curl | bash"]):
                issues.append({"severity": "critical", "category": "security", "file": None,
                                "line": None, "message": f"Dangerous command: {cmd}",
                                "suggestion": "Remove or use a safer alternative."})
                score -= 3

        for f in files:
            content = f.get("content", "")
            path = f.get("path", "")
            if "password" in content.lower() and ("=" in content or ":" in content):
                issues.append({"severity": "critical", "category": "security", "file": path,
                                "line": None, "message": "Possible hardcoded credential",
                                "suggestion": "Use environment variables."})
                score -= 2
            if content:
                lines = content.split("\n")
                if len(lines) > 200:
                    issues.append({"severity": "minor", "category": "maintainability",
                                    "file": path, "line": None,
                                    "message": f"File is {len(lines)} lines — consider splitting",
                                    "suggestion": "Break into smaller focused modules."})
                if "TODO" in content or "FIXME" in content:
                    issues.append({"severity": "info", "category": "maintainability",
                                    "file": path, "line": None,
                                    "message": "Unresolved TODO/FIXME comments",
                                    "suggestion": "Resolve or track before shipping."})
                if "except:" in content or "except Exception:" in content:
                    issues.append({"severity": "major", "category": "correctness",
                                    "file": path, "line": None,
                                    "message": "Bare exception handler — errors silently swallowed",
                                    "suggestion": "Catch specific exceptions and log errors."})
                    score -= 1

        if not files and not commands:
            issues.append({"severity": "info", "category": "correctness", "file": None,
                            "line": None, "message": "No concrete code changes produced",
                            "suggestion": "Verify coder agent completed its task."})

        critical = [i for i in issues if i["severity"] == "critical"]
        major = [i for i in issues if i["severity"] == "major"]
        approved = len(critical) == 0 and len(major) <= 1
        score = max(0, min(10, score))

        return {
            "approved": approved, "score": score, "issues": issues,
            "critical_count": len(critical), "major_count": len(major),
            "files_reviewed": len(files), "commands_reviewed": len(commands),
            "summary": (
                f"Review {'PASSED' if approved else 'FAILED'} with score {score}/10. "
                f"{len(critical)} critical, {len(major)} major issues. "
                f"Reviewed {len(files)} file(s) and {len(commands)} command(s)."
            ),
        }
