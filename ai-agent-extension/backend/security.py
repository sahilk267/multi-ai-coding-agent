"""
Security Manager - validates paths and blocks dangerous commands
"""

import os
import re
from typing import Optional


BLOCKED_PATTERNS = [
    r"\brm\s+-rf\s+/",
    r"\bformat\s+[a-z]:",
    r"\bshutdown\b",
    r"\breboot\b",
    r"\bpoweroff\b",
    r"\bmkfs\b",
    r"\bdd\s+if=",
    r">\s*/dev/sd",
    r"\bsudo\s+rm\s+-rf",
    r":\(\)\s*\{",  # Fork bomb
    r"\bchmod\s+-R\s+777\s+/",
    r"\bchown\s+-R\s+.*\s+/",
    r"\bkillall\b",
    r"\bkill\s+-9\s+1\b",  # Kill init
]

ALLOWED_BASE = os.environ.get("PROJECTS_ROOT", "./projects")


class SecurityManager:
    def __init__(self):
        self.allowed_root = os.path.abspath(ALLOWED_BASE)
        os.makedirs(self.allowed_root, exist_ok=True)
        self._compiled = [re.compile(p, re.IGNORECASE) for p in BLOCKED_PATTERNS]

    def is_command_safe(self, command: str) -> bool:
        """Check if a command is safe to execute"""
        for pattern in self._compiled:
            if pattern.search(command):
                return False
        return True

    def validate_path(self, path: str) -> Optional[str]:
        """
        Validate that a path stays within the allowed directory.
        Returns the absolute path if safe, None otherwise.
        """
        if not path:
            return None

        # Resolve to absolute path
        if os.path.isabs(path):
            abs_path = os.path.normpath(path)
        else:
            abs_path = os.path.normpath(os.path.join(self.allowed_root, path))

        # Allow if within allowed root OR within /tmp/agent-projects (for Node backend)
        if abs_path.startswith(self.allowed_root):
            return abs_path

        # Also allow /tmp paths for compatibility
        if abs_path.startswith("/tmp"):
            return abs_path

        return None

    def sanitize_command_output(self, output: str, max_length: int = 50000) -> str:
        """Truncate and clean command output"""
        if len(output) > max_length:
            output = output[:max_length] + "\n... (output truncated)"
        return output
