"""
Dual-layer agent memory system:
- Short-term: per-agent in-memory context (task window, recent outputs)
- Long-term:  shared JSON files persisted across runs (analysis, code changes, journal)

New in this version:
- ProjectJournal: appends a structured record for every pipeline run (goal, plan,
  code changes, review score, test result, duration). Agents load recent journal
  entries into their prompts so every run benefits from past context.
- LongTermMemory.invalidate(): clears cache for a namespace so changes are re-read.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional


class ShortTermMemory:
    """
    Sliding-window in-memory context per agent.
    Holds recent inputs, outputs, and intermediate results within one pipeline run.
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

    def invalidate(self, namespace: str) -> None:
        """Force a re-read on next access (use after external writes)."""
        self._cache.pop(namespace, None)

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


class ProjectJournal:
    """
    Append-only persistent log of every pipeline run.

    Each entry records:
      - goal, run_id, session_id, provider_used
      - plan tasks (titles only)
      - code files modified
      - review score + approval
      - test pass/fail counts
      - total duration (seconds)
      - timestamp

    Agents call journal.recent_summary(n) to get a compact text block that is
    injected into their system prompts, so they can learn from past runs.
    """

    NAMESPACE = "project_journal"
    KEY = "runs"

    def __init__(self, ltm: LongTermMemory):
        self._ltm = ltm

    def record(
        self,
        *,
        run_id: str,
        goal: str,
        session_id: Optional[str],
        provider_used: str,
        plan_tasks: List[str],
        files_modified: List[str],
        review_score: float,
        review_approved: bool,
        tests_passed: int,
        tests_failed: int,
        duration_s: float,
    ) -> None:
        entry = {
            "run_id": run_id,
            "goal": goal,
            "session_id": session_id,
            "provider_used": provider_used,
            "plan_tasks": plan_tasks[:10],
            "files_modified": files_modified[:20],
            "review_score": review_score,
            "review_approved": review_approved,
            "tests_passed": tests_passed,
            "tests_failed": tests_failed,
            "duration_s": duration_s,
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        self._ltm.append(self.NAMESPACE, self.KEY, entry, max_items=50)

    def recent_runs(self, n: int = 5) -> List[Dict[str, Any]]:
        items = self._ltm.get(self.NAMESPACE, self.KEY, [])
        entries = [i["data"] for i in items if isinstance(i, dict) and "data" in i]
        return entries[-n:]

    def recent_summary(self, n: int = 3) -> str:
        runs = self.recent_runs(n)
        if not runs:
            return "No previous runs in project journal."
        lines = ["=== RECENT PIPELINE RUNS (from project journal) ==="]
        for r in runs:
            status = "✅ PASSED" if r.get("review_approved") else "⚠️ NEEDS WORK"
            lines.append(
                f"[{r.get('ts', '?')}] {status} | Goal: {r.get('goal', '')[:80]}"
                f" | Provider: {r.get('provider_used', 'fallback')}"
                f" | Review: {r.get('review_score', 0)}/10"
                f" | Tests: {r.get('tests_passed', 0)} passed / {r.get('tests_failed', 0)} failed"
                f" | Files changed: {len(r.get('files_modified', []))}"
                f" | Duration: {r.get('duration_s', 0):.1f}s"
            )
            if r.get("files_modified"):
                lines.append(f"  Changed files: {', '.join(r['files_modified'][:5])}")
        return "\n".join(lines)

    def all_changed_files(self) -> List[str]:
        """Return deduplicated list of all files ever modified across runs."""
        runs = self.recent_runs(50)
        seen = set()
        result = []
        for r in runs:
            for f in r.get("files_modified", []):
                if f not in seen:
                    seen.add(f)
                    result.append(f)
        return result


class AgentMemorySystem:
    """
    Factory that provides per-agent short-term memory + shared long-term memory
    + a project journal.
    """

    def __init__(self, memory_dir: str):
        self._long_term = LongTermMemory(memory_dir)
        self._short_term: Dict[str, ShortTermMemory] = {}
        self._journal = ProjectJournal(self._long_term)

    def short_term(self, agent_id: str) -> ShortTermMemory:
        if agent_id not in self._short_term:
            self._short_term[agent_id] = ShortTermMemory(agent_id)
        return self._short_term[agent_id]

    def long_term(self) -> LongTermMemory:
        return self._long_term

    def journal(self) -> ProjectJournal:
        return self._journal

    def snapshot(self) -> Dict[str, Any]:
        return {
            agent_id: mem.to_dict()
            for agent_id, mem in self._short_term.items()
        }

    def reset_session(self) -> None:
        for mem in self._short_term.values():
            mem.clear()
        self._short_term = {}
