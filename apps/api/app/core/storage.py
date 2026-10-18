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
    async def get_presigned_url(self, key: str, expires_seconds: int = 300) -> str:
        """فقط برای آبجکت‌های خصوصی — URL عمومی قابل‌حدس هرگز."""
        ...

    @abstractmethod
    async def delete_object(self, key: str) -> None:
        ...


# پیاده‌سازی MinIO/S3 در فاز ۱ — اینجا فقط قرارداد است.
