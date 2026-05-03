"""
Base agent class — every specialized agent inherits from this.
Provides lifecycle management, memory access, message bus publishing,
and a standard run() interface.
"""

import asyncio
import time
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional

from ..agent_memory import AgentMemorySystem, ShortTermMemory, LongTermMemory
from ..message_bus import AgentMessage, MessageBus
from ..websocket_manager import ws_manager


class BaseAgent(ABC):
    """
    Abstract base for all pipeline agents.

    Subclasses must implement:
        - system_prompt (property)
        - run(task, context) -> AgentResult
    """

    def __init__(
        self,
        role: str,
        ai_model: str,
        memory_system: AgentMemorySystem,
        bus: MessageBus,
        session_id: str,
    ):
        self.role = role
        self.ai_model = ai_model
        self.session_id = session_id
        self._memory_system = memory_system
        self._bus = bus

        self.status: str = "idle"
        self.current_task: Optional[str] = None
        self.started_at: Optional[float] = None
        self.completed_at: Optional[float] = None
        self.error_count: int = 0

        self._mem: ShortTermMemory = memory_system.short_term(role)
        self._ltm: LongTermMemory = memory_system.long_term()

        asyncio.create_task(
            self._bus.subscribe(self.role, self._on_message)
        )
        asyncio.create_task(
            self._bus.subscribe("*", self._on_broadcast)
        )

    @property
    @abstractmethod
    def system_prompt(self) -> str:
        """System prompt that defines this agent's personality and expertise."""

    @abstractmethod
    async def run(self, task: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Execute this agent's core responsibility.
        Returns a result dict with at minimum: success (bool), output (str).
        """

    async def _on_message(self, msg: AgentMessage) -> None:
        """Handle messages addressed directly to this agent."""
        pass

    async def _on_broadcast(self, msg: AgentMessage) -> None:
        """Handle broadcast messages (to_agent == '*')."""
        pass

    async def _set_status(self, status: str, task: Optional[str] = None) -> None:
        self.status = status
        self.current_task = task
        if status == "running":
            self.started_at = time.time()
        elif status in ("completed", "failed"):
            self.completed_at = time.time()

        await self._broadcast_status(status)

    async def _broadcast_status(self, status: str) -> None:
        await ws_manager.broadcast("agent_status", {
            "agent": self.role,
            "status": status,
            "task": self.current_task,
            "session_id": self.session_id,
            "timestamp": time.time(),
        })

    async def _log(self, message: str, level: str = "info") -> None:
        await ws_manager.broadcast("agent_log", {
            "agent": self.role,
            "level": level,
            "message": message,
            "session_id": self.session_id,
            "timestamp": time.time(),
        })
        self._mem.add("log", message, category="log")

    async def _send(
        self,
        to_agent: str,
        message_type: str,
        payload: Dict[str, Any],
    ) -> None:
        msg = AgentMessage(
            from_agent=self.role,
            to_agent=to_agent,
            message_type=message_type,
            payload=payload,
            session_id=self.session_id,
        )
        await self._bus.publish(msg)
        await ws_manager.broadcast("agent_message", {
            "from": self.role,
            "to": to_agent,
            "type": message_type,
            "payload": payload,
            "session_id": self.session_id,
            "timestamp": time.time(),
        })

    def _build_prompt(self, task: Dict[str, Any], context: Dict[str, Any]) -> str:
        """
        Combines system prompt + long-term memory + short-term summary + task.
        """
        ltm_data = self._ltm.get("shared", "project_context", "")
        recent = self._mem.summarize()

        parts = [
            f"=== SYSTEM ===\n{self.system_prompt}",
            f"\n=== PROJECT CONTEXT ===\n{ltm_data}" if ltm_data else "",
            f"\n=== RECENT MEMORY ===\n{recent}" if recent else "",
            f"\n=== TASK ===\n{task.get('description', '')}",
        ]
        if context:
            import json
            ctx_str = json.dumps(context, indent=2, default=str)
            parts.append(f"\n=== CONTEXT ===\n{ctx_str[:3000]}")

        return "\n".join(p for p in parts if p)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "role": self.role,
            "ai_model": self.ai_model,
            "status": self.status,
            "current_task": self.current_task,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "error_count": self.error_count,
            "session_id": self.session_id,
        }
