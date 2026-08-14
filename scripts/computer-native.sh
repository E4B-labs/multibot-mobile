#!/usr/bin/env bash
# multibot: the bot computer WITHOUT Docker.
#
# Same desktop, same interface, no container: an X server, a window manager, a
# Chromium with CDP, and websockify serving noVNC — on exactly the ports the
# container publishes (cdp 9223, novnc 6901), so the harness proxy and
# engine/server/computer.py work against either backend unchanged.
#
# This exists for hosts where Docker cannot run at all. The obvious one is
# Termux on Android: Docker needs kernel privileges an unrooted phone will
# never grant, so the container path is not "hard" there, it is impossible.
#
# SECURITY, and this is the real difference from the container: there is NO
# isolation here. The browser and `computer_exec` run as your own user, on your
# own machine, with your own files — including MultiBot's own data directory and
# API keys. The container backend confines an agent to a throwaway filesystem;
# this one does not. Prefer Docker wherever it exists.
set -uo pipefail

DISPLAY_NUM="${MULTIBOT_COMPUTER_DISPLAY:-1}"
CDP_PORT="${MULTIBOT_COMPUTER_CDP_PORT:-9223}"
NOVNC_PORT="${MULTIBOT_COMPUTER_NOVNC_PORT:-6901}"
VNC_PORT="${MULTIBOT_COMPUTER_VNC_PORT:-5901}"
GEOMETRY="${MULTIBOT_COMPUTER_GEOMETRY:-1024x768}"

ROOT="${MULTIBOT_COMPUTER_HOME:-$HOME/.multibot-computer}"
LOG="$ROOT/logs"
mkdir -p "$LOG" "$ROOT/chrome"

export DISPLAY=":$DISPLAY_NUM"

have() { command -v "$1" >/dev/null 2>&1; }

# Termux keeps chromium out of PATH under that name.
CHROME=""
for candidate in "${PREFIX:-/usr}/lib/chromium/chrome" chromium-browser chromium google-chrome; do
  if [ -x "$candidate" ]; then CHROME="$candidate"; break; fi
  if have "$candidate"; then CHROME="$(command -v "$candidate")"; break; fi
done
[ -n "$CHROME" ] || { echo "no chromium/chrome found" >&2; exit 1; }
have Xvnc || { echo "Xvnc missing — install tigervnc" >&2; exit 1; }

running() { pgrep -f "$1" >/dev/null 2>&1; }

# -localhost: the screen is reachable only through the harness, never off-box.
# -SecurityTypes None is safe only BECAUSE of that; the harness auth gate is
# what actually protects it.
if ! running "Xvnc :$DISPLAY_NUM"; then
  setsid Xvnc ":$DISPLAY_NUM" -geometry "$GEOMETRY" -depth 24 \
    -SecurityTypes None -localhost -rfbport "$VNC_PORT" \
    >"$LOG/xvnc.log" 2>&1 </dev/null &
  sleep 4
fi

# A window manager is not decoration: without one, Chromium's window has no
# frame, cannot be raised, and dialogs land off-screen.
if ! running "openbox"; then
  if have openbox; then
    setsid openbox >"$LOG/openbox.log" 2>&1 </dev/null &
  elif have xfce4-session; then
    setsid xfce4-session >"$LOG/wm.log" 2>&1 </dev/null &
  fi
  sleep 2
fi

# Headful on purpose — the user watches this exact window and can take control.
if ! running "$ROOT/chrome"; then
  setsid "$CHROME" \
    --no-sandbox \
    --disable-dev-shm-usage \
    --disable-gpu \
    --no-first-run \
    --no-default-browser-check \
    --remote-debugging-port="$CDP_PORT" \
    --user-data-dir="$ROOT/chrome" \
    --window-position=0,0 \
    --window-size="${GEOMETRY/x/,}" \
    about:blank >"$LOG/chrome.log" 2>&1 </dev/null &
fi

# noVNC over websockify, on the same port the container publishes.
if ! running "websockify.*$NOVNC_PORT"; then
  NOVNC_DIR="${MULTIBOT_NOVNC_DIR:-$ROOT/noVNC}"
  if [ -f "$NOVNC_DIR/vnc.html" ]; then
    setsid python3 -m websockify --web="$NOVNC_DIR" \
      "127.0.0.1:$NOVNC_PORT" "127.0.0.1:$VNC_PORT" \
      >"$LOG/websockify.log" 2>&1 </dev/null &
  else
    echo "noVNC missing at $NOVNC_DIR — the screen will not render" >&2
  fi
fi

exit 0
