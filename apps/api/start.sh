#!/bin/sh
# Railway api entrypoint — runs inside the container (real shell), so
# Railway's dashboard start-command parser is never involved.
# Migration first, then a bounded seed attempt, then uvicorn unconditionally:
# a seed failure or timeout must never again leave the service down.
alembic upgrade head || echo "start.sh: alembic failed, continuing to uvicorn" >&2
timeout -k 10 180 python -u -m app.seed || echo "start.sh: seed failed or timed out, continuing to uvicorn" >&2
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --timeout-graceful-shutdown 30
