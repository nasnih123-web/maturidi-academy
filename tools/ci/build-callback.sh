#!/usr/bin/env bash
# build-callback.sh — بستن حلقهٔ بیلد (B-01، ADR-0025).
#
# پس از ساختِ موفق در workflow (mobile.yml / desktop.yml) صدا زده می‌شود:
#   ۱) هر فایل خروجی را به باکت builds در MinIO/S3 می‌فرستد
#      (کلید: builds/<platform>/<version>/<build_number>/<file>)
#   ۲) متادیتای انتشار را با توکن سرویس به API ثبت می‌کند:
#      POST <BUILDS_API_BASE_URL>/api/v1/admin/builds/releases
#      هدر: X-Build-Service-Token: <BUILDS_SERVICE_TOKEN>
# API از روی artifact_key، برای هر release یک download_url امضاشده و
# کوتاه‌عمر می‌سازد و نگهداری «۱۰ بیلد آخر هر پلتفرم» را اعمال می‌کند.
#
# ورودی‌ها (env از طرف workflow):
#   CB_PLATFORM      android | ios | desktop            (الزامی)
#   CB_VERSION       نسخهٔ انتشار مثل 1.1.0              (الزامی)
#   CB_BUILD_NUMBER  شمارهٔ بیلد یکتا برای این اجرا       (الزامی)
#   CB_ARTIFACT_DIR  پوشهٔ فایل‌های خروجی + مانیفست       (الزامی)
#   CB_MANIFEST      نام فایل مانیفست داخل پوشه (اختیاری؛ متادیتا)
#   CB_SIGNED        true | false (پیش‌فرض false — صادقانه)
#
# Secretهای لازم (GitHub repo Secrets؛ نبود هرکدام = ردّ صادقانه با
# هشدار و exit 0 — بیلد جعلیِ «ثبت‌شده» هرگز گزارش نمی‌شود):
#   BUILDS_API_BASE_URL, BUILDS_SERVICE_TOKEN,
#   BUILDS_S3_ENDPOINT, BUILDS_S3_BUCKET,
#   BUILDS_S3_ACCESS_KEY, BUILDS_S3_SECRET_KEY
#   BUILDS_S3_REGION (اختیاری؛ پیش‌فرض us-east-1)
set -euo pipefail

: "${CB_PLATFORM:?CB_PLATFORM is required}"
: "${CB_VERSION:?CB_VERSION is required}"
: "${CB_BUILD_NUMBER:?CB_BUILD_NUMBER is required}"
: "${CB_ARTIFACT_DIR:?CB_ARTIFACT_DIR is required}"
CB_SIGNED="${CB_SIGNED:-false}"
CB_MANIFEST="${CB_MANIFEST:-}"
export CB_PLATFORM CB_VERSION CB_BUILD_NUMBER CB_SIGNED CB_MANIFEST

missing=()
for v in BUILDS_API_BASE_URL BUILDS_SERVICE_TOKEN BUILDS_S3_ENDPOINT \
         BUILDS_S3_BUCKET BUILDS_S3_ACCESS_KEY BUILDS_S3_SECRET_KEY; do
  if [ -z "${!v:-}" ]; then missing+=("$v"); fi
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "::warning::Build callback secrets not configured (${missing[*]}) — release registration SKIPPED; the artifact exists only as a workflow artifact / GitHub Release asset. Configure the BUILDS_* repo secrets to close the loop (docs/ops/APK_BUILD_GUIDE.md)."
  exit 0
fi

export AWS_ACCESS_KEY_ID="$BUILDS_S3_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$BUILDS_S3_SECRET_KEY"
export AWS_DEFAULT_REGION="${BUILDS_S3_REGION:-us-east-1}"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1;
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

cd "$CB_ARTIFACT_DIR"
shopt -s nullglob
registered=0
for f in *; do
  [ -f "$f" ] || continue
  case "$f" in
    "$CB_MANIFEST"|SHA256SUMS*) continue ;;
  esac
  key="builds/${CB_PLATFORM}/${CB_VERSION}/${CB_BUILD_NUMBER}/${f}"
  size="$(wc -c < "$f" | tr -d ' ')"
  sha="$(sha256_of "$f")"
  echo "Uploading $f -> s3://${BUILDS_S3_BUCKET}/${key} (${size} bytes, sha256 ${sha})"
  aws s3 cp --endpoint-url "$BUILDS_S3_ENDPOINT" --only-show-errors \
    "$f" "s3://${BUILDS_S3_BUCKET}/${key}"
  body="$(CB_FILE="$f" CB_KEY="$key" CB_SIZE="$size" CB_SHA="$sha" node -e '
    const fs = require("fs");
    let manifest = {};
    const mf = process.env.CB_MANIFEST;
    if (mf && fs.existsSync(mf)) {
      try { manifest = JSON.parse(fs.readFileSync(mf, "utf8")); } catch { manifest = {}; }
    }
    const meta = {
      ...manifest,
      filename: process.env.CB_FILE,
      commit_sha: process.env.GITHUB_SHA || null,
      workflow_run: process.env.GITHUB_REPOSITORY
        ? "https://github.com/" + process.env.GITHUB_REPOSITORY +
          "/actions/runs/" + (process.env.GITHUB_RUN_ID || "")
        : null,
    };
    process.stdout.write(JSON.stringify({
      platform: process.env.CB_PLATFORM,
      version: process.env.CB_VERSION,
      build_number: process.env.CB_BUILD_NUMBER,
      artifact_key: process.env.CB_KEY,
      file_size_bytes: Number(process.env.CB_SIZE),
      sha256: process.env.CB_SHA,
      signed: process.env.CB_SIGNED === "true",
      build_metadata: meta,
    }));
  ')"
  echo "Registering release: platform=$CB_PLATFORM version=$CB_VERSION build=$CB_BUILD_NUMBER file=$f"
  curl -fsS -X POST "${BUILDS_API_BASE_URL%/}/api/v1/admin/builds/releases" \
    -H "Content-Type: application/json" \
    -H "X-Build-Service-Token: ${BUILDS_SERVICE_TOKEN}" \
    -d "$body" >/dev/null
  registered=$((registered + 1))
done

if [ "$registered" -eq 0 ]; then
  echo "::error::Build callback found no artifact files in $CB_ARTIFACT_DIR — nothing registered."
  exit 1
fi
echo "Build callback done: $registered artifact(s) uploaded to MinIO and registered with the API."
