#!/usr/bin/env node

/**
 * pack-local.mjs — Pack all publishable @leandown/* packages into packs/
 *
 * Usage:
 *   node scripts/pack-local.mjs
 *
 * Produces a .tgz per package in <repo-root>/packs/. pnpm handles
 * workspace:* → real version and publishConfig promotion automatically.
 *
 * Installing in another project (pnpm):
 *   1. Run this script, copy the printed pnpm.overrides block into the
 *      target project's package.json, then run `pnpm install`.
 *
 * Why overrides? When pnpm installs a blueprint pack, it resolves blueprint's
 * transitive @leandown/* deps by semver from the registry — not from the
 * file: packs you installed at the top level. overrides forces every
 * resolution of @leandown/* to the local tarballs instead.
 */

import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const outDir = resolve(root, "packs");

mkdirSync(outDir, { recursive: true });

const PACK_ORDER = [
  "packages/core",
  "packages/remark",
  "packages/markdown-it",
  "packages/comark",
  "packages/blueprint",
];

const packed = [];   // [{ name, tgzPath }]

for (const dir of PACK_ORDER) {
  const pkgDir = resolve(root, dir);
  const pkgName = JSON.parse(readFileSync(resolve(pkgDir, "package.json"), "utf8")).name;
  console.log(`\nPacking ${dir}...`);

  execSync("pnpm pack", { cwd: pkgDir, stdio: "inherit" });

  const tgz = readdirSync(pkgDir).find((f) => f.endsWith(".tgz"));
  if (!tgz) {
    console.error(`  ✗ no .tgz found in ${pkgDir}`);
    process.exit(1);
  }

  const dest = resolve(outDir, tgz);
  renameSync(resolve(pkgDir, tgz), dest);
  packed.push({ name: pkgName, tgzPath: dest });
  console.log(`  → ${dest}`);
}

console.log("\n✓ All packs written to packs/\n");

// ── Instructions ────────────────────────────────────────────────────────────

const overrides = Object.fromEntries(packed.map(({ name, tgzPath }) => [name, `file:${tgzPath}`]));
const addArgs = packed.map(({ tgzPath }) => `file:${tgzPath}`).join(" ");

const yamlOverrides = Object.entries(overrides)
  .map(([k, v]) => `  '${k}': '${v}'`)
  .join("\n");

console.log("Add this to the target project's pnpm-workspace.yaml, then run `pnpm install`:");
console.log("(pnpm v10+ reads overrides from pnpm-workspace.yaml, not package.json)");
console.log();
console.log(`overrides:\n${yamlOverrides}`);
console.log();
console.log("Or add packages as direct deps in one shot:");
console.log(`  pnpm add ${addArgs}`);
