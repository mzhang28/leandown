#!/usr/bin/env bun

/**
 * dev-link.ts — Link a blueprint project into the monorepo workspace so
 * local @leandown packages resolve from source during development.
 *
 * Usage:
 *   bun run scripts/dev-link.ts [target-dir]
 *
 * If no target directory is given, the current working directory is used.
 *
 * What it does:
 *   1. Surgically modifies the target project's package.json — replaces every
 *      @leandown/* version specifier with a `file:` path pointing at the
 *      corresponding package inside this monorepo.
 *   2. Adds the target directory to the root `package.json` workspaces list
 *      so transitive workspace dependencies (like @leandown/core ←
 *      workspace:* used by @leandown/blueprint) resolve correctly.
 *
 * After running this, run `bun install` from the monorepo root to apply.
 */

import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");
const ROOT_PKG_PATH = path.join(REPO_ROOT, "package.json");

const targetDir = path.resolve(process.argv[2] ?? process.cwd());
const pkgPath = path.join(targetDir, "package.json");

if (!fs.existsSync(pkgPath)) {
  console.error(`Error: no package.json found in ${targetDir}`);
  process.exit(1);
}

// ── Step 1: replace @leandown/* versions with file: paths ──────────────

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
const deps = (pkg.dependencies ?? {}) as Record<string, string>;

let linked = 0;

for (const [name, _version] of Object.entries(deps)) {
  if (!name.startsWith("@leandown/")) continue;

  const pkgName = name.slice("@leandown/".length);
  const srcDir = path.join(PACKAGES_DIR, pkgName);

  if (!fs.existsSync(srcDir)) {
    console.warn(
      `Warning: @leandown/${pkgName} not found at ${srcDir} — skipping.`
    );
    continue;
  }

  const oldValue = deps[name];
  deps[name] = `file:${srcDir}`;
  console.log(`  @leandown/${pkgName}:  "${oldValue}"  →  "file:${srcDir}"`);
  linked++;
}

if (linked > 0) {
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

// ── Step 2: add target to root workspaces ──────────────────────────────

const rootPkg = JSON.parse(fs.readFileSync(ROOT_PKG_PATH, "utf-8"));
const workspaces: string[] = rootPkg.workspaces ?? [];

// Compute a relative path from repo root to the target project
const relTarget = path.relative(REPO_ROOT, targetDir);

if (!workspaces.includes(relTarget)) {
  workspaces.push(relTarget);
  rootPkg.workspaces = workspaces;
  fs.writeFileSync(ROOT_PKG_PATH, JSON.stringify(rootPkg, null, 2) + "\n");
  console.log(`  + added "${relTarget}" to root workspaces`);
}

console.log(`\nLinked ${linked} package(s) and registered workspace.`);
console.log(`Run \`bun install\` from the repo root to apply.`);
