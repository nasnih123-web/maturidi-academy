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


class StorageProvider(ABC):
    @abstractmethod
    async def put_object(self, key: str, data: bytes, mime_type: str) -> None:
        ...

    @abstractmethod
    async def get_presigned_url(
        self, key: str, expires_seconds: int = 300, *, download_path: str | None = None
    ) -> str:
        """فقط برای آبجکت‌های خصوصی — URL عمومی قابل‌حدس هرگز.

        download_path: مسیر endpoint دانلود احرازهویتی (پیش‌فرض: مسیر
        گواهی LMS — سازگاری عقب‌رو)؛ ماژول‌ها مسیر خودشان را می‌دهند
        (مثلاً کتابخانه: /api/v1/library/download-by-ref).
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
        self, key: str, expires_seconds: int = 300, *, download_path: str | None = None
    ) -> str:
        """برای provider محلی: URL دانلود امضاشدهٔ کوتاه‌مدت.

        امضا با HMAC روی (key + exp) و کلید jwt_secret انجام می‌شود؛
        صحت آن در endpoint دانلود بررسی می‌شود.
        """
        import hashlib
        import hmac
        import time

        from app.core.config import get_settings

        settings = get_settings()
        exp = int(time.time()) + expires_seconds
        msg = f"{key}:{exp}".encode()
        sig = hmac.new(settings.jwt_secret.encode(), msg, hashlib.sha256).hexdigest()
        base = (settings.app_base_url or "").rstrip("/")
        path = download_path or "/api/v1/lms/certificates/download-by-ref"
        return f"{base}{path}?key={key}&exp={exp}&sig={sig}"

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

    def verify_download_sig(self, key: str, exp: int, sig: str) -> bool:
        import hashlib
        import hmac
        import time

        from app.core.config import get_settings

        if int(time.time()) > exp:
            return False
        settings = get_settings()
        msg = f"{key}:{exp}".encode()
        want = hmac.new(settings.jwt_secret.encode(), msg, hashlib.sha256).hexdigest()
        return hmac.compare_digest(want, sig)


def get_storage() -> StorageProvider:
    """فکتوری provider — امروز local، فردا MinIO/S3 بدون تغییر کد (§۶)."""
    from app.core.config import get_settings

    settings = get_settings()
    return LocalStorageProvider(settings.storage_local_dir)


# پیاده‌سازی MinIO/S3 در فاز ۱ — اینجا فقط قرارداد است.
# (LocalStorageProvider در فاز ۸ به‌عنوان پیاده‌سازی پیش‌فرض dev اضافه شد.)
