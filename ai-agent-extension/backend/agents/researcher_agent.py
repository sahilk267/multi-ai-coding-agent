"""
Researcher Agent — gathers context, indexes the codebase, and provides
structured knowledge to other agents before they begin coding.
Routed to: Gemini (long context model for large codebase understanding)
"""

import json
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from .base_agent import BaseAgent


class ResearcherAgent(BaseAgent):

    ROLE = "researcher"
    DEFAULT_MODEL = "gemini"

    def __init__(self, memory_system, bus, session_id: str):
        super().__init__(self.ROLE, self.DEFAULT_MODEL, memory_system, bus, session_id)
        self._project_root: Optional[str] = None

    @property
    def system_prompt(self) -> str:
        return (
            "You are an expert code researcher and technical analyst. "
            "Your role is to deeply understand codebases, identify relevant files, "
            "trace data flows, understand architectures, and provide precise, "
            "structured context that other agents can act on. "
            "You produce JSON-structured research reports with: files, patterns, dependencies, risks."
        )

    def set_project_root(self, root: str) -> None:
        self._project_root = root

    async def run(self, task: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        description = task.get("description", "")
        await self._set_status("running", f"Researching: {description[:60]}")
        await self._log(f"[RESEARCHER] Starting research: {description}")

        start = time.time()
        research = {}

        if self._project_root and Path(self._project_root).exists():
            research["file_index"] = self._index_project(self._project_root)
            research["relevant_files"] = self._find_relevant_files(
                self._project_root, description
            )
            research["project_structure"] = self._get_structure(self._project_root)
            research["tech_stack"] = self._detect_tech_stack(self._project_root)
        else:
            research["note"] = "No project root set; running in analysis-only mode."
            research["file_index"] = []
            research["relevant_files"] = []
            research["project_structure"] = {}
            research["tech_stack"] = []

        research["analysis"] = self._analyze_task(description, research)

        self._mem.set_context("research", research)
        self._ltm.write("shared", "project_context", json.dumps(research, default=str)[:4000])

        await self._send("orchestrator", "research_result", {
            "agent": self.ROLE,
            "research": research,
            "task_id": task.get("id"),
        })

        await self._set_status("completed", None)
        elapsed = time.time() - start
        await self._log(f"[RESEARCHER] Research complete in {elapsed:.1f}s — {len(research.get('relevant_files', []))} relevant files found")

        return {
            "success": True,
            "output": json.dumps(research, indent=2, default=str),
            "research": research,
            "agent": self.ROLE,
        }

    def _index_project(self, root: str, max_files: int = 200) -> List[Dict[str, Any]]:
        index = []
        skip_dirs = {".git", "node_modules", "__pycache__", ".venv", "dist", "build", ".cache"}
        skip_exts = {".pyc", ".jpg", ".png", ".gif", ".ico", ".svg", ".woff", ".ttf", ".map"}

        try:
            for path in Path(root).rglob("*"):
                if len(index) >= max_files:
                    break
                if any(skip in path.parts for skip in skip_dirs):
                    continue
                if path.is_file() and path.suffix not in skip_exts:
                    try:
                        size = path.stat().st_size
                        index.append({
                            "path": str(path.relative_to(root)),
                            "ext": path.suffix,
                            "size": size,
                        })
                    except OSError:
                        pass
        except Exception:
            pass
        return index

    def _find_relevant_files(self, root: str, task_desc: str, max_results: int = 10) -> List[str]:
        keywords = [w.lower() for w in task_desc.split() if len(w) > 3]
        scored: List[tuple] = []

        try:
            for path in Path(root).rglob("*"):
                if not path.is_file():
                    continue
                if any(skip in path.parts for skip in {".git", "node_modules", "__pycache__", "dist"}):
                    continue
                if path.suffix in {".pyc", ".jpg", ".png"}:
                    continue

                rel = str(path.relative_to(root)).lower()
                score = sum(1 for kw in keywords if kw in rel)

                try:
                    if path.stat().st_size < 50_000 and path.suffix in {".py", ".ts", ".js", ".tsx", ".jsx", ".md"}:
                        content = path.read_text(errors="ignore").lower()
                        score += sum(min(content.count(kw), 5) for kw in keywords)
                except OSError:
                    pass

                if score > 0:
                    scored.append((score, str(path.relative_to(root))))
        except Exception:
            pass

        scored.sort(key=lambda x: x[0], reverse=True)
        return [p for _, p in scored[:max_results]]

    def _get_structure(self, root: str, max_depth: int = 3) -> Dict[str, Any]:
        def _walk(path: Path, depth: int) -> Dict[str, Any]:
            if depth == 0:
                return {}
            result = {}
            try:
                for item in sorted(path.iterdir()):
                    if item.name.startswith(".") or item.name in {"node_modules", "__pycache__", "dist"}:
                        continue
                    if item.is_dir():
                        result[item.name + "/"] = _walk(item, depth - 1)
                    else:
                        result[item.name] = item.stat().st_size
            except PermissionError:
                pass
            return result

        try:
            return _walk(Path(root), max_depth)
        except Exception:
            return {}

    def _detect_tech_stack(self, root: str) -> List[str]:
        stack = []
        markers = {
            "package.json": "Node.js",
            "requirements.txt": "Python",
            "Cargo.toml": "Rust",
            "go.mod": "Go",
            "pom.xml": "Java/Maven",
            "build.gradle": "Java/Gradle",
            "Gemfile": "Ruby",
            "composer.json": "PHP",
            "tsconfig.json": "TypeScript",
            "vite.config.ts": "Vite",
            "next.config.js": "Next.js",
            "docker-compose.yml": "Docker",
            "Dockerfile": "Docker",
        }
        for marker, tech in markers.items():
            if (Path(root) / marker).exists():
                stack.append(tech)
        return stack

    def _analyze_task(self, description: str, research: Dict[str, Any]) -> str:
        rel_files = research.get("relevant_files", [])
        tech = research.get("tech_stack", [])
        total = len(research.get("file_index", []))

        lines = [
            f"Task: {description}",
            f"Project size: {total} files",
            f"Tech stack: {', '.join(tech) if tech else 'Unknown'}",
            f"Most relevant files: {', '.join(rel_files[:5]) if rel_files else 'None identified'}",
            "Recommendation: Examine the relevant files above before making changes.",
        ]
        return "\n".join(lines)
