import fs from "node:fs";
import path from "node:path";
import { loadProject, siteOptions } from "../util.ts";
import { SiteBuilder } from "../site/builder.ts";
import { DevServer } from "../site/server.ts";
import { docsCommand } from "./docs.ts";

export interface ServeOptions {
  port?: number;
  host?: string;
}

/** Changes under these directories never trigger a rebuild. */
const IGNORED = new Set(["node_modules", ".git", ".lake", ".blueprint"]);

/**
 * `blueprint serve` — build, serve, and rebuild on changes to `.typ` and
 * `.lean` files, reloading open pages.
 */
export async function serveCommand(opts: ServeOptions = {}): Promise<void> {
  const { root, cfg } = loadProject();
  const options = siteOptions(root, cfg);
  const outDir = path.join(root, options.outDir);

  if (cfg.leanProjectPath) {
    docsCommand({ background: true }).catch((err) => {
      console.warn(`Skipping Lean docs: ${(err as Error).message}`);
    });
  }

  const builder = new SiteBuilder(options);
  let building = false;
  let pending = false;
  const server = new DevServer({
    outDir,
    docsDir: options.leanProjectPath && path.join(options.leanProjectPath, ".lake", "build", "doc"),
  });

  async function rebuild(): Promise<void> {
    if (building) {
      pending = true;
      return;
    }
    building = true;
    const started = Date.now();
    const result = await builder.build();
    building = false;
    if (result.ok) {
      console.log(`[blueprint] built in ${Date.now() - started} ms`);
      server.reload();
    }
    if (pending) {
      pending = false;
      await rebuild();
    }
  }

  await rebuild();
  // An explicit --port is honoured exactly; the default moves on if taken.
  const port = await server.listen(opts.port ?? 5173, opts.host, opts.port !== undefined);
  console.log(`\n  Blueprint: http://${opts.host ?? "localhost"}:${port}/\n`);

  const outName = path.relative(root, outDir).split(path.sep)[0];
  let timer: ReturnType<typeof setTimeout> | undefined;
  fs.watch(root, { recursive: true }, (_event, file) => {
    if (!file) return;
    const parts = file.split(path.sep);
    if (parts.some((p) => IGNORED.has(p)) || parts[0] === outName) return;
    if (!/\.(typ|lean|json|bib|png|svg|jpe?g)$/.test(file)) return;
    clearTimeout(timer);
    timer = setTimeout(() => void rebuild(), 150);
  });

  const stop = async () => {
    await server.close();
    await builder.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
