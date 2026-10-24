"""تست m-04: سرویس بکاپ زمان‌بندی‌شده در compose — اعتبارسنجی استاتیک.

اجرای واقعی سرویس و restore از خروجی‌اش Docker می‌خواهد (در سندباکس
نیست — NOT RUN، در docs/ops/dr-drill.md ثبت شده). این تست ثابت
می‌کند سیم‌کشی درست است: سرویس هست، envهای اجباری backup.sh را
می‌گیرد، entrypoint و پین ایمیج mc سر جایشان‌اند.
"""
from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]


def test_backup_service_wired_in_prod_compose():
    compose = yaml.safe_load(
        (ROOT / "docker-compose.prod.yml").read_text(encoding="utf-8")
    )
    svc = compose["services"]["backup"]
    env = svc["environment"]
    # همان envهایی که backup.sh با :? اجباری می‌کند
    for key in (
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "POSTGRES_DB",
        "MINIO_ROOT_USER",
        "MINIO_ROOT_PASSWORD",
        "S3_BUCKET",
    ):
        assert key in env, key
    assert env["BACKUP_DIR"] == "/backups"
    volumes = " ".join(svc["volumes"])
    assert "backupdata:/backups" in volumes
    assert "docker.sock" in volumes
    assert "backupdata" in compose["volumes"]
    assert "entrypoint.sh" in " ".join(svc["entrypoint"])


def test_backup_entrypoint_and_mc_pin():
    entry = (ROOT / "infra/backup/entrypoint.sh").read_text(encoding="utf-8")
    assert "infra/backup.sh" in entry
    assert "BACKUP_AT_UTC" in entry
    backup_sh = (ROOT / "infra/backup.sh").read_text(encoding="utf-8")
    # ایمیج mc پین‌شده (قرارداد اسکریپت)
    assert "quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z" in backup_sh
    # هیچ اعتبار هاردکدی در entrypoint نیست — همه از env
    assert "PASSWORD=" not in entry.replace("MINIO_ROOT_PASSWORD", "")
