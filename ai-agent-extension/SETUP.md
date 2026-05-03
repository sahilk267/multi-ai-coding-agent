# Multi-AI Autonomous Coding Agent — Setup Guide

This system has three components that work together.

---

## Quick Start

```bash
# 1. Start all three services (use Replit workflow buttons or these commands):
PORT=8080 pnpm --filter @workspace/api-server run start           # API Server    → port 8080
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/ai-agent run dev  # Dashboard     → port 5000
cd ai-agent-extension && uvicorn backend.server:app --host 0.0.0.0 --port 8000 --reload  # Python backend → port 8000

# 2. (Optional) Run a local LLM with Ollama
ollama pull qwen2.5-coder:7b
# Ollama is auto-detected — no config needed

# 3. Run the smoke test to verify everything is wired up
BACKEND=http://127.0.0.1:8000 python -m ai-agent-extension.backend.pipeline_smoke
```

---

## 1. React Dashboard (port 5000)

The web dashboard is available at your Replit preview URL.

**Pages:**
- Overview — system health and recent activity
- Pipeline — live 6-agent flow diagram, task board, inter-agent message feed
- Projects — file browser, code viewer, git history
- Sessions — run history with full agent outputs
- Memory — browse long-term memory and project journal
- Agent Live — real-time agent status, logs, and WebSocket feed

---

## 2. API Server (port 8080)

Express/TypeScript API backed by PostgreSQL (Drizzle ORM).

**Key endpoints:**
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/pipeline/start` | Launch a new multi-agent pipeline run |
| `POST` | `/api/pipeline/:id/cancel` | Cancel a running pipeline |
| `GET`  | `/api/pipeline/:id/status` | Full status (session + agents + tasks + messages) |
| `GET`  | `/api/agents` | List agents (filter by `?sessionId=`) |
| `PATCH`| `/api/agents/:id` | Update agent status/currentTask |
| `GET`  | `/api/agent-tasks` | List tasks (filter by `?sessionId=`) |
| `PATCH`| `/api/agent-tasks/:id` | Update task status/result |
| `GET`  | `/api/agent-messages` | Inter-agent message log |
| `POST` | `/api/agent-messages` | Record a new message |
| `GET`  | `/api/projects` | List projects |
| `POST` | `/api/projects` | Create a project |
| `GET`  | `/api/sessions` | List sessions |
| `POST` | `/api/sessions` | Create a session |
| `GET`  | `/api/memory` | Browse memory entries |

---

## 3. Python Backend (port 8000)

FastAPI backend running the multi-agent orchestrator.

### REST Endpoints
| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/` | Health check + active provider |
| `GET`  | `/health` | Health with full provider status |
| `GET`  | `/status` | Agent state machine status |
| `GET`  | `/routing` | Model routing configuration |
| `GET`  | `/provider/status` | **LLM provider health** — Ollama, cloud keys, active provider |
| `GET`  | `/journal` | Project journal (last N pipeline runs) |
| `GET`  | `/journal/summary` | Human-readable journal summary |
| `POST` | `/orchestrator/run` | Start the multi-agent pipeline |
| `GET`  | `/orchestrator/status` | Pipeline run status + history |
| `POST` | `/orchestrator/cancel` | Cancel a running pipeline |
| `POST` | `/project/create` | Create a new project |
| `POST` | `/project/select` | Set active project |
| `GET`  | `/project/list` | List all projects |
| `GET`  | `/project/index` | Index active project files |
| `POST` | `/project/summary` | Code structure summary for a file |
| `POST` | `/read_file` | Read a file from the active project |
| `POST` | `/write_file` | Write a file to the active project |
| `POST` | `/list_files` | List directory entries |
| `POST` | `/execute` | Run an allow-listed shell command |
| `POST` | `/git/commit` | Git commit with message |
| `GET`  | `/git/log` | Git history |
| `POST` | `/git/rollback` | Roll back to a commit SHA |
| `POST` | `/memory/save` | Save named memory blob |
| `GET`  | `/memory/{name}` | Retrieve named memory blob |
| `POST` | `/state/{new_state}` | Transition agent state machine |
| `POST` | `/cancel` | Cancel current operation |
| `WS`   | `/ws` | WebSocket — real-time agent events |

### WebSocket Events
| Event | Payload | Description |
|-------|---------|-------------|
| `agent_status` | `{agent, status, task, session_id}` | Agent lifecycle change |
| `agent_log` | `{agent, level, message, session_id}` | Agent log line |
| `agent_message` | `{from, to, type, payload, session_id}` | Inter-agent message |
| `pipeline_state` | `{run_id, state, session_id}` | Pipeline stage transition |
| `pipeline_update` | Full run dict | Pipeline state broadcast |
| `file_written` | `{path, size}` | File written to project |
| `command_output` | `{task_id, line}` | Shell command output line |
| `status` | `{state}` | Agent state machine change |

---

## 4. LLM Provider Configuration

### Auto-selection (no config required)
The system automatically picks the best available LLM:

```
1. Ollama (local)  →  fastest, free, private — auto-detected at OLLAMA_HOST
2. Cloud API       →  if the matching env key is set
3. Rule-based      →  always available — structured responses, no LLM
```

### Environment Variables
Set these in Replit Secrets to enable cloud providers:

| Variable | Effect |
|----------|--------|
| `OPENAI_API_KEY` | Enables ChatGPT gpt-4o-mini (Planner + Reviewer agents) |
| `GEMINI_API_KEY` | Enables Gemini 1.5 Flash (Researcher agent) |
| `DEEPSEEK_API_KEY` | Enables DeepSeek Chat (Coder agent) |
| `QWEN_API_KEY` | Enables Qwen Plus via Dashscope (Tester agent) |
| `OLLAMA_HOST` | Override Ollama URL (default: `http://localhost:11434`) |
| `OLLAMA_MODEL` | Override Ollama model (default: `qwen2.5-coder:7b`) |
| `LLM_TIMEOUT` | Per-request timeout in seconds (default: `60`) |
| `LLM_MAX_RETRIES` | Retries before fallback (default: `2`) |

### Setting up Ollama (recommended)
```bash
# Install: https://ollama.ai/download
ollama pull qwen2.5-coder:7b      # coding-focused, 7B params, fast
# Optionally: llama3.2, deepseek-coder-v2, codestral, phi3
ollama serve                       # starts at localhost:11434 automatically
```

### Check which provider is active
```bash
curl http://localhost:8000/provider/status
```
```json
{
  "active_provider": "ollama/qwen2.5-coder:7b",
  "ollama": { "available": true, "host": "http://localhost:11434", "model": "qwen2.5-coder:7b" },
  "cloud": { "chatgpt": false, "gemini": false, "deepseek": false, "qwen": false },
  "fallback_mode": false,
  "config": { "timeout_s": 60, "max_retries": 2 }
}
```

---

## 5. Project Journal

After every pipeline run the system appends a structured record to `memory/project_journal.json`.
Agents read the last 3 entries into their prompts before generating a response.

```bash
# Browse the journal via API
curl http://localhost:8000/journal
curl http://localhost:8000/journal/summary
```

Journal entry shape:
```json
{
  "run_id": "abc12345",
  "goal": "Add caching layer to API",
  "provider_used": "ollama/qwen2.5-coder:7b",
  "plan_tasks": ["Research codebase", "Implement caching", "Code review", "Tests"],
  "files_modified": ["server/cache.ts", "server/routes.ts"],
  "review_score": 8.5,
  "review_approved": true,
  "tests_passed": 12,
  "tests_failed": 0,
  "duration_s": 23.4,
  "ts": "2025-01-15T10:30:00Z"
}
```

---

## 6. Chrome Extension (optional)

The extension lets you drive AI model web interfaces directly via DOM automation.

### Load the extension in Chrome:
1. Open Chrome → `chrome://extensions`
2. Enable **Developer Mode** (toggle top-right)
3. Click **Load unpacked**
4. Select the `ai-agent-extension/extension/` folder

**Supported AI interfaces:**
- ChatGPT (`chat.openai.com`) — reliable fallback
- DeepSeek (`chat.deepseek.com`) — best for coding
- Qwen (`chat.qwen.ai`) — best for debugging
- Gemini (`gemini.google.com`) — fastest responses

---

## 7. Smoke Tests

```bash
# Pipeline smoke test — full multi-agent pipeline end-to-end (port 8000)
BACKEND=http://127.0.0.1:8000 python -m ai-agent-extension.backend.pipeline_smoke

# Backend unit smoke test — file ops, git, memory, security (port 8000)
BACKEND=http://127.0.0.1:8000 python -m backend.test_smoke
```

Both tests exit `0` on success, `1` on failures, `2` if the backend is unreachable.

---

## 8. Production Error Handling

| Error | Behavior |
|-------|----------|
| Rate limit (429) | Exponential backoff: 1s → 4s → 16s, then fallback to next provider |
| Auth failure (401/403) | Skip provider immediately, try next |
| Timeout | Retry once (configurable via `LLM_MAX_RETRIES`), then fallback |
| Network error | Log + fallback |
| JSON parse error | Extract JSON from markdown fences, then fallback to rule-based |

All errors are logged as structured JSON to `logs/backend.log` (rotating, 2 MB × 5 files).

---

## How the full pipeline works

1. You give the agent a **goal** (e.g. "Add authentication to my Express app")
2. **Planner** decomposes it into structured tasks with dependencies
3. **Researcher** indexes the codebase and identifies relevant files
4. **Coder** writes/modifies the required files
5. **Reviewer** audits the changes — if rejected, Coder retries (up to 2×)
6. **Tester** runs the test suite and reports results
7. **Journal** records the full run for future agent context
