import fs from "node:fs";
import path from "node:path";

export interface InitOptions {
  /** Target directory for the new blueprint project */
  dir?: string;
  /** Overwrite files even if the target directory is non-empty. */
  force?: boolean;
  /** Version of this CLI; the scaffolded dependency is pinned to it. */
  version: string;
}

const MAIN_TYP = `#import "/.blueprint/lib.typ": *

#show: blueprint.with(title: "My Blueprint")

#chapter("index.html", title: [Introduction], include "chapters/intro.typ")
`;

const INTRO_TYP = `#import "/.blueprint/lib.typ": *

= My Blueprint

Welcome to your blueprint. It combines informal mathematics with links to
formal Lean 4 proofs; the dependency graph tracks how far along each part is.

#definition("add_def", lean: "Nat.add")[
  We write $a + b$ for the result of adding $b$ to $a$.
]

#theorem("add_zero", lean: "Nat.add_zero", uses: ("add_def",))[
  For every natural number $n$, adding zero on the right leaves it unchanged:
  $n + 0 = n$.
]

#proof[
  By induction on $n$, using @add_def.
]

\`\`\`lean
theorem add_zero_right (n : Nat) : n + 0 = n := by
  simp
\`\`\`

#theorem("add_succ", lean: "Nat.add_succ", uses: ("add_def",))[
  For all $m, n$, we have $m + op("succ")(n) = op("succ")(m + n)$.
]
`;

/** Files that mark the root of a Lake project. */
const LAKEFILES = ["lakefile.toml", "lakefile.lean"];

const GITIGNORE = ["node_modules/", "dist/", ".blueprint/"];

/** The nearest directory at or above `dir` that holds a lakefile. */
export function findLakeProject(dir: string): string | undefined {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (LAKEFILES.some((f) => fs.existsSync(path.join(d, f)))) return d;
    if (path.dirname(d) === d) return undefined;
  }
}

/** `existing` with each of `entries` it lacks appended. */
export function mergeGitignore(existing: string, entries: string[]): string {
  const have = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const missing = entries.filter((e) => !have.has(e) && !have.has(e.replace(/\/$/, "")) && !have.has("/" + e));
  if (missing.length === 0) return existing;
  const sep = existing === "" || existing.endsWith("\n") ? "" : "\n";
  return existing + sep + missing.join("\n") + "\n";
}

/**
 * Adds the blueprint scripts and dependency to a package.json, keeping
 * everything already there. A script name that's taken gets a `blueprint:`
 * prefix instead.
 */
export function mergePackageJson(existing: Record<string, any>, version: string): Record<string, any> {
  const pkg = { ...existing };
  const scripts = { ...(pkg.scripts ?? {}) };
  for (const [name, cmd] of [["dev", "blueprint serve"], ["build", "blueprint build"]] as const) {
    if (Object.values(scripts).includes(cmd)) continue;
    scripts[scripts[name] === undefined ? name : `blueprint:${name}`] = cmd;
  }
  pkg.scripts = scripts;
  const listed = [pkg.dependencies, pkg.devDependencies].some((d) => d?.["@leandown/blueprint"] !== undefined);
  if (!listed) pkg.dependencies = { ...(pkg.dependencies ?? {}), "@leandown/blueprint": `^${version}` };
  return pkg;
}

/**
 * `blueprint init [dir]` — scaffold a new blueprint project.
 *
 * Inside an existing Lean project (a lakefile in the target directory or
 * above it), it points `leanProjectPath` there and leaves existing files
 * alone: `.gitignore` and `package.json` are added to, never replaced.
 */
export async function initCommand(options: InitOptions): Promise<void> {
  const targetDir = path.resolve(options.dir ?? process.cwd());
  const projectName = path.basename(targetDir);
  const lake = findLakeProject(targetDir);

  if (!lake && fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    if (!options.force) {
      console.error(
        `Error: Directory '${targetDir}' already exists and is not empty.\n` +
          `Use --force to overwrite.`,
      );
      process.exit(1);
    }
    console.log(`Directory '${targetDir}' already exists — will overwrite files.\n`);
  }

  console.log(`\nCreating blueprint project in ${targetDir}\n`);
  const leanProjectPath = lake ? path.relative(targetDir, lake).split(path.sep).join("/") || "." : "./lean";
  if (lake) console.log(`Using the Lean project at ${leanProjectPath === "." ? "the same directory" : leanProjectPath}\n`);

  const read = (rel: string) => {
    const file = path.join(targetDir, rel);
    return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : undefined;
  };
  const pkgText = read("package.json");
  const pkg = mergePackageJson(pkgText ? JSON.parse(pkgText) : { name: projectName, private: true, type: "module" }, options.version);
  const files: Record<string, string> = {
    "blueprint.json": JSON.stringify({ name: projectName, leanProjectPath }, null, 2) + "\n",
    "main.typ": MAIN_TYP,
    "chapters/intro.typ": INTRO_TYP,
    ...(lake ? {} : { "lean/.gitkeep": "" }),
  };
  // Merged into what's there rather than replaced.
  const merged: Record<string, string> = {
    "package.json": JSON.stringify(pkg, null, 2) + "\n",
    ".gitignore": mergeGitignore(read(".gitignore") ?? "", GITIGNORE),
  };

  const write = (rel: string, content: string, note: string) => {
    const dest = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    console.log(`  ${rel}${note}`);
  };
  for (const [rel, content] of Object.entries(files)) {
    const exists = read(rel) !== undefined;
    if (exists && !options.force) console.log(`  ${rel} (exists, kept)`);
    else write(rel, content, "");
  }
  for (const [rel, content] of Object.entries(merged)) {
    const before = read(rel);
    if (before === content) console.log(`  ${rel} (unchanged)`);
    else write(rel, content, before === undefined ? "" : " (updated)");
  }

  console.log();
  console.log("Next steps:");
  if (path.resolve(options.dir ?? process.cwd()) !== process.cwd()) console.log(`  cd ${targetDir}`);
  console.log(`  bun install                 # or npm install`);
  if (!lake) console.log(`  (cd lean && lake init ${projectName.replace(/[^A-Za-z0-9]/g, "") || "Blueprint"})`);
  const script = (cmd: string) => Object.keys(pkg.scripts).find((k) => pkg.scripts[k] === cmd);
  console.log(`  bun run ${script("blueprint serve")}`.padEnd(30) + "# live preview");
  console.log(`  bun run ${script("blueprint build")}`.padEnd(30) + "# static site in dist/");
}
