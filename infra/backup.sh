#!/usr/bin/env bash
# فاز ۲ — بکاپ خودکار روزانهٔ PostgreSQL + MinIO
# اجرا در cron هاست: 0 2 * * * /path/to/infra/backup.sh
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/maturidi}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
DATE="$(date +%F)"

mkdir -p "$BACKUP_DIR"

echo "[backup] PostgreSQL dump → $BACKUP_DIR/pg-$DATE.sql.gz"
docker compose exec -T postgres pg_dump -U maturidi maturidi \
  | gzip > "$BACKUP_DIR/pg-$DATE.sql.gz"

echo "[backup] MinIO mirror → $BACKUP_DIR/minio-$DATE"
docker compose exec -T minio mc mirror --overwrite /data "$BACKUP_DIR/minio-$DATE" 2>/dev/null \
  || echo "[backup] WARN: mc mirror skipped (configure MinIO client alias)"

echo "[backup] pruning backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -maxdepth 1 -name 'pg-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -maxdepth 1 -name 'minio-*' -mtime +"$RETENTION_DAYS" -exec rm -rf {} +

echo "[backup] done: $DATE"
# تست بازیابی کامل در فاز ۱۷ انجام می‌شود (قرارداد فاز ۰).
