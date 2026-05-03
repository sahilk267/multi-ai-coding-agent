# Workspace — Multi-AI Autonomous Coding Agent (Multi-Agent System)

## Overview

Production-ready multi-agent coding system built on a pnpm monorepo.
6 specialized AI agents collaborate through a JSON message bus to plan, research,
code, review, and test software changes end-to-end.

## Architecture

### Multi-Agent Pipeline (6 agents)
1. **OrchestratorAgent** — controls the full pipeline, handles retries, broadcasts state
2. **PlannerAgent** — decomposes user goals into structured JSON task graphs (ChatGPT)
3. **ResearcherAgent** — indexes codebase, identifies relevant files, gathers context (Gemini)
4. **CoderAgent** — writes/modifies code based on research context (DeepSeek)
5. **ReviewerAgent** — audits code for security, correctness, style (ChatGPT)
6. **TesterAgent** — runs test suites, parses results, validates output (Qwen)

Pipeline flow: `User Goal → Planner → Researcher → Coder → Reviewer → [retry if rejected] → Tester → Done`

### Inter-Agent Communication
- **JSON message bus** (`ai-agent-extension/backend/message_bus.py`) — async pub/sub
- **AgentMessage** schema: `{from_agent, to_agent, message_type, payload, session_id}`
- Real-time WebSocket broadcast to the React dashboard on every agent state change

### Per-Agent Memory
- **Short-term** — sliding-window in-memory context per agent (recent outputs, feedback)
- **Long-term** — shared JSON files persisted to `memory/` across runs
- **PostgreSQL** — `agents`, `agent_tasks`, `agent_messages` tables for tracking

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
- **orchestrator.py** — main pipeline controller with 5-stage execution + retry logic
- **agents/** — 5 specialized agent classes (planner, researcher, coder, reviewer, tester)
- **base_agent.py** — abstract base with lifecycle, memory, bus publish, WebSocket broadcast
- **message_bus.py** — async JSON pub/sub with subscriber callbacks and history
- **agent_memory.py** — ShortTermMemory (sliding window) + LongTermMemory (JSON files)
- **server.py** — FastAPI with 22+ REST endpoints + WebSocket `/ws`
- **ai_providers.py** — provider abstraction with safe fallback when free-tier keys are unavailable

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

# Python backend
cd ai-agent-extension/backend && uvicorn server:app --reload --host 127.0.0.1 --port 8765
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Preview is blank | React dev server not running | Restart `Start application` and hard refresh |
| `/api/pipeline/start` fails | API server not running or DB unavailable | Check `Start API server` logs; verify PostgreSQL env is set |
| Python pipeline starts but no agents move | Python backend stale or callback failed | Restart `Start Python backend`; confirm `http://localhost:8000/orchestrator/status` responds |
| WS feed shows reconnecting forever | Vite proxy or host config mismatch | Keep `allowedHosts: true` and restart the frontend workflow |
| Cancel button does nothing | Orchestrator already finished or backend not reachable | Check `/api/pipeline/:id/status` and backend logs |
| Agent output looks simulated | No provider key configured | This is expected fallback; `ai_providers.py` keeps the run working without secrets |
| Real model calls are not happening | Free-tier keys not present | Add a supported key later; until then the fallback path is used safely |

## Agent Model Routing

| Agent       | Model    | Rationale                                     |
|-------------|----------|-----------------------------------------------|
| Orchestrator| auto     | Control logic only, no LLM calls              |
| Planner     | ChatGPT  | Strong reasoning for goal decomposition       |
| Researcher  | Gemini   | Long context for large codebase understanding |
| Coder       | DeepSeek | Code generation specialist                    |
| Reviewer    | ChatGPT  | Nuanced reasoning for code quality analysis   |
| Tester      | Qwen     | Debugging/analysis specialist                 |

## Architecture Notes

- Pipeline retries: Reviewer rejection triggers up to 2 Coder retry loops before proceeding
- State machine states: IDLE → PLANNING → RESEARCHING → CODING → REVIEWING → RETRYING → TESTING → DONE/FAILED
- All agent state changes broadcast via WebSocket `agent_status` events
- Pipeline updates broadcast via `pipeline_update` events (full run dict)
- DB schema uses JSONB for `shortTermMemory` (agents), `payload` (messages), `metadata` (tasks)
- API server validation uses plain JS (no zod import) to avoid esbuild resolution issues
- Zod catalog version: `^3.25.76` (v3, not v4 — use `"zod"` not `"zod/v4"` in api-server)
