.PHONY: help install run test check smoke verify clean hooks unhooks

PY ?= python3
VENV ?= .venv
ACTIVATE = . $(VENV)/bin/activate

help:
        @echo "Targets:"
        @echo "  install  - create venv and install backend deps"
        @echo "  run      - launch FastAPI backend on 127.0.0.1:8765"
        @echo "  test     - run extension unit tests (Node)"
        @echo "  check    - run extension test + selector audit + config snapshot"
        @echo "  smoke    - run end-to-end backend smoke test (backend must be running)"
        @echo "  verify   - run 'check' + (if venv exists and backend is up) 'smoke'"
        @echo "  hooks    - install git pre-push hook that runs 'make verify'"
        @echo "  unhooks  - uninstall git hooks"
        @echo "  clean    - remove venv, __pycache__, logs"

install:
        $(PY) -m venv $(VENV)
        $(ACTIVATE) && pip install --upgrade pip && pip install -r backend/requirements.txt
        @echo "installed. run 'make run' next."

run:
        @test -d $(VENV) || (echo "venv missing — run 'make install' first" && exit 1)
        $(ACTIVATE) && python -m uvicorn backend.server:app --host 127.0.0.1 --port 8000

test:
        cd extension && npm test

check:
        cd extension && npm run check

smoke:
        @test -d $(VENV) || (echo "venv missing — run 'make install' first" && exit 1)
        $(ACTIVATE) && python -m backend.test_smoke

verify:
        @set -e; \
        echo ">>> extension check"; \
        $(MAKE) --no-print-directory check; \
        if [ ! -d $(VENV) ]; then \
                echo ">>> backend smoke skipped: no venv (run 'make install' to enable)"; \
                exit 0; \
        fi; \
        if ! curl -fsS http://127.0.0.1:8000/ > /dev/null 2>&1; then \
                echo ">>> backend smoke skipped: backend not reachable on 127.0.0.1:8000 (run 'make run' in another terminal)"; \
                exit 0; \
        fi; \
        echo ">>> backend smoke"; \
        $(MAKE) --no-print-directory smoke

hooks:
        git config core.hooksPath ai-agent/.githooks
        @echo "git hooks installed: pre-push -> make verify"
        @echo "bypass once with: git push --no-verify"

unhooks:
        git config --unset core.hooksPath || true
        @echo "git hooks uninstalled"

clean:
        rm -rf $(VENV) logs/*.log
        find backend -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
