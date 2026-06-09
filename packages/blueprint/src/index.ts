#!/usr/bin/env node

import { command, subcommands, run, option, flag, string, optional } from "cmd-ts";
import { initCommand } from "./commands/init.ts";
import { buildCommand } from "./commands/build.ts";
import { serveCommand } from "./commands/serve.ts";
import { docsCommand } from "./commands/docs.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf-8"));

const init = command({
  name: "init",
  description: "Create a new blueprint project",
  args: {
    dir: option({
      type: optional(string),
      long: "dir",
      short: "d",
      description: "Target directory for the new project",
    }),
    force: flag({
      long: "force",
      short: "f",
      description: "Overwrite files even if target directory is non-empty",
    }),
  },
  handler: async (args) => {
    await initCommand({ dir: args.dir, force: args.force });
  },
});

const build = command({
  name: "build",
  args: {},
  description: "Build the blueprint for production (runs vite build)",
  handler: async () => {
    await buildCommand();
  },
});

const serve = command({
  name: "serve",
  args: {
    port: option({ type: optional(string), long: "port", short: "p", description: "Port to listen on" }),
    host: option({ type: optional(string), long: "host", description: "Hostname to listen on" }),
    open: flag({ long: "open", description: "Open browser on start" }),
    strictPort: flag({ long: "strictPort", description: "Exit if port is already in use" }),
  },
  description: "Start the Vite dev server with HMR and live reload",
  handler: async (args) => {
    await serveCommand({
      port: args.port ? parseInt(args.port, 10) : undefined,
      host: args.host,
      open: args.open || undefined,
      strictPort: args.strictPort || undefined,
    });
  },
});

const docs = command({
  name: "docs",
  args: {},
  description: "Build Lean documentation via lake build :docs",
  handler: async () => {
    await docsCommand();
  },
});

const versionCmd = command({
  name: "version",
  args: {},
  description: "Print the version",
  handler: () => {
    console.log(pkg.version);
  },
});

const blueprint = subcommands({
  name: "blueprint",
  description:
    "All-in-one CLI for managing Lean blueprint projects — markdown-based mathematical documents with Lean formalization tracking",
  cmds: {
    init,
    build,
    serve,
    docs,
    version: versionCmd,
  },
});

async function main(): Promise<void> {
  try {
    await run(blueprint, process.argv.slice(2));
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
