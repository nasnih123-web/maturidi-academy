#!/usr/bin/env bash
# bootstrap.sh — نصب و اجرای خودکار «آکادمی ماتریدی» (Maturidi Academy)
#
#   ./bootstrap.sh
#
# این اسکریپت همه‌چیز را آماده می‌کند:
#   ۱) بررسی پیش‌نیازها (Python 3.14 ، Node 24+ ، npm)
#   ۲) ساخت venv و نصب وابستگی‌های API + اجرای migration + seed اولیه
#   ۳) npm install برای وب و CRM (فقط اگر قبلاً نصب نشده باشند)
#   ۴) اجرای هم‌زمان هر سه سرویس و نمایش آدرس‌ها
#
# خروج با Ctrl+C هر سه سرویس را می‌بندد. اجرای دوبارهٔ اسکریپت امن است.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOGDIR="/tmp/maturidi-dev"
mkdir -p "$LOGDIR"

say()  { printf '\n\033[1;32m>>> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!! %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mخطا: %s\033[0m\n' "$*"; exit 1; }

# ---------- ۱) پیش‌نیازها ----------
say "بررسی پیش‌نیازها…"

# این پروژه به Python 3.14 نیاز دارد (Phase-1 v1.1.0: کل استک
# requirements.txt روی 3.14 پین و راستی‌آزمایی شده است — مثل bootstrap.ps1).
command -v python3 >/dev/null || die "python3 پیدا نشد. لطفاً Python 3.14 نصب کنید: https://www.python.org/downloads/"
PYV="$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
python3 -c 'import sys; sys.exit(0 if sys.version_info[:2] == (3, 14) else 1)' \
  || die "نسخهٔ Python شما $PYV است؛ این پروژه به Python 3.14 نیاز دارد: https://www.python.org/downloads/"

# خط مبنای Node نسخهٔ 24 است (.nvmrc) — سیاست یکسان با bootstrap.ps1:
# نسخه‌های قدیمی‌تر از 24 رد می‌شوند.
command -v node >/dev/null || die "node پیدا نشد. لطفاً Node.js 24 یا جدیدتر نصب کنید: https://nodejs.org/"
NODEV="$(node -p 'process.versions.node')"
node -e 'const [m]=process.versions.node.split(".").map(Number); if (m < 24) process.exit(1)' \
  || die "نسخهٔ Node شما $NODEV است؛ این پروژه به Node 24 یا جدیدتر نیاز دارد (خط مبنای .nvmrc)."
command -v npm >/dev/null || die "npm پیدا نشد (همراه Node.js نصب می‌شود)."

echo "  Python $PYV  ✓    Node $NODEV  ✓"

# ---------- ۲) بک‌اند (API) ----------
say "آماده‌سازی بک‌اند…"
if [ ! -f "$ROOT/apps/api/dev.db" ]; then
  echo "نصب اول است — یک مدیر ارشد برای ورود به CRM می‌سازیم."
  read -rp "  ایمیل مدیر [admin@example.com]: " ADMIN_EMAIL
  ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
  read -rsp "  رمز عبور مدیر (حداقل ۸ کاراکتر): " ADMIN_PASSWORD; echo
  [ "${#ADMIN_PASSWORD}" -ge 8 ] || die "رمز عبور باید حداقل ۸ کاراکتر باشد."
  ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    bash "$ROOT/apps/api/setup.sh"
else
  echo "  دیتابیس موجود است؛ فقط migrationهای جدید اجرا می‌شود."
  # صداقت وضعیت: شکست setup/migration نباید پنهان شود — بدون || true و
  # بدون بلعیدن خروجی؛ خطا بوت‌استرپ را با پیام روشن متوقف می‌کند.
  bash "$ROOT/apps/api/setup.sh" \
    || die "اجرای setup (نصب وابستگی‌ها/migration/seed) ناموفق بود — خروجی بالا را بررسی کنید؛ بوت‌استرپ متوقف شد."
fi

# ---------- ۳) فرانت‌اندها ----------
say "نصب وابستگی‌های وب…"
if [ ! -d "$ROOT/apps/web/node_modules" ]; then
  (cd "$ROOT/apps/web" && npm install)
else
  echo "  قبلاً نصب شده ✓"
fi

say "نصب وابستگی‌های CRM…"
if [ ! -d "$ROOT/apps/crm/node_modules" ]; then
  (cd "$ROOT/apps/crm" && npm install)
else
  echo "  قبلاً نصب شده ✓"
fi

# ---------- ۴) اجرا ----------
say "اجرای سرویس‌ها…"

cleanup() {
  echo; say "بستن سرویس‌ها…"
  kill "$API_PID" "$WEB_PID" "$CRM_PID" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

(cd "$ROOT/apps/api" && .venv/bin/uvicorn app.main:app --reload --port 8000) \
  >"$LOGDIR/api.log" 2>&1 &
API_PID=$!

(cd "$ROOT/apps/web" && npm run dev -- --port 3000) \
  >"$LOGDIR/web.log" 2>&1 &
WEB_PID=$!

(cd "$ROOT/apps/crm" && npm run dev -- --port 5173 --host 127.0.0.1) \
  >"$LOGDIR/crm.log" 2>&1 &
CRM_PID=$!

wait_for() { # wait_for <name> <url> <timeout_s>
  local name="$1" url="$2" timeout="$3" i=0
  printf '  در انتظار %s' "$name"
  until curl -sf -o /dev/null "$url" 2>/dev/null; do
    i=$((i + 2)); printf '.'
    if [ "$i" -ge "$timeout" ]; then
      echo; warn "$name بالا نیامد؛ لاگ: $LOGDIR/$(echo "$name" | tr '[:upper:]' '[:lower:]').log"
      return 1
    fi
    sleep 2
  done
  echo " ✓"
}

wait_for "API" "http://127.0.0.1:8000/health" 90
wait_for "CRM" "http://127.0.0.1:5173/" 120
wait_for "WEB" "http://127.0.0.1:3000/fa" 240

say "همه‌چیز آماده است 🎉"
cat <<'EOF'

  ┌──────────────────────────────────────────────────┐
  │  وب (فارسی) :  http://localhost:3000/fa           │
  │  وب (عربی)  :  http://localhost:3000/ar           │
  │  وب (انگلیسی): http://localhost:3000/en           │
  │  CRM        :  http://localhost:5173              │
  │  مستندات API:  http://localhost:8000/docs         │
  └──────────────────────────────────────────────────┘

  ورود به CRM با همان ایمیل و رمز مدیری که ساختید.
  لاگ‌ها: /tmp/maturidi-dev/  (api.log ، web.log ، crm.log)
  توقف همه: Ctrl+C
EOF

# باز کردن خودکار مرورگر (اگر ممکن بود)
if command -v xdg-open >/dev/null; then xdg-open http://localhost:3000/fa >/dev/null 2>&1 &
elif command -v open >/dev/null; then open http://localhost:3000/fa >/dev/null 2>&1 & fi

wait
