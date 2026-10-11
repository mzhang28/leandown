import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { remark } from "remark";
import remarkHtml from "remark-html";
import { LeanHighlightProcessor } from "@leandown/core";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import { computeStatuses, probeDeclarations } from "../lean/analyzer.ts";
import { findLeanSources } from "../lean/lakefile.ts";
import type { DeclFacts, NodeStatus } from "../lean/types.ts";
import { htmlToTree, type TreeNode } from "./tree.ts";
import "./typst-bundle.ts";

/** Where the built package keeps lib.typ and the browser assets (dist/). */
const PACKAGE_DIST = path.dirname(fileURLToPath(import.meta.url));

/** Files the Typst library emits for the CLI; never published. */
const INTERNAL_PREFIX = "__blueprint/";

/** Typst warns about these on every compile; they say nothing actionable. */
const EXPERIMENTAL_WARNING = /export is (experimental|under active development)/;

export interface SiteOptions {
  /** Blueprint project root (contains blueprint.json). */
  root: string;
  /** Typst entry file, relative to root. */
  entry: string;
  /** Output directory, relative to root. */
  outDir: string;
  /** Lean project directory, absolute. */
  leanProjectPath?: string;
  /** Modules to import when checking declarations. */
  leanImports?: string[];
}

interface BlueprintNodeMeta {
  kind: string;
  label: string;
  lean: string[];
  uses: string[];
  mathlib: boolean;
}

interface CompiledFile {
  path: string;
  content: Buffer;
}

export interface BuildResult {
  ok: boolean;
  /** Paths written to the output directory. */
  files: string[];
}

/**
 * Builds a Typst blueprint into a static site.
 *
 * Compiles twice: the first pass reports the Lean code blocks and blueprint
 * nodes, which are then highlighted and checked against Lean; the results go
 * into `.blueprint/data.json` for the second pass to render.
 */
export class SiteBuilder {
  private compiler: NodeCompiler;
  private processor: LeanHighlightProcessor | undefined;
  private statusCache: { key: string; facts: Map<string, DeclFacts> } | undefined;
  private readonly dataDir: string;

  constructor(private readonly options: SiteOptions) {
    this.compiler = NodeCompiler.create({ workspace: options.root });
    this.dataDir = path.join(options.root, ".blueprint");
    if (options.leanProjectPath && fs.existsSync(options.leanProjectPath)) {
      this.processor = new LeanHighlightProcessor({
        leanProjectPath: options.leanProjectPath,
        compileMarkdown: (md) => remark().use(remarkHtml).processSync(md).toString(),
      });
    }
  }

  async build(): Promise<BuildResult> {
    this.prepare();

    const first = this.compile();
    if (!first) return { ok: false, files: [] };
    const blocks = readJson<string[]>(first, "lean-blocks.json") ?? [];
    const nodes = readJson<BlueprintNodeMeta[]>(first, "nodes.json") ?? [];

    const lean = await this.highlight(blocks);
    const status = await this.statuses(nodes);
    this.writeData({ lean, status });

    const second = this.compile();
    if (!second) return { ok: false, files: [] };
    return { ok: true, files: this.write(second) };
  }

  async close(): Promise<void> {
    await this.processor?.shutdown();
  }

  /** Copy the Typst library and browser assets into `.blueprint/`. */
  private prepare(): void {
    const assets = path.join(this.dataDir, "assets");
    fs.mkdirSync(assets, { recursive: true });
    fs.copyFileSync(path.join(PACKAGE_DIST, "typst", "lib.typ"), path.join(this.dataDir, "lib.typ"));
    for (const name of fs.readdirSync(path.join(PACKAGE_DIST, "assets"))) {
      fs.copyFileSync(path.join(PACKAGE_DIST, "assets", name), path.join(assets, name));
    }
    const data = path.join(this.dataDir, "data.json");
    if (!fs.existsSync(data)) fs.writeFileSync(data, "{}\n");
  }

  private writeData(data: { lean: Record<string, TreeNode>; status: Record<string, NodeStatus> }): void {
    fs.writeFileSync(path.join(this.dataDir, "data.json"), JSON.stringify(data));
  }

  private compile(): CompiledFile[] | undefined {
    if (!this.compiler.bundle) {
      throw new Error(
        "This build of @myriaddreamin/typst-ts-node-compiler can't compile Typst bundles; " +
          "blueprint needs leandown's typst.ts build.",
      );
    }
    const result = this.compiler.bundle({
      mainFilePath: path.join(this.options.root, this.options.entry),
    });
    const warnings = result.takeWarnings();
    if (warnings) this.report(warnings);
    if (result.hasError()) {
      result.printErrors();
      return undefined;
    }
    this.compiler.evictCache(30);
    return result.result?.files();
  }

  private report(error: Parameters<NodeCompiler["fetchDiagnostics"]>[0]): void {
    for (const d of this.compiler.fetchDiagnostics(error) as { message?: string; path?: string; range?: string }[]) {
      if (!d.message || EXPERIMENTAL_WARNING.test(d.message)) continue;
      const where = d.path ? `${d.path}${d.range ? `:${d.range}` : ""}: ` : "";
      console.warn(`[blueprint] warning: ${where}${d.message}`);
    }
  }

  /** Highlight each Lean block in document order; later blocks see earlier ones. */
  private async highlight(blocks: string[]): Promise<Record<string, TreeNode>> {
    const out: Record<string, TreeNode> = {};
    if (!this.processor || blocks.length === 0) return out;
    this.processor.resetDocument();
    for (const code of blocks) {
      try {
        out[code] = htmlToTree(await this.processor.processBlock(code));
      } catch (err) {
        console.warn(`[blueprint] couldn't highlight a Lean block: ${(err as Error).message}`);
      }
    }
    return out;
  }

  private async statuses(nodes: BlueprintNodeMeta[]): Promise<Record<string, NodeStatus>> {
    const lean = this.options.leanProjectPath;
    const hasLakefile =
      !!lean &&
      (fs.existsSync(path.join(lean, "lakefile.toml")) || fs.existsSync(path.join(lean, "lakefile.lean")));
    if (!hasLakefile) return {};

    const names = [...new Set(nodes.flatMap((n) => n.lean))].sort();
    // Re-check only when the names or the Lean sources change.
    const newest = Math.max(0, ...findLeanSources(lean).map((f) => fs.statSync(f).mtimeMs));
    const key = `${newest}\n${names.join("\n")}`;
    if (this.statusCache?.key !== key) {
      try {
        const { facts, invalid } = await probeDeclarations(names, {
          leanProjectPath: lean,
          imports: this.options.leanImports,
        });
        for (const n of invalid) console.warn(`[blueprint] '${n}' is not a valid Lean name`);
        this.statusCache = { key, facts };
      } catch (err) {
        console.warn(`[blueprint] Lean status unavailable; the graph shows kinds only. ${(err as Error).message}`);
        return {};
      }
    }
    const facts = this.statusCache.facts;
    for (const n of nodes) {
      for (const d of n.lean) {
        if (facts.get(d)?.exists === false) {
          console.warn(`[blueprint] "${n.label}" links to Lean declaration '${d}', which wasn't found`);
        }
      }
    }
    const statuses = computeStatuses(
      nodes.map((n) => ({ label: n.label, leanDecls: n.lean, uses: n.uses, mathlib: n.mathlib })),
      facts,
      (cycle) => console.warn(`[blueprint] dependency cycle: ${[...cycle, cycle[0]].join(" → ")}`),
    );
    return Object.fromEntries(statuses);
  }

  /** Replace the output directory's contents (keeping copied Lean docs). */
  private write(files: CompiledFile[]): string[] {
    const outDir = path.join(this.options.root, this.options.outDir);
    fs.mkdirSync(outDir, { recursive: true });
    for (const entry of fs.readdirSync(outDir)) {
      if (entry !== "docs") fs.rmSync(path.join(outDir, entry), { recursive: true, force: true });
    }
    const written: string[] = [];
    for (const f of files) {
      if (f.path.startsWith(INTERNAL_PREFIX)) continue;
      const dest = path.join(outDir, f.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.content);
      written.push(f.path);
    }
    return written;
  }
}

function readJson<T>(files: CompiledFile[], name: string): T | undefined {
  const f = files.find((f) => f.path === INTERNAL_PREFIX + name);
  return f ? (JSON.parse(f.content.toString("utf-8")) as T) : undefined;
}
