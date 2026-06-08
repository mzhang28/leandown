import fs from "node:fs";
import path from "node:path";

/**
 * Minimal TOML parser for lakefile.toml.
 *
 * Handles the subset we need:
 *   - top-level keys: name, defaultTargets
 *   - [[lean_lib]] / [[lean_exe]] array-of-tables with name, root
 *
 * Does NOT support: inline tables, dotted keys, heterogenous arrays,
 * triple-quoted strings, or date/time types.
 */
export interface LakeConfig {
  name: string;
  version?: string;
  defaultTargets?: string[];
  libs: LakeLib[];
  exes: LakeExe[];
}

export interface LakeLib {
  name: string;
}

export interface LakeExe {
  name: string;
  root?: string;
}

/**
 * Parse a lakefile.toml into a structured LakeConfig.
 */
export function parseLakefile(filePath: string): LakeConfig {
  const src = fs.readFileSync(filePath, "utf-8");
  const lines = src.split("\n");

  const config: LakeConfig = { name: "unknown", libs: [], exes: [] };
  const defaultTargetsRaw: string[] = [];

  let currentTable: { type: "lib" | "exe"; data: Record<string, string> } | null =
    null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and blank lines
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Array-of-tables header: [[lean_lib]] or [[lean_exe]]
    const aotMatch = trimmed.match(/^\[\[lean_(lib|exe)\]\]$/);
    if (aotMatch) {
      // Flush previous table
      if (currentTable) flushTable(config, currentTable);
      currentTable = {
        type: aotMatch[1] as "lib" | "exe",
        data: {},
      };
      continue;
    }

    // Regular [section] — skip (we don't need nested sections for now)
    if (trimmed.startsWith("[")) {
      if (currentTable) flushTable(config, currentTable);
      currentTable = null;
      continue;
    }

    // Key = value
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    const value = parseTomlValue(trimmed.slice(eq + 1).trim());

    if (currentTable) {
      currentTable.data[key] = value;
    } else {
      // Top-level key
      if (key === "name") config.name = value;
      else if (key === "version") config.version = value;
      else if (key === "defaultTargets") {
        // Could be a string or an array parsed by parseTomlValue
        defaultTargetsRaw.push(value);
      }
    }
  }

  // Flush last table
  if (currentTable) flushTable(config, currentTable);

  // Parse defaultTargets — handle both `defaultTargets = ["a", "b"]` and
  // multiple `defaultTargets = "a"` lines (though the latter is unusual).
  // We do minimal array parsing.
  if (defaultTargetsRaw.length === 1 && defaultTargetsRaw[0]?.startsWith("[")) {
    config.defaultTargets = parseTomlArray(defaultTargetsRaw[0]);
  } else if (defaultTargetsRaw.length > 0) {
    config.defaultTargets = defaultTargetsRaw;
  }

  return config;
}

function flushTable(
  config: LakeConfig,
  table: { type: "lib" | "exe"; data: Record<string, string> }
): void {
  if (table.type === "lib") {
    config.libs.push({ name: table.data.name ?? "unnamed" });
  } else {
    config.exes.push({
      name: table.data.name ?? "unnamed",
      root: table.data.root,
    });
  }
}

/**
 * Parse a TOML value — handles quoted strings, booleans, bare strings.
 * Returns the unquoted string value for strings, or the raw string for bare words.
 */
function parseTomlValue(raw: string): string {
  raw = raw.trim();

  // Quoted string
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }

  // Boolean
  if (raw === "true") return "true";
  if (raw === "false") return "false";

  // Array
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw; // kept as-is for later array parsing
  }

  // Bare value (numbers, unquoted strings)
  return raw;
}

/**
 * Parse a TOML inline array like '["a", "b"]'
 */
function parseTomlArray(raw: string): string[] {
  const inner = raw.slice(1, -1); // strip [ ]
  const items: string[] = [];
  let current = "";
  let inString = false;
  let quoteChar = "";

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (inString) {
      if (ch === "\\" && i + 1 < inner.length) {
        current += inner[++i];
      } else if (ch === quoteChar) {
        inString = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inString = true;
      quoteChar = ch;
    } else if (ch === ",") {
      items.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) items.push(current.trim());
  return items.map((s) => {
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      return s.slice(1, -1);
    }
    return s;
  });
}

/**
 * Find all .lean source files under a directory, excluding hidden dirs
 * and build artifacts (.lake, _build, etc.).
 */
export function findLeanSources(projectPath: string): string[] {
  const results: string[] = [];
  const skip = new Set([".lake", "lake-packages", "_build", ".git", "node_modules"]);

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".") || skip.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile() && ent.name.endsWith(".lean")) {
        results.push(full);
      }
    }
  }

  walk(projectPath);
  return results;
}
