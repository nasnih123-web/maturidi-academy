# فاز ۱۷ — Dockerfile production برای API (FastAPI)
#
# نکات Track B (hardening/audit-pass-1):
# - اجرا با کاربر غیرریشه (یافتهٔ semgrep: dockerfile.security.missing-user)
# - فایل‌های alembic هم کپی می‌شوند چون سرویس یک‌بارهٔ `migrate` در
#   docker-compose.prod.yml در startup دستور `alembic upgrade head` را اجرا
#   می‌کند (بدون آن‌ها کانتینر migrate crash می‌کرد)
FROM python:3.12-slim
WORKDIR /code

# کاربر غیرریشه برای runtime
RUN useradd -m -u 10001 appuser

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
# --- برای migration در startup (دستور api در docker-compose.prod.yml) ---
COPY alembic.ini ./
COPY alembic ./alembic

# دایرکتوری runtime فایل‌های static (فونت‌های آپلودشده از CRM) باید برای
# appuser قابل‌نوشتن باشد — در production روی volume سوار می‌شود
RUN mkdir -p /code/static && chown -R appuser:appuser /code

USER appuser

# نکته: HEALTHCHECK عمداً این‌جا نیست — همین ایمیج برای worker-های ARQ هم
# استفاده می‌شود (پورت 8000 ندارند). هلث‌چک فقط در compose برای سرویس api.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
