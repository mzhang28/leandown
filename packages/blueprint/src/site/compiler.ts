import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import "./typst-bundle.ts";

/** A file emitted by compiling a Typst bundle. */
export interface CompiledFile {
  path: string;
  content: Buffer;
}

/** Compiles a Typst project for the bundle target (several output files). */
export interface BundleCompiler {
  readonly name: string;
  /** Returns the emitted files, or undefined after reporting errors. */
  bundle(): Promise<CompiledFile[] | undefined>;
}

/** Which compiler to use: see {@link createCompiler}. */
export type CompilerChoice = "auto" | "typst.ts" | "typst";

export interface CompilerOptions {
  root: string;
  /** Entry file, absolute. */
  entry: string;
  choice?: CompilerChoice;
  /** Path to the `typst` binary (default: `$TYPST`, then `typst` on PATH). */
  typstPath?: string;
}

/** Typst warns about these on every compile; they say nothing actionable. */
const EXPERIMENTAL_WARNING = /export is (experimental|under active development)/;

const TYPST_TS_PACKAGE = "@myriaddreamin/typst-ts-node-compiler";

/**
 * Picks a compiler. `"auto"` uses typst.ts when it's installed and can
 * compile bundles (leandown's build of it), and otherwise the `typst` CLI.
 */
export async function createCompiler(options: CompilerOptions): Promise<BundleCompiler> {
  const choice = options.choice ?? "auto";
  const problems: string[] = [];

  if (choice === "auto" || choice === "typst.ts") {
    const loaded = await loadTypstTs();
    if (typeof loaded !== "string") return new TypstTsCompiler(loaded, options);
    if (choice === "typst.ts") throw new Error(loaded);
    problems.push(loaded);
  }

  const typst = options.typstPath ?? process.env.TYPST ?? "typst";
  const version = await typstVersion(typst);
  if (version && atLeast(version, [0, 15, 0])) return new TypstCliCompiler(typst, options);
  problems.push(
    version
      ? `\`${typst}\` is Typst ${version.join(".")}; blueprint needs 0.15 or later.`
      : `\`${typst}\` wasn't found (install Typst 0.15+, or set "typstPath" in blueprint.json).`,
  );
  throw new Error(`No usable Typst compiler:\n  - ${problems.join("\n  - ")}`);
}

type NodeCompilerModule = { NodeCompiler: typeof NodeCompiler };

async function loadTypstTs(): Promise<NodeCompilerModule | string> {
  let mod: NodeCompilerModule;
  try {
    const imported = (await import(TYPST_TS_PACKAGE)) as Partial<NodeCompilerModule> & { default?: NodeCompilerModule };
    // It's CommonJS: the named export may only be reachable through `default`.
    mod = imported.NodeCompiler ? (imported as NodeCompilerModule) : imported.default!;
  } catch {
    return `${TYPST_TS_PACKAGE} isn't installed.`;
  }
  if (typeof mod.NodeCompiler?.prototype?.bundle !== "function") {
    return `The installed ${TYPST_TS_PACKAGE} can't compile Typst bundles (leandown's build of typst.ts can).`;
  }
  return mod;
}

/** Compiles in-process with typst.ts; fast for repeated builds. */
class TypstTsCompiler implements BundleCompiler {
  readonly name = "typst.ts";
  private readonly compiler: NodeCompiler;

  constructor(mod: NodeCompilerModule, private readonly options: CompilerOptions) {
    this.compiler = mod.NodeCompiler.create({ workspace: options.root });
  }

  async bundle(): Promise<CompiledFile[] | undefined> {
    const result = this.compiler.bundle!({ mainFilePath: this.options.entry });
    const warnings = result.takeWarnings();
    if (warnings) {
      for (const d of this.compiler.fetchDiagnostics(warnings) as { message?: string; path?: string; range?: string }[]) {
        if (!d.message || EXPERIMENTAL_WARNING.test(d.message)) continue;
        const where = d.path ? `${d.path}${d.range ? `:${d.range}` : ""}: ` : "";
        console.warn(`[blueprint] warning: ${where}${d.message}`);
      }
    }
    if (result.hasError()) {
      result.printErrors();
      return undefined;
    }
    this.compiler.evictCache(30);
    return result.result?.files();
  }
}

/** Runs the `typst` CLI into a temporary directory. */
class TypstCliCompiler implements BundleCompiler {
  readonly name = "typst";

  constructor(private readonly typst: string, private readonly options: CompilerOptions) {}

  async bundle(): Promise<CompiledFile[] | undefined> {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "blueprint-typst-"));
    try {
      const args = [
        "compile",
        "--features", "html,bundle",
        "--format", "bundle",
        "--root", this.options.root,
        this.options.entry,
        out,
      ];
      const { code, stderr } = await run(this.typst, args, this.options.root);
      const report = filterExperimental(stderr);
      if (report.trim()) process.stderr.write(report);
      if (code !== 0) return undefined;
      return readTree(out);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  }
}

function run(cmd: string, args: string[], cwd: string): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf-8")));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

/** Drops Typst's "export is experimental" warnings (each with its hints). */
function filterExperimental(stderr: string): string {
  const blocks = stderr.split(/\n(?=(?:warning|error)[:\[])/);
  return blocks.filter((b) => !EXPERIMENTAL_WARNING.test(b.split("\n")[0] ?? "")).join("\n");
}

function readTree(dir: string, prefix = ""): CompiledFile[] {
  const files: CompiledFile[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...readTree(abs, rel));
    else files.push({ path: rel, content: fs.readFileSync(abs) });
  }
  return files;
}

async function typstVersion(typst: string): Promise<number[] | undefined> {
  try {
    const { stdout } = await promisify(execFile)(typst, ["--version"]);
    const m = stdout.match(/typst (\d+)\.(\d+)\.(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
  } catch {
    return undefined;
  }
}

function atLeast(v: number[], min: number[]): boolean {
  for (let i = 0; i < min.length; i++) {
    if ((v[i] ?? 0) !== min[i]) return (v[i] ?? 0) > min[i]!;
  }
  return true;
}
