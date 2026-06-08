import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(__dirname, "./template");

export interface InitOptions {
  /** Target directory for the new blueprint project */
  dir?: string;
}

/**
 * Copy a file from the template directory to the target directory,
 * performing simple `{{key}}` placeholder substitution.
 */
function copyTemplate(
  templateName: string,
  targetPath: string,
  replacements: Record<string, string> = {}
): void {
  const srcPath = path.join(TEMPLATE_DIR, templateName);

  if (!fs.existsSync(srcPath)) {
    console.warn(`Template ${templateName} not found, skipping.`);
    return;
  }

  let content = fs.readFileSync(srcPath, "utf-8");

  // Simple placeholder substitution
  for (const [key, value] of Object.entries(replacements)) {
    content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }

  // Ensure parent directory exists
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(targetPath, content);
}

/**
 * `blueprint init [dir]` — scaffold a new blueprint project.
 */
export async function initCommand(options: InitOptions): Promise<void> {
  const targetDir = path.resolve(options.dir ?? process.cwd());
  const projectName = path.basename(targetDir);

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    console.error(
      `Error: Directory '${targetDir}' already exists and is not empty.`
    );
    process.exit(1);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  console.log(`\nCreating blueprint project in ${targetDir}\n`);

  const replacements = { name: projectName };

  // Write project config
  copyTemplate("blueprint.json", path.join(targetDir, "blueprint.json"), {
    name: projectName,
  });

  // Write Vite entry HTML
  copyTemplate("index.html", path.join(targetDir, "index.html"), {
    name: projectName,
  });

  // Write source files
  copyTemplate(
    "main.ts",
    path.join(targetDir, "src", "main.ts"),
    replacements
  );
  copyTemplate(
    "style.css",
    path.join(targetDir, "src", "style.css"),
    replacements
  );
  copyTemplate(
    "index.md",
    path.join(targetDir, "src", "index.md"),
    replacements
  );

  // Create chapters directory
  fs.mkdirSync(path.join(targetDir, "src", "chapters"), { recursive: true });

  // Create lean directory
  fs.mkdirSync(path.join(targetDir, "lean"), { recursive: true });
  fs.writeFileSync(
    path.join(targetDir, "lean", ".gitkeep"),
    ""
  );

  // Write Vite config
  const viteConfig = `import { defineConfig } from "vite";
import { blueprint } from "@leandown/blueprint/vite";

export default defineConfig({
  plugins: [blueprint()],
});
`;
  fs.writeFileSync(path.join(targetDir, "vite.config.ts"), viteConfig);

  // Write package.json for the blueprint project
  const pkgJson = {
    name: projectName,
    private: true,
    type: "module",
    scripts: {
      dev: "blueprint serve",
      build: "blueprint build",
    },
    dependencies: {
      "@leandown/blueprint": "^0.0.1",
      "@leandown/core": "^0.0.1",
      vite: "^6.0.0",
    },
  };
  fs.writeFileSync(
    path.join(targetDir, "package.json"),
    JSON.stringify(pkgJson, null, 2) + "\n"
  );

  // Write a gitignore
  fs.writeFileSync(
    path.join(targetDir, ".gitignore"),
    "node_modules/\ndist/\n.env\n"
  );

  console.log("Created files:");
  console.log(`  blueprint.json`);
  console.log(`  vite.config.ts`);
  console.log(`  package.json`);
  console.log(`  .gitignore`);
  console.log(`  index.html`);
  console.log(`  src/main.ts`);
  console.log(`  src/style.css`);
  console.log(`  src/index.md`);
  console.log(`  src/chapters/`);
  console.log(`  lean/`);
  console.log();
  console.log("Next steps:");
  console.log(`  cd ${targetDir}`);
  console.log(`  bun install`);
  console.log(`  blueprint serve    # start dev server`);
  console.log(`  blueprint build    # build for production`);
}
