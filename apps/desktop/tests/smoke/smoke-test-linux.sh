#!/usr/bin/env bash
# Smoke test for the Tauri desktop shell on Linux (Phase 9).
#
# What it really checks, in a real Xvfb X session on this machine:
#   1. unconfigured launch shows a window (built-in shell page)
#   2. remote-origin probe (127.0.0.1:8931): fetch + WebSocket echo work,
#      getUserMedia outcome is recorded by error NAME (OverconstrainedError
#      = WebKitGTK granted at its level but no device in the sandbox; on
#      Linux WebKitGTK 2.52 getUserMedia NEVER fires the permission-request
#      signal, so the mic cannot be denied via the handler there — see the
#      limitation note in main.rs and the phase-9 notes), geolocation is
#      DENIED by the handler (proves the handler is wired and active),
#      and Tauri IPC is DENIED (no remote capability for that origin)
#   2b. deny-path hop: after the probe hops to localhost:8932 (an origin
#      that does NOT match the configured base), geolocation must still be
#      denied there — proving the handler runs on the hopped origin too.
#      (A mic-deny hop test is impossible on Linux WebKitGTK: no signal
#      fires for getUserMedia, so there is nothing for the handler to deny.)
#   3. localhost probe (localhost:8932): Tauri IPC is ALLOWED via
#      capabilities/local-dev.json, recording flag round-trips
#   4. close guard: with --hifz-smoke-recording, closing the window is
#      refused (window + process survive); without the flag it closes
#   5. resize/maximize via the window manager
#
# What it does NOT check (recorded as NOT TESTED, not passed):
#   - macOS / Windows (no runners here), multi-display (Xvfb has one
#     virtual monitor), real microphone audio (no capture device in the
#     sandbox), TLS/wss against the production API, the real web app
#     (probe pages stand in for it).
#
# Usage: tests/smoke/smoke-test-linux.sh [path-to-binary]
#   Default binary: src-tauri/target/debug/maturidi-academy-desktop
# Requires: Xvfb, wmctrl, xdotool, xwininfo, python3.
set -u
cd "$(dirname "$0")/../.."

BIN="${1:-src-tauri/target/debug/maturidi-academy-desktop}"
TMP="$(mktemp -d)"
LOG="$TMP/probe.log"
APP_LOG="$TMP/app.log"
PASS=0
FAIL=0
DISP=":99"

note() { printf '%s\n' "$*"; }
ok()   { PASS=$((PASS+1)); note "PASS: $*"; }
bad()  { FAIL=$((FAIL+1)); note "FAIL: $*"; }

[ -x "$BIN" ] || { echo "binary not found/executable: $BIN (run cargo build first)"; exit 2; }
for t in Xvfb wmctrl xdotool xwininfo python3; do
  command -v "$t" >/dev/null || { echo "missing tool: $t"; exit 2; }
done

cleanup() {
  # Never leave a probe URL in the repo's shell/config.js, even on early exit.
  [ -n "${CONFIG_BAK:-}" ] && [ -f "$CONFIG_BAK" ] && cp "$CONFIG_BAK" shell/config.js 2>/dev/null || true
  pkill -f "maturidi-academy-deskto[p]" 2>/dev/null || true
  [ -n "${PROBE_PID:-}" ] && kill "$PROBE_PID" 2>/dev/null || true
  [ -n "${OB_PID:-}" ] && kill "$OB_PID" 2>/dev/null || true
  [ -n "${XVFB_PID:-}" ] && kill "$XVFB_PID" 2>/dev/null || true
  sleep 1
}
trap cleanup EXIT

# --- X session -------------------------------------------------------------
# Xvfb alone has no window manager: wmctrl -l stays empty and EWMH
# maximize does nothing. Run openbox as the WM for this session.
Xvfb "$DISP" -screen 0 1920x1080x24 >/dev/null 2>&1 &
XVFB_PID=$!
export DISPLAY="$DISP"
for _ in $(seq 1 20); do wmctrl -l >/dev/null 2>&1 && break; sleep 0.5; done
openbox >/dev/null 2>&1 &
OB_PID=$!
for _ in $(seq 1 20); do wmctrl -l >/dev/null 2>&1 && break; sleep 0.5; done
note "monitors: $(xrandr --listmonitors 2>/dev/null | tr '\n' ' ')"
note "screen: $(xdpyinfo 2>/dev/null | grep -m1 dimensions)"

# --- packaging-time config ----------------------------------------------
# The shell page reads MATURIDI_WEB_URL from shell/config.js, which is
# EMBEDDED into the binary at build time (not read from disk at runtime,
# and not from the environment). So a probe origin has to be written into
# config.js and the binary rebuilt — exactly the packaging flow. The env
# var only affects the Rust-side URL resolution (studio docks), never the
# shell navigation. Restored + rebuilt at the end.
CARGO_BIN="${CARGO:-$HOME/.cargo/bin/cargo}"
CONFIG_BAK="$TMP/config.js.bak"
[ -f "$CONFIG_BAK" ] || cp shell/config.js "$CONFIG_BAK"
set_shell_url() { # url
  printf '// smoke test only — overwritten by the test, restored afterwards\nwindow.MATURIDI_WEB_URL = "%s";\n' "$1" > shell/config.js
  (cd src-tauri && CARGO_BUILD_JOBS=1 "$CARGO_BIN" build 2>&1 | tail -2)
  [ -x "$BIN" ] || { echo "rebuild failed after setting shell URL to $1"; exit 2; }
}
restore_shell() {
  cp "$CONFIG_BAK" shell/config.js
  (cd src-tauri && CARGO_BUILD_JOBS=1 "$CARGO_BIN" build 2>&1 | tail -2)
}

# --- probe server ----------------------------------------------------------
python3 tests/smoke/probe_server.py "$LOG" >"$TMP/probe-server.log" 2>&1 &
PROBE_PID=$!
for _ in $(seq 1 30); do
  python3 -c "import socket; socket.create_connection(('127.0.0.1',8931),timeout=1); socket.create_connection(('127.0.0.1',8932),timeout=1)" 2>/dev/null && break
  sleep 0.5
done
python3 -c "import socket; socket.create_connection(('127.0.0.1',8931),timeout=2); socket.create_connection(('127.0.0.1',8932),timeout=2)" \
  || { echo "probe server did not come up"; cat "$TMP/probe-server.log"; exit 2; }

window_present() { # true when the main window exists (WM list OR direct X query)
  wmctrl -l 2>/dev/null | grep -q "Maturidi Academy" \
    || xdotool search --name "Maturidi Academy" 2>/dev/null | grep -q .
}
wait_window() { # seconds
  for _ in $(seq 1 "$1"); do
    window_present && return 0
    sleep 1
  done
  return 1
}
wait_probe() { # origin-substring seconds
  for _ in $(seq 1 "$2"); do
    grep -q "$1" "$LOG" 2>/dev/null && return 0
    sleep 1
  done
  return 1
}
start_app() { # env assignments... -- binary args...
  env -u MATURIDI_WEB_URL "$@" "$BIN" >>"$APP_LOG" 2>&1 &
  APP_PID=$!
}
stop_app() {
  pkill -f "maturidi-academy-desktop" 2>/dev/null || true
  for _ in $(seq 1 15); do pgrep -f "maturidi-academy-desktop" >/dev/null || return 0; sleep 1; done
  pkill -9 -f "maturidi-academy-desktop" 2>/dev/null || true
  return 1
}
probe_check() { # origin-substring jq-ish python predicate
  python3 - "$LOG" "$1" <<'PY' 2>/dev/null
import json, sys
want = sys.argv[2]
found = None
with open(sys.argv[1]) as f:
    for line in f:
        try: obj = json.loads(line)
        except Exception: continue
        if want in obj.get("server_origin", ""):
            found = obj
if not found:
    print("NO-PROBE-LINE"); sys.exit(1)
print(json.dumps(found, ensure_ascii=False))
PY
}

# --- 1. unconfigured launch -----------------------------------------------
note "--- 1. unconfigured launch (built-in shell page)"
: >"$APP_LOG"
start_app
if wait_window 30; then ok "window appeared (unconfigured)"; else bad "no window in 30s (unconfigured)"; fi
wmctrl -l | grep "Maturidi Academy" || true
xwininfo -name "Maturidi Academy" 2>/dev/null | grep -E "Width|Height" || true
pgrep -f "maturidi-academy-desktop" >/dev/null && ok "process alive (unconfigured)" || bad "process died (unconfigured)"
stop_app

# --- 2. remote origin: fetch + WS work, IPC denied -------------------------
note "--- 2. remote origin http://127.0.0.1:8931/ (production-like)"
set_shell_url "http://127.0.0.1:8931/?hop=localhost:8932"
: >"$APP_LOG"
env MATURIDI_WEB_URL="http://127.0.0.1:8931/" DISPLAY="$DISP" "$BIN" >>"$APP_LOG" 2>&1 &
wait_window 30 || bad "no window (remote probe)"
if wait_probe "127.0.0.1:8931" 60; then
  LINE="$(probe_check "127.0.0.1:8931")"
  note "probe[127.0.0.1]: $LINE"
  echo "$LINE" | python3 -c "import json,sys; c=json.load(sys.stdin)['checks']; assert c['fetch'].get('ok') is True, c; print('fetch ok')" \
    && ok "fetch same-origin works (remote)" || bad "fetch failed (remote)"
  echo "$LINE" | python3 -c "import json,sys; c=json.load(sys.stdin)['checks']; assert c['websocket'].get('ok') is True, c; print('ws echo ok')" \
    && ok "websocket echo works (remote)" || bad "websocket echo failed (remote)"
  echo "$LINE" | python3 -c "import json,sys; c=json.load(sys.stdin)['checks']; assert c['tauri_ipc'].get('ok') is False, c; print('ipc denied as expected')" \
    && ok "tauri IPC denied on remote origin (expected, no remote capability)" \
    || bad "tauri IPC unexpectedly allowed on remote origin"
  GM="$(echo "$LINE" | python3 -c "import json,sys; c=json.load(sys.stdin)['checks'].get('getUserMedia',{}); print(c.get('error') or 'GRANTED')")"
  note "getUserMedia (remote, base=127.0.0.1): $GM"
  case "$GM" in
    NotAllowedError|SecurityError) bad "microphone permission denied on matching origin ($GM)" ;;
    NotFoundError|OverconstrainedError) ok "microphone reached device enumeration on matching origin (WebKit-level grant, no device: $GM)" ;;
    GRANTED) ok "microphone permission granted on matching origin (stream opened)" ;;
    *) bad "unexpected getUserMedia outcome: $GM" ;;
  esac
  GEO="$(echo "$LINE" | python3 -c "import json,sys; c=json.load(sys.stdin)['checks'].get('geolocation',{}); print(c.get('error') or 'GRANTED')")"
  note "geolocation (remote): $GEO"
  case "$GEO" in
    *"User denied"*) ok "permission handler active: geolocation denied on remote origin" ;;
    *) bad "geolocation NOT denied on remote origin: $GEO" ;;
  esac
else
  bad "probe page never reported (remote origin)"
fi
# --- 2b. deny path on the hopped origin: the probe hops to localhost:8932,
# an origin that does NOT match the configured base (127.0.0.1:8931).
# Geolocation must be denied there too (handler runs on the hopped origin
# and denies). Microphone cannot be deny-tested on Linux WebKitGTK — no
# permission-request signal fires for getUserMedia, so there is nothing
# for the handler to deny (see main.rs limitation note).
note "--- 2b. permission deny path on hopped origin (localhost:8932)"
HOP_OK=0
hop_denied() {
  python3 - "$LOG" <<'PY' 2>/dev/null
import json, sys
with open(sys.argv[1]) as f:
    for line in f:
        try: obj = json.loads(line)
        except Exception: continue
        if obj.get("origin") == "http://localhost:8932":
            geo = obj.get("checks", {}).get("geolocation", {})
            if geo.get("code") == 1 and "User denied" in str(geo.get("error", "")):
                print("hop probe geolocation:", json.dumps(geo, ensure_ascii=False))
                sys.exit(0)
sys.exit(1)
PY
}
for _ in $(seq 1 40); do
  if hop_denied; then HOP_OK=1; break; fi
  sleep 1
done
[ "$HOP_OK" = 1 ] && ok "permission handler denies geolocation on non-matching origin too" || bad "permission handler did NOT deny geolocation on non-matching origin (see probe log)"
stop_app

# --- 3. localhost origin: IPC allowed --------------------------------------
note "--- 3. localhost origin http://localhost:8932/ (tauri dev-like)"
set_shell_url "http://localhost:8932/"
env MATURIDI_WEB_URL="http://localhost:8932/" DISPLAY="$DISP" "$BIN" >>"$APP_LOG" 2>&1 &
wait_window 30 || bad "no window (localhost probe)"
if wait_probe "localhost:8932" 60; then
  LINE="$(probe_check "localhost:8932")"
  note "probe[localhost]: $LINE"
  echo "$LINE" | python3 -c "import json,sys; c=json.load(sys.stdin)['checks']; assert c['tauri_ipc'].get('ok') is True, c; print('ipc allowed')" \
    && ok "tauri IPC allowed on localhost (local-dev capability)" \
    || bad "tauri IPC denied on localhost (local-dev capability broken)"
  echo "$LINE" | python3 -c "import json,sys; c=json.load(sys.stdin)['checks']; assert c['recording_flag'].get('ok') is True, c; print('recording flag round-trip ok')" \
    && ok "hifz_set/is_recording_active round-trip works" \
    || bad "recording flag round-trip failed"
else
  bad "probe page never reported (localhost origin)"
fi
stop_app

# --- 4. close guard ---------------------------------------------------------
# NOTE: close with `wmctrl -c` (proper EWMH _NET_CLOSE_WINDOW via the WM).
# `xdotool windowclose` sends a direct client message that destroys the
# window WITHOUT a CloseRequested event in this WebKitGTK/tao stack, so it
# bypasses any app-level close guard — it is not a valid test for the
# guard, and it is not how users close windows (WM button / Alt+F4 go
# through the WM like wmctrl -c).
# Tests 4a/4b/5 must run against the UNCONFIGURED shell page: a stale probe
# URL in config.js would load the probe page, whose recording_flag check
# sets recording=true and would make 4b look like a guard refusal.
note "--- 4a. close guard WITH recording (must refuse)"
restore_shell
env MATURIDI_WEB_URL="http://127.0.0.1:8931/" DISPLAY="$DISP" "$BIN" --hifz-smoke-recording >>"$APP_LOG" 2>&1 &
wait_window 30 || bad "no window (guard test)"
sleep 2
wmctrl -c "Maturidi Academy"
sleep 5
if window_present && pgrep -f "maturidi-academy-desktop" >/dev/null; then
  ok "close refused while recording (window + process survive)"
else
  bad "window/process closed despite active recording"
fi
stop_app
note "--- 4b. close WITHOUT recording (must close)"
env MATURIDI_WEB_URL="http://127.0.0.1:8931/" DISPLAY="$DISP" "$BIN" >>"$APP_LOG" 2>&1 &
wait_window 30 || bad "no window (control test)"
sleep 2
wmctrl -c "Maturidi Academy"
CLOSED=0
for _ in $(seq 1 15); do pgrep -f "maturidi-academy-desktop" >/dev/null || { CLOSED=1; break; }; sleep 1; done
[ "$CLOSED" = 1 ] && ok "window closed normally when not recording" || bad "window did not close when not recording"
stop_app

# --- 5. resize / maximize ---------------------------------------------------
note "--- 5. resize / maximize"
env -u MATURIDI_WEB_URL DISPLAY="$DISP" "$BIN" >>"$APP_LOG" 2>&1 &
wait_window 30 || bad "no window (resize test)"
GEO1="$(xwininfo -name "Maturidi Academy" 2>/dev/null | grep -E 'Width|Height' | tr '\n' ' ')"
note "geometry before maximize: $GEO1"
wmctrl -r "Maturidi Academy" -b add,maximized_vert,maximized_horz
sleep 2
GEO2="$(xwininfo -name "Maturidi Academy" 2>/dev/null | grep -E 'Width|Height' | tr '\n' ' ')"
note "geometry after maximize: $GEO2"
W2="$(echo "$GEO2" | sed -n 's/.*Width: \([0-9]*\).*/\1/p')"
if [ -n "$W2" ] && [ "$W2" -ge 1900 ]; then ok "maximize works ($GEO2)"; else bad "maximize did not expand window ($GEO2)"; fi
wmctrl -r "Maturidi Academy" -b remove,maximized_vert,maximized_horz
sleep 1
stop_app

note "--- restoring shell/config.js + rebuilding pristine binary"
restore_shell
git -C "$(pwd)" diff --quiet -- shell/config.js && ok "shell/config.js restored to repo state" || bad "shell/config.js NOT restored"
note "--- app log tail (last 20 lines)"
tail -20 "$APP_LOG"
note "--- probe log"
cat "$LOG"
note "=== SMOKE RESULT: PASS=$PASS FAIL=$FAIL (tmp: $TMP) ==="
[ "$FAIL" = 0 ]
