import fs from "node:fs";
import path from "node:path";

export interface BlueprintConfig {
  /** Project name */
  name: string;
  /** Path to the Lean project, relative to the blueprint root */
  leanProjectPath?: string;
  /** Source directory for markdown files (default: "src") */
  srcDir?: string;
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
  return JSON.parse(raw) as BlueprintConfig;
}
