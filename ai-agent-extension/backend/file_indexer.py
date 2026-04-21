"""
File Indexer - scans project files and extracts metadata for AI context
"""

import os
import re
import json
import time
from typing import Dict, List, Optional
from pathlib import Path

IGNORED_DIRS = {"node_modules", ".git", "__pycache__", ".next", "dist", "build", ".venv", "venv"}
IGNORED_EXTS = {".lock", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf"}
MAX_FILE_SIZE = 100 * 1024  # 100KB


class FileIndexer:
    def __init__(self):
        self._cache: Dict[str, dict] = {}

    def index(self, project_path: str) -> dict:
        """Scan project and build searchable index"""
        files = []
        total_size = 0

        for root, dirs, filenames in os.walk(project_path):
            dirs[:] = [d for d in dirs if d not in IGNORED_DIRS and not d.startswith(".")]

            for filename in filenames:
                ext = Path(filename).suffix.lower()
                if ext in IGNORED_EXTS:
                    continue

                filepath = os.path.join(root, filename)
                rel_path = os.path.relpath(filepath, project_path)

                try:
                    size = os.path.getsize(filepath)
                    if size > MAX_FILE_SIZE:
                        files.append({
                            "path": rel_path,
                            "size": size,
                            "language": self._detect_language(filename),
                            "summary": "(file too large to index)",
                            "functions": [],
                            "imports": [],
                        })
                        continue

                    content = Path(filepath).read_text(encoding="utf-8", errors="ignore")
                    total_size += size

                    files.append({
                        "path": rel_path,
                        "size": size,
                        "language": self._detect_language(filename),
                        "summary": self._summarize(content, rel_path),
                        "functions": self._extract_functions(content, ext),
                        "imports": self._extract_imports(content, ext),
                        "lines": content.count("\n"),
                    })
                except Exception:
                    continue

        result = {
            "project_path": project_path,
            "total_files": len(files),
            "total_size": total_size,
            "files": files,
            "indexed_at": time.time(),
        }

        self._cache[project_path] = result
        return result

    def get_cached_index(self, project_path: str) -> Optional[dict]:
        return self._cache.get(project_path)

    def get_relevant_files(self, project_path: str, task: str, max_files: int = 10) -> List[dict]:
        """Return files most relevant to the given task"""
        index = self._cache.get(project_path)
        if not index:
            return []

        task_lower = task.lower()
        scored = []

        for f in index["files"]:
            score = 0
            path_lower = f["path"].lower()

            # Score by path keywords
            for word in task_lower.split():
                if word in path_lower:
                    score += 10

            # Score entry files higher
            if any(name in path_lower for name in ["index", "main", "app", "server", "router"]):
                score += 5

            # Score by function names
            for func in f.get("functions", []):
                for word in task_lower.split():
                    if word in func.lower():
                        score += 3

            scored.append((score, f))

        scored.sort(key=lambda x: -x[0])
        return [f for _, f in scored[:max_files]]

    def _detect_language(self, filename: str) -> Optional[str]:
        ext_map = {
            ".py": "python", ".js": "javascript", ".ts": "typescript",
            ".jsx": "javascript", ".tsx": "typescript", ".rs": "rust",
            ".go": "go", ".java": "java", ".cpp": "cpp", ".c": "c",
            ".rb": "ruby", ".php": "php", ".cs": "csharp", ".swift": "swift",
            ".kt": "kotlin", ".html": "html", ".css": "css", ".scss": "scss",
            ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".md": "markdown",
            ".sh": "shell", ".bash": "shell", ".sql": "sql",
        }
        ext = Path(filename).suffix.lower()
        return ext_map.get(ext)

    def _summarize(self, content: str, path: str) -> str:
        lines = content.split("\n")
        first_lines = [l.strip() for l in lines[:5] if l.strip() and not l.strip().startswith(("#", "//", "/*", "*"))]
        return first_lines[0][:200] if first_lines else f"File: {path}"

    def _extract_functions(self, content: str, ext: str) -> List[str]:
        patterns = {
            ".py": r"def\s+(\w+)\s*\(",
            ".js": r"(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s+)?\(|(\w+)\s*:\s*(?:async\s+)?function)",
            ".ts": r"(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s+)?\(|async\s+(\w+)\s*\()",
            ".jsx": r"(?:function\s+(\w+)|const\s+(\w+)\s*=)",
            ".tsx": r"(?:function\s+(\w+)|const\s+(\w+)\s*=)",
            ".go": r"func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(",
            ".rs": r"fn\s+(\w+)\s*\(",
            ".java": r"(?:public|private|protected|static)\s+\w+\s+(\w+)\s*\(",
        }
        pattern = patterns.get(ext)
        if not pattern:
            return []
        matches = re.findall(pattern, content)
        return [m if isinstance(m, str) else next((x for x in m if x), "") for m in matches[:20]]

    def _extract_imports(self, content: str, ext: str) -> List[str]:
        if ext in (".js", ".ts", ".jsx", ".tsx"):
            matches = re.findall(r'import\s+.*?\s+from\s+[\'"](.+?)[\'"]', content)
        elif ext == ".py":
            matches = re.findall(r'^(?:import|from)\s+([\w.]+)', content, re.MULTILINE)
        else:
            return []
        return list(set(matches[:20]))
