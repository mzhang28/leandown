#!/usr/bin/env bash
# Builds wasm/ from upstream typst.ts plus the patches in patches/.
#
# Reuses a checkout at $TYPST_TS_DIR (default: <repo>/3rd-party/typst.ts),
# cloning upstream at $TYPST_TS_TAG if it's missing and applying any patches
# that aren't applied yet. Needs rustup (the checkout pins its toolchain) and
# network access for wasm-pack.
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../.." && pwd)"
TYPST_TS_DIR="${TYPST_TS_DIR:-$REPO_ROOT/3rd-party/typst.ts}"
TYPST_TS_TAG="${TYPST_TS_TAG:-v0.8.0-rc3}"
WASM_PACK_VERSION="0.15.0"

if [ ! -d "$TYPST_TS_DIR/.git" ]; then
  git clone --depth 1 --branch "$TYPST_TS_TAG" https://github.com/Myriad-Dreamin/typst.ts.git "$TYPST_TS_DIR"
fi

cd "$TYPST_TS_DIR"
for patch in "$PKG_DIR"/patches/*.patch; do
  subject="$(sed -n 's/^Subject: \[PATCH[^]]*\] //p' "$patch" | head -1)"
  if git log --format=%s | grep -qxF "$subject"; then
    continue
  fi
  git -c user.name=leandown -c user.email=leandown@localhost am --3way "$patch"
done

rustup target add wasm32-unknown-unknown >/dev/null
rm -rf "$PKG_DIR/wasm"
(cd packages/compiler && npx -y "wasm-pack@$WASM_PACK_VERSION" build \
  --target nodejs --release \
  --out-dir "$PKG_DIR/wasm" --out-name typst_ts_web_compiler \
  -- --no-default-features --features web,bundle)
rm -f "$PKG_DIR/wasm/package.json" "$PKG_DIR/wasm/.gitignore" "$PKG_DIR/wasm/README.md"
