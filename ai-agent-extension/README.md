# Multi-AI Autonomous Coding Agent

> A browser-based autonomous coding agent that drives ChatGPT, DeepSeek, Qwen and Gemini through Chrome's automation APIs — **no API keys required**.

[![CI](https://github.com/your-org/multi-ai-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/multi-ai-agent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What Is This?

A **mini Cursor/Devin clone** that works entirely through web UIs:

- Opens the AI provider in a background Chrome tab
- Types your prompt using DOM injection
- Reads the AI's response back via scraping
- Executes code, runs tests, writes files — all locally
- Loops until the task is complete or approval is required

**No API keys. No monthly bills. Just a Chrome extension + a small Python backend.**

---

## Architecture at a Glance

```
User
 │
 ▼
Panel UI (ui/panel.html)
 │  chrome.runtime
 ▼
background.js (Service Worker)
 │  chrome.scripting         │  HTTP / WebSocket
 ▼                           ▼
content.js              Python Backend (port 8765)
adapters/               ├── security.py (command sandbox)
 ├── chatgpt.js         ├── project_manager.py + watchdog
 ├── deepseek.js        ├── ai_router.py
 ├── qwen.js            └── websocket_manager.py
 └── gemini.js
                             │
                             ▼
                        React Dashboard (port 5174)
                        AgentLive.tsx (live monitoring)
```

Full Mermaid diagrams: [`docs/architecture.md`](docs/architecture.md)

---

## Quick Start

### Prerequisites

| Tool | Version |
|------|---------|
| Chrome / Chromium | 120+ |
| Python | 3.11+ |
| Node.js | 20+ |
| npm | 9+ |

### 1. Install Python backend

```bash
cd backend
pip install -r requirements.txt
python server.py
# Backend starts on http://127.0.0.1:8765
```

### 2. Load the Chrome extension

1. Open `chrome://extensions`
2. Toggle **Developer mode** ON (top-right)
3. Click **Load unpacked**
4. Select the `extension/` folder

### 3. Open a task

1. Click the extension icon → **Open Panel**
2. Type your coding task
3. The agent picks the best AI provider automatically and starts working

---

## Provider Routing

The agent automatically routes each task type to the best provider:

| Task | Primary | Why |
|------|---------|-----|
| Planning | ChatGPT | Best at structured reasoning |
| Coding | DeepSeek | Strongest code generation |
| Debugging | Qwen | Long context + error analysis |
| Long context | Gemini | 32 K+ token window |

Fallback order: DeepSeek → ChatGPT → Gemini → Qwen

---

## Token Budgeting

Every prompt is automatically budgeted before injection:

```
Raw prompt (any length)
  ↓
budgetPrompt(prompt, provider)
  ↓  keeps HEAD 60% + TAIL 40% if over limit
Budgeted prompt (≤ model_limit − reserved_reply)
  ↓
Injected into provider tab
```

Model limits:

| Provider | Default limit (tokens) |
|----------|----------------------|
| ChatGPT | 8 000 |
| DeepSeek | 8 000 |
| Qwen | 8 000 |
| Gemini | 32 000 |

Override in `config.json` → `modelLimits`.

---

## Security Model

All shell commands go through a three-layer sandbox:

### Layer 1 — Binary allow-list

Only these executables are permitted as the first token of any command:

```
npm  npx  node  yarn  pnpm  bun
python  python3  pip  pip3  pytest  uv
git
cargo  rustc  rustup
go
mvn  gradle  java  javac
make
ls  cat  echo  pwd  mkdir  cp  mv  touch
find  grep  head  tail  wc  sort  uniq  sed  awk
zip  unzip  tar
env  printenv  which
curl  wget
```

### Layer 2 — Blocked tokens

These substrings are **never** allowed anywhere in a command:

```
&&  ||  ;  |  $(  `  :(){
rm -rf /  rm -rf ~  sudo
chmod 777  chmod -R 777  mkfs
--no-preserve-root  --privileged
```

### Layer 3 — Path traversal guard

`safe_resolve(workdir, rel_path)` ensures every file path resolves **inside**
the active project directory. Any path that escapes → **HTTP 403**.

---

## State Machine

```
IDLE → PLANNING → CODING → TESTING → DEBUGGING → COMMITTING → DONE
                               ↑______________|
         Any state → WAITING_APPROVAL (write/command needs user OK)
         Any state → PAUSED (user pause)
         Any state → FAILED (unrecoverable)
         FAILED → IDLE or PLANNING (retry)
```

Backward-compat aliases: `EXECUTING` = `CODING`, `FIXING` = `DEBUGGING`.

---

## Checkpoint & Crash Recovery

The service worker saves a **checkpoint every 5 seconds** to `chrome.storage.local`:

```json
{
  "state": "CODING",
  "pendingApprovals": [...],
  "config": { "..." : "..." },
  "savedAt": 1714000000000
}
```

On restart/crash, the worker restores the state automatically and resumes the task.

---

## Configuration (`config.json`)

```jsonc
{
  "backendUrl": "http://127.0.0.1:8765",
  "wsUrl": "ws://127.0.0.1:8765/ws",

  "providers": {
    "chatgpt":  { "url": "https://chatgpt.com/",          "enabled": true },
    "deepseek": { "url": "https://chat.deepseek.com/",    "enabled": true },
    "qwen":     { "url": "https://chat.qwen.ai/",         "enabled": true },
    "gemini":   { "url": "https://gemini.google.com/app", "enabled": true }
  },

  "routing": {
    "planning":     "chatgpt",
    "coding":       "deepseek",
    "debugging":    "qwen",
    "long_context": "gemini"
  },

  "modelLimits": {
    "chatgpt":  8000,
    "deepseek": 8000,
    "qwen":     8000,
    "gemini":   32000
  },

  "fallbackOrder": ["deepseek", "chatgpt", "gemini", "qwen"],

  "loop": {
    "maxIterations":      25,
    "maxRetries":         3,
    "stepTimeoutMs":      120000,
    "checkpointIntervalMs": 5000
  },

  "approval": {
    "requireForWrites":   true,
    "requireForCommands": true
  },

  "tokens": {
    "reservedReply": 1024
  }
}
```

---

## Python Backend Endpoints

### Status & Control

| Method | Path | Description |
|--------|------|-------------|
| GET | `/status` | Health + state + uptime |
| GET | `/routing` | Current routing matrix |
| POST | `/state/{state}` | Force state transition |
| POST | `/cancel` | Cancel current task |

### Project Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/project/list` | List all projects |
| POST | `/project/create` | Create new project |
| POST | `/project/select` | Set active project |
| GET | `/project/index` | Index active project files |
| POST | `/project/summary` | Structured code summary (functions, classes, imports) |

### File Operations

| Method | Path | Description |
|--------|------|-------------|
| POST | `/read_file` | Read file content |
| POST | `/write_file` | Write file (approval-gated) |
| POST | `/delete_file` | Delete file |
| POST | `/list_files` | List directory |

### Command Execution

| Method | Path | Description |
|--------|------|-------------|
| POST | `/run_command` | Execute sandboxed command |
| POST | `/run_tests` | Run test suite |
| GET | `/stream_output` | SSE stream of command output |

### Git

| Method | Path | Description |
|--------|------|-------------|
| GET | `/git/log` | Recent commit log |
| POST | `/git/commit` | Stage + commit |
| POST | `/git/diff` | Show diff |

### Memory

| Method | Path | Description |
|--------|------|-------------|
| GET | `/memory/{name}` | Read JSON memory file |
| POST | `/memory/save` | Write JSON memory file |

### Approvals

| Method | Path | Description |
|--------|------|-------------|
| GET | `/approvals/pending` | List pending approvals |
| POST | `/approvals/{id}/approve` | Approve action |
| POST | `/approvals/{id}/reject` | Reject action |

### WebSocket

| Path | Description |
|------|-------------|
| `ws://127.0.0.1:8765/ws` | Real-time event stream (state, file changes, output) |

---

## CLI Developer Tools

All tools run from the `extension/` directory with `node scripts/<tool>.mjs`.

### `load-check.mjs` — Manifest validator

```bash
node scripts/load-check.mjs          # human report
node scripts/load-check.mjs --json   # machine-readable
```

Validates:
- `manifest.json` shape + all referenced files exist
- `config.json` required keys + routing entries
- All 4 adapter files present
- Host permissions cover all 4 providers

### `check-selectors.mjs` — Adapter audit

```bash
node scripts/check-selectors.mjs
node scripts/check-selectors.mjs --provider deepseek
node scripts/check-selectors.mjs --json
```

Checks each adapter has all 6 required selector groups:
`input`, `sendButton`, `responseContainer`, `lastResponse`, `spinner`, `loginIndicator`

### `snapshot-config.mjs` — Config snapshot

```bash
node scripts/snapshot-config.mjs
```

Pretty-prints the active config and flags any issues (mismatched ports, disabled providers, etc.).

### `budget.mjs` — Token budget CLI

```bash
node scripts/budget.mjs deepseek myfile.js
node scripts/budget.mjs gemini - < prompt.txt --reserved=2048
```

Shows exactly what a provider will receive after budgeting.

### `package-check.mjs` — Release smoke test

```bash
node scripts/package-check.mjs
node scripts/package-check.mjs --json
```

Verifies the extension is ready for packaging (no debug flags, version bumped, etc.).

---

## Adapter Development

Each provider adapter lives in `extension/adapters/<provider>.js`.

### Required interface

```js
export default class MyProviderAdapter extends AIAdapter {
  constructor(utils) {
    super(utils);
    this.name = "myprovider";
    this.selectors = {
      input:             [...],  // CSS selectors for the text input
      sendButton:        [...],  // CSS selectors for the send button
      responseContainer: [...],  // CSS selectors for AI response blocks
      lastResponse:      [...],  // CSS selectors for the most recent response
      spinner:           [...],  // CSS selectors for loading indicator
      loginIndicator:    [...],  // CSS selectors visible only when logged out
    };
  }
}
```

### Rules

1. **Default export** the class (used by `check-selectors.mjs` and `baseAdapter.js`)
2. **Never reference `window` at module scope** — guard with `if (typeof window !== "undefined")`
3. Provide at least one selector per required group
4. Register on `window.__adapters` inside the guard block

---

## Running Tests

```bash
# Extension
cd extension
node --test core/tokenManager.test.mjs   # 10 tests, should all pass
node scripts/load-check.mjs              # static manifest check
node scripts/check-selectors.mjs         # adapter audit

# Backend
cd backend
pytest tests/ -v                          # Python unit tests
python -c "from security import SecurityManager; print('ok')"
```

---

## CI / CD

GitHub Actions workflows:

| Workflow | Triggers | What it does |
|----------|----------|--------------|
| `ci.yml` | push to main/dev, all PRs | Extension checks + Python backend smoke tests |
| `release.yml` | push tag `v*.*.*` | Full CI → zip extension → create GitHub Release |

---

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make changes — ensure `node scripts/load-check.mjs` and `check-selectors.mjs` pass
4. Submit a pull request — a CODEOWNER review is required for extension core + security files
5. After merge, tag a release to trigger the release workflow

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for full contribution guidelines.

---

## Project Structure

```
ai-agent-extension/
├── extension/               Chrome MV3 extension
│   ├── adapters/            Per-provider DOM automation
│   ├── core/                State machine, router, tokenizer, context
│   ├── scripts/             CLI audit & debug tools
│   ├── ui/                  Panel HTML / JS / CSS
│   ├── background.js        Service worker (checkpoint, routing, approvals)
│   ├── content.js           Content script (DOM bridge)
│   ├── config.json          Central configuration
│   └── manifest.json        MV3 manifest
├── backend/                 Python FastAPI backend
│   ├── server.py            22+ endpoints + WebSocket
│   ├── security.py          Command sandbox
│   ├── project_manager.py   File ops + watchdog watcher
│   └── memory/              JSON persistence
├── docs/                    Architecture docs + Mermaid diagrams
├── .github/                 CI workflows + CODEOWNERS
├── Makefile                 Developer shortcuts
├── CONTRIBUTING.md          Contribution guide
├── SETUP.md                 Detailed setup guide
└── README.md                This file
```

---

## License

MIT — see [`LICENSE`](LICENSE) for details.

---

## FAQ

**Q: Do I need an API key?**
A: No. The extension drives the web UI directly. As long as you're logged into the AI provider in Chrome, it works.

**Q: Which Chrome version is supported?**
A: Chrome 120+ (Manifest V3 with `chrome.scripting` API).

**Q: Can I add a new AI provider?**
A: Yes — create `extension/adapters/yourprovider.js` implementing the 6 required selector groups, add it to `config.json`, and update `manifest.json` host permissions.

**Q: What if the AI provider changes its UI?**
A: Run `node scripts/check-selectors.mjs` to audit which selector groups are empty, then update the relevant adapter's `selectors` object.

**Q: Is it safe to run on production code?**
A: The command sandbox uses a binary allowlist + blocked tokens + path traversal guard. Dangerous operations (sudo, rm -rf /, shell operators) are blocked. Still, review all commands before approving.

**Q: How do I disable the approval gate?**
A: Set `"requireForWrites": false` and `"requireForCommands": false` in `config.json → approval`. Not recommended for production use.
