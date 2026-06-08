#!/usr/bin/env node

/**
 * Publishes all `@leandown/*` packages to npm with provenance.
 *
 * For each publishable package:
 *  1. Temporarily resolves `workspace:*` → `^{version}` in dependencies
 *  2. Runs `npm publish --provenance --access public`
 *  3. Restores the original `workspace:*` references
 *
 * This keeps `workspace:*` in the working tree for local dev while ensuring
 * published packages carry the correct concrete version ranges.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const PUBLISH_ORDER = [
  "packages/core",
  "packages/remark",
  "packages/markdown-it",
  "packages/comark",
  "packages/blueprint",
];

// --- Build a version map of all workspace packages ---
const versionMap = new Map();
for (const dir of PUBLISH_ORDER) {
  const pkg = JSON.parse(readFileSync(resolve(root, dir, "package.json"), "utf8"));
  versionMap.set(pkg.name, pkg.version);
}

console.log("Package versions:");
for (const [name, version] of versionMap) {
  console.log(`  ${name}@${version}`);
}
console.log();

// --- Patch all package.json files temporarily ---
const originalContents = new Map();

try {
  console.log("Patching packages for release...");
  for (const dir of PUBLISH_ORDER) {
    const pkgPath = resolve(root, dir, "package.json");
    const original = readFileSync(pkgPath, "utf8");
    originalContents.set(pkgPath, original);

    const pkg = JSON.parse(original);
    let needsPatch = false;

    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      const deps = pkg[field];
      if (!deps) continue;

      for (const [name, version] of Object.entries(deps)) {
        if (version === "workspace:*" || version === "workspace:^" || version === "workspace:~") {
          // Look up the actual version of the dependency
          const resolvedVersion = versionMap.get(name);
          if (resolvedVersion) {
            deps[name] = `^${resolvedVersion}`;
            needsPatch = true;
            console.log(`  ${pkg.name}: ${name} ${version} → ^${resolvedVersion}`);
          } else {
            console.warn(`  ⚠ ${pkg.name}: cannot resolve ${name} — skipping`);
          }
        }
      }
    }

    if (needsPatch) {
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    }
  }

  // --- Run changeset publish ---
  console.log("\n🚀 Publishing packages via changeset publish...");
  execSync("bun run changeset publish", {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      NPM_CONFIG_PROVENANCE: "true",
    },
  });
  console.log("\n✓ Publishing completed successfully.");

} catch (err) {
  console.error(`\n✗ Error during publishing: ${err.message}`);
  process.exitCode = 1;
} finally {
  // --- Restore the original package.json files ---
  console.log("\nReverting package.json files...");
  for (const [pkgPath, original] of originalContents) {
    try {
      writeFileSync(pkgPath, original);
    } catch (restoreErr) {
      console.error(`  ✗ failed to restore ${pkgPath}: ${restoreErr.message}`);
    }
  }
  console.log("✓ Reverted all package.json files.");
}
