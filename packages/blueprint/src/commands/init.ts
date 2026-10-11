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

/**
 * `blueprint init [dir]` — scaffold a new blueprint project.
 */
export async function initCommand(options: InitOptions): Promise<void> {
  const targetDir = path.resolve(options.dir ?? process.cwd());
  const projectName = path.basename(targetDir);

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
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

  const files: Record<string, string> = {
    "blueprint.json": JSON.stringify({ name: projectName, leanProjectPath: "./lean" }, null, 2) + "\n",
    "main.typ": MAIN_TYP,
    "chapters/intro.typ": INTRO_TYP,
    "package.json":
      JSON.stringify(
        {
          name: projectName,
          private: true,
          type: "module",
          scripts: { dev: "blueprint serve", build: "blueprint build" },
          dependencies: { "@leandown/blueprint": `^${options.version}` },
        },
        null,
        2,
      ) + "\n",
    ".gitignore": "node_modules/\ndist/\n.blueprint/\n",
    "lean/.gitkeep": "",
  };
  for (const [rel, content] of Object.entries(files)) {
    const dest = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
    console.log(`  ${rel}`);
  }

  console.log();
  console.log("Next steps:");
  console.log(`  cd ${targetDir}`);
  console.log(`  bun install                 # or npm install`);
  console.log(`  (cd lean && lake init ${projectName.replace(/[^A-Za-z0-9]/g, "") || "Blueprint"})`);
  console.log(`  bun run dev                 # live preview`);
  console.log(`  bun run build               # static site in dist/`);
}
