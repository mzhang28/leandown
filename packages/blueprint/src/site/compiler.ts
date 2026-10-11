import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

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

const TYPST_TS_PACKAGE = "@leandown/typst.ts";

/**
 * Picks a compiler. `"auto"` uses `@leandown/typst.ts` (WebAssembly) when
 * it's installed, and otherwise the `typst` CLI.
 */
export async function createCompiler(options: CompilerOptions): Promise<BundleCompiler> {
  const choice = options.choice ?? "auto";
  const problems: string[] = [];

  if (choice === "auto" || choice === "typst.ts") {
    const loaded = await loadTypstTs();
    if (typeof loaded !== "string") return new TypstTsBundleCompiler(loaded, options);
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

// The subset of @leandown/typst.ts that blueprint uses. Typed here so that
// blueprint builds without it installed.
interface TypstTsDiagnostic {
  path: string;
  range: string;
  severity: string;
  message: string;
}
interface TypstTsCompiler {
  bundle(options: { root: string; entry: string }): {
    hasError: boolean;
    diagnostics: TypstTsDiagnostic[];
    files: CompiledFile[];
  };
  reset(): void;
}
interface TypstTsModule {
  createCompiler(options?: { fontPaths?: string[] }): Promise<TypstTsCompiler>;
}

async function loadTypstTs(): Promise<TypstTsModule | string> {
  try {
    const imported = (await import(TYPST_TS_PACKAGE)) as Partial<TypstTsModule> & { default?: TypstTsModule };
    // It's CommonJS: the export may only be reachable through `default`.
    const mod = imported.createCompiler ? (imported as TypstTsModule) : imported.default;
    if (!mod?.createCompiler) return `${TYPST_TS_PACKAGE} doesn't export createCompiler.`;
    return mod;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND"
      ? `${TYPST_TS_PACKAGE} isn't installed.`
      : `${TYPST_TS_PACKAGE} failed to load: ${(err as Error).message}`;
  }
}

/** Compiles in-process with typst.ts (WebAssembly). */
class TypstTsBundleCompiler implements BundleCompiler {
  readonly name = "typst.ts";
  private compiler: Promise<TypstTsCompiler>;

  constructor(mod: TypstTsModule, private readonly options: CompilerOptions) {
    this.compiler = mod.createCompiler();
  }

  async bundle(): Promise<CompiledFile[] | undefined> {
    const compiler = await this.compiler;
    compiler.reset(); // re-read files edited since the last build
    const result = compiler.bundle({ root: this.options.root, entry: this.options.entry });
    let failed = false;
    for (const d of result.diagnostics) {
      if (d.severity !== "error" && EXPERIMENTAL_WARNING.test(d.message)) continue;
      const line = d.range ? Number(d.range.split(":")[0]) + 1 : undefined;
      const where = d.path ? `${d.path}${line ? `:${line}` : ""}: ` : "";
      const log = d.severity === "error" ? console.error : console.warn;
      if (d.severity === "error") failed = true;
      log(`[blueprint] ${d.severity}: ${where}${d.message}`);
    }
    if (result.hasError || failed) return undefined;
    return result.files;
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
