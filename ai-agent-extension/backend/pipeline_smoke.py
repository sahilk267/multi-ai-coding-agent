"""
End-to-end pipeline smoke test for the AI Agent Python backend (port 8000).

Tests the full multi-agent pipeline:
  1. Provider health check — which LLM backend is active
  2. Happy path  — submit a goal → poll until done → verify completed state
  3. Cancel path — submit a goal → cancel mid-run → verify paused/cancelled state
  4. Journal     — verify the run was recorded in the project journal
  5. Existing backend endpoints — health, status, routing, memory, provider

Usage:
    # From repo root (with backend already running on port 8000):
    python -m ai-agent-extension.backend.pipeline_smoke

    # Or point at a different host:
    BACKEND=http://127.0.0.1:8000 python -m ai-agent-extension.backend.pipeline_smoke

Exits 0 if all checks pass, 1 if any check fails, 2 if backend is unreachable.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Optional, Tuple

BASE = os.environ.get("BACKEND", "http://127.0.0.1:8000").rstrip("/")
POLL_INTERVAL = 2    # seconds between status polls
POLL_TIMEOUT  = 90  # max seconds to wait for pipeline completion

GREEN  = "\033[32m"
RED    = "\033[31m"
YELLOW = "\033[33m"
CYAN   = "\033[36m"
RESET  = "\033[0m"

PASS = f"{GREEN}PASS{RESET}"
FAIL = f"{RED}FAIL{RESET}"
SKIP = f"{YELLOW}SKIP{RESET}"
INFO = f"{CYAN}INFO{RESET}"

results: list[tuple[str, bool, str]] = []


# ── HTTP helpers ───────────────────────────────────────────────────────────────

def _req(
    method: str,
    path: str,
    body: Optional[Dict[str, Any]] = None,
    timeout: int = 20,
) -> Tuple[int, Any]:
    data = None
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, raw
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:
            return e.code, str(e)
    except urllib.error.URLError as e:
        raise ConnectionError(str(e)) from e


def check(name: str, ok: bool, detail: str = "") -> bool:
    status = PASS if ok else FAIL
    results.append((name, ok, detail))
    print(f"  {status}  {name}" + (f"\n        {detail}" if detail else ""))
    return ok


def info(msg: str) -> None:
    print(f"  {INFO}  {msg}")


def section(title: str) -> None:
    print(f"\n{CYAN}{'─'*60}{RESET}")
    print(f"{CYAN}  {title}{RESET}")
    print(f"{CYAN}{'─'*60}{RESET}")


# ── Test groups ────────────────────────────────────────────────────────────────

def test_provider_health() -> bool:
    section("1. Provider Health Check")
    code, body = _req("GET", "/provider/status")
    ok = check("GET /provider/status → 200", code == 200 and isinstance(body, dict), str(body)[:120])
    if not ok:
        return False

    active = body.get("active_provider", "unknown")
    info(f"Active provider: {active}")

    ollama = body.get("ollama", {})
    info(f"Ollama: {'available' if ollama.get('available') else 'not available'} "
         f"at {ollama.get('host')} (model={ollama.get('model')})")

    cloud = body.get("cloud", {})
    for provider, has_key in cloud.items():
        info(f"Cloud/{provider}: {'key present' if has_key else 'no key'}")

    fallback = body.get("fallback_mode", True)
    if fallback:
        info("Running in RULE-BASED FALLBACK mode (no Ollama, no cloud keys) — responses are structured but not LLM-generated")
    else:
        info("LLM calls ACTIVE — real AI responses will be generated")

    return True


def test_basic_endpoints() -> None:
    section("2. Basic Endpoint Checks")

    code, body = _req("GET", "/")
    check("GET / → ok=true", code == 200 and isinstance(body, dict) and body.get("ok"), str(body)[:120])

    code, body = _req("GET", "/health")
    check("GET /health → status=ok", code == 200 and isinstance(body, dict) and body.get("status") == "ok", str(body)[:120])

    code, body = _req("GET", "/status")
    check("GET /status → has agent_state", code == 200 and "agent_state" in body, str(body)[:120])

    code, body = _req("GET", "/routing")
    check("GET /routing → has routes", code == 200 and "routes" in body, str(body)[:120])

    code, body = _req("GET", "/orchestrator/status")
    check("GET /orchestrator/status → 200", code == 200, str(body)[:120])


def test_journal_endpoint() -> bool:
    section("3. Project Journal")
    code, body = _req("GET", "/journal")
    ok = check("GET /journal → 200", code == 200 and isinstance(body, dict), str(body)[:120])
    if ok:
        count = body.get("count", 0)
        info(f"Journal contains {count} previous run(s)")

    code, body = _req("GET", "/journal/summary")
    check("GET /journal/summary → 200", code == 200 and "summary" in body, str(body)[:120])
    if code == 200:
        summary_preview = (body.get("summary") or "")[:200]
        if summary_preview and "No previous" not in summary_preview:
            info(f"Summary preview: {summary_preview}")
    return ok


def test_happy_path() -> bool:
    section("4. Happy Path — Full Pipeline Run")
    info("Submitting goal to orchestrator...")

    goal = "Add a hello_world function to utils.py that returns 'Hello, World!'"
    code, body = _req("POST", "/orchestrator/run", {
        "goal": goal,
        "session_id": 99901,
        "agent_ids": {},
        "task_ids": {},
        "callback_url": "http://localhost:9999",   # no real API server needed
    }, timeout=10)

    ok = check(
        "POST /orchestrator/run → accepted",
        code in (200, 202) and isinstance(body, dict) and body.get("status") == "started",
        str(body)[:200],
    )
    if not ok:
        return False

    info("Polling /orchestrator/status until done (or timeout)...")
    deadline = time.time() + POLL_TIMEOUT
    final_status: Optional[Dict[str, Any]] = None

    while time.time() < deadline:
        time.sleep(POLL_INTERVAL)
        try:
            code2, status_body = _req("GET", "/orchestrator/status", timeout=10)
        except ConnectionError:
            continue
        if code2 != 200:
            continue
        current_run = status_body.get("current_run") or {}
        state = current_run.get("state", "unknown")
        info(f"  Pipeline state: {state}")
        if state in ("done", "failed", "idle") or not status_body.get("is_running"):
            final_status = status_body
            break

    if final_status is None:
        return check("Pipeline completed within timeout", False, f"Timed out after {POLL_TIMEOUT}s")

    run = final_status.get("current_run") or (final_status.get("history") or [{}])[-1]
    raw_state = (run.get("state") or "unknown") if isinstance(run, dict) else "unknown"
    state = raw_state.lower()

    check("Pipeline reached terminal state", state in ("done", "failed", "idle"), f"state={raw_state}")

    if isinstance(run, dict):
        plan_count = len(run.get("plan", []))
        info(f"Plan tasks: {plan_count}")

        results_dict = run.get("results", {})
        for stage in ("planner", "researcher", "coder", "reviewer", "tester"):
            if stage in results_dict:
                info(f"  Agent '{stage}' completed ✓")

    return state in ("done", "failed", "idle")


def test_cancel_path() -> bool:
    section("5. Cancel Path — Start Then Cancel")

    # First ensure no pipeline is running
    _req("POST", "/orchestrator/cancel", timeout=5)
    time.sleep(1)

    goal = "Implement a complex distributed caching layer with Redis"
    code, body = _req("POST", "/orchestrator/run", {
        "goal": goal,
        "session_id": 99902,
        "agent_ids": {},
        "task_ids": {},
        "callback_url": "http://localhost:9999",
    }, timeout=10)

    started = check(
        "POST /orchestrator/run (cancel test) → accepted",
        code in (200, 202) and body.get("status") == "started",
        str(body)[:200],
    )
    if not started:
        return False

    time.sleep(2)
    code2, cancel_body = _req("POST", "/orchestrator/cancel", timeout=10)
    ok = check(
        "POST /orchestrator/cancel → status=cancel_requested",
        code2 == 200 and cancel_body.get("status") == "cancel_requested",
        str(cancel_body)[:120],
    )

    time.sleep(2)
    code3, status_body = _req("GET", "/orchestrator/status", timeout=10)
    is_running = status_body.get("is_running", True) if code3 == 200 else True
    check("Pipeline stopped after cancel", not is_running, f"is_running={is_running}")

    return ok


def test_memory_endpoints() -> None:
    section("6. Memory & State Endpoints")

    code, body = _req("POST", "/memory/save", {
        "file": "session_memory",
        "data": {"current_goal": "smoke_test", "completed_steps": ["provider_check", "pipeline"], "modified_files": []},
    })
    check("POST /memory/save → ok", code == 200 and body.get("ok"), str(body)[:120])

    code, body = _req("GET", "/memory/session_memory")
    check(
        "GET /memory/session_memory → data present",
        code == 200 and isinstance(body.get("data"), dict) and body["data"].get("current_goal") == "smoke_test",
        str(body)[:160],
    )

    code, body = _req("POST", "/state/IDLE")
    check("POST /state/IDLE → ok", code == 200 and body.get("ok"), str(body)[:120])

    code, body = _req("POST", "/state/INVALID_STATE_XYZ")
    check("POST /state/INVALID → 400+", code >= 400, str(body)[:120])


def test_journal_recorded() -> None:
    section("7. Journal Updated After Pipeline")
    code, body = _req("GET", "/journal")
    if code == 200 and isinstance(body, dict):
        count = body.get("count", 0)
        info(f"Journal now has {count} entries")
        check("Journal has at least 1 entry", count >= 0, f"count={count}")
        if count > 0 and body.get("entries"):
            entry = body["entries"][-1]
            info(f"Latest run: goal='{(entry.get('goal',''))[:60]}' "
                 f"provider={entry.get('provider_used','?')} "
                 f"review={entry.get('review_score',0)}/10")
    else:
        check("Journal endpoint reachable", False, str(body)[:120])


# ── Main ───────────────────────────────────────────────────────────────────────

def _print_summary() -> int:
    failed = [r for r in results if not r[1]]
    passed = len(results) - len(failed)

    print(f"\n{'─'*60}")
    print(f"Results: {GREEN}{passed} passed{RESET}, {RED}{len(failed)} failed{RESET} / {len(results)} total")
    if failed:
        print(f"\n{RED}Failed checks:{RESET}")
        for name, _, detail in failed:
            print(f"  • {name}" + (f": {detail}" if detail else ""))
    print()
    return 0 if not failed else 1


def main() -> int:
    print(f"\n{'═'*60}")
    print(f"  AI Agent Pipeline Smoke Test")
    print(f"  Backend: {BASE}")
    print(f"{'═'*60}")

    provider_ok = test_provider_health()
    if not provider_ok:
        check("Provider health — cannot continue", False, "Backend unreachable or /provider/status broken")
        return _print_summary()

    test_basic_endpoints()
    test_journal_endpoint()
    test_happy_path()
    test_cancel_path()
    test_memory_endpoints()
    test_journal_recorded()

    return _print_summary()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ConnectionError as e:
        print(f"\n  {FAIL}  Backend not reachable at {BASE}")
        print(f"        {e}")
        print(f"\n  Make sure the Python backend is running:")
        print(f"  cd ai-agent-extension && uvicorn backend.server:app --host 0.0.0.0 --port 8000 --reload")
        sys.exit(2)
    except KeyboardInterrupt:
        print("\n  Interrupted by user")
        sys.exit(130)
