"""
JSON-based inter-agent message bus.
Agents publish and subscribe to typed messages via structured JSON envelopes.
"""

import asyncio
import json
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Dict, List, Optional


@dataclass
class AgentMessage:
    from_agent: str
    to_agent: str
    message_type: str
    payload: Dict[str, Any]
    id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    timestamp: float = field(default_factory=time.time)
    session_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict())


class MessageBus:
    """
    Async in-process message bus for agent-to-agent communication.
    Supports point-to-point and broadcast messaging with subscriber callbacks.
    """

    TYPES = {
        "TASK_ASSIGN": "task_assign",
        "TASK_RESULT": "task_result",
        "TASK_FAILED": "task_failed",
        "CONTEXT_UPDATE": "context_update",
        "REVIEW_REQUEST": "review_request",
        "REVIEW_RESULT": "review_result",
        "TEST_REQUEST": "test_request",
        "TEST_RESULT": "test_result",
        "RESEARCH_REQUEST": "research_request",
        "RESEARCH_RESULT": "research_result",
        "STATUS_UPDATE": "status_update",
        "APPROVAL_REQUEST": "approval_request",
        "APPROVAL_RESULT": "approval_result",
        "PIPELINE_COMPLETE": "pipeline_complete",
        "PIPELINE_FAILED": "pipeline_failed",
    }

    def __init__(self):
        self._subscribers: Dict[str, List[Callable]] = {}
        self._history: List[AgentMessage] = []
        self._lock = asyncio.Lock()
        self._max_history = 1000

    async def publish(self, message: AgentMessage) -> None:
        async with self._lock:
            self._history.append(message)
            if len(self._history) > self._max_history:
                self._history = self._history[-self._max_history:]

        recipients = set()
        recipients.update(self._subscribers.get(message.to_agent, []))
        recipients.update(self._subscribers.get("*", []))

        tasks = [asyncio.create_task(cb(message)) for cb in recipients]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def subscribe(self, agent_id: str, callback: Callable) -> None:
        async with self._lock:
            if agent_id not in self._subscribers:
                self._subscribers[agent_id] = []
            if callback not in self._subscribers[agent_id]:
                self._subscribers[agent_id].append(callback)

    async def unsubscribe(self, agent_id: str, callback: Callable) -> None:
        async with self._lock:
            if agent_id in self._subscribers:
                self._subscribers[agent_id] = [
                    cb for cb in self._subscribers[agent_id] if cb != callback
                ]

    def get_history(
        self,
        session_id: Optional[str] = None,
        agent: Optional[str] = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        msgs = self._history
        if session_id:
            msgs = [m for m in msgs if m.session_id == session_id]
        if agent:
            msgs = [m for m in msgs if m.from_agent == agent or m.to_agent == agent]
        return [m.to_dict() for m in msgs[-limit:]]

    def send(
        self,
        from_agent: str,
        to_agent: str,
        message_type: str,
        payload: Dict[str, Any],
        session_id: Optional[str] = None,
    ) -> AgentMessage:
        msg = AgentMessage(
            from_agent=from_agent,
            to_agent=to_agent,
            message_type=message_type,
            payload=payload,
            session_id=session_id,
        )
        asyncio.create_task(self.publish(msg))
        return msg


bus = MessageBus()
