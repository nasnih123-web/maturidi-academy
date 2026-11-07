#!/usr/bin/env python3
"""Probe server for the Tauri desktop smoke test (stdlib only).

Serves the probe page on two origins at once:
  - http://127.0.0.1:8931/  (NOT covered by capabilities/local-dev.json
    -> Tauri IPC must be DENIED there; this is the production-like case)
  - http://localhost:8932/ (covered by local-dev.json -> IPC must work)

Endpoints:
  GET  /          probe page (tests/smoke/probe.html)
  GET  /__ping    {"ok": true}
  POST /__probe   appends one JSON line to the log file (argv[1])
  GET  /__ws      minimal WebSocket echo (one text frame round-trip)

Usage: probe_server.py <log-file>
"""
import base64
import hashlib
import json
import os
import struct
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = sys.argv[1]
LOG_LOCK = threading.Lock()


def log_line(obj):
    with LOG_LOCK:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(obj, ensure_ascii=False) + "\n")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # keep stdout clean
        pass

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/__ping":
            self._send(200, '{"ok":true}')
            return
        if path == "/__ws":
            self._ws_echo()
            return
        if path in ("/", "/index.html"):
            with open(os.path.join(HERE, "probe.html"), "rb") as f:
                self._send(200, f.read(), "text/html; charset=utf-8")
            return
        self._send(404, '{"error":"not found"}')

    def do_POST(self):
        if urlparse(self.path).path != "/__probe":
            self._send(404, '{"error":"not found"}')
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            obj = json.loads(raw.decode("utf-8"))
        except Exception as e:  # noqa: BLE001 - probe must never crash
            obj = {"error": f"bad json: {e}", "raw": raw.decode("utf-8", "replace")[:500]}
        obj["server_origin"] = f"http://{self.headers.get('Host')}"
        log_line(obj)
        self._send(200, '{"ok":true}')

    # -- minimal WebSocket (RFC 6455) echo: one masked text frame in/out --
    def _ws_echo(self):
        key = self.headers.get("Sec-WebSocket-Key", "")
        accept = base64.b64encode(
            hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()
        ).decode()
        self.send_response(101)
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        try:
            frame = self._read_exact(2)
            b1, b2 = frame[0], frame[1]
            masked = bool(b2 & 0x80)
            ln = b2 & 0x7F
            if ln == 126:
                ln = struct.unpack(">H", self._read_exact(2))[0]
            elif ln == 127:
                ln = struct.unpack(">Q", self._read_exact(8))[0]
            mask = self._read_exact(4) if masked else b""
            payload = self._read_exact(ln)
            if masked:
                payload = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
            # echo as one unmasked text frame (opcode 0x81)
            header = b"\x81" + bytes([len(payload)])
            self.wfile.write(header + payload)
            self.wfile.flush()
        except Exception:  # noqa: BLE001 - probe only
            pass

    def _read_exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.rfile.read(n - len(buf))
            if not chunk:
                raise EOFError("client closed")
            buf += chunk
        return buf


def serve(host, port):
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    open(LOG_FILE, "w").close()
    threads = [
        threading.Thread(target=serve, args=("127.0.0.1", 8931), daemon=True),
        threading.Thread(target=serve, args=("localhost", 8932), daemon=True),
    ]
    for t in threads:
        t.start()
    print("probe server up: 127.0.0.1:8931 + localhost:8932", flush=True)
    try:
        for t in threads:
            t.join()
    except KeyboardInterrupt:
        pass
