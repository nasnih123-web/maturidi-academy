#!/bin/sh
# entrypoint سرویس backup (m-04) — اجرای زمان‌بندی‌شدهٔ infra/backup.sh
# روزی یک‌بار در ساعت BACKUP_AT_UTC (پیش‌فرض 02:00 UTC).
#
# چرا حلقهٔ sleep و نه cron داخل کانتینر؟ کانتینر تک‌منظوره است و
# حلقه هیچ daemon اضافه‌ای نمی‌خواهد؛ زمان اجرا در لاگ‌ها دیده می‌شود
# و با BACKUP_RUN_ON_START=true می‌شود اجرای فوری هم گرفت (تست).
set -eu

cd /opt/maturidi
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
export BACKUP_DIR="${BACKUP_DIR:-/backups}"
AT="${BACKUP_AT_UTC:-02:00}"
HOUR="${AT%%:*}"
MIN="${AT##*:}"

run_backup() {
  echo "[backup-service] starting backup at $(date -u +%FT%TZ)"
  if ./infra/backup.sh; then
    echo "[backup-service] backup OK at $(date -u +%FT%TZ)"
  else
    echo "[backup-service] backup FAILED (exit $?) at $(date -u +%FT%TZ)" >&2
  fi
}

if [ "${BACKUP_RUN_ON_START:-false}" = "true" ]; then
  run_backup
fi

while true; do
  now="$(date -u +%s)"
  target="$(date -u -d "today $HOUR:$MIN" +%s 2>/dev/null || date -u -d "today ${HOUR}:${MIN}" +%s)"
  if [ "$target" -le "$now" ]; then
    target="$(date -u -d "tomorrow $HOUR:$MIN" +%s 2>/dev/null || date -u -d "tomorrow ${HOUR}:${MIN}" +%s)"
  fi
  wait_s=$((target - now))
  echo "[backup-service] next backup at $(date -u -d "@$target" +%FT%TZ) (in ${wait_s}s)"
  sleep "$wait_s"
  run_backup
done
