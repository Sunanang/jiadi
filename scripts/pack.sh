#!/usr/bin/env bash
# Build a self-contained delivery zip for the pinned package version.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VERSION="$(node -p "require('./package.json').version")"
NAME="jiadi-v${VERSION}"
STAGE="$(mktemp -d)/${NAME}"
mkdir -p "$STAGE" "$ROOT/dist"

rsync -a \
  --exclude '.git' \
  --exclude 'data' \
  --exclude 'dist' \
  --exclude 'node_modules' \
  --exclude '*.log' \
  --exclude 'ui-*.png' \
  --exclude 'home-ledger*.html' \
  --exclude 'AUDIT.md' \
  --exclude 'docs/audit-*.md' \
  --exclude 'docs/shared-ledger-*.md' \
  ./ "$STAGE/"

# Keep only the unified acceptance record under docs/
mkdir -p "$STAGE/docs"
cp docs/ACCEPTANCE.md "$STAGE/docs/ACCEPTANCE.md"

(
  cd "$(dirname "$STAGE")"
  rm -f "$ROOT/dist/${NAME}.zip"
  zip -qr "$ROOT/dist/${NAME}.zip" "$NAME"
)
rm -rf "$(dirname "$STAGE")"
echo "wrote dist/${NAME}.zip"
unzip -l "$ROOT/dist/${NAME}.zip" | sed -n '1,40p'
