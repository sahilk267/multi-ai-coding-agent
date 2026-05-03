# Workspace — Multi-AI Autonomous Coding Agent (Multi-Agent System)

## Overview

Production-ready multi-agent coding system built on a pnpm monorepo.
6 specialized AI agents collaborate through a JSON message bus to plan, research,
code, review, and test software changes end-to-end.

**Key capability**: Agents automatically select between local open-source LLMs (Ollama)
and cloud APIs (OpenAI, Gemini, DeepSeek, Qwen) — no manual switching required.
The provider layer pings Ollama first, then checks env keys, then falls back to rule-based responses.

## Architecture

### Multi-Agent Pipeline (6 agents)
1. **OrchestratorAgent** — controls the full pipeline, handles retries, broadcasts state, records project journal
2. **PlannerAgent** — decomposes user goals into structured JSON task graphs (preferred: ChatGPT → Ollama → fallback)
3. **ResearcherAgent** — indexes codebase, identifies relevant files, gathers context (preferred: Gemini → Ollama → fallback)
4. **CoderAgent** — writes/modifies code based on research context (preferred: DeepSeek → Ollama → fallback)
5. **ReviewerAgent** — audits code for security, correctness, style (preferred: ChatGPT → Ollama → fallback)
6. **TesterAgent** — runs test suites, parses results, validates output (preferred: Qwen → Ollama → fallback)

Pipeline flow: `User Goal → Planner → Researcher → Coder → Reviewer → [retry if rejected] → Tester → Done → Journal`

### Provider Auto-Selection Logic
```
For each agent call:
  1. Ping Ollama (localhost:11434) — use if available (fastest, free, private)
  2. Check env key for the agent's preferred cloud provider — use if key present
  3. Rule-based structured fallback — always succeeds, no LLM required
```
Provider selection is logged in every pipeline run and stored in the project journal.

### Inter-Agent Communication
- **JSON message bus** (`ai-agent-extension/backend/message_bus.py`) — async pub/sub
- **AgentMessage** schema: `{from_agent, to_agent, message_type, payload, session_id}`
- Real-time WebSocket broadcast to the React dashboard on every agent state change

### Agent Memory System
- **Short-term** — sliding-window in-memory context per agent (recent outputs, feedback, within one run)
- **Long-term** — shared JSON files persisted to `memory/` across runs
- **ProjectJournal** — append-only log of every pipeline run (goal, provider, plan, files changed, review score, test results, duration)
- **PostgreSQL** — `agents`, `agent_tasks`, `agent_messages` tables for structured tracking
- Each agent reads the last 3 journal entries into its prompt before running → learns from past failures

## Stack

### Monorepo (pnpm)
- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (v3.25+), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec at `lib/api-spec/openapi.yaml`)
- **Build**: esbuild (ESM bundle)

### React Dashboard (`artifacts/ai-agent/`, port 5000)
- 6 pages: Overview, **Pipeline** (new), Projects, Sessions, Memory, Agent Live
- Pipeline page: live 6-agent flow diagram, task board, inter-agent message feed, live log
- Vite proxies `/api/*` → `localhost:8080`, `/python-api/*` → `localhost:8000`, `/python-ws` → `ws://localhost:8000/ws`

### API Server (`artifacts/api-server/`, port 8080)
Multi-agent routes:
- `POST /api/pipeline/start` — create DB records + fire-and-forget launch Python orchestrator
- `POST /api/pipeline/:id/cancel` — cancel running pipeline, mark session paused
- `GET  /api/pipeline/:sessionId/status` — full status (session + agents + tasks + messages)
- `GET  /api/agents` — list agents (filter by `?sessionId=`)
- `PATCH /api/agents/:id` — update agent status/currentTask
- `GET  /api/agent-tasks` — list tasks (filter by `?sessionId=`)
- `PATCH /api/agent-tasks/:id` — update task status/result
- `GET  /api/agent-messages` — list inter-agent messages
- `POST /api/agent-messages` — record a new message

### Python Backend (`ai-agent-extension/backend/`, port 8000)
- **orchestrator.py** — main pipeline controller with 5-stage execution + retry logic + journal recording
- **agents/** — 5 specialized agent classes (planner, researcher, coder, reviewer, tester)
- **base_agent.py** — abstract base with lifecycle, memory, bus publish, WebSocket broadcast, journal-enriched prompts
- **message_bus.py** — async JSON pub/sub with subscriber callbacks and history
- **agent_memory.py** — ShortTermMemory + LongTermMemory + `ProjectJournal` (append-only run log)
- **ai_providers.py** — full provider layer: Ollama auto-detect + 4 cloud APIs + exponential backoff + fallback
- **server.py** — FastAPI with 25+ REST endpoints + WebSocket `/ws`
- **pipeline_smoke.py** — end-to-end smoke test for all pipeline endpoints

### DB Schema (`lib/db/src/schema/`)
- `projects`, `sessions`, `logs`, `plans`, `memory` — original tables
- `agents` — per-agent state tracking (role, status, aiModel, shortTermMemory, startedAt)
- `agent_tasks` — task assignments with priority, retry count, result, error
- `agent_messages` — inter-agent communication log with typed payloads (JSONB)

### Chrome Extension (`ai-agent-extension/extension/`)
- MV3 service worker (`background.js`) — drives AI model UIs via DOM automation
- 4 provider adapters — chatgpt / deepseek / qwen / gemini
- Core modules — stateMachine, router, tokenManager, contextEngine, diffViewer, toolRegistry

## Key Commands

```bash
# Start all three services (also available as Replit workflows)
PORT=8080 pnpm --filter @workspace/api-server run start    # API server (port 8080)
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/ai-agent run dev  # React dashboard (port 5000)
# Python backend (port 8000) — workflow: "Start Python backend"
cd ai-agent-extension && uvicorn backend.server:app --host 0.0.0.0 --port 8000 --reload

# Build
pnpm --filter @workspace/api-server run build   # compile TypeScript → dist/index.mjs
pnpm --filter @workspace/db run push            # push schema changes to PostgreSQL

# Codegen
pnpm --filter @workspace/api-spec run codegen   # regenerate API client hooks from OpenAPI

# Smoke tests
BACKEND=http://127.0.0.1:8000 python -m ai-agent-extension.backend.pipeline_smoke  # pipeline test
BACKEND=http://127.0.0.1:8000 python -m backend.test_smoke      # backend unit smoke test
```

## Provider Configuration

### Auto-selection order (first available wins)
| Priority | Provider | Activation |
|----------|----------|------------|
| 1 | **Ollama** (local LLM) | Ollama running at `OLLAMA_HOST` (default: `http://localhost:11434`) |
| 2 | Cloud API | Matching env key present (see table below) |
| 3 | Rule-based fallback | Always active — no setup needed |

### Environment Variables
| Variable | Provider | Default | Notes |
|----------|----------|---------|-------|
| `OLLAMA_HOST` | Ollama | `http://localhost:11434` | Override if Ollama is remote |
| `OLLAMA_MODEL` | Ollama | `qwen2.5-coder:7b` | Any model pulled in Ollama |
| `OPENAI_API_KEY` | OpenAI/ChatGPT | — | Used by Planner + Reviewer agents |
| `GEMINI_API_KEY` | Google Gemini | — | Used by Researcher (long context) |
| `DEEPSEEK_API_KEY` | DeepSeek | — | Used by Coder agent |
| `QWEN_API_KEY` | Qwen/Dashscope | — | Used by Tester agent |
| `LLM_TIMEOUT` | All | `60` | Per-request timeout in seconds |
| `LLM_MAX_RETRIES` | All | `2` | Retries per provider before fallback |

### Setting up Ollama (recommended for local LLM)
```bash
# Install Ollama: https://ollama.ai
ollama pull qwen2.5-coder:7b    # recommended for coding tasks
# Or any other model: llama3.2, deepseek-coder-v2, codestral, etc.
# Then start: ollama serve (runs on localhost:11434 by default)
```

### Checking provider status
```bash
curl http://localhost:8000/provider/status
# Returns: active_provider, ollama availability, cloud key presence
```

## Agent Model Routing

| Agent       | Preferred Model | Fallback | Rationale |
|-------------|-----------------|----------|-----------|
| Orchestrator| (none) | — | Control logic only, no LLM calls |
| Planner     | ChatGPT | Ollama → fallback | Strong reasoning for goal decomposition |
| Researcher  | Gemini  | Ollama → fallback | Long context for large codebase understanding |
| Coder       | DeepSeek | Ollama → fallback | Code generation specialist |
| Reviewer    | ChatGPT | Ollama → fallback | Nuanced reasoning for code quality analysis |
| Tester      | Qwen    | Ollama → fallback | Debugging/analysis specialist |

## Project Journal

After every pipeline run the orchestrator writes a structured record to `memory/project_journal.json`:
```json
{
  "run_id": "abc12345",
  "goal": "Add hello_world function",
  "provider_used": "ollama/qwen2.5-coder:7b",
  "plan_tasks": ["Research codebase", "Implement feature", "Code review", "Run tests"],
  "files_modified": ["utils.py"],
  "review_score": 8.5,
  "review_approved": true,
  "tests_passed": 3,
  "tests_failed": 0,
  "duration_s": 12.4,
  "ts": "2025-01-15T10:30:00Z"
}
```
Agents read the last 3 journal entries and inject them into their prompts, so the system
continuously improves — avoiding past mistakes and building on successful patterns.

API endpoints:
- `GET /journal` — last N runs (default 10)
- `GET /journal/summary` — human-readable text summary for last 3 runs

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Preview is blank | React dev server not running | Restart `Start application` and hard refresh |
| `/api/pipeline/start` fails | API server not running or DB unavailable | Check `Start API server` logs; verify PostgreSQL env is set |
| Python pipeline starts but no agents move | Python backend stale or callback failed | Restart `Start Python backend`; confirm `http://localhost:8000/provider/status` responds |
| WS feed shows reconnecting forever | Vite proxy or host config mismatch | Keep `allowedHosts: true` and restart the frontend workflow |
| Cancel button does nothing | Orchestrator already finished or backend not reachable | Check `/orchestrator/status` and backend logs |
| Agent output looks simulated | No LLM configured | Set `OPENAI_API_KEY`, `GEMINI_API_KEY`, etc., or run Ollama locally |
| Ollama not detected | Wrong host or model not pulled | Check `OLLAMA_HOST`, run `ollama pull qwen2.5-coder:7b` |
| Rate limit errors (429) | Cloud API quota exceeded | Providers auto-retry with 1s/4s/16s backoff; add another provider key |
| Auth error (401/403) | Invalid API key | Check the key in Replit secrets; provider is auto-skipped on auth failure |
| Smoke test fails at /orchestrator/run | Port 8000 not running | Start `Start Python backend` workflow first |

## Architecture Notes

- Pipeline retries: Reviewer rejection triggers up to 2 Coder retry loops before proceeding
- State machine states: IDLE → PLANNING → RESEARCHING → CODING → REVIEWING → RETRYING → TESTING → DONE/FAILED
- All agent state changes broadcast via WebSocket `agent_status` events
- Pipeline updates broadcast via `pipeline_update` events (full run dict)
- DB schema uses JSONB for `shortTermMemory` (agents), `payload` (messages), `metadata` (tasks)
- API server validation uses plain JS (no zod import) to avoid esbuild resolution issues
- Zod catalog version: `^3.25.76` (v3, not v4 — use `"zod"` not `"zod/v4"` in api-server)
- Error handling: 429 → exponential backoff; 401/403 → skip provider; timeout → retry once then fallback
- Journal is append-only (max 50 entries, rolling), stored in `memory/project_journal.json`
