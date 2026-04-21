"""
Test Runner - detects and runs tests for various project types
"""

import os
import subprocess
import time
import re
from typing import Optional


class TestRunner:
    def run(self, cwd: str, language: Optional[str] = None) -> dict:
        """Auto-detect test framework and run tests"""
        if not os.path.exists(cwd):
            return {"success": False, "error": "Project directory not found", "passed": 0, "failed": 0, "output": ""}

        test_cmd = self._detect_test_command(cwd, language)
        if not test_cmd:
            return {
                "success": False,
                "error": "No test framework detected",
                "passed": 0,
                "failed": 0,
                "output": "Could not detect test framework. Install jest (Node) or pytest (Python).",
                "duration": 0,
            }

        start = time.time()
        try:
            result = subprocess.run(
                test_cmd,
                shell=True,
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=120,
            )
            duration = int((time.time() - start) * 1000)
            output = result.stdout + result.stderr

            passed, failed = self._parse_results(output, language)

            return {
                "success": result.returncode == 0 and failed == 0,
                "passed": passed,
                "failed": failed,
                "total": passed + failed,
                "output": output[:10000],  # Limit output
                "duration": duration,
                "exit_code": result.returncode,
            }
        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "error": "Tests timed out after 120s",
                "passed": 0,
                "failed": 0,
                "total": 0,
                "output": "Tests exceeded 120 second timeout",
                "duration": 120000,
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "passed": 0,
                "failed": 0,
                "total": 0,
                "output": str(e),
                "duration": 0,
            }

    def _detect_test_command(self, cwd: str, language: Optional[str] = None) -> Optional[str]:
        """Detect the appropriate test command based on project type"""
        # Python
        if language == "python" or os.path.exists(os.path.join(cwd, "pytest.ini")) or \
           os.path.exists(os.path.join(cwd, "pyproject.toml")):
            return "python -m pytest -v 2>&1"

        # Node.js
        pkg_json = os.path.join(cwd, "package.json")
        if os.path.exists(pkg_json):
            import json
            try:
                with open(pkg_json) as f:
                    pkg = json.load(f)
                scripts = pkg.get("scripts", {})
                if "test" in scripts:
                    return "npm test 2>&1"
                # Detect jest/mocha
                deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
                if "jest" in deps:
                    return "npx jest 2>&1"
                if "mocha" in deps:
                    return "npx mocha 2>&1"
                if "vitest" in deps:
                    return "npx vitest run 2>&1"
            except Exception:
                return "npm test 2>&1"

        # Rust
        if os.path.exists(os.path.join(cwd, "Cargo.toml")):
            return "cargo test 2>&1"

        # Go
        if any(f.endswith(".go") for f in os.listdir(cwd)):
            return "go test ./... 2>&1"

        return None

    def _parse_results(self, output: str, language: Optional[str] = None) -> tuple:
        """Parse test output to extract pass/fail counts"""
        # Jest pattern: "Tests: X passed, Y failed"
        jest_match = re.search(r"Tests:\s*(?:(\d+)\s+passed)?.*?(?:(\d+)\s+failed)?", output, re.IGNORECASE)
        
        # Pytest pattern: "X passed, Y failed"
        pytest_match = re.search(r"(\d+)\s+passed(?:.*?(\d+)\s+failed)?", output, re.IGNORECASE)

        # Generic pass/fail
        pass_match = re.search(r"(\d+)\s+pass(?:ing|ed)", output, re.IGNORECASE)
        fail_match = re.search(r"(\d+)\s+fail(?:ing|ed)", output, re.IGNORECASE)

        passed = 0
        failed = 0

        if pytest_match:
            passed = int(pytest_match.group(1) or 0)
            failed = int(pytest_match.group(2) or 0)
        elif pass_match or fail_match:
            passed = int(pass_match.group(1)) if pass_match else 0
            failed = int(fail_match.group(1)) if fail_match else 0

        return passed, failed
