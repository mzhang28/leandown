#!/usr/bin/env bash
# prepublish.sh — Prepares the remark-lean package for npm publication.
#
# Steps performed:
#   1. Validate the working tree is clean (no uncommitted changes)
#   2. Ensure we are on the main/master branch
#   3. Install dependencies
#   4. Build the package (JS + type declarations + CSS)
#   5. Verify expected dist artifacts exist
#   6. Run a dry-run publish to preview what will be uploaded
#   7. Prompt for confirmation, then publish
#
# Usage:
#   bash scripts/prepublish.sh [--skip-git-checks] [--dry-run]

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[info]${RESET}  $*"; }
success() { echo -e "${GREEN}[ok]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[warn]${RESET}  $*"; }
error()   { echo -e "${RED}[error]${RESET} $*" >&2; }
die()     { error "$*"; exit 1; }

# ── Flags ─────────────────────────────────────────────────────────────────────
SKIP_GIT_CHECKS=false
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --skip-git-checks) SKIP_GIT_CHECKS=true ;;
    --dry-run)         DRY_RUN=true ;;
    *) die "Unknown argument: $arg" ;;
  esac
done

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PKG_DIR="$REPO_ROOT/packages/remark-lean"

echo -e "\n${BOLD}═══════════════════════════════════════════════${RESET}"
echo -e "${BOLD}   remark-lean — npm publish preparation${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════════${RESET}\n"

# ── 1. Git checks ─────────────────────────────────────────────────────────────
if [ "$SKIP_GIT_CHECKS" = false ]; then
  info "Checking git status…"

  if ! git -C "$REPO_ROOT" rev-parse --git-dir &>/dev/null; then
    die "Not inside a git repository."
  fi

  # Require clean working tree
  if ! git -C "$REPO_ROOT" diff --quiet || ! git -C "$REPO_ROOT" diff --cached --quiet; then
    die "Working tree has uncommitted changes. Commit or stash them first."
  fi
  success "Working tree is clean."

  # Require main or master branch
  CURRENT_BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
  if [[ "$CURRENT_BRANCH" != "main" && "$CURRENT_BRANCH" != "master" ]]; then
    warn "You are on branch '$CURRENT_BRANCH', not 'main'/'master'."
    read -r -p "Continue anyway? [y/N] " CONFIRM
    [[ "$CONFIRM" =~ ^[Yy]$ ]] || die "Aborted."
  else
    success "On branch '$CURRENT_BRANCH'."
  fi
else
  warn "--skip-git-checks is set; skipping git validation."
fi

# ── 2. Read current version ────────────────────────────────────────────────────
PKG_VERSION="$(node -p "require('$PKG_DIR/package.json').version")"
PKG_NAME="$(node    -p "require('$PKG_DIR/package.json').name")"
info "Package: ${BOLD}${PKG_NAME}@${PKG_VERSION}${RESET}"

# ── 3. Install dependencies ────────────────────────────────────────────────────
info "Installing dependencies…"
(cd "$REPO_ROOT" && bun install --frozen-lockfile)
success "Dependencies installed."

# ── 4. Build ───────────────────────────────────────────────────────────────────
info "Building package…"
(cd "$PKG_DIR" && bun run build)
success "Build complete."

# ── 5. Verify dist artifacts ───────────────────────────────────────────────────
info "Verifying dist artifacts…"

EXPECTED_FILES=(
  "dist/index.js"
  "dist/index.d.ts"
  "dist/runtime.js"
  "dist/runtime.d.ts"
  "dist/lean.css"
)

MISSING=()
for f in "${EXPECTED_FILES[@]}"; do
  if [ ! -f "$PKG_DIR/$f" ]; then
    MISSING+=("$f")
  fi
done

if [ "${#MISSING[@]}" -gt 0 ]; then
  error "Missing expected dist files:"
  for m in "${MISSING[@]}"; do echo "  • $m"; done
  die "Build output is incomplete. Aborting."
fi
success "All expected dist files present."

# ── 6. Dry-run publish ─────────────────────────────────────────────────────────
info "Running npm publish --dry-run to preview upload…"
echo ""
(cd "$PKG_DIR" && npm publish --dry-run --access public 2>&1)
echo ""

# ── 7. Confirm & publish ───────────────────────────────────────────────────────
if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}[dry-run]${RESET} Skipping actual publish (--dry-run flag set)."
  echo -e "\n${BOLD}Ready to publish ${PKG_NAME}@${PKG_VERSION}.${RESET}"
  echo -e "Run without ${CYAN}--dry-run${RESET} to publish for real.\n"
  exit 0
fi

echo -e "${BOLD}Ready to publish ${PKG_NAME}@${PKG_VERSION} to npm.${RESET}"
read -r -p "$(echo -e "${YELLOW}Publish now?${RESET} [y/N] ")" PUBLISH_CONFIRM

if [[ "$PUBLISH_CONFIRM" =~ ^[Yy]$ ]]; then
  info "Publishing…"
  (cd "$PKG_DIR" && npm publish --access public)
  success "Published ${PKG_NAME}@${PKG_VERSION} 🎉"
else
  warn "Aborted. No package was published."
  exit 0
fi
