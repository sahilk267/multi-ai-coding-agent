"""
Planner Agent — decomposes a high-level user goal into structured JSON tasks.
Preferred model: ChatGPT → Ollama → rule-based fallback.
"""
from __future__ import annotations

import json
import time
from typing import Any, Dict, List

from ..ai_providers import call_model, extract_json
from .base_agent import BaseAgent


class PlannerAgent(BaseAgent):

    ROLE = "planner"
    DEFAULT_MODEL = "chatgpt"

    def __init__(self, memory_system, bus, session_id: str):
        super().__init__(self.ROLE, self.DEFAULT_MODEL, memory_system, bus, session_id)

    @property
    def system_prompt(self) -> str:
        return (
            "You are an expert software engineering planner. "
            "Given a user goal, break it into a precise, ordered list of tasks. "
            "Each task must be concrete, actionable, and assigned to exactly one specialist: "
            "researcher, coder, reviewer, or tester. "
            "Use previous project journal entries to avoid repeating past mistakes. "
            "Output ONLY valid JSON — no prose, no markdown fences. "
            'Schema: {"tasks": [{"id": "T1", "title": "...", "description": "...", '
            '"assignedTo": "researcher|coder|reviewer|tester", "priority": 1, '
            '"dependencies": [], "status": "pending"}]}'
        )

    async def run(self, task: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        goal = task.get("goal", task.get("description", ""))
        await self._set_status("running", f"Planning: {goal[:60]}")
        await self._log(f"[PLANNER] Decomposing goal: {goal}")

        start = time.time()
        structured_tasks = self._decompose(goal, context)

        prompt = self._build_prompt({"description": goal, "goal": goal}, context)
        provider_result = call_model(self.ai_model, self.system_prompt, prompt, {"tasks": structured_tasks})

        if isinstance(provider_result, dict) and isinstance(provider_result.get("tasks"), list):
            llm_tasks = provider_result["tasks"]
            if llm_tasks:
                structured_tasks = llm_tasks
                await self._log(f"[PLANNER] LLM produced {len(llm_tasks)} tasks")

        self._mem.set_context("plan", structured_tasks)
        self._ltm.write("shared", "last_plan", {
            "goal": goal,
            "tasks": structured_tasks,
            "created_at": time.time(),
        })

        await self._send("orchestrator", "task_result", {
            "agent": self.ROLE,
            "tasks": structured_tasks,
            "goal": goal,
        })
        await self._set_status("completed", None)
        await self._log(f"[PLANNER] Produced {len(structured_tasks)} tasks in {time.time()-start:.1f}s")

        return {
            "success": True,
            "output": json.dumps(structured_tasks, indent=2),
            "tasks": structured_tasks,
            "agent": self.ROLE,
        }

    def _decompose(self, goal: str, context: Dict[str, Any]) -> List[Dict[str, Any]]:
        goal_lower = goal.lower()
        base_tasks: List[Dict[str, Any]] = []

        base_tasks.append({
            "id": "T1", "title": "Research codebase structure",
            "description": f"Index the project, identify relevant files, and gather context for: {goal}",
            "assignedTo": "researcher", "priority": 1, "dependencies": [], "status": "pending",
        })

        if any(kw in goal_lower for kw in ["fix", "bug", "error", "crash", "fail"]):
            base_tasks += [
                {"id": "T2", "title": "Diagnose root cause",
                 "description": f"Analyze error patterns and identify the root cause of: {goal}",
                 "assignedTo": "researcher", "priority": 2, "dependencies": ["T1"], "status": "pending"},
                {"id": "T3", "title": "Implement fix",
                 "description": f"Write the code changes needed to fix: {goal}",
                 "assignedTo": "coder", "priority": 3, "dependencies": ["T2"], "status": "pending"},
            ]
        elif any(kw in goal_lower for kw in ["add", "implement", "create", "build", "feature"]):
            base_tasks += [
                {"id": "T2", "title": "Design implementation approach",
                 "description": f"Design the technical approach and data flow for: {goal}",
                 "assignedTo": "researcher", "priority": 2, "dependencies": ["T1"], "status": "pending"},
                {"id": "T3", "title": "Implement feature",
                 "description": f"Write all required code to implement: {goal}",
                 "assignedTo": "coder", "priority": 3, "dependencies": ["T2"], "status": "pending"},
            ]
        elif any(kw in goal_lower for kw in ["refactor", "optimize", "improve", "clean"]):
            base_tasks += [
                {"id": "T2", "title": "Analyze current implementation",
                 "description": f"Identify improvement opportunities and anti-patterns for: {goal}",
                 "assignedTo": "researcher", "priority": 2, "dependencies": ["T1"], "status": "pending"},
                {"id": "T3", "title": "Apply refactoring",
                 "description": f"Refactor code according to best practices for: {goal}",
                 "assignedTo": "coder", "priority": 3, "dependencies": ["T2"], "status": "pending"},
            ]
        else:
            base_tasks.append({
                "id": "T2", "title": "Implement solution",
                "description": f"Write the code to accomplish: {goal}",
                "assignedTo": "coder", "priority": 2, "dependencies": ["T1"], "status": "pending",
            })

        last_id = base_tasks[-1]["id"]
        base_tasks += [
            {"id": "T4", "title": "Code review",
             "description": "Review code quality, edge cases, security, and correctness of all changes",
             "assignedTo": "reviewer", "priority": 4, "dependencies": [last_id], "status": "pending"},
            {"id": "T5", "title": "Run tests and validate",
             "description": "Execute existing tests, write new tests for the changes, and validate final output",
             "assignedTo": "tester", "priority": 5, "dependencies": ["T4"], "status": "pending"},
        ]
        return base_tasks
