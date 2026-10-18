#!/usr/bin/env bash
# بوت‌استرپ فاز ۱: venv، نصب وابستگی‌ها، migration، ساخت super_admin و seed اولیه.
#
#   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='...' ./setup.sh
#
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo ">>> ساخت venv..."
  python3 -m venv .venv
fi

echo ">>> نصب وابستگی‌ها..."
.venv/bin/pip install -q --default-timeout=180 --retries=10 -r requirements.txt

echo ">>> اجرای migrationها..."
.venv/bin/alembic upgrade head

echo ">>> ساخت super_admin و seed اولیه..."
.venv/bin/python -m app.seed

echo ">>> تمام شد. اجرا:"
echo "    .venv/bin/uvicorn app.main:app --reload --port 8000"
