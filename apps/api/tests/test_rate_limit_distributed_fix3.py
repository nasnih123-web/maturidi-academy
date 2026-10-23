"""FIX3-03 — محدودیت نرخ توزیع‌شده برای آخرین مسیرهای درون‌حافظه‌ای (ADR-0050).

تا پیش از این fix دو مسیر حساس هنوز روی `rate_limiter` درون‌حافظه‌ایِ
app.core.security بودند: استریم/دانلود کتابخانه (`library_stream`)
و استعلام عمومی گواهی (`cert_verify`). با چند worker، هرکدام سقف
جدا می‌زدند و سقف واقعی چندبرابر می‌شد (قرارداد §۱۹.۳).

اثبات‌های این فایل:
۱) دو نمونهٔ مستقل limiter روی یک بک‌اند مشترک: سقفِ مجموع رعایت
   می‌شود، نه سقفِ هر نمونه جدا.
۲) تست چندپردازه‌ای واقعی: دو پردازهٔ جدا (subprocess) با کلاینت
   واقعی redis.asyncio روی یک بک‌اند TCP مشترک — شمارنده بیرون از
   هر دو پردازه زندگی می‌کند و مجموع مجازها دقیقاً سقف است.
   یادداشت صداقت: بک‌اند، یک سرور RESP مینیمالِ داخل تست است (همان
   دستورهای اتمیک SET NX EX / INCR که limiter استفاده می‌کند، زیر
   قفل) چون redis-server واقعی در این sandbox نیست؛ پردازه‌ها،
   سوکت و کلاینت کاملاً واقعی‌اند و خاصیتِ مورد اثبات (سقف مجموع
   بین پردازه‌ها) دقیقاً همان است که با Redis واقعی هم برقرار است.
۳) معنای fail-closed مسیرهای مهاجر: با Redisِ قطع و حالت
   production، auth=True رد می‌کند؛ در حالت dev fallback حافظه‌ای.
۴) سیم‌کشی HTTP: endpoint استعلام گواهی پس از سقف، 429 می‌دهد.
"""
from __future__ import annotations

import socketserver
import subprocess
import sys
import threading
import time
from pathlib import Path

from app.core.rate_limit import DistributedRateLimiter

API_DIR = Path(__file__).resolve().parents[1]
LIMIT_KEY = "cert_verify:203.0.113.7"


# ---------------------------------------------------------- ۱) دو نمونه


async def test_two_instances_share_one_backend_ceiling():
    from fakeredis import FakeServer
    from fakeredis.aioredis import FakeRedis

    server = FakeServer()
    rl_a = DistributedRateLimiter(FakeRedis(server=server), fail_closed_auth=False)
    rl_b = DistributedRateLimiter(FakeRedis(server=server), fail_closed_auth=False)
    allowed = 0
    for rl in [rl_a, rl_b] * 5:  # ۱۰ تلاش یکی‌درمیان از دو نمونه
        if await rl.is_allowed(LIMIT_KEY, limit=6, window_s=60, auth=True):
            allowed += 1
    assert allowed == 6, "سقف باید سقفِ مجموع دو نمونه باشد، نه ۶+۶"


# ------------------------------------------- ۲) چندپردازه‌ای با بک‌اند TCP


class _RespState:
    def __init__(self) -> None:
        self.data: dict[str, tuple[int, float | None]] = {}
        self.lock = threading.Lock()

    def _alive(self, key: str) -> bool:
        item = self.data.get(key)
        if item is None:
            return False
        if item[1] is not None and item[1] <= time.time():
            del self.data[key]
            return False
        return True


_STATE = _RespState()


class _RespHandler(socketserver.StreamRequestHandler):
    """RESP مینیمال: SET NX EX / INCR / DEL / PING — اتمیک زیر قفل."""

    def _read_command(self) -> list[bytes] | None:
        line = self.rfile.readline()
        if not line:
            return None
        if not line.startswith(b"*"):
            return []
        n = int(line[1:].strip())
        args = []
        for _ in range(n):
            header = self.rfile.readline()
            length = int(header[1:].strip())
            args.append(self.rfile.read(length))
            self.rfile.read(2)  # CRLF
        return args

    def _send(self, payload: bytes) -> None:
        self.wfile.write(payload)
        self.wfile.flush()

    def handle(self) -> None:
        while True:
            args = self._read_command()
            if args is None:
                return
            if not args:
                self._send(b"-ERR bad command\r\n")
                continue
            cmd = args[0].upper()
            with _STATE.lock:
                if cmd == b"PING":
                    self._send(b"+PONG\r\n")
                elif cmd == b"SET":
                    key = args[1].decode()
                    value = int(args[2])
                    rest = [a.upper() for a in args[3:]]
                    nx = b"NX" in rest
                    exp = None
                    if b"EX" in rest:
                        exp = time.time() + int(args[3 + rest.index(b"EX") + 1])
                    if nx and _STATE._alive(key):
                        self._send(b"$-1\r\n")
                    else:
                        _STATE.data[key] = (value, exp)
                        self._send(b"+OK\r\n")
                elif cmd in (b"INCR", b"INCRBY"):
                    # redis-py دستور incr را به INCRBY key 1 ترجمه می‌کند
                    step = int(args[2]) if cmd == b"INCRBY" else 1
                    key = args[1].decode()
                    if _STATE._alive(key):
                        value, exp = _STATE.data[key]
                        _STATE.data[key] = (value + step, exp)
                    else:
                        _STATE.data[key] = (step, None)
                    self._send(f":{ _STATE.data[key][0] }\r\n".encode())
                elif cmd == b"DEL":
                    removed = 0
                    for raw in args[1:]:
                        key = raw.decode()
                        if _STATE._alive(key):
                            del _STATE.data[key]
                            removed += 1
                    self._send(f":{removed}\r\n".encode())
                elif cmd in (b"CLIENT", b"AUTH", b"SELECT", b"COMMAND", b"CONFIG"):
                    self._send(b"+OK\r\n")
                else:
                    self._send(b"-ERR unknown command\r\n")


_WORKER = '''
import asyncio, sys
sys.path.insert(0, sys.argv[1])
from redis import asyncio as aioredis
from app.core.rate_limit import DistributedRateLimiter

async def main():
    port, key = int(sys.argv[2]), sys.argv[3]
    attempts, limit = int(sys.argv[4]), int(sys.argv[5])
    client = aioredis.from_url(
        f"redis://127.0.0.1:{port}/0", socket_connect_timeout=5
    )
    rl = DistributedRateLimiter(client, fail_closed_auth=False)
    allowed = 0
    for _ in range(attempts):
        if await rl.is_allowed(key, limit=limit, window_s=120, auth=True):
            allowed += 1
    print(allowed)
    await client.aclose()

asyncio.run(main())
'''


def test_multiprocess_combined_ceiling(tmp_path):
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), _RespHandler)
    server.daemon_threads = True
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    worker = tmp_path / "rl_worker.py"
    worker.write_text(_WORKER, encoding="utf-8")
    try:
        procs = [
            subprocess.Popen(
                [sys.executable, str(worker), str(API_DIR), str(port),
                 LIMIT_KEY, "8", "10"],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            )
            for _ in range(2)
        ]
        totals = []
        for proc in procs:
            out, err = proc.communicate(timeout=120)
            assert proc.returncode == 0, f"worker failed: {err[-500:]}"
            totals.append(int(out.strip()))
    finally:
        server.shutdown()
    # دو پردازه × ۸ تلاش با سقف ۱۰: مجموع مجازها دقیقاً ۱۰ است —
    # اگر هر پردازه سقف جدا داشت، ۱۶ می‌شد.
    assert sum(totals) == 10, f"per-process totals: {totals}"


# ------------------------------------------------- ۳) معنای fail-closed


async def test_migrated_namespaces_fail_closed_without_redis():
    from redis import asyncio as aioredis

    dead = aioredis.from_url(
        "redis://127.0.0.1:6399/0", socket_connect_timeout=0.5
    )
    prod = DistributedRateLimiter(dead, fail_closed_auth=True)
    assert not await prod.is_allowed(
        "cert_verify:198.51.100.3", limit=30, window_s=60, auth=True
    )
    assert not await prod.is_allowed(
        "library_stream:198.51.100.3", limit=60, window_s=60, auth=True
    )
    dev = DistributedRateLimiter(dead, fail_closed_auth=False)
    assert await dev.is_allowed(
        "cert_verify:198.51.100.4", limit=30, window_s=60, auth=True
    )
    await dead.aclose()


# ------------------------------------------------------ ۴) سیم‌کشی HTTP


async def test_http_cert_verify_route_enforces_limit(tc):
    """مسیر واقعی استعلام گواهی: ۳۰ تای اول از گیت رد می‌شوند (هر
    پاسخی غیر از 429)، سی‌ویکمی 429 rate_limited است — سقف روی
    limiter توزیع‌شده نشسته، نه نمونهٔ درون‌حافظه‌ای قدیمی."""
    for i in range(30):
        r = await tc["client"].get("/api/v1/certificates/UNKNOWN-CODE/verify")
        assert r.status_code != 429, f"attempt {i + 1} unexpectedly limited"
    r = await tc["client"].get("/api/v1/certificates/UNKNOWN-CODE/verify")
    assert r.status_code == 429, r.text
    assert r.json()["error"]["code"] == "rate_limited"
