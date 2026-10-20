"""تنظیمات مرکزی — سه محیط dev/staging/production (فاز ۰ §۳)."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "dev"  # dev | staging | production
    app_name: str = "Maturidi Academy API"

    database_url: str = "sqlite+aiosqlite:///./dev.db"
    redis_url: str = "redis://localhost:6379/0"

    # امنیت — فاز ۰ §۲ و §۳: این‌ها باید از env/secrets manager بیایند، هرگز هاردکد
    encryption_key: str = "CHANGE_ME"
    encryption_key_version: int = 1
    jwt_secret: str = "CHANGE_ME"
    access_token_expire_minutes: int = 15

    # محدودیت نرخ توزیع‌شده — remediation-pass-2 Track 1 (§۷)
    # در production اگر Redis در دسترس نباشد، endpointهای احرازهویتی
    # fail-closed می‌شوند (429)؛ در dev/test fallback حافظه‌ای.
    rate_limit_fail_closed: bool = True
    # پس از قطع Redis، هر چند ثانیه یک‌بار اتصال پروب می‌شود تا شمارش معتبر
    # برگردد (final remediation — Track 2؛ نه stuck-open، نه stuck-closed).
    rate_limit_redis_retry_s: float = 30.0
    # IPهای پروکسی مورداعتماد (کاما-جدا) که X-Forwarded-Forشان پذیرفته می‌شود
    trusted_proxies: str = ""

    # ذخیرهٔ فایل — فاز ۰ §۶
    s3_endpoint: str = "http://localhost:9000"
    # Track 1 (final remediation) / §۱۲: endpoint عمومی برای presigned URLهایی
    # که به مرورگر داده می‌شود. باید از بیرون شبکهٔ داکر قابل دسترس باشد
    # (مثلاً https://files.example.com)؛ خالی = همان s3_endpoint — فقط وقتی
    # درست است که هاست داخلی از مرورگر هم قابل دسترس باشد (مثل dev).
    # در production اگر هاست مؤثر داخلی‌باشد (minio/localhost/...)، بوت فیل
    # می‌شود تا آدرس داخلی هرگز به مرورگر نشت نکند.
    s3_endpoint_public: str = ""
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "maturidi-media"
    s3_region: str = "us-east-1"
    # فاز ۸ — پیاده‌سازی محلی پیش‌فرض StorageProvider (§۶)
    storage_local_dir: str = "./storage"
    # Track 2 / §۱۲ — انتخاب پیاده‌سازی StorageProvider (§۶): "local" | "s3"
    # "s3" یعنی MinIO/S3-سازگار با مقادیر S3_* همین فایل؛ در production باید s3 باشد.
    # مقدار نامعتبر → فکتوری در startup با خطای صریح fail می‌کند.
    storage_provider: str = "local"
    app_base_url: str = "http://localhost:8000"

    # ایمیل تراکنشی — فاز ۱ (خالی = حالت dev با لاگ)
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "noreply@example.com"

    # پیامک — فاز ۱ (خالی = حالت dev با لاگ)
    sms_provider: str = ""
    sms_api_key: str = ""

    # رصدپذیری — فاز ۲ §۱۱ (خالی = غیرفعال)
    sentry_dsn: str = ""
    otel_exporter_otlp_endpoint: str = ""
    log_format: str = "text"  # text | json

    # CORS — خالی = غیرفعال؛ کاما-جدا یا "*" (مثلاً برای تست موقت یا فرانت جدا)
    cors_allow_origins: str = ""

    # بلادرنگ — فاز ۲
    dispatcher_poll_interval: float = 1.0  # ثانیه — فاصلهٔ polling جدول domain_events
    ws_heartbeat_interval: int = 25  # ثانیه — ping/pong دوره‌ای WebSocket
    ws_heartbeat_timeout: int = 60  # ثانیه — قطع اتصال بعد از این مدت بی‌پاسخی

    # Track 2 / §۱۵ — سقف سراسری حجم body درخواست‌ها (بایت)؛ آپلودهای فایل
    # سقف دقیق‌تر خودشان را دارند (read_capped_upload) — این سپر سراسری است.
    max_request_body_bytes: int = 10 * 1024 * 1024

    @property
    def is_dev(self) -> bool:
        return self.app_env == "dev"

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


# ---------- نگهبان secrets در production (فاز ۰ §۳ و §۱۵ قانون ۳) ----------

_PLACEHOLDER_SECRETS = frozenset({"", "CHANGE_ME"})

# مقادیر پیش‌فرض/ضعیف شناخته‌شده — هرگز در production قابل قبول نیستند
_KNOWN_WEAK_SECRETS = frozenset(
    {
        "password",
        "secret",
        "changeme",
        "12345678",
        "qwerty",
        "letmein",
        "admin",
        "minioadmin",
        "test",
        "dev",
        "development",
    }
)

_MIN_SECRET_CHARS = 32  # حداقل طول JWT secret / کلید رمزنگاری در production


def _secret_problems(name: str, value: str, other: str | None = None) -> list[str]:
    """فهرست ایرادهای یک secret در production؛ خالی یعنی قابل قبول."""
    problems: list[str] = []
    v = (value or "").strip()
    if not v or v in _PLACEHOLDER_SECRETS:
        problems.append(f"{name}: placeholder/empty")
        return problems
    # الگوهایی مثل CHANGE_ME__generate_a_random_secret — هر پسوندی از CHANGE_ME
    if "change_me" in v.lower():
        problems.append(f"{name}: contains placeholder pattern 'CHANGE_ME'")
    if len(v) < _MIN_SECRET_CHARS:
        problems.append(
            f"{name}: too short ({len(v)} < {_MIN_SECRET_CHARS} chars)"
        )
    if v.lower() in _KNOWN_WEAK_SECRETS:
        problems.append(f"{name}: known weak/default value")
    if other is not None and v == (other or "").strip():
        problems.append(f"{name}: must not equal encryption_key (secret reuse)")
    return problems


def assert_production_secrets_ok(settings: Settings | None = None) -> None:
    """fail-fast در startup: در محیط واقعی، secret پیش‌فرض/placeholder ممنوع است.

    در dev سکوت می‌کند تا توسعه و تست سبک بمانند؛ در staging/production با
    jwt_secret یا encryption_key برابر CHANGE_ME (یا خالی) بالا نمی‌آید.

    remediation-pass-2 Track 1 (§۶): علاوه بر placeholder دقیق، الگوهای
    CHANGE_ME__...، کلیدهای کوتاه‌تر از ۳۲ کاراکتر، مقادیر ضعیف شناخته‌شده،
    استفادهٔ مجدد از یک secret برای دو منظور، و app_base_url نامعتبر
    (localhost در production — لینک‌های بازیابی/تأیید باید واقعی باشند) هم
    رد می‌شوند. Track 1 (final): وقتی STORAGE_PROVIDER=s3/minio است، تنظیمات
    S3 هم با همان سخت‌گیری بررسی می‌شود (s3_production_problems): بدون
    placeholder/کلید ضعیف، بدون endpoint داخلی یا example.*، بدون bucket
    نمایشی، و بدون نشت هاست داخلی به presigned URL مرورگر. هیچ secretی در
    پیام خطا یا لاگ چاپ نمی‌شود — فقط نام فیلد.
    """
    s = settings or get_settings()
    if s.is_dev:
        return
    bad: list[str] = []
    bad.extend(_secret_problems("jwt_secret", s.jwt_secret, s.encryption_key))
    bad.extend(_secret_problems("encryption_key", s.encryption_key))
    # Track 1 (final remediation) / §۱۲ — نگهبان S3 در production:
    # هیچ placeholderای (CHANGE_ME__...، کلید ضعیف/کوتاه، endpoint داخلی یا
    # example.com، bucket نمایشی) نباید بوت production را رد کند.
    provider = (s.storage_provider or "local").strip().lower()
    if provider in ("s3", "minio"):
        from app.core.storage import s3_production_problems

        bad.extend(s3_production_problems(s))
    # §۸: لینک‌های ایمیل در production باید به هاست واقعی اشاره کنند
    base = (s.app_base_url or "").strip().lower()
    if not base.startswith(("http://", "https://")) or "localhost" in base or base.startswith(
        ("http://127.", "https://127.", "http://[::1]", "https://[::1]")
    ):
        bad.append("app_base_url: must be a public http(s) URL in production")
    if bad:
        raise RuntimeError(
            f"Refusing to start in env={s.app_env}: insecure setting(s): "
            + "; ".join(bad)
            + " — set real values via environment / secrets manager"
        )
