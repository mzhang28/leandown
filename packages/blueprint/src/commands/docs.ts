import { execSync, spawn } from "node:child_process";
import { findProjectRoot, readConfig } from "../util.ts";
import path from "node:path";
import fs from "node:fs";

export interface DocsOptions {
  /** Run lake build :docs in the background (non-blocking). */
  background?: boolean;
}

/**
 * `blueprint docs` — build Lean documentation via `lake build :docs`.
 *
 * Finds the project root, reads `leanProjectPath` from blueprint.json,
 * then runs lake in that directory. Pass `background: true` to fire-and-forget
 * (used by `blueprint serve` so the dev server starts immediately).
 */
export async function docsCommand(opts: DocsOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const projectRoot = findProjectRoot(cwd);

  if (!projectRoot) {
    console.error("Error: No blueprint.json found.");
    process.exit(1);
  }

  let cfg;
  try {
    cfg = readConfig(projectRoot);
  } catch {
    console.error("Error: Could not read blueprint.json.");
    process.exit(1);
  }

  if (!cfg.leanProjectPath) {
    console.error("Error: leanProjectPath not set in blueprint.json.");
    process.exit(1);
  }

  const leanDir = path.resolve(projectRoot, cfg.leanProjectPath);

  if (!fs.existsSync(leanDir)) {
    console.error(`Error: Lean project directory not found: ${leanDir}`);
    process.exit(1);
  }

  console.log(`Building Lean docs in ${leanDir}...`);

  if (opts.background) {
    const child = spawn("lake", ["build", ":docs"], {
      cwd: leanDir,
      stdio: "inherit",
      detached: false,
    });
    child.on("close", (code) => {
      if (code === 0) console.log("\n[blueprint] Lean docs ready at /docs/");
      else console.error(`\n[blueprint] lake build :docs exited with code ${code}`);
    });
    return;
  }

  execSync("lake build :docs", { cwd: leanDir, stdio: "inherit" });
  console.log("Lean docs built successfully.");
}
