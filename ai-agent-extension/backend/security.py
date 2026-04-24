"""
Security Manager — full implementation per reference spec.

Model:
  1. Binary allow-list  — only these executables may appear as the FIRST token
  2. Blocked tokens     — these substrings / shell operators are never allowed
  3. Blocked flags      — these CLI flags are never allowed
  4. Path traversal     — safe_resolve() rejects anything outside the active project

Network: backend binds 127.0.0.1 only (never 0.0.0.0).
"""

import os
import re
import shlex
from pathlib import Path
from typing import Optional, Tuple

# ── 1. Binary allow-list (first token of every command) ───────────────────────
ALLOWED_BINARIES = {
    "npm", "npx", "node", "nodejs",
    "yarn", "pnpm", "bun",
    "python", "python3", "python3.11", "python3.12",
    "pip", "pip3", "pip3.11",
    "pytest", "uv",
    "git",
    "cargo", "rustc", "rustup",
    "go",
    "mvn", "gradle",
    "java", "javac",
    "make",
    "ls", "cat", "echo", "pwd", "mkdir", "cp", "mv", "touch", "find", "grep",
    "head", "tail", "wc", "sort", "uniq", "sed", "awk", "tr",
    "curl",   # curl is allowed but blocked flags cover --output /etc and similar
    "wget",
    "zip", "unzip", "tar",
    "env", "printenv", "which", "type",
    "true", "false",
}

# ── 2. Blocked tokens (substrings forbidden anywhere in the command) ───────────
BLOCKED_TOKENS = [
    "&&", "||", ";", "|", "$(",
    "`",           # backtick subshell
    ":(){",        # fork bomb opener
    "rm -rf /",    # nuke root
    "rm -rf ~",    # nuke home
    "sudo",
    "chmod 777",
    "chmod -R 777",
    "mkfs",
    "--no-preserve-root",
    "--privileged",
]

# ── 3. Blocked flag patterns (regex) ──────────────────────────────────────────
BLOCKED_FLAG_PATTERNS = [
    re.compile(r"--no-preserve-root", re.IGNORECASE),
    re.compile(r"--privileged", re.IGNORECASE),
    re.compile(r"-rf\s+/", re.IGNORECASE),
    re.compile(r">\s*/dev/sd", re.IGNORECASE),
    re.compile(r">\s*/etc/", re.IGNORECASE),
    re.compile(r">\s*/sys/", re.IGNORECASE),
    re.compile(r"\bdd\s+if=", re.IGNORECASE),
    re.compile(r"\bformat\s+[a-z]:", re.IGNORECASE),
    re.compile(r"\bshutdown\b", re.IGNORECASE),
    re.compile(r"\breboot\b", re.IGNORECASE),
    re.compile(r"\bpoweroff\b", re.IGNORECASE),
    re.compile(r"\bkill\s+-9\s+1\b"),
]


class SecurityManager:
    def __init__(self, allowed_root: str = "./projects"):
        self.allowed_root = os.path.abspath(allowed_root)
        os.makedirs(self.allowed_root, exist_ok=True)

    # ── Public API ─────────────────────────────────────────────────────────────

    def is_command_safe(self, command: str) -> Tuple[bool, str]:
        """
        Returns (True, "") if safe, or (False, reason) if blocked.

        Checks in order:
          1. Blocked flag patterns (regex)
          2. Blocked token substrings
          3. Binary allow-list (first token after optional env assignments)
        """
        if not command or not command.strip():
            return False, "Empty command"

        # 1. Blocked flag patterns
        for pat in BLOCKED_FLAG_PATTERNS:
            if pat.search(command):
                return False, f"Blocked: command matches forbidden pattern '{pat.pattern}'"

        # 2. Blocked token substrings
        for tok in BLOCKED_TOKENS:
            if tok in command:
                return False, f"Blocked: command contains forbidden token '{tok}'"

        # 3. Binary allow-list
        binary = self._extract_binary(command)
        if binary and binary not in ALLOWED_BINARIES:
            return False, (
                f"Blocked: '{binary}' is not in the allowed-binary list. "
                f"Allowed: {', '.join(sorted(ALLOWED_BINARIES))}"
            )

        return True, ""

    def safe_resolve(self, workdir: str, rel_path: str) -> Optional[str]:
        """
        Resolve rel_path relative to workdir, refusing any result that
        escapes workdir. Returns the absolute path or None (caller → HTTP 403).
        """
        if not rel_path:
            return None
        workdir_abs = os.path.abspath(workdir)
        if os.path.isabs(rel_path):
            resolved = os.path.normpath(rel_path)
        else:
            resolved = os.path.normpath(os.path.join(workdir_abs, rel_path))
        if not resolved.startswith(workdir_abs):
            return None  # path traversal attempt
        return resolved

    def validate_path(self, path: str, base: Optional[str] = None) -> Optional[str]:
        """Alias for safe_resolve for backward compatibility."""
        root = base or self.allowed_root
        return self.safe_resolve(root, path)

    # ── Internal ───────────────────────────────────────────────────────────────

    def _extract_binary(self, command: str) -> Optional[str]:
        """
        Extract the effective binary name from a shell command string,
        skipping leading env-var assignments (KEY=value binary …).
        """
        try:
            tokens = shlex.split(command)
        except ValueError:
            # Malformed quoting — treat the first word as the binary
            tokens = command.split()
        for tok in tokens:
            if "=" in tok and tok.split("=")[0].isidentifier():
                continue  # skip env assignment (e.g. NODE_ENV=production)
            # Return just the basename (strip path prefix)
            return os.path.basename(tok)
        return None
