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

    # ذخیرهٔ فایل — فاز ۰ §۶
    s3_endpoint: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "maturidi-media"
    s3_region: str = "us-east-1"

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

    # بلادرنگ — فاز ۲
    dispatcher_poll_interval: float = 1.0  # ثانیه — فاصلهٔ polling جدول domain_events
    ws_heartbeat_interval: int = 25  # ثانیه — ping/pong دوره‌ای WebSocket
    ws_heartbeat_timeout: int = 60  # ثانیه — قطع اتصال بعد از این مدت بی‌پاسخی

    @property
    def is_dev(self) -> bool:
        return self.app_env == "dev"


@lru_cache
def get_settings() -> Settings:
    return Settings()
