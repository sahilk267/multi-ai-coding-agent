"""
Orchestrator — the master controller that manages all agents in the pipeline.

Pipeline flow:
  User Goal → Planner → Researcher → Coder → Reviewer → [retry if rejected] → Tester → Done

Broadcasts real-time WebSocket events AND writes back to the API server via HTTP
callbacks (PATCH /api/agents/:id, /api/agent-tasks/:id, /api/sessions/:id).
"""

import asyncio
import json
import time
import urllib.request
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
    IDLE       = "IDLE"
    PLANNING   = "PLANNING"
    RESEARCHING= "RESEARCHING"
    CODING     = "CODING"
    REVIEWING  = "REVIEWING"
    TESTING    = "TESTING"
    RETRYING   = "RETRYING"
    DONE       = "DONE"
    FAILED     = "FAILED"


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


def _http_patch(url: str, body: Dict[str, Any]) -> None:
    """Synchronous HTTP PATCH using stdlib urllib (run via asyncio.to_thread)."""
    try:
        data = json.dumps(body).encode()
        req = urllib.request.Request(
            url,
            data=data,
            method="PATCH",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            resp.read()
    except Exception as e:
        log.warning(f"HTTP PATCH {url} failed: {e}")


def _http_post(url: str, body: Dict[str, Any]) -> None:
    """Synchronous HTTP POST using stdlib urllib."""
    try:
        data = json.dumps(body).encode()
        req = urllib.request.Request(
            url,
            data=data,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            resp.read()
    except Exception as e:
        log.warning(f"HTTP POST {url} failed: {e}")


class Orchestrator:
    """
    Main controller that runs the multi-agent pipeline end-to-end.

    Manages agent lifecycle, retry logic, real-time WebSocket broadcasting,
    and HTTP callbacks to update the API server's database records.
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

        # Callback state (set per run via run())
        self._callback_url: Optional[str] = None
        self._agent_ids: Dict[str, int] = {}   # role → DB agent row id
        self._task_ids: Dict[int, int] = {}    # taskIndex → DB agent_task row id
        self._db_session_id: Optional[int] = None

        asyncio.create_task(self._bus.subscribe("orchestrator", self._on_agent_message))

    def set_project_root(self, root: str) -> None:
        self._project_root = root

    @property
    def is_running(self) -> bool:
        return self._current_run is not None and self._current_run.state not in (
            PipelineState.DONE, PipelineState.FAILED, PipelineState.IDLE
        )

    # ── DB callback helpers ────────────────────────────────────────────────────

    async def _cb_agent(
        self,
        role: str,
        status: str,
        current_task: Optional[str] = None,
    ) -> None:
        agent_id = self._agent_ids.get(role)
        if not self._callback_url or not agent_id:
            return
        body: Dict[str, Any] = {"status": status}
        if current_task is not None:
            body["currentTask"] = current_task
        url = f"{self._callback_url}/api/agents/{agent_id}"
        await asyncio.to_thread(_http_patch, url, body)

    async def _cb_task(
        self,
        task_index: int,
        status: str,
        result: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> None:
        task_id = self._task_ids.get(task_index)
        if not self._callback_url or not task_id:
            return
        body: Dict[str, Any] = {"status": status}
        if result is not None:
            body["result"] = result[:2000] if len(result) > 2000 else result
        if error_message is not None:
            body["errorMessage"] = error_message
        url = f"{self._callback_url}/api/agent-tasks/{task_id}"
        await asyncio.to_thread(_http_patch, url, body)

    async def _cb_session(self, status: str) -> None:
        if not self._callback_url or not self._db_session_id:
            return
        url = f"{self._callback_url}/api/sessions/{self._db_session_id}"
        body: Dict[str, Any] = {"status": status}
        await asyncio.to_thread(_http_patch, url, body)

    async def _cb_message(
        self,
        from_agent: str,
        to_agent: str,
        message_type: str,
        payload: Dict[str, Any],
    ) -> None:
        if not self._callback_url or not self._db_session_id:
            return
        url = f"{self._callback_url}/api/agent-messages"
        body = {
            "sessionId": self._db_session_id,
            "fromAgent": from_agent,
            "toAgent": to_agent,
            "messageType": message_type,
            "payload": payload,
        }
        await asyncio.to_thread(_http_post, url, body)

    # ── Public run() ──────────────────────────────────────────────────────────

    async def run(
        self,
        goal: str,
        session_id: Optional[str] = None,
        agent_ids: Optional[Dict[str, int]] = None,
        task_ids: Optional[Dict[int, int]] = None,
        callback_url: Optional[str] = None,
    ) -> Dict[str, Any]:
        if self.is_running:
            return {"success": False, "error": "Pipeline already running"}

        self._callback_url = callback_url
        self._agent_ids = agent_ids or {}
        self._task_ids = task_ids or {}
        self._db_session_id = int(session_id) if session_id and session_id.isdigit() else None

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
            await self._cb_session("completed")
            self._run_history.append(run)
            self._current_run = None
            return result

        except asyncio.CancelledError:
            run.error = "Cancelled by user"
            await self._set_state(run, PipelineState.FAILED)
            await self._cb_session("failed")
            self._run_history.append(run)
            self._current_run = None
            return {"success": False, "error": "Cancelled", "run": run.to_dict()}

        except Exception as e:
            log.exception("Pipeline failed")
            run.error = str(e)
            await self._set_state(run, PipelineState.FAILED)
            run.completed_at = time.time()
            await self._broadcast_pipeline(run)
            await self._cb_session("failed")
            self._run_history.append(run)
            self._current_run = None
            return {"success": False, "error": str(e), "run": run.to_dict()}

    async def _on_agent_message(self, msg: AgentMessage) -> None:
        if self._current_run:
            self._current_run.messages.append(msg.to_dict())

    async def _execute_pipeline(
        self,
        run: PipelineRun,
        memory: AgentMemorySystem,
        bus: MessageBus,
    ) -> Dict[str, Any]:

        await self._log(f"[ORCHESTRATOR] Pipeline started: {run.goal}", run)
        context: Dict[str, Any] = {"goal": run.goal, "session_id": run.session_id}

        # Mark orchestrator itself as running in DB
        await self._cb_agent("orchestrator", "running", "Managing pipeline")

        # ── Stage 1: Plan ──────────────────────────────────────────────────────
        await self._set_state(run, PipelineState.PLANNING)
        await self._cb_agent("planner", "running", f"Decomposing: {run.goal[:60]}")
        await self._cb_message("orchestrator", "planner", "task_assign", {"goal": run.goal})

        planner = PlannerAgent(memory, bus, run.session_id or run.id)
        plan_result = await planner.run({"goal": run.goal, "description": run.goal}, context)

        if not plan_result.get("success"):
            raise RuntimeError("Planner failed to produce a plan")

        tasks = plan_result.get("tasks", [])
        run.plan = tasks
        run.results["planner"] = plan_result
        context["plan"] = tasks

        await self._cb_agent("planner", "completed")
        await self._cb_message("planner", "orchestrator", "task_result", {
            "tasks_count": len(tasks),
            "tasks": [t["title"] for t in tasks[:5]],
        })
        await self._broadcast_pipeline(run)
        await self._log(f"[ORCHESTRATOR] Plan complete — {len(tasks)} tasks", run)

        if self._cancel_requested:
            raise asyncio.CancelledError()

        # ── Stage 2: Research ──────────────────────────────────────────────────
        await self._set_state(run, PipelineState.RESEARCHING)
        await self._cb_agent("researcher", "running", "Indexing codebase and gathering context")
        await self._cb_task(0, "running")
        await self._cb_message("orchestrator", "researcher", "task_assign", {
            "task": "research_codebase",
            "goal": run.goal,
        })

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
            combined_research.update(res.get("research", {}))
            self._mark_task_done(tasks, rt.get("id"), "completed")

        context["research"] = combined_research
        research_summary = (
            f"{len(combined_research.get('file_index', []))} files indexed, "
            f"{len(combined_research.get('relevant_files', []))} relevant, "
            f"stack: {', '.join(combined_research.get('tech_stack', ['unknown']))}"
        )
        await self._cb_agent("researcher", "completed")
        await self._cb_task(0, "completed", result=research_summary)
        await self._cb_message("researcher", "orchestrator", "research_result", {
            "files_indexed": len(combined_research.get("file_index", [])),
            "relevant_files": combined_research.get("relevant_files", [])[:5],
            "tech_stack": combined_research.get("tech_stack", []),
        })
        await self._broadcast_pipeline(run)
        await self._log(f"[ORCHESTRATOR] Research complete — {research_summary}", run)

        if self._cancel_requested:
            raise asyncio.CancelledError()

        # ── Stage 3: Code ──────────────────────────────────────────────────────
        await self._set_state(run, PipelineState.CODING)
        await self._cb_agent("coder", "running", f"Implementing: {run.goal[:60]}")
        await self._cb_task(1, "running")
        await self._cb_message("orchestrator", "coder", "task_assign", {
            "task": "implement_solution",
            "research_summary": research_summary,
        })

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
        code_summary = (
            f"{len(all_changes['files'])} file(s) modified, "
            f"{len(all_changes['commands'])} command(s) planned"
        )
        await self._cb_agent("coder", "completed")
        await self._cb_task(1, "completed", result=code_summary)
        await self._cb_message("coder", "orchestrator", "task_result", {
            "files_modified": len(all_changes["files"]),
            "commands": all_changes["commands"][:3],
        })
        await self._broadcast_pipeline(run)

        if self._cancel_requested:
            raise asyncio.CancelledError()

        # ── Stage 4: Review (with retry loop) ────────────────────────────────
        await self._set_state(run, PipelineState.REVIEWING)
        reviewer = ReviewerAgent(memory, bus, run.session_id or run.id)
        reviewer_tasks = [t for t in tasks if t.get("assignedTo") == "reviewer"]
        review_result: Dict[str, Any] = {}
        review_data: Dict[str, Any] = {}

        for attempt in range(self.MAX_REVIEW_RETRIES + 1):
            if self._cancel_requested:
                raise asyncio.CancelledError()

            await self._cb_agent("reviewer", "running", f"Reviewing code (attempt {attempt+1})")
            if attempt == 0:
                await self._cb_task(2, "running")
            await self._cb_message("orchestrator", "reviewer", "review_request", {
                "attempt": attempt + 1,
                "files_to_review": len(all_changes["files"]),
            })

            rt = reviewer_tasks[0] if reviewer_tasks else {"id": "RV0", "description": "Review all changes"}
            review_result = await reviewer.run(rt, context)
            run.results["reviewer"] = review_result
            review_data = review_result.get("review", {})
            context["review"] = review_data

            await self._cb_message("reviewer", "orchestrator", "review_result", {
                "approved": review_data.get("approved", True),
                "score": review_data.get("score", 0),
                "issues": len(review_data.get("issues", [])),
            })

            if review_data.get("approved", True):
                await self._cb_agent("reviewer", "completed")
                await self._cb_task(2, "completed", result=review_data.get("summary", ""))
                await self._log(f"[ORCHESTRATOR] Review PASSED (attempt {attempt+1}) — score {review_data.get('score', 0)}/10", run)
                break
            else:
                await self._cb_agent("reviewer", "waiting", "Waiting for code fix")
                if attempt < self.MAX_REVIEW_RETRIES:
                    run.retry_count += 1
                    feedback = [i["message"] for i in review_data.get("issues", [])[:5]]
                    context["review_feedback"] = feedback
                    await self._log(f"[ORCHESTRATOR] Review FAILED (attempt {attempt+1}) — retrying coder", run)

                    await self._set_state(run, PipelineState.RETRYING)
                    await self._cb_agent("coder", "running", f"Fixing review issues (retry {attempt+1})")
                    await self._cb_message("orchestrator", "coder", "task_assign", {
                        "task": "fix_review_issues",
                        "feedback": feedback,
                    })

                    for ct in coder_tasks or [{"id": "C0", "description": run.goal}]:
                        code_result = await coder.run(ct, context)
                        run.results.setdefault("coder_retry", []).append(code_result)
                        changes = code_result.get("changes", {})
                        all_changes["files"].extend(changes.get("files", []))
                    context["coder_output"] = {"changes": all_changes}

                    await self._cb_agent("coder", "completed")
                    await self._cb_message("coder", "reviewer", "task_result", {
                        "task": "code_fixed",
                        "retry": attempt + 1,
                    })
                    await self._set_state(run, PipelineState.REVIEWING)
                else:
                    await self._cb_agent("reviewer", "completed")
                    await self._cb_task(2, "completed", result="Max retries reached — proceeding to test")
                    await self._log("[ORCHESTRATOR] Max review retries reached — proceeding to test", run)

        await self._broadcast_pipeline(run)

        if self._cancel_requested:
            raise asyncio.CancelledError()

        # ── Stage 5: Test ──────────────────────────────────────────────────────
        await self._set_state(run, PipelineState.TESTING)
        await self._cb_agent("tester", "running", "Running test suite")
        await self._cb_task(3, "running")
        await self._cb_message("orchestrator", "tester", "test_request", {
            "task": "run_tests",
            "review_approved": review_data.get("approved", True),
        })

        tester = TesterAgent(memory, bus, run.session_id or run.id)
        if self._project_root:
            tester.set_project_root(self._project_root)

        tester_tasks = [t for t in tasks if t.get("assignedTo") == "tester"]
        tt = tester_tasks[0] if tester_tasks else {"id": "T0", "description": "Run test suite"}
        test_result = await tester.run(tt, context)
        run.results["tester"] = test_result
        self._mark_task_done(tasks, tt.get("id"), "completed")

        test_summary = (
            f"{test_result.get('passed', 0)} passed / "
            f"{test_result.get('failed', 0)} failed — "
            f"{'✅ PASSED' if test_result.get('success') else '❌ FAILED'}"
        )
        await self._cb_agent("tester", "completed")
        await self._cb_task(3, "completed", result=test_summary)
        await self._cb_message("tester", "orchestrator", "test_result", {
            "passed": test_result.get("passed", 0),
            "failed": test_result.get("failed", 0),
            "success": test_result.get("success", False),
        })

        # ── Mark orchestrator done ─────────────────────────────────────────────
        await self._cb_agent("orchestrator", "completed")
        await self._broadcast_pipeline(run)

        final = {
            "success": test_result.get("success", False),
            "run_id": run.id,
            "goal": run.goal,
            "pipeline_state": PipelineState.DONE.value,
            "plan_tasks": len(tasks),
            "review_approved": review_data.get("approved", False),
            "review_score": review_data.get("score", 0),
            "tests_passed": test_result.get("passed", 0),
            "tests_failed": test_result.get("failed", 0),
            "retry_count": run.retry_count,
            "duration_s": round(time.time() - run.started_at, 1),
            "agents_used": ["planner", "researcher", "coder", "reviewer", "tester"],
            "run": run.to_dict(),
        }

        await self._log(
            f"[ORCHESTRATOR] ✅ Pipeline complete in {final['duration_s']}s — "
            f"review {review_data.get('score', 0)}/10, {test_summary}",
            run,
        )

        return final

    async def cancel(self) -> None:
        self._cancel_requested = True
        if self._current_run:
            await self._log("[ORCHESTRATOR] Cancel requested by user", self._current_run)
        await self._cb_session("paused")

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
