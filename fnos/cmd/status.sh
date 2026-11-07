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

if [[ -f "$PID_FILE" ]]; then
  PID="$(tr -d '[:space:]' <"$PID_FILE" || true)"
  if [[ "$PID" =~ ^[1-9][0-9]*$ ]] && kill -0 "$PID" 2>/dev/null; then
    echo "running pid=$PID socket=$SOCKET_PATH gateway=/app/jiadi"
    exit 0
  fi
  rm -f "$PID_FILE"
fi
echo "stopped"
exit 1
