"""فیکسچرهای تست — دیتابیس SQLite جدا، override کردن get_db، ضبط ایمیل/پیامک."""
from __future__ import annotations

import os
import socket
import struct
import threading

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

_EICAR_MARKER = b"EICAR-STANDARD-ANTIVIRUS-TEST-FILE"


class _StubClamd(threading.Thread):
    """سرور clamd آزمایشی — سوکت واقعی + پروتکل واقعی INSTREAM (C-01).

    دادهٔ پاک → `stream: OK`؛ دادهٔ حاوی نشان EICAR →
    `stream: Eicar-Test-Signature FOUND`. فقط زیرساخت تست است؛ کد
    production همیشه به clamd واقعی وصل می‌شود.
    """

    def __init__(self, port: int = 0) -> None:
        super().__init__(daemon=True)
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._sock.bind(("127.0.0.1", port))
        self._sock.listen(16)
        self.port = self._sock.getsockname()[1]
        self._closed = False

    def run(self) -> None:
        while not self._closed:
            try:
                conn, _ = self._sock.accept()
            except OSError:
                return
            threading.Thread(target=self._handle, args=(conn,), daemon=True).start()

    @staticmethod
    def _read_exact(conn: socket.socket, n: int) -> bytes:
        buf = b""
        while len(buf) < n:
            part = conn.recv(n - len(buf))
            if not part:
                raise ConnectionError("eof")
            buf += part
        return buf

    def _handle(self, conn: socket.socket) -> None:
        try:
            # فرمان: zINSTREAM\0
            cmd = b""
            while not cmd.endswith(b"\x00"):
                cmd += conn.recv(1)
            infected = False
            tail = b""
            while True:
                (length,) = struct.unpack(">I", self._read_exact(conn, 4))
                if length == 0:
                    break
                data = self._read_exact(conn, length)
                window = tail + data
                if _EICAR_MARKER in window:
                    infected = True
                tail = window[-len(_EICAR_MARKER):]
            if infected:
                conn.sendall(b"stream: Eicar-Test-Signature FOUND\n")
            else:
                conn.sendall(b"stream: OK\n")
        except (ConnectionError, OSError):
            pass
        finally:
            conn.close()

    def close(self) -> None:
        self._closed = True
        try:
            self._sock.close()
        except OSError:
            pass


# ---------------------------------------------------------------------------
# پیکربندی harness در سطح env (C-01/C-02) — در importِ conftest ست می‌شود
# تا در برابر get_settings.cache_clear() در ماژول‌های تست دیگر مصون
# بماند: جهش‌دادن نمونهٔ کش‌شدهٔ Settings کافی نبود (یک cache_clear
# همهٔ مقادیر harness را از دست می‌داد و register/آپلودهای بعدیِ سوئیت
# با پیش‌فرض‌های production مواجه می‌شدند).
# ---------------------------------------------------------------------------

_STUB_CLAMD_PORT = 33310
os.environ["CLAMAV_HOST"] = "127.0.0.1"
os.environ["CLAMAV_PORT"] = str(_STUB_CLAMD_PORT)
os.environ["CAPTCHA_ENABLED"] = "false"
_STUB_SERVER = _StubClamd(port=_STUB_CLAMD_PORT)
_STUB_SERVER.start()


@pytest.fixture(scope="session", autouse=True)
def _stub_clamd():
    """همهٔ تست‌ها مسیر اسکن واقعی را علیه stub clamd تمرین می‌کنند."""
    yield _STUB_SERVER


@pytest.fixture(scope="session", autouse=True)
def _captcha_disabled_by_default():
    """پیش‌فرضِ harness تست: کپچا خاموش است (C-02 — با env در بالای فایل).

    پیش‌فرض production روشن + fail-closed است؛ تست‌های C-02 آن را
    per-test با monkeypatch صریح روشن و siteverify را stub می‌کنند.
    بقیهٔ سوئیت (که روی register تکیه دارد) نباید به secret واقعی
    کلودفلر نیاز داشته باشد.
    """
    yield

TEST_DB = os.environ.get("MATURIDI_TEST_DB", "/tmp/maturidi_test_phase1.db")
# نکتهٔ Track C (2026-10-19): مسیر از env قابل بازنویسی است تا چند اجرای
# هم‌زمان pytest (ترک‌های مختلف روی یک برنچ) دیتابیس مشترک همدیگر را پاک نکنند:
#   MATURIDI_TEST_DB=/tmp/maturidi_test_track_c.db pytest tests/ -q


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def tc():
    """کلاینت HTTP + دیتابیس تست تازه + ضبط ایمیل/پیامک."""
    import app.models
    from app.core.database import Base

    if os.path.exists(TEST_DB):
        os.remove(TEST_DB)
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{TEST_DB}", connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    from app.core.database import get_db
    from app.main import app

    async def _override():
        async with maker() as session:
            yield session

    app.dependency_overrides[get_db] = _override

    import app.core.email as email_mod
    import app.core.sms as sms_mod

    sent: dict = {"emails": [], "sms": []}

    async def _fake_email(to, subject, body_text, body_html=None):
        sent["emails"].append({"to": to, "subject": subject, "body": body_text})
        return True

    async def _fake_sms(phone, message):
        sent["sms"].append({"phone": phone, "message": message})
        return True

    email_mod.send_email = _fake_email
    sms_mod.send_sms = _fake_sms

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield {"client": client, "sent": sent, "maker": maker}
    await engine.dispose()


@pytest_asyncio.fixture(loop_scope="session")
async def db_session(tc):
    """دسترسی مستقیم به دیتابیس تست (برای seed نقش/مجوز در تست ادمین)."""
    maker = tc["maker"]
    async with maker() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture(autouse=True)
async def _reset_distributed_rate_limiter():
    """ریست محدودکنندهٔ نرخ توزیع‌شده بین تست‌ها (remediation-pass-2 Track 1).

    auth service از get_rate_limiter()‎ استفاده می‌کند؛ بدون ریست، سقف‌های
    login/register بین تست‌های یک فایل/جلسه جمع می‌شدند و 429 کاذب می‌دادند.
    """
    from app.core.rate_limit import get_rate_limiter

    get_rate_limiter().reset_for_tests()
    yield
    get_rate_limiter().reset_for_tests()
