import { build as viteBuild } from "vite";
import { findProjectRoot, readConfig } from "../util.ts";
import type { BlueprintConfig } from "../util.ts";
import { docsCommand } from "./docs.ts";
import path from "node:path";
import fs from "node:fs";

/**
 * `blueprint build` — production build via Vite.
 *
 * Finds the project root (nearest parent with blueprint.json),
 * then runs `vite build` in that directory. Vite + the blueprint
 * plugin handle the entire pipeline: .md → HTML, assets, bundling.
 */
export async function buildCommand(): Promise<void> {
  const cwd = process.cwd();
  const projectRoot = findProjectRoot(cwd);

  if (!projectRoot) {
    console.error(
      "Error: No blueprint.json found. Run this command from within a blueprint project."
    );
    process.exit(1);
  }

  // Check for vite.config.ts in the project root
  const viteConfigPath = path.join(projectRoot, "vite.config.ts");
  if (!fs.existsSync(viteConfigPath)) {
    console.error(
      "Error: No vite.config.ts found in project root. Is this a blueprint project?"
    );
    process.exit(1);
  }

  let cfg: BlueprintConfig;
  try {
    cfg = readConfig(projectRoot);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
  const cfgVite = cfg.vite ?? {};

  if (cfg.leanProjectPath) {
    try {
      await docsCommand();
    } catch (err) {
      console.warn(`Skipping Lean docs: ${(err as Error).message}`);
    }
  }

  console.log(`Building blueprint in ${projectRoot}...\n`);

  const outDir = cfgVite.build?.outDir ?? "dist";
  try {
    await viteBuild({
      ...cfgVite,
      root: projectRoot,
      configFile: viteConfigPath,
      logLevel: "info",
      build: {
        ...cfgVite.build,
        outDir,
      },
    });
    console.log(`\nBuild complete. Output in ${path.resolve(projectRoot, outDir)}/`);
    // The pooled Lean server keeps the event loop alive; we're done with it.
    process.exit(0);
  } catch (err) {
    console.error("Build failed:", err);
    process.exit(1);
  }
}
