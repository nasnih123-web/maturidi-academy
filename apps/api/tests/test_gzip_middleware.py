"""GZip روی API (پیشنهاد ۱، سرعت حفاظ).

زنجیرهٔ پیش‌بارگذاری نص ~۸٫۵ مگابایت JSON را بدون فشرده‌سازی
می‌گرفت؛ پاسخ‌های بزرگ باید با gzip برگردند و پاسخ‌های کوچک نه.
"""

from __future__ import annotations


def test_large_json_response_is_gzipped_when_client_asks():
    from starlette.testclient import TestClient

    from app.main import app

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/openapi.json", headers={"Accept-Encoding": "gzip"})
    assert resp.status_code == 200
    assert len(resp.content) > 1000
    assert resp.headers.get("content-encoding") == "gzip"


def test_small_response_is_not_gzipped():
    from starlette.testclient import TestClient

    from app.main import app

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/health", headers={"Accept-Encoding": "gzip"})
    assert resp.status_code == 200
    assert resp.headers.get("content-encoding") is None


def test_large_response_without_gzip_request_stays_plain():
    from starlette.testclient import TestClient

    from app.main import app

    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/openapi.json", headers={"Accept-Encoding": "identity"})
    assert resp.status_code == 200
    assert resp.headers.get("content-encoding") is None
