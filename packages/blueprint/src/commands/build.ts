import { build as viteBuild } from "vite";
import { findProjectRoot, readConfig } from "../util.ts";
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

  // Build Lean docs first so the plugin can copy them into dist/docs/
  try {
    const cfg = readConfig(projectRoot);
    if (cfg.leanProjectPath) {
      await docsCommand();
    }
  } catch { /* no leanProjectPath, skip */ }

  console.log(`Building blueprint in ${projectRoot}...\n`);

  try {
    await viteBuild({
      root: projectRoot,
      configFile: viteConfigPath,
      logLevel: "info",
      build: {
        outDir: "dist",
      },
    });
    console.log(`\nBuild complete. Output in ${path.join(projectRoot, "dist")}/`);
  } catch (err) {
    console.error("Build failed:", err);
    process.exit(1);
  }
}
