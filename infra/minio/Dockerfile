# MinIO — ساخت از باینری رسمی GitHub Release (نسخه و چک‌سام پین‌شده).
#
# چرا build و نه ایمیج آماده (یافتهٔ CI در ممیزی 197efa0 — ADR-0039):
# ایمیج‌های عمومی MinIO دیگر برای pull ناشناس در دسترس نیستند —
# Docker Hub ریپوی minio/minio را حذف کرده و quay.io/minio/minio هم
# 401 می‌دهد (با توکن ناشناس هم tags/list قرمز است، در حالی که ریپوهای
# عمومی دیگر quay سالم‌اند). تنها مسیر رسمیِ قابل‌اتکا، باینری همان
# release روی GitHub است؛ این‌جا با sha256 رسمیِ خود release راستی‌آزمایی
# می‌شود و نسخه دقیقاً همان پین قبلی می‌ماند.
FROM alpine:3.22

ARG MINIO_VERSION=RELEASE.2025-09-07T16-13-09Z
ARG TARGETARCH=amd64

RUN apk add --no-cache ca-certificates curl \
 && case "$TARGETARCH" in \
      amd64) SHA=7c5bd8512c6e966455b1d198209358b2d191c77a83ab377c4073281065fb855f ;; \
      arm64) SHA=5c83cd2cf151717ba0243f73e1c7802ff36e272b67144bdd7f1f7d684fd6f03d ;; \
      *) echo "unsupported arch: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /usr/local/bin/minio \
      "https://github.com/minio/minio/releases/download/${MINIO_VERSION}/minio.linux-${TARGETARCH}.${MINIO_VERSION}" \
 && echo "${SHA}  /usr/local/bin/minio" | sha256sum -c - \
 && chmod +x /usr/local/bin/minio

VOLUME /data
EXPOSE 9000 9001
ENTRYPOINT ["/usr/local/bin/minio"]
