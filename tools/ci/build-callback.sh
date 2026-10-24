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

# Pass 4 / B2: تلاش محدود با backoff — خرابیِ گذرای یک فایل، کل
# حلقه را نمی‌کشد؛ خلاصهٔ هر فایل در پایان چاپ می‌شود و exit code
# فقط وقتی غیرصفر است که فایلی واقعاً ثبت نشده باشد (اجرای دوباره،
# به‌لطف idempotencyِ POST /releases روی artifact_key، فایل‌های
# موفق را دوباره ثبت نمی‌کند).
retry_with_backoff() {
  local attempt=0 max_attempts=3 delay=2
  while [ "$attempt" -lt "$max_attempts" ]; do
    attempt=$((attempt + 1))
    if "$@"; then return 0; fi
    if [ "$attempt" -lt "$max_attempts" ]; then
      echo "Attempt $attempt/$max_attempts failed — retrying in ${delay}s..."
      sleep "$delay"
      delay=$((delay * 2))
    fi
  done
  return 1
}

# ثبت یک فایل: 0=موفق، 1=خطای گذرا (قابل retry)، 2=conflict واقعی
# (همان artifact_key با متادیتای متفاوت — retry بی‌فایده است).
register_release() {
  local body="$1" code
  code="$(curl -sS -o /tmp/cb_resp.json -w "%{http_code}" -X POST "${BUILDS_API_BASE_URL%/}/api/v1/admin/builds/releases" \
    -H "Content-Type: application/json" \
    -H "X-Build-Service-Token: $BUILDS_SERVICE_TOKEN" \
    -d "$body")" || return 1
  case "$code" in
    200|201) return 0 ;;
    409)
      echo "::error::Release conflict (same artifact_key, different metadata) — not retried."
      head -c 500 /tmp/cb_resp.json; echo
      return 2
      ;;
    *)
      echo "API returned HTTP $code:"
      head -c 500 /tmp/cb_resp.json; echo
      return 1
      ;;
  esac
}

registered=0
succeeded_files=()
failed_files=()
for f in *; do
  [ -f "$f" ] || continue
  case "$f" in
    "$CB_MANIFEST"|SHA256SUMS*) continue ;;
  esac
  key="builds/${CB_PLATFORM}/${CB_VERSION}/${CB_BUILD_NUMBER}/${f}"
  size="$(wc -c < "$f" | tr -d ' ')"
  sha="$(sha256_of "$f")"
  echo "Uploading $f -> s3://${BUILDS_S3_BUCKET}/${key} (${size} bytes, sha256 ${sha})"
  if ! retry_with_backoff aws s3 cp --endpoint-url "$BUILDS_S3_ENDPOINT" --only-show-errors \
      "$f" "s3://${BUILDS_S3_BUCKET}/${key}"; then
    echo "::error::Upload failed after retries: $f"
    failed_files+=("$f (upload)")
    continue
  fi
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
  attempt=0; reg_ok=0; reg_conflict=0
  while [ "$attempt" -lt 3 ]; do
    attempt=$((attempt + 1))
    # نکته: $? پس از if همیشه ۰ است — وضعیت را مستقیم می‌گیریم.
    # (فراخوان در فهرست || از set -e معاف است.)
    rc=0
    register_release "$body" || rc=$?
    if [ "$rc" -eq 0 ]; then reg_ok=1; break; fi
    if [ "$rc" -eq 2 ]; then reg_conflict=1; break; fi
    if [ "$attempt" -lt 3 ]; then sleep $((2 ** attempt)); fi
  done
  if [ "$reg_ok" -eq 1 ]; then
    registered=$((registered + 1))
    succeeded_files+=("$f")
  elif [ "$reg_conflict" -eq 1 ]; then
    failed_files+=("$f (conflict)")
  else
    echo "::error::Registration failed after retries: $f"
    failed_files+=("$f (register)")
  fi
done

echo "Build callback summary:"
echo "  succeeded (${#succeeded_files[@]}): ${succeeded_files[*]:-none}"
echo "  failed (${#failed_files[@]}): ${failed_files[*]:-none}"
if [ "${#failed_files[@]}" -gt 0 ]; then
  echo "::error::Build callback: ${#failed_files[@]} artifact(s) not registered — rerun recovers the succeeded ones via artifact_key idempotency."
  exit 1
fi
if [ "$registered" -eq 0 ]; then
  echo "::error::Build callback found no artifact files in $CB_ARTIFACT_DIR — nothing registered."
  exit 1
fi
echo "Build callback done: $registered artifact(s) uploaded to MinIO and registered with the API."
