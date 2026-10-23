# ClamAV — ایمیج رسمی + دیتابیس امضا که در زمان build گرفته می‌شود.
#
# چرا (یافتهٔ CI در ممیزی 197efa0 — ADR-0040): ایمیج رسمی clamav/clamav
# بدون دیتابیس عرضه می‌شود و در بوت اولِ هر والیوم خالی، entrypoint
# اول freshclam را اجرا می‌کند (~۲۷۰MB از database.clamav.net) و clamd
# فقط بعد از آن بالا می‌آید. CDN کلم‌انتی‌وی آی‌پی‌های دیتاسنتری/ابر
# را به‌شدت throttle می‌کند (برای UA غیر freshclam ‏403 می‌دهد و روی
# آی‌پی‌های اشتراکی CI مرتب 429/backoff می‌خورد)؛ در دو اجرای متوالی
# ‏CI روی PR #16 کانتینر حتی با پنجرهٔ سلامت ۸ دقیقه‌ای هم healthy
# نشد و کل استک (api به‌علت گیت fail-closed ‏C-01) خوابید.
#
# راه‌حل: دیتابیس یک‌بار در build گرفته و داخل لایهٔ ایمیج می‌نشیند؛
# والیوم نام‌دار در اولین اجرا از محتوای ایمیج seed می‌شود، clamd
# فوراً لود می‌کند و freshclam پس‌زمینه داخل کانتینر طبق روال عادی
# آپدیت می‌گیرد. اگر دانلود در build ممکن نباشد، build با صدای بلند
# fail می‌شود — نه این‌که استک بی‌صدا unhealthy بماند.
FROM clamav/clamav:1.4

RUN mkdir -p /var/lib/clamav \
 && chown clamav:clamav /var/lib/clamav \
 && for i in 1 2 3; do \
      runuser -u clamav -- freshclam --datadir=/var/lib/clamav && break; \
      echo "freshclam attempt $i failed — retrying" >&2; sleep 10; \
    done \
 && (ls /var/lib/clamav/main.cvd /var/lib/clamav/main.cld >/dev/null 2>&1 \
     || ls /var/lib/clamav/daily.cvd /var/lib/clamav/daily.cld >/dev/null) \
 && echo "ClamAV signature DB baked:" && ls -la /var/lib/clamav
