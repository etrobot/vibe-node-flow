#!/usr/bin/env bash
set -euo pipefail

echo "==> Building project..."
pnpm run build

echo "==> Copying SEA entry into dist/"
cp sea-entry.cjs dist/sea-entry.cjs

echo "==> Generating SEA blob..."
node --experimental-sea-config sea-config.json

echo "==> Copying Node.js binary..."
cp "$(command -v node)" dist/genno
chmod u+w dist/genno

echo "==> Removing code signature (macOS)..."
codesign --remove-signature dist/genno 2>/dev/null || true

echo "==> Injecting SEA blob into binary..."
pnpm exec postject dist/genno NODE_SEA_BLOB dist/sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

echo "==> Re-signing (macOS)..."
codesign --sign - dist/genno 2>/dev/null || true

echo ""
echo "✅ Pack complete!  Executable → dist/genno"
echo "   Default port: 39741 (override with PORT env var)"
echo "   Run: ./dist/genno"
