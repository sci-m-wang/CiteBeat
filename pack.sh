#!/usr/bin/env bash
# Build CiteBeat extension into dist/unpacked (for browser loading)
# and dist/citebeat-<version>.zip (for Web Store submission).
set -euo pipefail

cd "$(dirname "$0")"

VERSION=$(node -p "require('./manifest.json').version")
OUT_DIR="dist/unpacked"
ZIP="dist/citebeat-${VERSION}.zip"

rm -rf "$OUT_DIR" "$ZIP"
mkdir -p "$OUT_DIR"

# Files/folders that belong to the extension
cp manifest.json    "$OUT_DIR/"
cp background.js    "$OUT_DIR/"
cp -R icons         "$OUT_DIR/"
cp -R popup         "$OUT_DIR/"
cp -R options       "$OUT_DIR/"

# Remove macOS junk if any
find "$OUT_DIR" -name ".DS_Store" -delete

# Zip for Web Store (zip contents, not the wrapper dir)
( cd "$OUT_DIR" && zip -rq "../../$ZIP" . )

echo "Built:"
echo "  - $OUT_DIR/   (load unpacked here)"
echo "  - $ZIP        (upload to Chrome Web Store)"
