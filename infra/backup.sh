#!/usr/bin/env bash
# فاز ۲ — بکاپ خودکار روزانهٔ PostgreSQL + MinIO (بازبینی Track 1 / §۱۷)
#
# اجرا در cron هاست (از ریشهٔ ریپو):
#   0 2 * * * cd /opt/maturidi && COMPOSE_FILE=docker-compose.prod.yml ./infra/backup.sh
#
# قراردادهای این اسکریپت:
# ۱) همهٔ اعتبارات (کاربر/رمز دیتابیس، کاربر/رمز MinIO، نام bucket) از env
#    می‌آیند (همان .env.prod) — هیچ هاردکدی نیست و نبودنشان فیلِ بلند است.
# ۲) کد خروجِ هر مرحله صریح چک می‌شود؛ هیچ مرحله‌ای «ساکت» رد نمی‌شود و
#    پیام «done» فقط وقتی چاپ می‌شود که همهٔ مراحل واقعاً موفق بوده‌اند.
# ۳) بکاپ MinIO با کانتینر یک‌بارمصرف mc انجام می‌شود — ایمیج minio سرور
#    دستور mc ندارد، پس نسخهٔ قبلی (exec روی سرویس minio) همیشه ساکت فیل
#    می‌شد و بکاپ فایل عملاً گرفته نمی‌شد.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/maturidi}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
# ایمیج mc پین‌شده (quay.io جایگزین Docker Hub برای minio/mc است)؛ در صورت
# نیاز override کنید: MC_IMAGE=quay.io/minio/mc:<tag> ./infra/backup.sh
MC_IMAGE="${MC_IMAGE:-quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z}"
DATE="$(date +%F)"

# --- اعتبارات اجباری: نبودنشان = فیل بلند با پیام روشن، نه مقدار پیش‌فرض کور ---
: "${POSTGRES_USER:?backup.sh: POSTGRES_USER must be set (same value as compose env)}"
: "${POSTGRES_PASSWORD:?backup.sh: POSTGRES_PASSWORD must be set}"
: "${POSTGRES_DB:?backup.sh: POSTGRES_DB must be set}"
: "${MINIO_ROOT_USER:?backup.sh: MINIO_ROOT_USER must be set}"
: "${MINIO_ROOT_PASSWORD:?backup.sh: MINIO_ROOT_PASSWORD must be set}"
: "${S3_BUCKET:?backup.sh: S3_BUCKET must be set (must match the app S3_BUCKET)}"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "[backup] FATAL: compose file not found: $COMPOSE_FILE (run from repo root)" >&2
  exit 2
fi

mkdir -p "$BACKUP_DIR"

fail() {
  echo "[backup] FATAL: $1" >&2
  exit 1
}

DC="docker compose -f $COMPOSE_FILE"

# ---------------------------------------------------------- مرحلهٔ ۱: دیتابیس
echo "[backup] step 1/4: PostgreSQL dump (db=$POSTGRES_DB) → $BACKUP_DIR/pg-$DATE.sql.gz"
PGDUMP_ERR="$BACKUP_DIR/pg-$DATE.err"
# pipefail فعال است: خطای pg_dump یا gzip هر دو باعث فیل می‌شوند.
# رمز با -e به فرایند داخل کانتینر داده می‌شود (در خط فرمان هاست دیده نمی‌شود).
if ! $DC exec -T -e "PGPASSWORD=$POSTGRES_PASSWORD" \
    postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" 2>"$PGDUMP_ERR" \
    | gzip > "$BACKUP_DIR/pg-$DATE.sql.gz"; then
  cat "$PGDUMP_ERR" >&2
  fail "pg_dump failed (compose=$COMPOSE_FILE service=postgres db=$POSTGRES_DB user=$POSTGRES_USER)"
fi
rm -f "$PGDUMP_ERR"
[ -s "$BACKUP_DIR/pg-$DATE.sql.gz" ] || fail "pg_dump produced an empty file"
gzip -t "$BACKUP_DIR/pg-$DATE.sql.gz" || fail "pg_dump output failed gzip integrity check"
sha256sum "$BACKUP_DIR/pg-$DATE.sql.gz" > "$BACKUP_DIR/pg-$DATE.sql.gz.sha256" \
  || fail "could not write pg dump manifest"
echo "[backup] step 1/4: OK"

# ---------------------------------------------------------- مرحلهٔ ۲: MinIO
echo "[backup] step 2/4: MinIO mirror (bucket=$S3_BUCKET) → $BACKUP_DIR/minio-$DATE"
MINIO_OUT="$BACKUP_DIR/minio-$DATE"
mkdir -p "$MINIO_OUT"
# کانتینر یک‌بارمصرف mc روی همان شبکهٔ compose؛ alias با mc alias set ساخته
# می‌شود تا رمزهای دارای کاراکتر خاص هم درست کار کنند.
if ! $DC run --rm \
    -e "MC_MINIO_USER=$MINIO_ROOT_USER" \
    -e "MC_MINIO_PASSWORD=$MINIO_ROOT_PASSWORD" \
    -e "MC_BUCKET=$S3_BUCKET" \
    -v "$MINIO_OUT:/out" \
    --entrypoint sh "$MC_IMAGE" -c \
    'mc alias set src http://minio:9000 "$MC_MINIO_USER" "$MC_MINIO_PASSWORD" >/dev/null && mc mirror --overwrite "src/$MC_BUCKET" /out'; then
  rm -rf "$MINIO_OUT"
  fail "MinIO mirror failed (mc image=$MC_IMAGE bucket=$S3_BUCKET) — partial output removed"
fi
if [ -z "$(ls -A "$MINIO_OUT")" ]; then
  echo "[backup] NOTE: bucket $S3_BUCKET mirrored empty (no objects)"
fi
echo "[backup] step 2/4: OK"

# ---------------------------------------------------------- مرحلهٔ ۳: مانیفست
echo "[backup] step 3/4: SHA-256 manifests"
(cd "$BACKUP_DIR" && find "minio-$DATE" -type f -exec sha256sum {} + > "minio-$DATE.sha256") \
  || fail "could not write minio manifest"
echo "[backup] step 3/4: OK"

# ---------------------------------------------------------- مرحلهٔ ۴: هرس
echo "[backup] step 4/4: pruning backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -maxdepth 1 -name 'pg-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete \
  || fail "pruning pg dumps failed"
find "$BACKUP_DIR" -maxdepth 1 -name 'pg-*.sql.gz.sha256' -mtime +"$RETENTION_DAYS" -delete \
  || fail "pruning pg manifests failed"
find "$BACKUP_DIR" -maxdepth 1 -name 'minio-*' -mtime +"$RETENTION_DAYS" -exec rm -rf {} + \
  || fail "pruning minio mirrors failed"
echo "[backup] step 4/4: OK"

echo "[backup] done: $DATE — all 4 steps succeeded"
# تمرین بازیابی واقعی (restore به scratch + راستی‌آزمایی) حداقل فصلی یک‌بار —
# قرارداد §۱۷.۳؛ دستورالعمل: docs/ops/disaster-recovery.md
