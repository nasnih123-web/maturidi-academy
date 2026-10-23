"""انتزاع StorageProvider — فاز ۰ §۶.

امروز MinIO، فردا هر S3-سازگار — بدون تغییر کد بقیهٔ پروژه.
آبجکت‌های خصوصی فقط با signed URL با انقضای کوتاه سرو می‌شوند.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class UploadConstraints:
    max_bytes: int
    allowed_mime_prefixes: tuple[str, ...]


# ---------------------------------------------------------------------------
# منظور (purpose) امضای دانلود — FIX2-08 / ADR-0047
#
# امضای HMAC ارائه‌دهندهٔ محلی به (purpose, key, exp) گره می‌خورد، نه
# فقط (key, exp): URLی که برای یک مصرف صادر شده (مثلاً فایل کتابخانه)
# در endpoint مصرف دیگر (مثلاً دانلود گواهی) کار نمی‌کند. URLها
# کوتاه‌عمرند (دقایق) پس تغییر قالب امضا مهاجرت ذخیره‌شده نمی‌خواهد؛
# URLهای صادرشدهٔ پیش از این تغییر تا انقضای طبیعی‌شان از کار می‌افتند.
# ---------------------------------------------------------------------------

SIGNED_PURPOSE_GENERIC = "download"
SIGNED_PURPOSE_LIBRARY = "library"
SIGNED_PURPOSE_CERTIFICATE = "lms-certificate"


class StorageProvider(ABC):
    @abstractmethod
    async def put_object(self, key: str, data: bytes, mime_type: str) -> None:
        ...

    @abstractmethod
    async def get_presigned_url(
        self,
        key: str,
        expires_seconds: int = 300,
        *,
        download_path: str | None = None,
        purpose: str = SIGNED_PURPOSE_GENERIC,
    ) -> str:
        """فقط برای آبجکت‌های خصوصی — URL عمومی قابل‌حدس هرگز.

        download_path: مسیر endpoint دانلود احرازهویتی (پیش‌فرض: مسیر
        گواهی LMS — سازگاری عقب‌رو)؛ ماژول‌ها مسیر خودشان را می‌دهند
        (مثلاً کتابخانه: /api/v1/library/download-by-ref).
        purpose: منظور امضا (FIX2-08) — endpoint دانلود فقط امضای
        هم‌منظور خودش را می‌پذیرد.
        """
        ...

    @abstractmethod
    async def delete_object(self, key: str) -> None:
        ...


class LocalStorageProvider(StorageProvider):
    """پیاده‌سازی محلی (dev/پیش‌فرض) — فاز ۸.

    فایل‌ها زیر base_dir ذخیره می‌شوند؛ base_dir به‌صورت عمومی mount
    **نمی‌شود** — آبجکت‌های خصوصی فقط از طریق endpoint احرازهویتی دانلود
    سرو می‌شوند (§۶). پیاده‌سازی MinIO/S3 می‌تواند بعداً جایگزین شود
    بدون تغییر کد بقیهٔ پروژه.
    """

    def __init__(self, base_dir: str) -> None:
        self._base = base_dir

    def _path(self, key: str) -> str:
        import os
        import re

        safe = re.sub(r"[^A-Za-z0-9._/-]", "_", key).lstrip("/")
        if ".." in safe.split("/"):
            raise ValueError("unsafe storage key")
        return os.path.join(self._base, safe)

    async def put_object(self, key: str, data: bytes, mime_type: str) -> None:
        import os

        path = self._path(key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(data)

    async def get_presigned_url(
        self,
        key: str,
        expires_seconds: int = 300,
        *,
        download_path: str | None = None,
        purpose: str = SIGNED_PURPOSE_GENERIC,
    ) -> str:
        """برای provider محلی: URL دانلود امضاشدهٔ کوتاه‌مدت.

        امضا با HMAC روی (purpose + key + exp) و کلید jwt_secret
        انجام می‌شود (FIX2-08)؛ صحت آن در endpoint دانلودِ همان
        منظور بررسی می‌شود.
        """
        import hashlib
        import hmac
        import time

        from app.core.config import get_settings

        settings = get_settings()
        exp = int(time.time()) + expires_seconds
        msg = f"{purpose}:{key}:{exp}".encode()
        sig = hmac.new(settings.jwt_secret.encode(), msg, hashlib.sha256).hexdigest()
        base = (settings.app_base_url or "").rstrip("/")
        path = download_path or "/api/v1/lms/certificates/download-by-ref"
        return f"{base}{path}?key={key}&exp={exp}&sig={sig}&purpose={purpose}"

    async def delete_object(self, key: str) -> None:
        import os

        try:
            os.remove(self._path(key))
        except FileNotFoundError:
            pass

    async def read_bytes(self, key: str) -> bytes:
        """خواندن داخلی (برای endpoint دانلود احرازهویتی) — جزئی از قرارداد §۶ نیست."""
        with open(self._path(key), "rb") as fh:
            return fh.read()

    def verify_download_sig(
        self, key: str, exp: int, sig: str, purpose: str = SIGNED_PURPOSE_GENERIC
    ) -> bool:
        """بررسی امضا برای یک منظور مشخص (FIX2-08) — منظور اشتباه = رد."""
        import hashlib
        import hmac
        import time

        from app.core.config import get_settings

        if int(time.time()) > exp:
            return False
        settings = get_settings()
        msg = f"{purpose}:{key}:{exp}".encode()
        want = hmac.new(settings.jwt_secret.encode(), msg, hashlib.sha256).hexdigest()
        return hmac.compare_digest(want, sig)


class S3StorageProvider(StorageProvider):
    """پیاده‌سازی MinIO/S3-سازگار — §۶ (Track 2 / §۱۲).

    آبجکت‌ها خصوصی‌اند (bucket بدون policy عمومی)؛ دسترسی فقط با
    presigned URL کوتاه‌مدت که خود MinIO امضا می‌کند.

    endpoint داخلی (مثلاً http://minio:9000) فقط برای عملیات سمت‌سرور
    (put/delete/read/ensure_bucket) است؛ presigned URLهایی که به مرورگر
    داده می‌شود با endpoint عمومی (S3_ENDPOINT_PUBLIC) امضا می‌شوند تا
    هاست داخلی داکر هرگز به بیرون نشت نکند (یافتهٔ ۱).

    تفاوت با LocalStorageProvider:
    - ``get_presigned_url`` یک URL امضاشدهٔ مستقیم MinIO برمی‌گرداند؛ نیازی به
      مسیر proxy دانلود (``download_path``) نیست و نادیده گرفته می‌شود.
    - ``verify_download_sig`` پیاده‌سازی **نمی‌شود**: endpointهای قدیمی
      ``download-by-ref`` مخصوص provider محلی‌اند و با S3 خطای 403 می‌دهند؛
      کلاینت‌ها باید همان presigned URL مستقیم را مصرف کنند.
    - ``read_bytes`` برای دانلودهای احرازهویتی سمت‌سرور (ادمین/تسک‌ها) هست.

    سازنده هیچ فراخوانی شبکه‌ای نمی‌کند (فقط آبجکت کلاینت)؛ ایمپورت
    ``minio`` lazy است تا نبودنش در dev/test کرش ندهد.
    """

    def __init__(
        self,
        *,
        endpoint: str,
        access_key: str,
        secret_key: str,
        bucket: str,
        region: str = "us-east-1",
        endpoint_public: str | None = None,
    ) -> None:
        """endpoint: آدرس داخلی برای عملیات سمت‌سرور (مثلاً http://minio:9000
        درون شبکهٔ compose)؛ endpoint_public: آدرس مرورگر-قابل‌دسترس برای
        presigned URLها (مثلاً https://files.example.com) — خالی یعنی همان
        endpoint داخلی (فقط dev/تک‌هاست).

        امضای presigned URL خالصاً محلی است (بدون شبکه)، پس کلاینت عمومی
        هیچ‌وقت واقعاً به جایی وصل نمی‌شود؛ فقط هاست امضا/URL را تعیین
        می‌کند. هاست داخلی هرگز در URL مرورگر قرار نمی‌گیرد.
        """
        try:
            from minio import Minio
        except ImportError as exc:
            raise RuntimeError(
                "STORAGE_PROVIDER=s3 requires the 'minio' package "
                "(pip install -r requirements.txt)"
            ) from exc
        from urllib.parse import urlparse

        parsed = urlparse(endpoint)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise ValueError(f"invalid S3 endpoint: {endpoint!r}")
        public = (endpoint_public or "").strip() or endpoint
        pparsed = urlparse(public)
        if pparsed.scheme not in ("http", "https") or not pparsed.hostname:
            raise ValueError(f"invalid S3 public endpoint: {public!r}")
        self._endpoint = endpoint.rstrip("/")
        self._endpoint_public = public.rstrip("/")
        self._bucket = bucket
        # region به هر دو کلاینت داده می‌شود تا presigned_get_object برای
        # تشخیص region درخواست شبکه‌ای (GetBucketLocation) نزند.
        self._client = Minio(
            parsed.netloc,
            access_key=access_key,
            secret_key=secret_key,
            secure=parsed.scheme == "https",
            region=region or None,
        )
        self._public_client = Minio(
            pparsed.netloc,
            access_key=access_key,
            secret_key=secret_key,
            secure=pparsed.scheme == "https",
            region=region or None,
        )

    @property
    def bucket(self) -> str:
        return self._bucket

    @property
    def endpoint_public(self) -> str:
        """آدرس عمومی‌ای که presigned URLها با آن ساخته می‌شوند."""
        return self._endpoint_public

    def ensure_bucket(self) -> None:
        """تضمین وجود bucket — idempotent؛ فقط عملیات سمت‌سرور (یافتهٔ ۲).

        روی deploy تازه bucket را می‌سازد؛ اگر باشد هیچ‌کاری نمی‌کند.
        خطای اتصال/دسترسی با RuntimeError صریح و قابل‌تشخیص بالا می‌آید
        (هرگز موفقیت ساکت)؛ هیچ secretای در پیام نیست.
        """
        try:
            exists = self._client.bucket_exists(self._bucket)
        except Exception as exc:
            raise RuntimeError(
                f"S3/MinIO unreachable at {self._endpoint} "
                f"(bucket_exists failed for bucket {self._bucket!r}); "
                "check S3_ENDPOINT and network connectivity"
            ) from exc
        if exists:
            return
        try:
            self._client.make_bucket(self._bucket)
        except Exception as exc:
            from minio.error import S3Error

            if isinstance(exc, S3Error) and exc.code in (
                "BucketAlreadyOwnedByYou",
                "BucketAlreadyExists",
            ):
                return  # race با یک سازندهٔ هم‌زمان — همان نتیجهٔ مطلوب
            raise RuntimeError(
                f"cannot create bucket {self._bucket!r} on S3/MinIO "
                f"at {self._endpoint}; check S3_ACCESS_KEY/S3_SECRET_KEY permissions"
            ) from exc

    async def put_object(self, key: str, data: bytes, mime_type: str) -> None:
        import asyncio
        import io

        client, bucket = self._client, self._bucket
        await asyncio.to_thread(
            client.put_object,
            bucket,
            key,
            io.BytesIO(data),
            len(data),
            content_type=mime_type,
        )

    async def get_presigned_url(
        self,
        key: str,
        expires_seconds: int = 300,
        *,
        download_path: str | None = None,
        purpose: str = SIGNED_PURPOSE_GENERIC,
    ) -> str:
        """URL امضاشدهٔ مستقیم MinIO — بدون شبکه (فقط امضای محلی).

        purpose (FIX2-08) در این provider بی‌اثر است: امضای SigV4 خود
        MinIO ذاتاً به همان آبجکت و همان عملیات گره خورده و URL از
        مسیر endpoint اپلیکیشن دانلود نمی‌شود.

        Track 1 (final) / یافتهٔ ۱: امضا همیشه با کلاینتِ endpoint عمومی
        انجام می‌شود تا هاست داخلی (مثلاً minio:9000) هرگز به مرورگر نشت
        نکند. وقتی endpoint_public تنظیم نشده، همان endpoint داخلی استفاده
        می‌شود (سازگاری عقب‌رو — فقط وقتی درست است که هاست داخلی از
        مرورگر هم قابل دسترس باشد).
        """
        import asyncio
        from datetime import timedelta

        client, bucket = self._public_client, self._bucket
        return await asyncio.to_thread(
            client.presigned_get_object,
            bucket,
            key,
            expires=timedelta(seconds=expires_seconds),
        )

    async def delete_object(self, key: str) -> None:
        import asyncio

        client, bucket = self._client, self._bucket

        def _delete() -> None:
            try:
                client.remove_object(bucket, key)
            except Exception as exc:  # نگاشت خطای S3
                from minio.error import S3Error

                if isinstance(exc, S3Error) and exc.code == "NoSuchKey":
                    return
                raise

        await asyncio.to_thread(_delete)

    async def read_bytes(self, key: str) -> bytes:
        """خواندن داخلی برای دانلودهای احرازهویتی سمت‌سرور (§۶)."""
        import asyncio

        client, bucket = self._client, self._bucket

        def _read() -> bytes:
            response = client.get_object(bucket, key)
            try:
                return response.read()
            finally:
                response.close()
                response.release_conn()

        return await asyncio.to_thread(_read)


# ---------- قوانین production برای تنظیمات S3 (یافته‌های ۱ و ۸) ----------

# هاست‌هایی که مرورگرِ بیرون شبکهٔ داکر هرگز نمی‌تواند به آن‌ها برسد —
# اگر چنین هاستی در presigned URL بیاید، لینک برای کاربر خراب است و آدرس
# داخلی زیرساخت لو رفته است.
_BROWSER_UNREACHABLE_HOSTS = frozenset({"localhost", "minio"})
_BROWSER_UNREACHABLE_SUFFIXES = (".local", ".internal", ".svc", ".cluster.local")


def _host_of(url: str) -> str:
    from urllib.parse import urlparse

    return (urlparse(url or "").hostname or "").lower()


def _is_browser_unreachable_host(host: str) -> bool:
    if not host:
        return True
    if host in _BROWSER_UNREACHABLE_HOSTS:
        return True
    if host == "::1" or host.startswith(("127.", "[::1]")):
        return True
    return host.endswith(_BROWSER_UNREACHABLE_SUFFIXES)


def _is_dummy_internal_host(host: str) -> bool:
    """هاست غیرقابل‌قبول برای endpoint داخلی در production.

    «minio» (نام سرویس compose) و هاست/IP واقعی مجازند؛ localhost و
    example.* و change_me ممنوع‌اند (یافتهٔ ۸).
    """
    if not host or "change_me" in host:
        return True
    if host == "localhost" or host == "::1" or host.startswith(("127.", "[::1]")):
        return True
    return "example." in host


_PLACEHOLDER_BUCKETS = frozenset(
    {"bucket", "mybucket", "test", "example", "dummy", "placeholder", "changeme", "testbucket"}
)


def _is_placeholder_bucket(bucket: str) -> bool:
    b = (bucket or "").lower()
    if not b or "change_me" in b:
        return True
    if b in _PLACEHOLDER_BUCKETS:
        return True
    return b.startswith(("example-", "test-", "dummy-", "placeholder-")) or b.endswith(
        ("-example", "-test", "-dummy", "-placeholder")
    )


def s3_production_problems(settings) -> list[str]:
    """ایرادهای تنظیمات S3 در production/staging؛ خالی یعنی قابل قبول.

    از app.core.config.assert_production_secrets_ok (نگهبان startup) و از
    _validate_s3_settings فراخوانی می‌شود. هیچ secretای در پیام‌ها نیست.
    """
    from app.core.config import _KNOWN_WEAK_SECRETS

    problems: list[str] = []
    endpoint = (settings.s3_endpoint or "").strip()
    host = _host_of(endpoint)
    if _is_dummy_internal_host(host):
        problems.append(
            "s3_endpoint: must not be a dummy/localhost/example URL in production"
        )
    public = (settings.s3_endpoint_public or "").strip()
    if public:
        phost = _host_of(public)
        from urllib.parse import urlparse

        p = urlparse(public)
        if p.scheme not in ("http", "https") or not phost:
            problems.append("s3_endpoint_public: not a valid http(s) URL")
        elif (
            _is_browser_unreachable_host(phost)
            or "example." in phost
            or "change_me" in phost
        ):
            problems.append(
                "s3_endpoint_public: must be browser-reachable in production "
                "(internal hostnames like 'minio'/'localhost' must never leak to browsers)"
            )
    elif _is_browser_unreachable_host(host) or "example." in host or "change_me" in host:
        # بدون public صریح، هاست داخلی در presigned URL می‌آید → نشت + لینک خراب
        problems.append(
            f"s3_endpoint: internal hostname {host!r} would leak into browser "
            "presigned URLs — set S3_ENDPOINT_PUBLIC to a browser-reachable URL"
        )
    ak = (settings.s3_access_key or "").strip()
    if not ak:
        problems.append("s3_access_key: empty")
    elif "change_me" in ak.lower():
        problems.append("s3_access_key: contains placeholder pattern 'CHANGE_ME'")
    elif ak.lower() in _KNOWN_WEAK_SECRETS:
        problems.append("s3_access_key: known weak/default value")
    # secret key با همان نوار secretهای اصلی: بدون placeholder، بدون مقدار
    # ضعیف، حداقل ۳۲ کاراکتر (یافتهٔ ۸)
    from app.core.config import _secret_problems

    problems.extend(_secret_problems("s3_secret_key", settings.s3_secret_key))
    bucket = (settings.s3_bucket or "").strip()
    if _is_placeholder_bucket(bucket):
        problems.append(f"s3_bucket: placeholder bucket name {bucket!r}")
    return problems


def _validate_s3_settings(settings) -> None:
    """اعتبارسنجی استاتیک تنظیمات S3 — بدون هیچ فراخوانی شبکه‌ای.

    در production با config بد، به‌جای fallback خاموش به local، با
    RuntimeError صریح fail می‌کند (§۱۲). در production علاوه بر قالب،
    قوانین سخت‌گیرانهٔ s3_production_problems هم اعمال می‌شود (یافته‌های
    ۱ و ۸): endpoint/کلید/bucket نمایشی و نشت هاست داخلی به مرورگر.
    """
    import re
    from urllib.parse import urlparse

    problems: list[str] = []
    endpoint = (settings.s3_endpoint or "").strip()
    parsed = urlparse(endpoint)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        problems.append(f"S3_ENDPOINT={endpoint!r} یک URL معتبر http(s) نیست")
    if not (settings.s3_access_key or "").strip():
        problems.append("S3_ACCESS_KEY خالی است")
    if not (settings.s3_secret_key or "").strip():
        problems.append("S3_SECRET_KEY خالی است")
    bucket = (settings.s3_bucket or "").strip()
    if not re.fullmatch(r"[a-z0-9][a-z0-9.\-]{1,61}[a-z0-9]", bucket) or ".." in bucket:
        problems.append(f"S3_BUCKET={bucket!r} نام معتبر bucket نیست")
    if problems:
        raise RuntimeError(
            "STORAGE_PROVIDER=s3 ولی تنظیمات S3 نامعتبر است: " + "؛ ".join(problems)
        )
    if settings.is_production:
        prod_problems = s3_production_problems(settings)
        if prod_problems:
            raise RuntimeError(
                "STORAGE_PROVIDER=s3 ولی تنظیمات S3 در production نامعتبر است: "
                + "؛ ".join(prod_problems)
            )


def get_storage() -> StorageProvider:
    """فکتوری provider — انتخاب config-driven (§۶، Track 2 / §۱۲).

    - ``STORAGE_PROVIDER=local`` (پیش‌فرض dev): LocalStorageProvider
    - ``STORAGE_PROVIDER=s3`` (نام مستعار: ``minio``): S3StorageProvider با
      اعتبارسنجی سخت‌گیرانه؛ config بد → RuntimeError صریح در startup
      (نه fallback خاموش). در production علاوه بر قالب، قوانین
      s3_production_problems هم اعمال می‌شود.
    """
    from app.core.config import get_settings

    settings = get_settings()
    provider = (settings.storage_provider or "local").strip().lower()
    if provider in ("s3", "minio"):
        _validate_s3_settings(settings)
        return S3StorageProvider(
            endpoint=settings.s3_endpoint,
            endpoint_public=(settings.s3_endpoint_public or "").strip() or None,
            access_key=settings.s3_access_key,
            secret_key=settings.s3_secret_key,
            bucket=settings.s3_bucket,
            region=settings.s3_region,
        )
    if provider == "local":
        return LocalStorageProvider(settings.storage_local_dir)
    raise RuntimeError(
        f"STORAGE_PROVIDER={settings.storage_provider!r} نامعتبر است "
        "(مقادیر مجاز: 'local' | 's3' | 'minio')"
    )


# ---------- StorageProvider اختصاصی بیلدها (FIX2-02 — ADR-0041) ----------

#: چهار مقدار اصلی کانفیگ storage بیلدها — قرارداد «همه یا هیچ».
_BUILDS_S3_REQUIRED = (
    "builds_s3_endpoint",
    "builds_s3_access_key",
    "builds_s3_secret_key",
    "builds_s3_bucket",
)


def builds_s3_configured(settings) -> bool:
    """آیا کانفیگ اختصاصی بیلدها کامل تنظیم شده است؟"""
    return all(
        (getattr(settings, name) or "").strip() for name in _BUILDS_S3_REQUIRED
    )


def builds_storage_problems(settings) -> list[str]:
    """ایرادهای کانفیگ storage بیلدها؛ خالی یعنی سازگار.

    سازگار یعنی یکی از این دو: (الف) هیچ‌کدام از BUILDS_S3_* تنظیم نشده
    — بیلدها باکت واحدِ storage عمومی برنامه (S3_*) را مصرف می‌کنند؛
    (ب) هر چهار مقدار اصلی کامل و از نظر قالب معتبرند. حالت میانی
    ناسازگاری است: کالبک CI در یک باکت می‌نویسد و API از باکت دیگری
    می‌خواند — دانلود و prune بی‌صدا خراب می‌شوند، پس باید در startup
    گرفته شود، نه در زمان دانلود کاربر. هیچ secretای در پیام‌ها نیست.
    """
    values = {
        name: (getattr(settings, name) or "").strip()
        for name in _BUILDS_S3_REQUIRED
    }
    present = [name for name, v in values.items() if v]
    if not present:
        return []
    missing = [name.upper() for name, v in values.items() if not v]
    if missing:
        return [
            "BUILDS_S3_* ناقص است — یا هر چهار مقدار را تنظیم کنید یا "
            "هیچ‌کدام را (باکت واحد با S3_*): مقادیر خالی: " + ", ".join(missing)
        ]
    import re
    from urllib.parse import urlparse

    problems: list[str] = []
    parsed = urlparse(values["builds_s3_endpoint"])
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        problems.append(
            f"BUILDS_S3_ENDPOINT={values['builds_s3_endpoint']!r} یک URL معتبر http(s) نیست"
        )
    bucket = values["builds_s3_bucket"]
    if not re.fullmatch(r"[a-z0-9][a-z0-9.\-]{1,61}[a-z0-9]", bucket) or ".." in bucket:
        problems.append(f"BUILDS_S3_BUCKET={bucket!r} نام معتبر bucket نیست")
    public = (settings.builds_s3_endpoint_public or "").strip()
    if public:
        pparsed = urlparse(public)
        if pparsed.scheme not in ("http", "https") or not pparsed.hostname:
            problems.append(
                f"BUILDS_S3_ENDPOINT_PUBLIC={public!r} یک URL معتبر http(s) نیست"
            )
    return problems


def validate_builds_storage(settings=None) -> None:
    """fail-fast استارتاپ برای کانفیگ storage بیلدها — از lifespan صدا زده می‌شود."""
    from app.core.config import get_settings

    s = settings or get_settings()
    problems = builds_storage_problems(s)
    if problems:
        raise RuntimeError(
            "تنظیمات storage بیلدها ناسازگار است: " + "؛ ".join(problems)
        )


def get_builds_storage() -> StorageProvider:
    """provider بیلدها — دقیقاً همان باکتی که کالبک CI در آن می‌نویسد.

    BUILDS_S3_* کامل → S3StorageProvider اختصاصی با همان مقادیر؛ خالی →
    همان provider عمومی برنامه (باکت واحد با S3_*). کانفیگ ناقص →
    RuntimeError صریح (هرگز حدس/فالبک خاموش).
    """
    from app.core.config import get_settings

    settings = get_settings()
    validate_builds_storage(settings)
    if not builds_s3_configured(settings):
        return get_storage()
    return S3StorageProvider(
        endpoint=settings.builds_s3_endpoint,
        endpoint_public=(settings.builds_s3_endpoint_public or "").strip() or None,
        access_key=settings.builds_s3_access_key,
        secret_key=settings.builds_s3_secret_key,
        bucket=settings.builds_s3_bucket,
        region=settings.builds_s3_region,
    )


async def ensure_storage_ready(settings=None) -> StorageProvider:
    """چک startup برای storage (یافته‌های ۲ و ۴) — از lifespan فراخوانی می‌شود.

    ۱) اعتبارسنجی استاتیک config (get_storage → RuntimeError صریح اگر بد باشد)؛
    ۲) اگر provider از نوع S3 است: handshake واقعی با MinIO + ساخت idempotent
       bucket (ensure_bucket) — خطای اتصال = RuntimeError بلند با پیام
       قابل‌تشخیص (endpoint و bucket، بدون secret) و امتناع از بوت.

    در dev/test مرحلهٔ ۲ انجام نمی‌شود (بدون MinIO هم dev باید بالا بیاید)؛
    در staging/production هر خطایی فیلِ بلندِ startup است.
    """
    import asyncio
    import os

    from app.core.config import get_settings

    s = settings or get_settings()
    provider = get_storage()
    if not isinstance(provider, S3StorageProvider):
        return provider
    if (
        s.is_dev
        or os.environ.get("PYTEST_CURRENT_TEST")
        or os.environ.get("MATURIDI_TESTING")
    ):
        return provider
    try:
        await asyncio.to_thread(provider.ensure_bucket)
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError(
            f"Storage backend unreachable: cannot provision MinIO bucket "
            f"{provider.bucket!r} at {s.s3_endpoint} — refusing to start. "
            "Check S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY and network. "
            f"Cause: {type(exc).__name__}"
        ) from exc
    return provider


async def read_capped_upload(
    upload,
    max_bytes: int,
    *,
    chunk_size: int = 1024 * 1024,
    too_large_code: str = "file_too_large",
    too_large_status: int = 413,
    too_large_message: str = "حجم فایل بیش از سقف مجاز است",
) -> bytes:
    """خواندن جریانیِ UploadFile با سقف حجم — قرارداد §۷.

    به‌جای `await upload.read()` که کل فایل را پیش از هر بررسی در RAM
    می‌ریزد، تکه‌تکه می‌خواند و به‌محض عبور از سقف خطا می‌دهد؛ یعنی
    فایل غول‌پیکرِ مخرب هرگز کامل در حافظه بار نمی‌شود.
    کد/وضعیت خطا قابل‌تنظیم است تا قرارداد API هر ماژول حفظ شود.
    """
    from app.core.errors import APIError

    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(chunk_size)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise APIError(
                too_large_status,
                too_large_code,
                too_large_message,
                {"max_bytes": max_bytes},
            )
        chunks.append(chunk)
    return b"".join(chunks)


# چرخهٔ عمر فایل و سیاست مهاجرت local→S3: docs/ops/storage.md (§۱۲).
