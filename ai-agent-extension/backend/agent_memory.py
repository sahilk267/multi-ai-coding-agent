"""
Dual-layer agent memory system:
- Short-term: per-agent in-memory context (task window, recent outputs)
- Long-term: shared JSON files persisted across runs
"""

import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional


class ShortTermMemory:
    """
    Sliding-window in-memory context per agent.
    Holds recent inputs, outputs, and intermediate results.
    """

    def __init__(self, agent_id: str, max_entries: int = 50):
        self.agent_id = agent_id
        self.max_entries = max_entries
        self._store: List[Dict[str, Any]] = []
        self._context: Dict[str, Any] = {}

    def add(self, key: str, value: Any, category: str = "general") -> None:
        entry = {
            "key": key,
            "value": value,
            "category": category,
            "timestamp": time.time(),
        }
        self._store.append(entry)
        if len(self._store) > self.max_entries:
            self._store = self._store[-self.max_entries:]

    def set_context(self, key: str, value: Any) -> None:
        self._context[key] = value

    def get_context(self, key: str, default: Any = None) -> Any:
        return self._context.get(key, default)

    def get_recent(self, n: int = 10, category: Optional[str] = None) -> List[Dict[str, Any]]:
        items = self._store
        if category:
            items = [e for e in items if e["category"] == category]
        return items[-n:]

    def get_by_key(self, key: str) -> Optional[Any]:
        for entry in reversed(self._store):
            if entry["key"] == key:
                return entry["value"]
        return None

    def summarize(self) -> str:
        if not self._store:
            return "No memory entries."
        lines = []
        for e in self._store[-20:]:
            v = e["value"]
            if isinstance(v, str) and len(v) > 200:
                v = v[:200] + "..."
            lines.append(f"[{e['category']}] {e['key']}: {v}")
        return "\n".join(lines)

    def clear(self) -> None:
        self._store = []
        self._context = {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "agent_id": self.agent_id,
            "context": self._context,
            "recent": self._store[-10:],
        }


class LongTermMemory:
    """
    Shared persistent memory stored in JSON files.
    All agents can read; agents write to their own namespace.
    """

    def __init__(self, memory_dir: str):
        self._dir = Path(memory_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._cache: Dict[str, Any] = {}

    def _path(self, namespace: str) -> Path:
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in namespace)
        return self._dir / f"{safe}.json"

    def read(self, namespace: str) -> Dict[str, Any]:
        if namespace in self._cache:
            return self._cache[namespace]
        p = self._path(namespace)
        if not p.exists():
            return {}
        try:
            data = json.loads(p.read_text())
            self._cache[namespace] = data
            return data
        except Exception:
            return {}

    def write(self, namespace: str, key: str, value: Any) -> None:
        data = self.read(namespace)
        data[key] = {"value": value, "updated_at": time.time()}
        self._cache[namespace] = data
        self._path(namespace).write_text(json.dumps(data, indent=2, default=str))

    def append(self, namespace: str, key: str, item: Any, max_items: int = 100) -> None:
        data = self.read(namespace)
        existing = data.get(key, {"value": []})
        items = existing.get("value", []) if isinstance(existing, dict) else []
        items.append({"data": item, "timestamp": time.time()})
        if len(items) > max_items:
            items = items[-max_items:]
        data[key] = {"value": items, "updated_at": time.time()}
        self._cache[namespace] = data
        self._path(namespace).write_text(json.dumps(data, indent=2, default=str))

    def get(self, namespace: str, key: str, default: Any = None) -> Any:
        data = self.read(namespace)
        entry = data.get(key)
        if entry is None:
            return default
        return entry.get("value", default) if isinstance(entry, dict) else entry

    def all_keys(self, namespace: str) -> List[str]:
        return list(self.read(namespace).keys())

    def delete(self, namespace: str, key: str) -> None:
        data = self.read(namespace)
        data.pop(key, None)
        self._cache[namespace] = data
        self._path(namespace).write_text(json.dumps(data, indent=2, default=str))


class AgentMemorySystem:
    """
    Factory that provides per-agent short-term memory + shared long-term memory.
    """

    def __init__(self, memory_dir: str):
        self._long_term = LongTermMemory(memory_dir)
        self._short_term: Dict[str, ShortTermMemory] = {}

    def short_term(self, agent_id: str) -> ShortTermMemory:
        if agent_id not in self._short_term:
            self._short_term[agent_id] = ShortTermMemory(agent_id)
        return self._short_term[agent_id]

    def long_term(self) -> LongTermMemory:
        return self._long_term

    def snapshot(self) -> Dict[str, Any]:
        return {
            agent_id: mem.to_dict()
            for agent_id, mem in self._short_term.items()
        }

    def reset_session(self) -> None:
        for mem in self._short_term.values():
            mem.clear()
        self._short_term = {}
