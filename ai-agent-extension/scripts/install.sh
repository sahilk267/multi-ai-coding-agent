#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
VENV="$ROOT/backend/.venv"

PY="${PYTHON:-python3}"
if ! command -v "$PY" >/dev/null 2>&1; then
  if command -v python >/dev/null 2>&1; then PY=python
  else
    echo "Python 3 not found. Install Python 3.10+ and re-run." >&2
    exit 1
  fi
fi

echo "==> Creating virtualenv at $VENV"
"$PY" -m venv "$VENV"

# shellcheck disable=SC1091
source "$VENV/bin/activate"

echo "==> Upgrading pip"
python -m pip install --upgrade pip wheel

echo "==> Installing backend requirements"
pip install -r "$ROOT/backend/requirements.txt"

mkdir -p "$ROOT/logs" "$ROOT/projects"

echo
echo "Install complete."
echo "Run the backend with: ai-agent/scripts/run.sh"
echo "Then load ai-agent/extension/ as an unpacked extension in chrome://extensions"
