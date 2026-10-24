# ذخیرهٔ فایل — چرخهٔ عمر و سیاست مهاجرت (Track 2 / §۱۲)

انتزاع: `apps/api/app/core/storage.py` — `StorageProvider` (قرارداد §۶).
انتخاب پیاده‌سازی config-driven است: `STORAGE_PROVIDER=local|s3|minio`
(`apps/api/app/core/config.py`). در production باید `s3` باشد
(`.env.prod.example`)؛ مقادیر S3 بد → `get_storage()` در startup با
`RuntimeError` صریح fail می‌کند، نه fallback خاموش.

## endpoint داخلی در برابر عمومی (یافتهٔ ۱ — نشت آدرس داخلی به مرورگر)

`S3StorageProvider` دو آدرس جدا دارد:

| متغیر | مصرف | مثال production |
|---|---|---|
| `S3_ENDPOINT` | عملیات سمت‌سرور: put/delete/read/ensure_bucket | `http://minio:9000` (درون شبکهٔ compose) |
| `S3_ENDPOINT_PUBLIC` | امضای presigned URLهایی که به مرورگر داده می‌شود | `https://files.example.com` |

- امضای presigned URL خالصاً محلی است (بدون هیچ فراخوانی شبکه‌ای)، پس
  کلاینت «عمومی» هیچ‌وقت واقعاً به جایی وصل نمی‌شود؛ فقط هاستِ داخل URL
  را تعیین می‌کند.
- هاست داخلی **هرگز** در URL مرورگر قرار نمی‌گیرد: `get_presigned_url`
  همیشه با کلاینت endpoint عمومی امضا می‌کند.
- اگر `S3_ENDPOINT_PUBLIC` خالی باشد، همان `S3_ENDPOINT` استفاده می‌شود
  (سازگاری عقب‌رو — فقط وقتی درست است که هاست داخلی از مرورگر هم قابل
  دسترس باشد، مثل dev).
- در production اگر هاستِ مؤثرِ presigned URL داخلی باشد
  (`minio`، `localhost`، `127.*`، `*.local` و...)، بوت با خطای صریح فیل
  می‌شود و از اپراتور `S3_ENDPOINT_PUBLIC` مرورگر-قابل‌دسترس خواسته می‌شود.
- bucket همیشه **خصوصی** می‌ماند (بدون policy عمومی)؛ دسترسی فقط با
  presigned URL کوتاه‌مدت (پیش‌فرض ۳۰۰ ثانیه) و per-file است — هیچ‌چیز
  ناامنانه public نمی‌شود.

## ساخت bucket در deploy تازه (یافتهٔ ۲)

- `S3StorageProvider.ensure_bucket()` — idempotent: اگر bucket نباشد
  می‌سازد، اگر باشد هیچ‌کاری نمی‌کند (race هم‌زمان با
  `BucketAlreadyOwnedByYou` تحمل می‌شود).
- در startup اپ (`lifespan` در `apps/api/app/main.py` → `ensure_storage_ready()`)
  فراخوانی می‌شود؛ خطای اتصال به MinIO = فیلِ بلند با پیام قابل‌تشخیص
  (endpoint و bucket، بدون secret) — هرگز موفقیت ساکت، و بدون crash-loop
  بی‌تشخیص (پیام می‌گوید کدام endpoint و چرا).
- در dev/test مرحلهٔ شبکه‌ای انجام نمی‌شود تا توسعه بدون MinIO هم کار کند.

## قرارداد اعتبارسنجی startup در production (یافته‌های ۴ و ۸)

وقتی `STORAGE_PROVIDER=s3` (یا نام مستعار `minio`) و `APP_ENV=production`:

1. اعتبارسنجی استاتیک (`_validate_s3_settings`): قالب endpoint/bucket/کلیدها.
2. نگهبان secrets (`assert_production_secrets_ok` → `s3_production_problems`):
   بدون الگوی `CHANGE_ME*` (از جمله `CHANGE_ME__generate_a_random_secret`)،
   بدون کلید ضعیف/پیش‌فرض (`minioadmin` و...)، `s3_secret_key` حداقل ۳۲
   کاراکتر، بدون endpoint نمایشی (`localhost`/`example.*` در production)،
   بدون bucket نمایشی، و بدون نشت هاست داخلی به presigned URL.
3. handshake واقعی: `ensure_bucket()` به MinIO وصل می‌شود؛ هر خطایی =
   امتناع از بوت با پیام روشن.

هر سه مرحله fail-fast هستند: با config بد یا MinIOِ در دسترس‌نبودن،
سرویس api بالا **نمی‌آید** (exit غیرصفر → در compose/log بلند معلوم است).

## راز امضای URLها و چرخش آن (FIX3-02 — ADR-0049)

امضای HMAC روی URLهای دانلودِ provider محلی (و هر مسیری که از
`LocalStorageProvider.get_presigned_url` می‌گذرد: کتابخانه، گواهی
LMS، دانلود عمومی و URLهای بیلد وقتی provider محلی است) با راز
اختصاصی `STORAGE_SIGNING_SECRET` انجام می‌شود — **مستقل از
`JWT_SECRET`** تا نشت یکی از این دو راز، سامانهٔ دیگر را نیندازد.
(در provider ‏S3 امضا SigV4 خود MinIO است و به این راز کاری ندارد.)

قواعد نگهبان در production/staging (`assert_production_secrets_ok`):

- `STORAGE_SIGNING_SECRET` الزامی است؛ خالی/placeholder/کوتاه‌تر از
  ۳۲ کاراکتر/مقدار ضعیف شناخته‌شده = امتناع از بوت.
- برابری با `JWT_SECRET` یا `ENCRYPTION_KEY` ممنوع است (استفادهٔ
  مجدد از راز).
- `STORAGE_SIGNING_SECRET_PREVIOUS` اختیاری و فقط برای پنجرهٔ چرخش
  است؛ اگر پر باشد باید قوی و متفاوت از کلید جاری باشد.

**ران‌بوک چرخش (بدون قطعی):**

1. راز تازه بسازید: `python -c "import secrets; print(secrets.token_urlsafe(43))"`
2. در secrets manager/env مقدار فعلی را به
   `STORAGE_SIGNING_SECRET_PREVIOUS` منتقل و مقدار تازه را در
   `STORAGE_SIGNING_SECRET` بگذارید؛ سرویس را redeploy کنید.
   از این لحظه امضاهای تازه با کلید تازه ساخته می‌شوند و
   راستی‌آزمایی هر دو کلید را می‌پذیرد.
3. دست‌کم به‌اندازهٔ حداکثر عمر URLهای صادرشده صبر کنید (پیش‌فرض
   امضاها ۵ دقیقه است؛ اگر جایی TTL بزرگ‌تری تنظیم شده، همان ملاک
   است — یک ساعت صبر، حاشیهٔ امن عملی است).
4. `STORAGE_SIGNING_SECRET_PREVIOUS` را خالی کنید و دوباره redeploy
   کنید. از این لحظه URLهای امضاشده با کلید قدیمی رد می‌شوند.

در dev/test اگر `STORAGE_SIGNING_SECRET` خالی باشد، امضا به‌صورت
انتقالی با `JWT_SECRET` انجام می‌شود و یک هشدار در لاگ ثبت می‌شود؛
این fallback در production هرگز رخ نمی‌دهد چون بوت پیش‌تر رد شده
است. محیط توسعهٔ محلی (bootstrap) از همان ابتدا راز اختصاصی تصادفی
جدا می‌سازد.

## پیاده‌سازی‌ها

| provider | کی | کجا |
|---|---|---|
| `LocalStorageProvider` | dev/test پیش‌فرض | `STORAGE_LOCAL_DIR` روی دیسک محلی |
| `S3StorageProvider` | production | MinIO همین compose (`S3_ENDPOINT=http://minio:9000`) یا هر S3-سازگار |

آبجکت‌ها **خصوصی**‌اند: در هیچ providerای URL عمومی قابل‌حدس وجود ندارد.
دسترسی فقط با signed URL کوتاه‌مدت (پیش‌فرض ۳۰۰ ثانیه):

- local: امضای HMAC روی `(key + exp)` با `JWT_SECRET`؛ مصرف از طریق endpoint
  احرازهویتی `download-by-ref` (امضا جایگزین auth می‌شود).
- s3: presigned URL مستقیم MinIO (`presigned_get_object`)؛ کلاینت همان URL را
  مستقیم مصرف می‌کند. `download-by-ref` قدیمی با S3 خطای 403 می‌دهد
  (`verify_download_sig` عمداً پیاده‌سازی نشده)؛ `read_bytes` برای دانلودهای
  احرازهویتی سمت‌سرور (ادمین/تسک‌های transcribe) در هر دو provider هست.

## چرخهٔ عمر فایل

1. **آپلود:** `read_capped_upload` (سقف جریانی، هرگز کل فایل در RAM نه) →
   `put_object(key, bytes, mime)` → `key` در دیتابیس ذخیره می‌شود (نه خود فایل).
2. **نگهداری:** فایل فقط با `key` قابل آدرس‌دهی است؛ کلیدها شامل شناسهٔ
   یکتا + مسیر منطقی ماژول‌اند (مثلاً `library/<uuid>.pdf`).
3. **دسترسی:** `get_presigned_url(key, expires_seconds)` — انقضای کوتاه؛ برای
   محتوای داغ، URL تازه تولید شود (کش نکنید).
4. **حذف:** `delete_object(key)` — حذف فیزیکی؛ رکورد دیتابیس جدا پاک شود.
   حذف دسته‌ای منظم (retention) بر عهدهٔ تسک‌های هر ماژول است.

## سیاست مهاجرت local → S3

`STORAGE_PROVIDER` را نمی‌توان روی دیتابیس پر از local سوییچ کرد (کلیدها
همان‌اند ولی بایت‌ها روی دیسک‌اند). مسیر مهاجرت:

1. بکاپ کامل (دیتابیس + `STORAGE_LOCAL_DIR`) — `infra/backup.sh`.
2. ساخت bucket مقصد و اجرای اسکریپت sync (الگو):
   `mc mirror --overwrite <STORAGE_LOCAL_DIR> s3/<S3_BUCKET>/`
   (کلیدها بدون پیشوند اضافی mirror شوند تا با کلیدهای دیتابیس بخوانند).
3. راستی‌آزمایی: نمونه‌برداری تصادفی — دانلود از S3 و مقایسهٔ SHA-256 با نسخهٔ local.
4. سوییچ `STORAGE_PROVIDER=s3` + استقرار؛ سپس `download-by-ref`های قدیمیِ
   local دیگر کار نمی‌کنند (۴۰۳) — کش‌های کلاینت منقضی شوند.

برگشت (s3 → local) معکوس همین مسیر است. migration بین دو S3 (مثلاً MinIO
خودی → S3 ابری) فقط `mc mirror` بین bucketهاست چون کلیدها عوض نمی‌شوند.
