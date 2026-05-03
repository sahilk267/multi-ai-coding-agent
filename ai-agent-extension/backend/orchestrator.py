"""
Orchestrator — the master controller that manages all agents in the pipeline.

Pipeline flow:
  User Goal → Planner → Researcher → Coder → Reviewer → [retry if rejected] → Tester → Done

Broadcasts real-time status to the WebSocket dashboard.
"""

import asyncio
import json
import time
import uuid
from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

from .agent_memory import AgentMemorySystem
from .agents import (
    PlannerAgent,
    ResearcherAgent,
    CoderAgent,
    ReviewerAgent,
    TesterAgent,
)
from .message_bus import MessageBus, AgentMessage, bus as global_bus
from .websocket_manager import ws_manager
from .logger import get_logger

log = get_logger("orchestrator")


class PipelineState(str, Enum):
    IDLE = "IDLE"
    PLANNING = "PLANNING"
    RESEARCHING = "RESEARCHING"
    CODING = "CODING"
    REVIEWING = "REVIEWING"
    TESTING = "TESTING"
    RETRYING = "RETRYING"
    DONE = "DONE"
    FAILED = "FAILED"


@dataclass
class PipelineRun:
    id: str
    goal: str
    session_id: Optional[str]
    state: PipelineState = PipelineState.IDLE
    started_at: float = field(default_factory=time.time)
    completed_at: Optional[float] = None
    plan: List[Dict[str, Any]] = field(default_factory=list)
    results: Dict[str, Any] = field(default_factory=dict)
    messages: List[Dict[str, Any]] = field(default_factory=list)
    retry_count: int = 0
    max_retries: int = 2
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["state"] = self.state.value
        return d


class Orchestrator:
    """
    Main controller that runs the multi-agent pipeline end-to-end.
    Manages agent lifecycle, retry logic, and real-time WebSocket broadcasting.
    """

    MAX_REVIEW_RETRIES = 2

    def __init__(
        self,
        memory_dir: str = "memory",
        project_root: Optional[str] = None,
    ):
        self._memory_dir = memory_dir
        self._project_root = project_root
        self._current_run: Optional[PipelineRun] = None
        self._run_history: List[PipelineRun] = []
        self._bus = global_bus
        self._cancel_requested = False

        self._bus_task: Optional[asyncio.Task] = None
        asyncio.create_task(self._bus.subscribe("orchestrator", self._on_agent_message))

    def set_project_root(self, root: str) -> None:
        self._project_root = root

    @property
    def current_run(self) -> Optional[PipelineRun]:
        return self._current_run

    @property
    def is_running(self) -> bool:
        return self._current_run is not None and self._current_run.state not in (
            PipelineState.DONE, PipelineState.FAILED, PipelineState.IDLE
        )

    async def _on_agent_message(self, msg: AgentMessage) -> None:
        if self._current_run:
            self._current_run.messages.append(msg.to_dict())

    async def run(self, goal: str, session_id: Optional[str] = None) -> Dict[str, Any]:
        if self.is_running:
            return {"success": False, "error": "Pipeline already running"}

        run = PipelineRun(
            id=str(uuid.uuid4())[:8],
            goal=goal,
            session_id=session_id,
        )
        self._current_run = run
        self._cancel_requested = False

        memory = AgentMemorySystem(self._memory_dir)
        bus = self._bus

        await self._set_state(run, PipelineState.PLANNING)
        await self._broadcast_pipeline(run)

        try:
            result = await self._execute_pipeline(run, memory, bus)
            await self._set_state(run, PipelineState.DONE)
            run.completed_at = time.time()
            await self._broadcast_pipeline(run)
            self._run_history.append(run)
            self._current_run = None
            return result

        except asyncio.CancelledError:
            run.error = "Cancelled by user"
            await self._set_state(run, PipelineState.FAILED)
            self._run_history.append(run)
            self._current_run = None
            return {"success": False, "error": "Cancelled", "run": run.to_dict()}

        except Exception as e:
            log.exception("Pipeline failed")
            run.error = str(e)
            await self._set_state(run, PipelineState.FAILED)
            run.completed_at = time.time()
            await self._broadcast_pipeline(run)
            self._run_history.append(run)
            self._current_run = None
            return {"success": False, "error": str(e), "run": run.to_dict()}

    async def _execute_pipeline(
        self,
        run: PipelineRun,
        memory: AgentMemorySystem,
        bus: MessageBus,
    ) -> Dict[str, Any]:

        await self._log(f"[ORCHESTRATOR] Pipeline started: {run.goal}", run)
        context: Dict[str, Any] = {"goal": run.goal, "session_id": run.session_id}

        # ── Stage 1: Plan ──────────────────────────────────────────────────────
        await self._set_state(run, PipelineState.PLANNING)
        planner = PlannerAgent(memory, bus, run.session_id or run.id)
        plan_result = await planner.run({"goal": run.goal, "description": run.goal}, context)

        if not plan_result.get("success"):
            raise RuntimeError("Planner failed to produce a plan")

        tasks = plan_result.get("tasks", [])
        run.plan = tasks
        run.results["planner"] = plan_result
        context["plan"] = tasks
        await self._broadcast_pipeline(run)
        await self._log(f"[ORCHESTRATOR] Plan complete — {len(tasks)} tasks", run)

        if self._cancel_requested:
            raise asyncio.CancelledError()

        # ── Stage 2: Research (for each research task) ────────────────────────
        await self._set_state(run, PipelineState.RESEARCHING)
        researcher = ResearcherAgent(memory, bus, run.session_id or run.id)
        if self._project_root:
            researcher.set_project_root(self._project_root)

        research_tasks = [t for t in tasks if t.get("assignedTo") == "researcher"]
        combined_research: Dict[str, Any] = {}

        for rt in research_tasks or [{"id": "R0", "description": run.goal}]:
            if self._cancel_requested:
                raise asyncio.CancelledError()
            res = await researcher.run(rt, context)
            run.results.setdefault("researcher", []).append(res)
            research_data = res.get("research", {})
            combined_research.update(research_data)
            self._mark_task_done(tasks, rt.get("id"), "completed")

        context["research"] = combined_research
        await self._broadcast_pipeline(run)
        await self._log("[ORCHESTRATOR] Research complete", run)

        if self._cancel_requested:
            raise asyncio.CancelledError()

        # ── Stage 3: Code ──────────────────────────────────────────────────────
        await self._set_state(run, PipelineState.CODING)
        coder = CoderAgent(memory, bus, run.session_id or run.id)
        if self._project_root:
            coder.set_project_root(self._project_root)

        coder_tasks = [t for t in tasks if t.get("assignedTo") == "coder"]
        all_changes: Dict[str, Any] = {"files": [], "commands": []}

        for ct in coder_tasks or [{"id": "C0", "description": run.goal}]:
            if self._cancel_requested:
                raise asyncio.CancelledError()
            code_result = await coder.run(ct, context)
            run.results.setdefault("coder", []).append(code_result)
            changes = code_result.get("changes", {})
            all_changes["files"].extend(changes.get("files", []))
            all_changes["commands"].extend(changes.get("commands", []))
            self._mark_task_done(tasks, ct.get("id"), "completed")

        context["coder_output"] = {"changes": all_changes}
        await self._broadcast_pipeline(run)

        if self._cancel_requested:
            raise asyncio.CancelledError()

        # ── Stage 4: Review (with retry loop) ────────────────────────────────
        await self._set_state(run, PipelineState.REVIEWING)
        reviewer = ReviewerAgent(memory, bus, run.session_id or run.id)
        reviewer_tasks = [t for t in tasks if t.get("assignedTo") == "reviewer"]
        review_result: Dict[str, Any] = {}

        for attempt in range(self.MAX_REVIEW_RETRIES + 1):
            if self._cancel_requested:
                raise asyncio.CancelledError()

            rt = reviewer_tasks[0] if reviewer_tasks else {"id": "RV0", "description": "Review all changes"}
            review_result = await reviewer.run(rt, context)
            run.results["reviewer"] = review_result
            context["review"] = review_result.get("review", {})

            if review_result.get("approved", True):
                self._mark_task_done(tasks, rt.get("id"), "completed")
                await self._log(f"[ORCHESTRATOR] Review passed (attempt {attempt+1})", run)
                break
            else:
                if attempt < self.MAX_REVIEW_RETRIES:
                    await self._set_state(run, PipelineState.RETRYING)
                    run.retry_count += 1
                    feedback = [i["message"] for i in review_result.get("review", {}).get("issues", [])[:5]]
                    context["review_feedback"] = feedback
                    await self._log(f"[ORCHESTRATOR] Review failed — retry {attempt+1}/{self.MAX_REVIEW_RETRIES}", run)

                    await self._set_state(run, PipelineState.CODING)
                    for ct in coder_tasks or [{"id": "C0", "description": run.goal}]:
                        code_result = await coder.run(ct, context)
                        run.results.setdefault("coder_retry", []).append(code_result)
                        changes = code_result.get("changes", {})
                        all_changes["files"].extend(changes.get("files", []))
                    context["coder_output"] = {"changes": all_changes}

                    await self._set_state(run, PipelineState.REVIEWING)
                else:
                    await self._log("[ORCHESTRATOR] Max review retries reached — proceeding to test", run)

        await self._broadcast_pipeline(run)

        if self._cancel_requested:
            raise asyncio.CancelledError()

        # ── Stage 5: Test ──────────────────────────────────────────────────────
        await self._set_state(run, PipelineState.TESTING)
        tester = TesterAgent(memory, bus, run.session_id or run.id)
        if self._project_root:
            tester.set_project_root(self._project_root)

        tester_tasks = [t for t in tasks if t.get("assignedTo") == "tester"]
        tt = tester_tasks[0] if tester_tasks else {"id": "T0", "description": "Run test suite"}
        test_result = await tester.run(tt, context)
        run.results["tester"] = test_result
        self._mark_task_done(tasks, tt.get("id"), "completed")

        await self._broadcast_pipeline(run)

        final = {
            "success": test_result.get("success", False),
            "run_id": run.id,
            "goal": run.goal,
            "pipeline_state": PipelineState.DONE.value,
            "plan_tasks": len(tasks),
            "review_approved": review_result.get("approved", False),
            "review_score": review_result.get("review", {}).get("score", 0),
            "tests_passed": test_result.get("passed", 0),
            "tests_failed": test_result.get("failed", 0),
            "retry_count": run.retry_count,
            "duration_s": round(time.time() - run.started_at, 1),
            "agents_used": ["planner", "researcher", "coder", "reviewer", "tester"],
            "run": run.to_dict(),
        }

        await self._log(
            f"[ORCHESTRATOR] ✅ Pipeline complete — "
            f"{test_result.get('passed', 0)} tests passed, "
            f"review score {review_result.get('review', {}).get('score', 0)}/10",
            run,
        )

        return final

    async def cancel(self) -> None:
        self._cancel_requested = True
        if self._current_run:
            await self._log("[ORCHESTRATOR] Cancel requested", self._current_run)

    def _mark_task_done(self, tasks: List[Dict], task_id: Optional[str], status: str) -> None:
        for t in tasks:
            if t.get("id") == task_id:
                t["status"] = status
                break

    async def _set_state(self, run: PipelineRun, state: PipelineState) -> None:
        run.state = state
        await ws_manager.broadcast("pipeline_state", {
            "run_id": run.id,
            "state": state.value,
            "session_id": run.session_id,
            "timestamp": time.time(),
        })

    async def _broadcast_pipeline(self, run: PipelineRun) -> None:
        await ws_manager.broadcast("pipeline_update", run.to_dict())

    async def _log(self, message: str, run: PipelineRun) -> None:
        log.info(message)
        await ws_manager.broadcast("agent_log", {
            "agent": "orchestrator",
            "level": "info",
            "message": message,
            "session_id": run.session_id,
            "timestamp": time.time(),
        })

    def get_status(self) -> Dict[str, Any]:
        return {
            "is_running": self.is_running,
            "current_run": self._current_run.to_dict() if self._current_run else None,
            "history_count": len(self._run_history),
            "history": [r.to_dict() for r in self._run_history[-5:]],
        }

    def get_history(self) -> List[Dict[str, Any]]:
        return [r.to_dict() for r in self._run_history]

    def get_messages(self, session_id: Optional[str] = None) -> List[Dict[str, Any]]:
        return self._bus.get_history(session_id=session_id)
