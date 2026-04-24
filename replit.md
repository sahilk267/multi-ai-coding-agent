# Workspace — Multi-AI Autonomous Coding Agent

## Overview

Browser-based autonomous coding agent that drives ChatGPT, DeepSeek, Qwen, and Gemini
through Chrome automation APIs. No API keys required. A pnpm monorepo.

## Stack

### Monorepo (pnpm)
- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

### Chrome Extension (ai-agent-extension/extension/)
- MV3 service worker (background.js) — checkpoint loop, approval queue, crash recovery
- Content script (content.js) — DOM bridge
- 4 provider adapters — chatgpt / deepseek / qwen / gemini (default exports)
- Core modules — stateMachine, router, tokenManager, contextEngine, diffViewer, toolRegistry
- Config: config.json — backendUrl port 8765, all 4 providers, routing matrix, token limits (8k/32k)

### Python Backend (ai-agent-extension/backend/, port 8765)
- FastAPI server (server.py) — 22+ REST endpoints + WebSocket /ws
- SecurityManager (security.py) — binary allowlist + blocked tokens + path traversal guard
- ProjectManager (project_manager.py) — file ops + optional watchdog file watcher
- Memory persistence — JSON files in memory/

### React Dashboard (artifacts/ai-agent/, port 5174)
- AGENT_OS dashboard — 5 pages including AgentLive (live WS monitoring + approval queue)

## Key Commands

### pnpm monorepo
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks
- `pnpm --filter @workspace/db run push` — push DB schema changes
- `pnpm --filter @workspace/api-server run dev` — run Express API server

### Extension CLI tools (run from ai-agent-extension/extension/)
- `node scripts/load-check.mjs` — manifest + config static validation
- `node scripts/check-selectors.mjs` — audit all 4 provider adapters
- `node scripts/snapshot-config.mjs` — print routing matrix + check port coverage
- `node --test core/tokenManager.test.mjs` — 10 unit tests (all pass)
- `node scripts/budget.mjs <provider> <file>` — token budget CLI

### Python backend
- `cd ai-agent-extension/backend && python server.py` — start on port 8765

## Architecture Notes

- State machine states: IDLE → PLANNING → CODING → TESTING → DEBUGGING → COMMITTING → DONE
  with WAITING_APPROVAL interrupts. Aliases: EXECUTING=CODING, FIXING=DEBUGGING
- Checkpoint: background.js saves state every 5s to chrome.storage.local; restores on startup
- Token budgeting: budgetPrompt() keeps HEAD 60% + TAIL 40% when prompt > model limit
- Security: allowlist (npm/git/python/etc.) + blocked tokens (&&/||/;/|/$() etc.) + path traversal 403
- Routing: planning→chatgpt, coding→deepseek, debugging→qwen, long_context→gemini
- Backend port: 8765
- Watchdog: project_manager.py uses watchdog lib if installed for file system events

## CI/CD

- `.github/workflows/ci.yml` — Node 20/22 + Python 3.11/3.12 matrix
- `.github/workflows/release.yml` — tag v*.*.* → zip extension → GitHub Release
- `.github/CODEOWNERS` — extension core + security require owner review
- `docs/architecture.md` — Mermaid state machine, sequence, security flow diagrams
