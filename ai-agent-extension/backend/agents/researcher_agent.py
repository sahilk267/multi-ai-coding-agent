"""
Researcher Agent — gathers context, indexes the codebase, and provides
structured knowledge to other agents before they begin coding.
Preferred model: Gemini (long context) → Ollama → rule-based fallback.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..ai_providers import call_model
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
            "Deeply understand codebases, identify relevant files, trace data flows, "
            "understand architectures, and provide precise structured context for other agents. "
            "Use the project journal to identify files previously modified and patterns to avoid. "
            "Output JSON with keys: files (list of relevant paths), patterns (list of strings), "
            "dependencies (list), risks (list), analysis (string summary). "
            "Do not include the full file contents — paths and analysis only."
        )

    def set_project_root(self, root: str) -> None:
        self._project_root = root

    async def run(self, task: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        description = task.get("description", "")
        await self._set_status("running", f"Researching: {description[:60]}")
        await self._log(f"[RESEARCHER] Starting research: {description}")

        start = time.time()
        research: Dict[str, Any] = {}

        if self._project_root and Path(self._project_root).exists():
            research["file_index"] = self._index_project(self._project_root)
            research["relevant_files"] = self._find_relevant_files(self._project_root, description)
            research["project_structure"] = self._get_structure(self._project_root)
            research["tech_stack"] = self._detect_tech_stack(self._project_root)
        else:
            research.update({"note": "No project root set — analysis-only mode.",
                             "file_index": [], "relevant_files": [],
                             "project_structure": {}, "tech_stack": []})

        research["previously_modified"] = self._journal.all_changed_files()[:20]
        research["analysis"] = self._analyze_task(description, research)

        prompt = self._build_prompt(task, context)
        provider_result = call_model(self.ai_model, self.system_prompt, prompt, {"research": research})

        if isinstance(provider_result, dict) and provider_result.get("analysis"):
            research["llm_analysis"] = provider_result.get("analysis", "")
            research["llm_risks"] = provider_result.get("risks", [])
            research["llm_patterns"] = provider_result.get("patterns", [])

        self._mem.set_context("research", research)
        self._ltm.write("shared", "project_context",
                        json.dumps(research, default=str)[:4000])

        await self._send("orchestrator", "research_result", {
            "agent": self.ROLE,
            "research": research,
            "task_id": task.get("id"),
        })
        await self._set_status("completed", None)
        elapsed = time.time() - start
        await self._log(
            f"[RESEARCHER] Research complete in {elapsed:.1f}s — "
            f"{len(research.get('relevant_files', []))} relevant files, "
            f"{len(research.get('tech_stack', []))} stack items"
        )

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
                        index.append({"path": str(path.relative_to(root)),
                                      "ext": path.suffix, "size": path.stat().st_size})
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
                if any(s in path.parts for s in {".git", "node_modules", "__pycache__", "dist"}):
                    continue
                if path.suffix in {".pyc", ".jpg", ".png"}:
                    continue
                rel = str(path.relative_to(root)).lower()
                score = sum(1 for kw in keywords if kw in rel)
                try:
                    if path.stat().st_size < 50_000 and path.suffix in {
                        ".py", ".ts", ".js", ".tsx", ".jsx", ".md"
                    }:
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
        markers = {
            "package.json": "Node.js", "requirements.txt": "Python",
            "Cargo.toml": "Rust", "go.mod": "Go", "pom.xml": "Java/Maven",
            "build.gradle": "Java/Gradle", "Gemfile": "Ruby",
            "composer.json": "PHP", "tsconfig.json": "TypeScript",
            "vite.config.ts": "Vite", "next.config.js": "Next.js",
            "docker-compose.yml": "Docker", "Dockerfile": "Docker",
        }
        return [tech for marker, tech in markers.items() if (Path(root) / marker).exists()]

    def _analyze_task(self, description: str, research: Dict[str, Any]) -> str:
        rel_files = research.get("relevant_files", [])
        tech = research.get("tech_stack", [])
        total = len(research.get("file_index", []))
        prev = research.get("previously_modified", [])
        lines = [
            f"Task: {description}",
            f"Project size: {total} files",
            f"Tech stack: {', '.join(tech) if tech else 'Unknown'}",
            f"Most relevant files: {', '.join(rel_files[:5]) if rel_files else 'None identified'}",
            f"Previously modified (from journal): {', '.join(prev[:5]) if prev else 'None'}",
            "Recommendation: Examine the relevant files above before making changes.",
        ]
        return "\n".join(lines)
