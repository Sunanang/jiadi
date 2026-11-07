#!/bin/bash
# 家底前端交互测试：把应用跑进无头浏览器，真实点击验证
# 用法: ./run.sh [probe文件名]   不带参数则跑全部
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$(dirname "$HERE")/jiadi-ui.html"
PORT=8899
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

[ -f "$SRC" ] || { echo "找不到 $SRC"; exit 1; }

# 每次从源文件重建，并注入 TEST_LOCAL（避免测到旧副本）
rm -rf "$HERE/build" && mkdir -p "$HERE/build"
sed 's|<script src="./shared-client.js">|<script>window.JIADI_TEST_LOCAL=1;</script>\n<script src="./shared-client.js">|' "$SRC" > "$HERE/build/jiadi-ui.html"
cp "$HERE"/seed.json "$HERE/build/" 2>/dev/null || true
cp /tmp/jtest/shared-client.js "$HERE/build/" 2>/dev/null || true
cp /tmp/jtest/ledger-domain.mjs "$HERE/build/" 2>/dev/null || true

cd "$HERE/build"
(python3 -m http.server $PORT >/dev/null 2>&1 &) ; sleep 1.5

PROBES="${1:-probe-backfill.html probe-sweep.html probe-guards.html probe-mobile.html}"
for p in $PROBES; do
  [ -f "$HERE/$p" ] || continue
  cp "$HERE/$p" "$HERE/build/"
  echo "--- $p ---"
  "$CHROME" --headless=new --disable-gpu --no-sandbox \
    --user-data-dir="/tmp/cp_$$_$p" --window-size=1300,1000 \
    --virtual-time-budget=18000 --dump-dom "http://127.0.0.1:$PORT/$p" 2>/dev/null \
    | grep -o 'RESULT::[^<]*' | sed 's/RESULT:://' | tr '|' '\n'
done
pkill -f "http.server $PORT" 2>/dev/null || true
