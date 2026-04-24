#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
VENV="$ROOT/backend/.venv"

if [ ! -d "$VENV" ]; then
  echo "No virtualenv found. Running install first..."
  bash "$HERE/install.sh"
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8765}"

cd "$ROOT"
echo "==> Starting backend at http://$HOST:$PORT"
exec python -m uvicorn backend.server:app --host "$HOST" --port "$PORT"
