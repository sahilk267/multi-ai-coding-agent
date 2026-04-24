# Architecture — Multi-AI Autonomous Coding Agent

> Last updated: April 2026

## Overview

This project is a browser-based autonomous coding agent that drives four AI providers
(ChatGPT, DeepSeek, Qwen, Gemini) through Chrome's automation APIs, coordinated by a
local Python backend and a React dashboard.

---

## High-Level Component Map

```mermaid
graph TB
    subgraph Browser["Browser (Chrome MV3 Extension)"]
        BG[background.js\nService Worker]
        CS[content.js\nContent Script]
        PANEL[ui/panel.html\nPanel UI]
        ADAPTERS[Adapters\nchatgpt / deepseek / qwen / gemini]
    end

    subgraph Python["Python Backend (port 8765)"]
        SERVER[server.py\nFastAPI REST + WebSocket]
        SECURITY[security.py\nCommand Sandbox]
        AI_ROUTER[ai_router.py\nModel Router]
        PM[project_manager.py\nFile ops + Watchdog]
        MEM[memory/\nJSON persistence]
    end

    subgraph React["React Dashboard (port 5174)"]
        DASH[AGENT_OS\nDashboard]
        LIVE[AgentLive.tsx\nLive Monitor + WS]
        API_CLIENT[API Client\nOrval generated]
    end

    subgraph ExpressAPI["Express API (port 8080)"]
        EXPRESS[api-server\nREST + WS relay]
        DB[(PostgreSQL\nDrizzle ORM)]
    end

    BG <-->|REST + WS| SERVER
    CS <-->|DOM injection| ADAPTERS
    BG <-->|chrome.scripting| CS
    PANEL <-->|chrome.runtime| BG
    DASH <-->|HTTP| EXPRESS
    LIVE <-->|WebSocket| EXPRESS
    EXPRESS <-->|SQL| DB
    SERVER <-->|WS broadcast| LIVE
```

---

## State Machine

```mermaid
stateDiagram-v2
    [*] --> IDLE

    IDLE --> PLANNING : task received
    PLANNING --> CODING : plan approved
    PLANNING --> WAITING_APPROVAL : plan needs review

    CODING --> TESTING : code written
    CODING --> WAITING_APPROVAL : write needs approval
    CODING --> PAUSED : user pause
    CODING --> FAILED : unrecoverable error

    TESTING --> DEBUGGING : tests fail
    TESTING --> COMMITTING : tests pass
    TESTING --> WAITING_APPROVAL : test command needs approval

    DEBUGGING --> CODING : fix written
    DEBUGGING --> FAILED : too many retries

    COMMITTING --> DONE : committed
    COMMITTING --> FAILED : git error

    DONE --> IDLE : next task
    DONE --> PLANNING : follow-up task

    WAITING_APPROVAL --> CODING : approved
    WAITING_APPROVAL --> FAILED : rejected

    PAUSED --> CODING : user resume

    note right of WAITING_APPROVAL
      Any state can transition
      to WAITING_APPROVAL for
      write/command approval
    end note
```

---

## Request Lifecycle

```mermaid
sequenceDiagram
    participant User
    participant Panel as Panel UI
    participant BG as background.js
    participant Router as Router
    participant TokenMgr as TokenManager
    participant Tab as AI Provider Tab
    participant Backend as Python Backend

    User->>Panel: Submit task prompt
    Panel->>BG: AGENT_RUN_PROMPT
    BG->>Router: route("auto", "coding")
    Router-->>BG: {model:"deepseek", url:"https://..."}
    BG->>TokenMgr: budgetPrompt(rawPrompt, "deepseek")
    TokenMgr-->>BG: {prompt, truncated, tokens}
    BG->>Tab: chrome.scripting inject
    Tab->>Tab: paste → click send → wait response
    Tab-->>BG: {response, done:true}
    BG->>Backend: POST /run_command or /write_file
    Backend->>Backend: security.is_command_safe()
    Backend-->>BG: {stdout, stderr, exit_code}
    BG->>Panel: broadcast state + response
```

---

## Token Budget Flow

```mermaid
flowchart LR
    A[Raw Prompt\n∞ chars] --> B{fits in\nmodel limit?}
    B -- yes --> C[Send as-is]
    B -- no --> D[Split: HEAD 60%\nTAIL 40%]
    D --> E[Insert truncation\nmarker]
    E --> F[Budgeted Prompt\n≤ model_limit - reserved]
    F --> C
    C --> G[Inject into\nProvider Tab]
```

---

## Security Model

```mermaid
flowchart TD
    CMD[Raw shell command] --> BL{Blocked flag\npattern?}
    BL -- yes --> BLOCK1[❌ Blocked\nHTTP 400]
    BL -- no --> BT{Blocked token\nsubstring?}
    BT -- yes --> BLOCK2[❌ Blocked\nHTTP 400]
    BT -- no --> AL{First binary\nin allow-list?}
    AL -- no --> BLOCK3[❌ Blocked\nHTTP 400]
    AL -- yes --> PT{Path within\nproject root?}
    PT -- no --> BLOCK4[❌ HTTP 403\nPath traversal]
    PT -- yes --> RUN[✅ Execute\nsubprocess]
```

---

## Directory Structure

```
ai-agent-extension/
├── extension/               # Chrome MV3 extension
│   ├── adapters/            # Per-provider DOM adapters (default exports)
│   │   ├── baseAdapter.js
│   │   ├── chatgpt.js
│   │   ├── deepseek.js
│   │   ├── qwen.js
│   │   └── gemini.js
│   ├── core/
│   │   ├── stateMachine.js  # IDLE→PLANNING→CODING→TESTING→DEBUGGING→COMMITTING→DONE
│   │   ├── router.js        # Task-to-provider routing
│   │   ├── tokenManager.js  # Prompt budgeting + truncation
│   │   ├── contextEngine.js # Sliding context window
│   │   ├── diffViewer.js    # Unified diff renderer
│   │   ├── toolRegistry.js  # Tool registration + dispatch
│   │   └── agentLoop.js     # Main agentic loop
│   ├── scripts/             # CLI audit/debug tools
│   │   ├── budget.mjs       # Token budget CLI
│   │   ├── check-selectors.mjs
│   │   ├── load-check.mjs
│   │   ├── package-check.mjs
│   │   └── snapshot-config.mjs
│   ├── ui/                  # Panel HTML/JS/CSS
│   ├── background.js        # Service worker
│   ├── content.js           # Content script
│   ├── config.json          # Central config (providers, routing, limits)
│   └── manifest.json        # MV3 manifest
│
├── backend/                 # Python FastAPI backend (port 8765)
│   ├── server.py            # 22+ REST endpoints + WebSocket /ws
│   ├── security.py          # Binary allow-list + token blocks
│   ├── project_manager.py   # File ops + watchdog watcher
│   ├── ai_router.py         # Model selection logic
│   ├── websocket_manager.py # WS connection manager
│   ├── file_indexer.py      # Directory indexer
│   └── memory/              # JSON memory persistence
│
├── docs/                    # Architecture docs (this file)
│
└── .github/                 # CI/CD
    ├── CODEOWNERS
    └── workflows/
        ├── ci.yml
        └── release.yml
```

---

## Provider Routing Matrix

| Task Type      | Primary  | Fallback Order                    | Reason                              |
|----------------|----------|-----------------------------------|-------------------------------------|
| `planning`     | ChatGPT  | DeepSeek → Gemini → Qwen          | Best at structured reasoning        |
| `coding`       | DeepSeek | ChatGPT → Gemini → Qwen           | Strongest code generation           |
| `debugging`    | Qwen     | DeepSeek → ChatGPT → Gemini       | Long code context + error analysis  |
| `long_context` | Gemini   | DeepSeek → ChatGPT → Qwen         | 32K+ token window                   |

---

## Checkpoint & Recovery

The background service worker saves a checkpoint every **5 seconds** to `chrome.storage.local`:

```json
{
  "state": "CODING",
  "pendingApprovals": [...],
  "config": {...},
  "savedAt": 1714000000000
}
```

On startup, the worker restores the last checkpoint and resumes from the saved state.
This ensures task continuity across browser crashes and extension reloads.

---

## Extension Permissions

| Permission       | Why                                              |
|------------------|--------------------------------------------------|
| `tabs`           | Open/find provider tabs                         |
| `storage`        | Checkpoint + config override persistence        |
| `scripting`      | Inject prompts + read responses from AI pages   |
| `activeTab`      | Focus the active provider tab                   |
| `http://localhost:8765/*` | Communicate with Python backend        |
| `ws://localhost:8765/*`   | WebSocket stream from backend          |
| `https://chatgpt.com/*` etc. | Read/write provider DOM            |
