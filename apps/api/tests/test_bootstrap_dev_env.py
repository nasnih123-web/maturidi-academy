"""FIX2-06 — env توسعهٔ محلی bootstrap + چک‌لیست سلامت واقعی.

قرارداد:
- write_dev_env.py یک env صریحِ فقط-dev می‌سازد (نه کپی قالب
  production): APP_ENV=dev، دیتابیس SQLite، CAPTCHA_ENABLED=false
  (با دلیل مستند)، بای‌پس فقط-dev ClamAV روشن و پرسر و صدا، و
  secretهای تصادفی تازه (نه CHANGE_ME). فایل موجود بازنویسی نمی‌شود.
- bootstrap_check.py روی سرویس زنده سه چک واقعی می‌زند و با هر
  شکست غیرصفر خارج می‌شود (این‌جا روی stub HTTP قطعی تست می‌شود).
- نحو اسکریپت‌های پوسته معتبر است (bash -n).
"""
from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
WRITE_ENV = REPO_ROOT / "tools" / "dev" / "write_dev_env.py"
CHECK = REPO_ROOT / "tools" / "dev" / "bootstrap_check.py"


def _load_write_env():
    spec = importlib.util.spec_from_file_location("write_dev_env", WRITE_ENV)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_rendered_dev_env_parses_with_expected_values(tmp_path, monkeypatch):
    module = _load_write_env()
    monkeypatch.setattr(module, "ROOT", tmp_path)
    assert module.main() == 0

    from app.core.config import Settings

    settings = Settings(_env_file=str(tmp_path / ".env"))
    assert settings.app_env == "dev"
    assert settings.captcha_enabled is False
    assert settings.clamav_allow_insecure_dev_bypass is True
    assert settings.database_url.startswith("sqlite")
    assert settings.jwt_secret not in ("", "CHANGE_ME")
    assert len(settings.jwt_secret) >= 32
    assert "localhost:5173" in settings.cors_allow_origins

    api_env = (tmp_path / "apps" / "api" / ".env").read_text(encoding="utf-8")
    assert "CAPTCHA_ENABLED=false" in api_env
    assert "CLAMAV_ALLOW_INSECURE_DEV_BYPASS=true" in api_env


def test_write_dev_env_never_overwrites(tmp_path, monkeypatch):
    module = _load_write_env()
    monkeypatch.setattr(module, "ROOT", tmp_path)
    assert module.main() == 0
    target = tmp_path / ".env"
    target.write_text("EDITED=by-user\n", encoding="utf-8")
    assert module.main() == 0
    assert target.read_text(encoding="utf-8") == "EDITED=by-user\n"


# ---------------------------------------------------------------------------
# bootstrap_check روی stub HTTP قطعی
# ---------------------------------------------------------------------------


def _stub_server(transcribe_status: int, transcribe_code: str | None):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # سکوت لاگ تست
            pass

        def _json(self, status: int, payload: dict):
            raw = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            if self.path == "/health":
                self._json(200, {"status": "ok", "env": "dev"})
            else:
                self._json(404, {})

        def do_POST(self):
            length = int(self.headers.get("Content-Length") or 0)
            self.rfile.read(length)
            if self.path == "/api/v1/auth/register":
                self._json(201, {"id": "u1"})
            elif self.path == "/api/v1/auth/login":
                self._json(200, {"access_token": "tok"})
            elif self.path == "/api/v1/voice/transcribe":
                if transcribe_status == 200:
                    self._json(200, {"text": ""})
                else:
                    self._json(
                        transcribe_status,
                        {"error": {"code": transcribe_code, "message": "stub"}},
                    )
            else:
                self._json(404, {})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


def _run_check(server) -> subprocess.CompletedProcess:
    port = server.server_address[1]
    return subprocess.run(
        [sys.executable, str(CHECK), "--base-url", f"http://127.0.0.1:{port}"],
        capture_output=True, text=True, timeout=60, check=False,
    )


def test_bootstrap_check_passes_when_scan_ok_and_stt_unconfigured():
    server = _stub_server(503, "stt_unavailable")
    try:
        proc = _run_check(server)
    finally:
        server.shutdown()
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert proc.stdout.count("✓") >= 4  # health/register/login/upload + جمع‌بندی


def test_bootstrap_check_fails_when_antivirus_unavailable():
    server = _stub_server(503, "antivirus_unavailable")
    try:
        proc = _run_check(server)
    finally:
        server.shutdown()
    assert proc.returncode == 1
    assert "✗" in proc.stdout


@pytest.mark.skipif(not shutil.which("bash"), reason="bash در این محیط نیست")
def test_shell_scripts_syntax_ok():
    for script in (REPO_ROOT / "bootstrap.sh", REPO_ROOT / "apps" / "api" / "setup.sh"):
        proc = subprocess.run(
            ["bash", "-n", str(script)], capture_output=True, text=True, check=False
        )
        assert proc.returncode == 0, f"{script}: {proc.stderr}"
