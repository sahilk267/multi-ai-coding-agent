# Multi-AI Autonomous Coding Agent — Setup Guide

This system has three components that work together:

## 1. React Dashboard (already running)
The web dashboard is running at your Replit preview URL.
It gives you a full IDE-like interface to manage projects, sessions, and agent memory.

## 2. Chrome Extension

### How to load the extension in Chrome:
1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer Mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `ai-agent-extension/extension/` folder

The extension popup lets you:
- Set a goal and choose an AI model
- Start the agent (it will open AI tabs and inject prompts)
- Monitor real-time logs
- Link to the dashboard

### Supported AI interfaces:
- ChatGPT (`chat.openai.com`) — reliable fallback
- DeepSeek (`chat.deepseek.com`) — best for coding tasks
- Qwen (`chat.qwen.ai`) — best for debugging
- Gemini (`gemini.google.com`) — fastest responses

## 3. Python Backend (Optional local backend)

The Node.js API server handles most operations.
The Python backend offers an alternative if you want to run it locally.

### Setup:
```bash
cd ai-agent-extension/backend
pip install -r requirements.txt
uvicorn server:app --reload --port 8000
```

### Endpoints:
- `GET  /health` — health check
- `GET  /projects` — list projects
- `POST /write_file` — write a file
- `POST /read_file` — read a file
- `POST /execute` — run a shell command
- `POST /run_tests` — auto-detect and run tests
- `POST /projects/{id}/git/commit` — git commit
- `GET  /memory` — get agent memory
- `POST /memory` — store memory entry

## How it works

1. You give the agent a **goal** (e.g. "Add authentication to my Express app")
2. The agent **routes** to the best AI model for the task type
3. It **injects a planning prompt** into the AI chat interface
4. It **parses the JSON plan** from the AI response
5. It **executes** each step (write files, run commands, run tests)
6. If a step **fails**, it asks the AI for a fix and retries
7. Results and errors are stored in **agent memory** for future context
