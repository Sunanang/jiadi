#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VAR_DIR="${TRIM_PKGVAR:-$ROOT/var}"
RUNTIME_DIR="$VAR_DIR/runtime"
PID_FILE="$RUNTIME_DIR/server.pid"
if [[ -n "${TRIM_APPDEST:-}" ]]; then
  SOCKET_PATH="${FNOS_SOCKET_PATH:-$TRIM_APPDEST/app.sock}"
else
  SOCKET_PATH="${FNOS_SOCKET_PATH:-$RUNTIME_DIR/app.sock}"
fi

if [[ ! -f "$PID_FILE" ]]; then
  rm -f "$SOCKET_PATH"
  echo "not running"
  exit 0
fi
PID="$(tr -d '[:space:]' <"$PID_FILE" || true)"
if [[ "$PID" =~ ^[1-9][0-9]*$ ]] && kill -0 "$PID" 2>/dev/null; then
  kill -TERM "$PID" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.2
  done
  if kill -0 "$PID" 2>/dev/null; then
    kill -KILL "$PID" 2>/dev/null || true
  fi
fi
rm -f "$PID_FILE" "$SOCKET_PATH"
rm -f "${VAR_DIR}/data/server.lock" 2>/dev/null || true
echo "stopped"
