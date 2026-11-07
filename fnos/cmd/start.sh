#!/bin/bash
# Start jiadi on the fnOS unified gateway Unix socket (no TCP port).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

fail() {
  local msg="$1"
  echo "$msg" >&2
  if [[ -n "${TRIM_TEMP_LOGFILE:-}" ]]; then
    printf '%s\n' "$msg" >>"$TRIM_TEMP_LOGFILE"
  fi
  exit 1
}

VAR_DIR="${TRIM_PKGVAR:-$ROOT/var}"
RUNTIME_DIR="$VAR_DIR/runtime"
DATA_DIR="$VAR_DIR/data"
PID_FILE="$RUNTIME_DIR/server.pid"
LOG_FILE="$RUNTIME_DIR/server.log"
mkdir -p "$RUNTIME_DIR" "$DATA_DIR"

if [[ -f "$PID_FILE" ]]; then
  old="$(tr -d '[:space:]' <"$PID_FILE" || true)"
  if [[ "$old" =~ ^[1-9][0-9]*$ ]] && kill -0 "$old" 2>/dev/null; then
    echo "already running pid=$old"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if [[ -n "${TRIM_APPDEST:-}" ]]; then
  SOCKET_PATH="${FNOS_SOCKET_PATH:-$TRIM_APPDEST/app.sock}"
  APP_ENTRY="$TRIM_APPDEST/server.mjs"
else
  SOCKET_PATH="${FNOS_SOCKET_PATH:-$RUNTIME_DIR/app.sock}"
  APP_ENTRY="$ROOT/app/server.mjs"
fi
[[ -f "$APP_ENTRY" ]] || fail "未找到应用入口 server.mjs，请重新安装"

export PATH="/var/apps/nodejs_v22/target/bin:/var/apps/nodejs_v24/target/bin:${PATH:-/usr/local/bin:/usr/bin}"
NODE_BIN="$(command -v node || true)"
[[ -n "$NODE_BIN" ]] || fail "未找到 Node.js。请先在应用中心安装 Node.js v22。"

rm -f "$SOCKET_PATH"
export FNOS_SOCKET_PATH="$SOCKET_PATH"
export FNOS_GATEWAY_PREFIX="${FNOS_GATEWAY_PREFIX:-/app/jiadi}"
export JIADI_DATA_DIR="$DATA_DIR"
export JIADI_TRUST_GATEWAY=1

nohup "$NODE_BIN" "$APP_ENTRY" >>"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"
sleep 0.4
if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  rm -f "$PID_FILE"
  fail "服务启动失败，请查看 $LOG_FILE"
fi
echo "started pid=$(cat "$PID_FILE") socket=$SOCKET_PATH prefix=$FNOS_GATEWAY_PREFIX data=$DATA_DIR"
