"""
Security Manager — path sandboxing + blocked command patterns
"""
import os
import re
from typing import Optional, Tuple

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
    r":\(\)\s*\{",
    r"\bchmod\s+-R\s+777\s+/",
    r"\bkill\s+-9\s+1\b",
]


class SecurityManager:
    def __init__(self, allowed_root: str = "./projects"):
        self.allowed_root = os.path.abspath(allowed_root)
        os.makedirs(self.allowed_root, exist_ok=True)
        self._compiled = [re.compile(p, re.IGNORECASE) for p in BLOCKED_PATTERNS]

    def is_command_safe(self, command: str) -> Tuple[bool, str]:
        for pattern in self._compiled:
            if pattern.search(command):
                return False, f"Command blocked by security policy: matches '{pattern.pattern}'"
        return True, ""

    def validate_path(self, path: str, base: Optional[str] = None) -> Optional[str]:
        if not path:
            return None
        root = base or self.allowed_root
        if os.path.isabs(path):
            abs_path = os.path.normpath(path)
        else:
            abs_path = os.path.normpath(os.path.join(root, path))
        if abs_path.startswith(root) or abs_path.startswith("/tmp"):
            return abs_path
        return None
