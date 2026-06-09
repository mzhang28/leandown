import { execSync, spawn } from "node:child_process";
import { findProjectRoot, readConfig } from "../util.ts";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

export interface DocsOptions {
  /** Run lake build :docs in the background (non-blocking). */
  background?: boolean;
}

/**
 * `blueprint docs` — build Lean documentation via `lake build :docs`.
 *
 * Finds the project root, reads `leanProjectPath` from blueprint.json,
 * then runs lake in that directory.  Output is redirected to a temp file
 * so the terminal stays clean; only the log path is printed.
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

  // Pipe all lake output to a temp file so the terminal stays clean.
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "blueprint-docs-"));
  const logPath = path.join(logDir, "lake.log");

  console.log(`Building Lean docs in ${leanDir}...`);
  console.log(`  (output → ${logPath})`);

  if (opts.background) {
    const out = fs.openSync(logPath, "w");
    const child = spawn("lake", ["build", ":docs"], {
      cwd: leanDir,
      stdio: ["ignore", out, out],
      detached: false,
    });
    child.on("close", (code) => {
      fs.closeSync(out);
      if (code === 0)
        console.log("[blueprint] Lean docs ready at /docs/");
      else
        console.error(
          `[blueprint] lake build :docs exited with code ${code}.  See ${logPath}`,
        );
    });
    return;
  }

  const out = fs.openSync(logPath, "w");
  try {
    execSync("lake build :docs", {
      cwd: leanDir,
      stdio: ["ignore", out, out],
    });
    console.log("Lean docs built successfully.");
  } catch {
    console.error(
      `lake build :docs failed.  See ${logPath}`,
    );
    process.exit(1);
  } finally {
    fs.closeSync(out);
  }
}
