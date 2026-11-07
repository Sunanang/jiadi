#!/usr/bin/env bash
# Assemble fnOS FPK from fnos/ + current app sources. Does not mutate source tree app payload permanently.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FNPACK="${FNPACK:-}"
if [[ -z "$FNPACK" ]]; then
  if command -v fnpack >/dev/null 2>&1; then FNPACK="$(command -v fnpack)"
  elif [[ -x "$HOME/.local/bin/fnpack" ]]; then FNPACK="$HOME/.local/bin/fnpack"
  else echo "错误: 未找到 fnpack" >&2; exit 1; fi
fi

VERSION="$(node -p "require('$ROOT/package.json').version")"
MANIFEST_VER="$(sed -n 's/^version[[:space:]]*=[[:space:]]*//p' "$ROOT/fnos/manifest" | head -1 | tr -d '[:space:]')"
UI_VER="$(sed -n "s/^const APP_VERSION = '\([0-9.]*\)';.*/\1/p" "$ROOT/jiadi-ui.html" | head -1)"
[[ -n "$UI_VER" ]] || { echo "错误: jiadi-ui.html 里找不到 const APP_VERSION（关于面板版本号）" >&2; exit 1; }
[[ "$VERSION" == "$MANIFEST_VER" ]] || { echo "错误: package.json($VERSION) 与 fnos/manifest($MANIFEST_VER) 版本不一致" >&2; exit 1; }
[[ "$VERSION" == "$UI_VER" ]] || { echo "错误: package.json($VERSION) 与 jiadi-ui.html APP_VERSION($UI_VER) 不一致" >&2; exit 1; }

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/jiadi-fpk.XXXXXX")"
cleanup() { rm -rf -- "$STAGE"; }
trap cleanup EXIT

PAYLOAD="$STAGE/payload"
mkdir -p "$PAYLOAD"
rsync -a --exclude '.DS_Store' --exclude '*.fpk' --exclude 'app/server.mjs' --exclude 'app/ledger-domain.mjs' \
  --exclude 'app/shared-client.js' --exclude 'app/jiadi-ui.html' --exclude 'app/package.json' \
  "$ROOT/fnos/" "$PAYLOAD/"

# Runtime files live at TRIM_APPDEST root (fnpack extracts app/).
cp "$ROOT/server.mjs" "$ROOT/ledger-domain.mjs" "$ROOT/shared-client.js" "$ROOT/jiadi-ui.html" "$ROOT/package.json" \
  "$PAYLOAD/app/"

chmod +x "$PAYLOAD"/cmd/*

(cd "$STAGE" && "$FNPACK" build --directory "$PAYLOAD")
PKG="$STAGE/jiadi.fpk"
[[ -s "$PKG" ]] || { echo "错误: fnpack 未生成 jiadi.fpk" >&2; exit 1; }

mkdir -p "$ROOT/dist"
OUT="$ROOT/dist/jiadi-${VERSION}-fnos-all.fpk"
mv -f "$PKG" "$OUT"
node -e "
const {createHash}=require('crypto'),fs=require('fs');
const p=process.argv[1];
const d=createHash('sha256').update(fs.readFileSync(p)).digest('hex');
fs.writeFileSync(p+'.sha256', d+'  '+require('path').basename(p)+'\n');
console.log(p, d);
" "$OUT"
echo "已生成: $OUT ($(du -h "$OUT" | cut -f1))"
