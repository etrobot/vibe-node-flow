#!/usr/bin/env bash
set -euo pipefail

echo "==> Building project..."
pnpm run build

echo "==> Copying SEA entry into dist/"
cp sea-entry.cjs dist/sea-entry.cjs

echo "==> Generating SEA blob..."
node --experimental-sea-config sea-config.json

echo "==> Copying Node.js binary..."
cp "$(command -v node)" dist/vibe-node-flow

echo "==> Removing code signature (macOS)..."
codesign --remove-signature dist/vibe-node-flow 2>/dev/null || true

echo "==> Injecting SEA blob into binary..."
pnpm exec postject dist/vibe-node-flow NODE_SEA_BLOB dist/sea-prep.blob \
  --sentinel-native NODE_SEA_FOR_SEA

echo "==> Re-signing (macOS)..."
codesign --sign - dist/vibe-node-flow 2>/dev/null || true

echo ""
echo "✅ Pack complete!  Executable → dist/vibe-node-flow"
echo "   Default port: 39741 (override with PORT env var)"
echo "   Run: ./dist/vibe-node-flow"