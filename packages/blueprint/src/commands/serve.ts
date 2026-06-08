import { createServer } from "vite";
import { findProjectRoot } from "../util.ts";
import path from "node:path";
import fs from "node:fs";

/**
 * `blueprint serve` — start the Vite dev server with HMR.
 *
 * Finds the project root, then starts Vite in dev mode.
 * The blueprint Vite plugin handles .md → HTML transformation
 * with live reload on file changes.
 */
export async function serveCommand(): Promise<void> {
  const cwd = process.cwd();
  const projectRoot = findProjectRoot(cwd);

  if (!projectRoot) {
    console.error(
      "Error: No blueprint.json found. Run this command from within a blueprint project."
    );
    process.exit(1);
  }

  const viteConfigPath = path.join(projectRoot, "vite.config.ts");
  if (!fs.existsSync(viteConfigPath)) {
    console.error(
      "Error: No vite.config.ts found in project root. Is this a blueprint project?"
    );
    process.exit(1);
  }

  console.log(`Starting dev server for blueprint in ${projectRoot}...\n`);

  try {
    const server = await createServer({
      root: projectRoot,
      configFile: viteConfigPath,
      server: {
        open: false,
      },
    });

    await server.listen();

    server.printUrls();
    server.bindCLIShortcuts({ print: true });

    // Keep alive
    process.on("SIGINT", async () => {
      await server.close();
      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      await server.close();
      process.exit(0);
    });
  } catch (err) {
    console.error("Failed to start dev server:", err);
    process.exit(1);
  }
}
