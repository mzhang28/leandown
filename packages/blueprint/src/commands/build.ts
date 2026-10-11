import fs from "node:fs";
import path from "node:path";
import { loadProject, siteOptions } from "../util.ts";
import { SiteBuilder } from "../site/builder.ts";
import { docsCommand } from "./docs.ts";

/**
 * `blueprint build` — build the Typst blueprint into a static site.
 */
export async function buildCommand(): Promise<void> {
  const { root, cfg } = loadProject();
  const options = siteOptions(root, cfg);

  if (cfg.leanProjectPath) {
    try {
      await docsCommand();
    } catch (err) {
      console.warn(`Skipping Lean docs: ${(err as Error).message}`);
    }
  }

  console.log(`Building blueprint in ${root}...`);
  const builder = new SiteBuilder(options);
  const result = await builder.build();
  await builder.close();
  if (!result.ok) {
    console.error("Build failed.");
    process.exit(1);
  }

  const outDir = path.join(root, options.outDir);
  if (options.leanProjectPath) {
    const docsDir = path.join(options.leanProjectPath, ".lake", "build", "doc");
    if (fs.existsSync(docsDir)) {
      fs.cpSync(docsDir, path.join(outDir, "docs"), { recursive: true });
    }
  }
  console.log(`Build complete: ${result.files.length} files in ${outDir}/`);
  // The pooled Lean server keeps the event loop alive; we're done with it.
  process.exit(0);
}
