#!/bin/sh
# Railway api entrypoint — runs inside the container (real shell), so
# Railway's dashboard start-command parser is never involved.
# Migration first, then a bounded seed attempt, then uvicorn unconditionally:
# a seed failure or timeout must never again leave the service down.
alembic upgrade head || echo "start.sh: alembic failed, continuing to uvicorn" >&2
timeout -k 10 180 python -u -m app.seed || echo "start.sh: seed failed or timed out, continuing to uvicorn" >&2
# حفاظ: گرفتن/راستی‌آزمایی استارتاپ دارایی‌های نسخه‌دار (مانیفست +
# چک‌سام؛ URL محیطی فقط override است). ناموفق بودن هرگز استارت را
# نمی‌شکند — موتور همان ۵۰۳ صادقانه را می‌دهد.
python -u -m app.core.hifz_assets || echo "start.sh: hifz assets download failed, continuing to uvicorn" >&2
# ورکر media (صف ARQ زیرنویس/رسانه): روی Railway سرویس ورکر جداگانه‌ای
# نداریم (سقف منابع پلن trial) و این فایل فقط همان‌جا اجرا می‌شود — در
# استک compose، api با دستور uvicorn خودش بالا می‌آید و worker-media
# سرویس جداست، پس این مسیر آن‌جا هرگز اجرا نمی‌شود و اجرای دوم رخ
# نمی‌دهد. ورکر در پس‌زمینه و زیر نظر همین شل می‌چرخد (مرگش api را
# پایین نمی‌آورد و ۵ ثانیه بعد دوباره بالا می‌آید) و uvicorn همچنان
# پروسهٔ اصلیِ exec‌شده می‌ماند. خاموش‌کردن: MEDIA_WORKER=off
if [ "${MEDIA_WORKER:-on}" != "off" ]; then
  (
    while true; do
      python -u -m app.worker media || echo "start.sh: media worker exited, restarting in 5s" >&2
      sleep 5
    done
  ) &
fi
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --timeout-graceful-shutdown 30
