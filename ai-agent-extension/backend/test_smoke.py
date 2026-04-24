"""
End-to-end smoke test for the AI Agent backend.

Usage (with the backend already running on http://127.0.0.1:8765):

    python -m backend.test_smoke

Or point at a different host/port:

    BACKEND=http://127.0.0.1:9000 python -m backend.test_smoke

Exits 0 on success, non-zero on the first failure. Cleans up the temporary
project it creates.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

BASE = os.environ.get("BACKEND", "http://127.0.0.1:8765").rstrip("/")
PROJECT = f"_smoke_{uuid.uuid4().hex[:8]}"


def _req(method: str, path: str, body: dict | None = None, timeout: int = 30) -> tuple[int, dict | str]:
    data = None
    headers = {"Content-Type": "application/json"}
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


PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"
results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, ok, detail))
    print(f"{PASS if ok else FAIL}  {name}" + (f"  — {detail}" if detail else ""))
    return ok


def main() -> int:
    print(f"Backend: {BASE}")
    print(f"Test project: {PROJECT}")
    print("-" * 60)

    # 1. health
    code, body = _req("GET", "/")
    if not check("GET /", code == 200 and isinstance(body, dict) and body.get("ok"), str(body)[:120]):
        return _finish()

    # 2. status
    code, body = _req("GET", "/status")
    check("GET /status", code == 200 and isinstance(body, dict) and "agent_state" in body, str(body)[:120])

    # 3. routing
    code, body = _req("GET", "/routing")
    check("GET /routing", code == 200 and isinstance(body, dict) and "routes" in body, str(body)[:120])

    # 4. project create + select
    code, body = _req("POST", "/project/create", {"name": PROJECT})
    check("POST /project/create", code == 200 and body.get("ok") is True, str(body)[:120])
    code, body = _req("POST", "/project/select", {"name": PROJECT})
    check("POST /project/select", code == 200 and body.get("ok") is True, str(body)[:120])

    # 5. write + read + list
    code, body = _req("POST", "/write_file", {"path": "hello.txt", "content": "smoke ok"})
    check("POST /write_file", code == 200 and body.get("ok") is True, str(body)[:120])
    code, body = _req("POST", "/read_file", {"path": "hello.txt"})
    check("POST /read_file", code == 200 and body.get("content") == "smoke ok", str(body)[:120])
    code, body = _req("POST", "/list_files", {"path": ""})
    has_file = isinstance(body, dict) and any(e.get("name") == "hello.txt" for e in body.get("entries", []))
    check("POST /list_files", code == 200 and has_file, str(body)[:120])

    # 6. project index + summary
    code, body = _req("GET", "/project/index")
    check("GET /project/index", code == 200 and isinstance(body.get("files"), list), str(body)[:120])

    # 7. path traversal must be blocked
    code, body = _req("POST", "/read_file", {"path": "../../etc/passwd"})
    check("path traversal blocked", code >= 400, str(body)[:120])

    # 8. allow-listed command (echo)
    code, body = _req("POST", "/execute", {"cmd": "echo smoke", "timeout": 10})
    check("POST /execute (echo)", code == 200 and body.get("ok") is True and "smoke" in (body.get("output") or ""),
          str(body)[:160])

    # 9. forbidden command rejected
    code, body = _req("POST", "/execute", {"cmd": "rm -rf /", "timeout": 5})
    check("forbidden command blocked", code >= 400, str(body)[:120])

    # 10. git commit + log + rollback to HEAD
    code, body = _req("POST", "/git/commit", {"message": "smoke commit"})
    sha_ok = code == 200 and isinstance(body.get("sha"), str) and len(body["sha"]) >= 7
    sha = body.get("sha") if sha_ok else None
    check("POST /git/commit", sha_ok, str(body)[:120])
    code, body = _req("GET", "/git/log?n=5")
    check("GET /git/log", code == 200 and body.get("ok") is True, str(body)[:120])
    if sha:
        code, body = _req("POST", "/git/rollback", {"sha": sha})
        check("POST /git/rollback", code == 200 and body.get("ok") is True, str(body)[:120])

    # 11. memory save + load
    code, body = _req("POST", "/memory/save", {"file": "session_memory",
                                               "data": {"current_goal": "smoke", "completed_steps": [], "modified_files": []}})
    check("POST /memory/save", code == 200 and body.get("ok") is True, str(body)[:120])
    code, body = _req("GET", "/memory/session_memory")
    check("GET /memory/session_memory",
          code == 200 and isinstance(body.get("data"), dict) and body["data"].get("current_goal") == "smoke",
          str(body)[:160])

    # 12. state transitions
    code, body = _req("POST", "/state/IDLE")
    check("POST /state/IDLE", code == 200 and body.get("ok") is True, str(body)[:120])
    code, body = _req("POST", "/state/NOPE")
    check("invalid state rejected", code >= 400, str(body)[:120])

    # 13. cancel (no-op when nothing is running, should still return ok)
    code, body = _req("POST", "/cancel")
    check("POST /cancel", code == 200 and body.get("ok") is True, str(body)[:120])

    return _finish()


def _finish() -> int:
    # cleanup the temp project on disk
    try:
        root = Path(__file__).resolve().parent.parent
        target = root / "projects" / PROJECT
        if target.exists():
            shutil.rmtree(target, ignore_errors=True)
    except Exception:
        pass

    print("-" * 60)
    failed = [r for r in results if not r[1]]
    print(f"{len(results) - len(failed)} passed, {len(failed)} failed")
    return 0 if not failed else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except urllib.error.URLError as e:
        print(f"{FAIL}  Backend not reachable at {BASE} — {e}")
        sys.exit(2)
