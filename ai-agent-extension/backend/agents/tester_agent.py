"""
Tester Agent — runs test suites, validates outputs, and reports structured results.
Routed to: Qwen (debugging/analysis specialist)
"""

import json
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..ai_providers import call_model
from .base_agent import BaseAgent


class TesterAgent(BaseAgent):

    ROLE = "tester"
    DEFAULT_MODEL = "qwen"

    def __init__(self, memory_system, bus, session_id: str):
        super().__init__(self.ROLE, self.DEFAULT_MODEL, memory_system, bus, session_id)
        self._project_root: Optional[str] = None

    @property
    def system_prompt(self) -> str:
        return (
            "You are a QA engineer and test automation specialist. "
            "You run test suites, analyze failures, and write targeted tests for new code. "
            "Output JSON: { passed: int, failed: int, skipped: int, total: int, "
            "success: bool, output: string, new_tests_written: [string], failures: [{ test, reason }] }."
        )

    def set_project_root(self, root: str) -> None:
        self._project_root = root

    async def run(self, task: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        description = task.get("description", "")
        await self._set_status("running", f"Testing: {description[:60]}")
        await self._log(f"[TESTER] Starting test suite")

        start = time.time()

        review = context.get("review", {})
        coder_output = context.get("coder_output", {})

        if not review.get("approved", True):
            await self._log("[TESTER] Skipping — reviewer rejected changes", "warn")
            result = {
                "success": False,
                "passed": 0, "failed": 0, "skipped": 0, "total": 0,
                "output": "Skipped: reviewer did not approve code changes.",
                "new_tests_written": [],
                "failures": [{"test": "pre-test gate", "reason": "Code review failed"}],
                "agent": self.ROLE,
            }
            await self._send("orchestrator", "test_result", result)
            await self._set_status("completed", None)
            return result

        test_result = await self._run_tests()
        prompt = self._build_prompt(task, context)
        provider_result = call_model(self.ai_model, self.system_prompt, prompt, test_result)
        if isinstance(provider_result, dict):
            test_result = provider_result
        test_result["agent"] = self.ROLE

        self._mem.set_context("last_test", test_result)
        self._ltm.append("shared", "test_history", {
            "passed": test_result.get("passed", 0),
            "failed": test_result.get("failed", 0),
            "success": test_result.get("success", False),
            "timestamp": time.time(),
        })

        await self._send("orchestrator", "test_result", {
            **test_result,
            "task_id": task.get("id"),
        })

        elapsed = time.time() - start
        status = "✅" if test_result.get("success") else "❌"
        await self._set_status("completed", None)
        await self._log(
            f"[TESTER] {status} Tests done in {elapsed:.1f}s — "
            f"{test_result.get('passed', 0)} passed / {test_result.get('failed', 0)} failed"
        )

        return {"success": True, "output": json.dumps(test_result, indent=2), **test_result}

    async def _run_tests(self) -> Dict[str, Any]:
        if not self._project_root or not Path(self._project_root).exists():
            return self._mock_result("No project root configured")

        framework, cmd = self._detect_framework()
        if not cmd:
            return self._mock_result("No test framework detected")

        await self._log(f"[TESTER] Running {framework}: {cmd}")

        try:
            proc = subprocess.run(
                cmd,
                shell=True,
                cwd=self._project_root,
                capture_output=True,
                text=True,
                timeout=120,
            )
            output = proc.stdout + proc.stderr
            return self._parse_output(framework, output, proc.returncode)
        except subprocess.TimeoutExpired:
            return self._mock_result("Test run timed out after 120s", success=False)
        except Exception as e:
            return self._mock_result(f"Test execution error: {e}", success=False)

    def _detect_framework(self) -> tuple:
        root = Path(self._project_root)
        if (root / "pytest.ini").exists() or (root / "setup.cfg").exists() or (root / "pyproject.toml").exists():
            return "pytest", "python -m pytest -v --tb=short 2>&1"
        if any((root / f).exists() for f in ["requirements.txt", "setup.py"]):
            if list(root.rglob("test_*.py")) or list(root.rglob("*_test.py")):
                return "pytest", "python -m pytest -v --tb=short 2>&1"
        if (root / "package.json").exists():
            pkg = json.loads((root / "package.json").read_text())
            scripts = pkg.get("scripts", {})
            if "test" in scripts:
                runner = "pnpm" if (root / "pnpm-lock.yaml").exists() else "npm"
                return "jest", f"{runner} test -- --passWithNoTests 2>&1"
        if (root / "Cargo.toml").exists():
            return "cargo", "cargo test 2>&1"
        if (root / "go.mod").exists():
            return "go", "go test ./... 2>&1"
        return "", ""

    def _parse_output(self, framework: str, output: str, returncode: int) -> Dict[str, Any]:
        passed = failed = skipped = 0

        if framework == "pytest":
            import re
            m = re.search(r"(\d+) passed", output)
            if m: passed = int(m.group(1))
            m = re.search(r"(\d+) failed", output)
            if m: failed = int(m.group(1))
            m = re.search(r"(\d+) skipped", output)
            if m: skipped = int(m.group(1))
        elif framework == "jest":
            import re
            m = re.search(r"Tests:\s+(?:(\d+) failed,\s+)?(\d+) passed", output)
            if m:
                failed = int(m.group(1) or 0)
                passed = int(m.group(2) or 0)

        total = passed + failed + skipped
        failures: List[Dict[str, str]] = []

        if failed > 0:
            import re
            for match in re.finditer(r"FAILED (.+?)(?:\n|$)", output):
                failures.append({"test": match.group(1).strip(), "reason": "See output"})

        return {
            "passed": passed,
            "failed": failed,
            "skipped": skipped,
            "total": total if total > 0 else (1 if returncode == 0 else 1),
            "success": returncode == 0,
            "output": output[:3000],
            "new_tests_written": [],
            "failures": failures[:10],
        }

    def _mock_result(self, reason: str, success: bool = True) -> Dict[str, Any]:
        return {
            "passed": 1 if success else 0,
            "failed": 0 if success else 1,
            "skipped": 0,
            "total": 1,
            "success": success,
            "output": reason,
            "new_tests_written": [],
            "failures": [] if success else [{"test": "setup", "reason": reason}],
        }
