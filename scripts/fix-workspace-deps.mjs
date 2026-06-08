#!/usr/bin/env node

/**
 * Reverts internal `@leandown/*` dependency versions back to `workspace:*`
 * after `changeset version` has converted them to concrete version ranges.
 *
 * This ensures local development always uses `workspace:*` protocol so that
 * package managers always resolve to the local workspace copy.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// All workspace package.json files that may contain internal @leandown/* deps
const pkgDirs = [
  "packages/core",
  "packages/remark",
  "packages/markdown-it",
  "packages/comark",
  "packages/blueprint",
  "docs",
  "examples/basic/markdown",
];

let changedCount = 0;

for (const dir of pkgDirs) {
  const pkgPath = resolve(root, dir, "package.json");
  let original;
  try {
    original = readFileSync(pkgPath, "utf8");
  } catch {
    continue; // skip if no package.json
  }

  const pkg = JSON.parse(original);
  let modified = false;

  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const deps = pkg[field];
    if (!deps) continue;

    for (const [name, version] of Object.entries(deps)) {
      if (
        name.startsWith("@leandown/") &&
        version !== "workspace:*" &&
        version !== "workspace:^" &&
        version !== "workspace:~"
      ) {
        deps[name] = "workspace:*";
        modified = true;
      }
    }
  }

  if (modified) {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`  ✓ reverted internal deps → workspace:* in ${dir}/package.json`);
    changedCount++;
  }
}

if (changedCount > 0) {
  console.log(`\nReverted ${changedCount} package(s) back to workspace:*`);
} else {
  console.log("No internal deps needed reverting.");
}
