import fs from "node:fs";
import path from "node:path";

export interface BlueprintConfig {
  /** Project name */
  name: string;
  /** Path to the Lean project, relative to the blueprint root */
  leanProjectPath?: string;
  /**
   * Lean modules to import when checking declarations for the dependency
   * graph (default: the root module of every `lean_lib` in the lakefile).
   */
  leanImports?: string[];
  /** Typst entry file, relative to the blueprint root (default: "main.typ") */
  entry?: string;
  /** Output directory, relative to the blueprint root (default: "dist") */
  outDir?: string;
}

/**
 * Walks up the directory tree from `startDir` to find a directory
 * containing `blueprint.json`. Returns the directory path, or null.
 */
export function findProjectRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  while (true) {
    const configPath = path.join(dir, "blueprint.json");
    if (fs.existsSync(configPath)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Reads and parses the `blueprint.json` config file from the given project root.
 */
export function readConfig(projectRoot: string): BlueprintConfig {
  const configPath = path.join(projectRoot, "blueprint.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(`No blueprint.json found in ${projectRoot}`);
  }
  const raw = fs.readFileSync(configPath, "utf-8");
  try {
    return JSON.parse(raw) as BlueprintConfig;
  } catch (err) {
    throw new Error(`Invalid ${configPath}: ${(err as Error).message}`);
  }
}

/**
 * Like `readConfig`, but returns `undefined` when there is no
 * `blueprint.json`. A malformed file still throws.
 */
export function readConfigIfExists(projectRoot: string): BlueprintConfig | undefined {
  if (!fs.existsSync(path.join(projectRoot, "blueprint.json"))) return undefined;
  return readConfig(projectRoot);
}

/** Build options for a project, from its blueprint.json. */
export function siteOptions(root: string, cfg: BlueprintConfig) {
  return {
    root,
    entry: cfg.entry ?? "main.typ",
    outDir: cfg.outDir ?? "dist",
    leanProjectPath: cfg.leanProjectPath ? path.resolve(root, cfg.leanProjectPath) : undefined,
    leanImports: cfg.leanImports,
  };
}

/** Loads blueprint.json for the project containing the cwd, or exits. */
export function loadProject(): { root: string; cfg: BlueprintConfig } {
  const root = findProjectRoot(process.cwd());
  if (!root) {
    console.error("Error: No blueprint.json found. Run this command from within a blueprint project.");
    process.exit(1);
  }
  try {
    return { root, cfg: readConfig(root) };
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}
