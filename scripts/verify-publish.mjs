#!/usr/bin/env node
/**
 * verify-publish.mjs — simulates what publish-packages.mjs does, but uses
 * `npm pack` instead of `npm publish` so nothing goes to the registry.
 *
 * For each package:
 *   1. Applies the same publishConfig promotion + workspace:* → version rewrite
 *   2. Runs `npm pack` to produce a tarball
 *   3. Extracts the tarball and checks key fields in the packed package.json
 *   4. Restores the original package.json
 *   5. Deletes the tarball
 *
 * Exits 1 if any package's packed exports still reference .ts files.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const PACK_ORDER = [
  "packages/core",
  "packages/remark",
  "packages/markdown-it",
  "packages/comark",
  "packages/blueprint",
];

const versionMap = new Map();
for (const dir of PACK_ORDER) {
  const pkg = JSON.parse(readFileSync(resolve(root, dir, "package.json"), "utf8"));
  versionMap.set(pkg.name, pkg.version);
}

const tmpDir = resolve(root, ".verify-publish-tmp");
mkdirSync(tmpDir, { recursive: true });

let failed = false;

for (const dir of PACK_ORDER) {
  const pkgDir = resolve(root, dir);
  const pkgPath = resolve(pkgDir, "package.json");
  const original = readFileSync(pkgPath, "utf8");
  const pkg = JSON.parse(original);

  console.log(`\n── ${pkg.name}@${pkg.version} ─────────────────────────`);

  // Same patching as publish-packages.mjs
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    for (const [name, ver] of Object.entries(pkg[field] ?? {})) {
      if (ver.startsWith("workspace:")) {
        const resolved = versionMap.get(name);
        if (resolved) pkg[field][name] = `^${resolved}`;
      }
    }
  }
  if (pkg.publishConfig) {
    for (const [key, value] of Object.entries(pkg.publishConfig)) {
      if (key !== "registry" && key !== "access") {
        pkg[key] = value;
      }
    }
  }

  try {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

    // Pack into tmpDir
    execSync(`npm pack --pack-destination ${tmpDir}`, { cwd: pkgDir, stdio: "pipe" });

    // Find the tarball
    const tgz = readdirSync(tmpDir).find(f => f.endsWith(".tgz"));
    if (!tgz) throw new Error("npm pack produced no tarball");

    const tgzPath = resolve(tmpDir, tgz);

    // Extract package/package.json from the tarball
    const raw = execSync(`tar -xOf ${tgzPath} package/package.json`, { encoding: "utf8" });
    const packed = JSON.parse(raw);

    console.log("  exports:");
    for (const [key, val] of Object.entries(packed.exports ?? {})) {
      const imp = typeof val === "string" ? val : val.import ?? val.default ?? JSON.stringify(val);
      const bad = imp && imp.endsWith(".ts");
      console.log(`    ${key}: ${imp}${bad ? "  ← ✗ STILL .TS" : "  ✓"}`);
      if (bad) failed = true;
    }

    rmSync(tgzPath);
  } finally {
    writeFileSync(pkgPath, original);
  }
}

rmSync(tmpDir, { recursive: true, force: true });

if (failed) {
  console.error("\n✗ Some exports still point to .ts source files!\n");
  process.exit(1);
} else {
  console.log("\n✓ All packed exports resolve to .js dist files.\n");
}
