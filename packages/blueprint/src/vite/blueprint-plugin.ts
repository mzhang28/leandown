import type { Plugin as VitePlugin, ViteDevServer } from "vite";
import { remark } from "remark";
import remarkHtml from "remark-html";
import remarkLean from "@leandown/remark";
import { processDirectives, scanDirectives } from "../plugin/index.ts";
import { findProjectRoot, readConfigIfExists } from "../util.ts";
import { parseSummary } from "./summary.ts";
import { computeStatuses, probeDeclarations } from "../lean/analyzer.ts";
import type { DeclFacts } from "../lean/analyzer.ts";
import path from "node:path";
import fs from "node:fs";

const SUMMARY_MODULE = "@leandown/blueprint/summary";
const RESOLVED_SUMMARY_MODULE = "\0blueprint-summary";
const GRAPH_MODULE = "@leandown/blueprint/graph";
const RESOLVED_GRAPH_MODULE = "\0blueprint-graph";
/** Sent to the browser when fresh Lean status is available for the graph. */
const GRAPH_STATUS_EVENT = "blueprint:graph-status";

interface GraphNodeData {
  id: string;
  label: string;
  kind: string;
  lean?: string;
  route: string;
  mathlib: boolean;
  leanDecls: string[];
  uses: string[];
}

function extractGraphData(
  srcDir: string,
  watch: (file: string) => void = () => {},
): { nodes: GraphNodeData[]; edges: any[] } {
  const nodes: GraphNodeData[] = [];
  const edges: any[] = [];
  if (!fs.existsSync(srcDir)) return { nodes, edges };

  // Build route map from SUMMARY.md
  const routeMap = new Map<string, string>();
  const summaryPath = path.join(srcDir, "SUMMARY.md");
  if (fs.existsSync(summaryPath)) {
    watch(summaryPath);
    const entries = parseSummary(fs.readFileSync(summaryPath, "utf-8"));
    function walk(list: any[]) {
      for (const e of list) {
        routeMap.set(e.srcPath, e.route);
        if (e.children) walk(e.children);
      }
    }
    walk(entries);
  }

  const seen = new Map<string, string>();
  for (const [srcPath, route] of routeMap) {
    const absPath = path.resolve(srcDir, srcPath.replace(/^\.\//, ""));
    if (!fs.existsSync(absPath)) continue;
    watch(absPath);
    const content = fs.readFileSync(absPath, "utf-8");
    for (const { kind, label, attrs, lineNo } of scanDirectives(content)) {
      if (!label) continue;
      const where = `${srcPath}:${lineNo}`;
      const firstSeen = seen.get(label);
      if (firstSeen) {
        console.warn(`[blueprint] duplicate label "${label}" at ${where} (first defined at ${firstSeen}); ignoring it in the graph`);
        continue;
      }
      seen.set(label, where);
      const split = (v?: string) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const uses = split(attrs.uses);
      nodes.push({
        id: label, label, kind, lean: attrs.lean, route,
        mathlib: attrs.mathlib !== undefined,
        leanDecls: split(attrs.lean),
        uses,
      });
      for (const dep of uses) {
        edges.push({ source: dep, target: label, where });
      }
    }
  }

  // Drop edges to unknown labels; cytoscape throws on a dangling endpoint.
  for (let i = edges.length - 1; i >= 0; i--) {
    const e = edges[i];
    if (!seen.has(e.source)) {
      console.warn(`[blueprint] "${e.target}" (${e.where}) uses unknown label "${e.source}"`);
      edges.splice(i, 1);
    } else {
      delete e.where;
    }
  }

  return { nodes, edges };
}

/**
 * Serialize the graph module. Lean status fields are added only when `facts`
 * is available; without them the renderer falls back to kind colours.
 */
function graphModuleCode(
  graph: { nodes: GraphNodeData[]; edges: any[] },
  facts: Map<string, DeclFacts> | undefined,
  warn: (msg: string) => void,
): string {
  const statuses = facts
    ? computeStatuses(
        graph.nodes.map((n) => ({ label: n.id, leanDecls: n.leanDecls, uses: n.uses, mathlib: n.mathlib })),
        facts,
        (cycle) => warn(`dependency cycle: ${[...cycle, cycle[0]].join(" → ")}`),
      )
    : undefined;
  const nodes = graph.nodes.map(({ leanDecls, uses, ...n }) => {
    if (facts) {
      for (const d of leanDecls) {
        if (facts.get(d)?.exists === false) {
          warn(`"${n.id}" links to Lean declaration '${d}', which wasn't found (is it fully qualified, and imported by a library root?)`);
        }
      }
    }
    return { ...n, ...statuses?.get(n.id) };
  });
  return `export const nodes = ${JSON.stringify(nodes)};
export const edges = ${JSON.stringify(graph.edges)};
if (import.meta.hot) {
  import.meta.hot.on(${JSON.stringify(GRAPH_STATUS_EVENT)}, () => {
    const p = location.pathname;
    if (p.endsWith("/graph") || p.endsWith("/graph/")) location.reload();
  });
}
`;
}

export interface BlueprintVitePluginOptions {
  /** Lean project path for LSP highlighting (default: auto-detect from blueprint.json) */
  leanProjectPath?: string;
  /** Project root directory (default: auto-detect) */
  projectRoot?: string;
}

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export function blueprintVitePlugin(
  options: BlueprintVitePluginOptions = {}
): VitePlugin {
  let resolvedRoot: string | undefined;
  let resolvedLeanPath: string | undefined;
  let resolvedSrcDir: string | undefined;
  let resolvedOutDir: string | undefined;
  let resolvedLeanImports: string[] | undefined;
  let resolvedBase = "/";
  let isBuild = false;
  let devServer: ViteDevServer | undefined;

  // Lean status for the graph. A build waits for it; the dev server runs it
  // in the background, and the graph page reloads when it lands. A probe is
  // reused while the set of names and the Lean sources are unchanged.
  interface Probe {
    key: string;
    facts?: Map<string, DeclFacts>;
    done: Promise<void>;
    warned: Set<string>;
  }
  let probe: Probe | undefined;
  let leanGeneration = 0;
  let lastLeanNames: string[] = [];

  const hasLeanProject = () =>
    !!resolvedLeanPath &&
    (fs.existsSync(path.join(resolvedLeanPath, "lakefile.toml")) ||
      fs.existsSync(path.join(resolvedLeanPath, "lakefile.lean")));

  function invalidateGraph(): void {
    const mod = devServer?.moduleGraph.getModuleById(RESOLVED_GRAPH_MODULE);
    if (mod) devServer!.moduleGraph.invalidateModule(mod);
  }

  function ensureProbe(names: string[]): Probe {
    lastLeanNames = names;
    const key = `${leanGeneration}\n${[...new Set(names)].sort().join("\n")}`;
    if (probe?.key === key) return probe;
    // Keep showing the previous result until the new one lands.
    const entry: Probe = { key, facts: probe?.facts, done: Promise.resolve(), warned: new Set() };
    probe = entry;
    if (devServer) console.log("[blueprint] checking Lean declarations for the graph...");
    entry.done = probeDeclarations(names, {
      leanProjectPath: resolvedLeanPath!,
      imports: resolvedLeanImports,
    }).then(
      ({ facts, invalid }) => {
        if (probe !== entry) return;
        for (const n of invalid) console.warn(`[blueprint] '${n}' is not a valid Lean name`);
        entry.facts = facts;
        if (devServer) {
          console.log("[blueprint] Lean status ready");
          invalidateGraph();
          devServer.ws.send({ type: "custom", event: GRAPH_STATUS_EVENT });
        }
      },
      (err) => {
        if (probe !== entry) return;
        console.warn(`[blueprint] Lean status unavailable; the graph shows kinds only. ${(err as Error).message}`);
      },
    );
    return entry;
  }

  return {
    name: "leandown-blueprint",

    config() {
      return {
        appType: "spa" as const,
        resolve: {
          alias: [
            { find: SUMMARY_MODULE, replacement: RESOLVED_SUMMARY_MODULE },
            { find: GRAPH_MODULE, replacement: RESOLVED_GRAPH_MODULE },
          ],
        },
        optimizeDeps: {
          // The app imports the virtual summary/graph modules, so it can't be
          // pre-bundled itself. Its CommonJS deps must be, or they reach the
          // browser untransformed when installed from a registry.
          exclude: [SUMMARY_MODULE, GRAPH_MODULE, "@leandown/blueprint/app"],
          include: [
            "@leandown/blueprint > react",
            "@leandown/blueprint > react/jsx-runtime",
            "@leandown/blueprint > react/jsx-dev-runtime",
            "@leandown/blueprint > react-dom/client",
            "@leandown/blueprint > @tanstack/react-router",
            "@leandown/blueprint > @leandown/core/runtime",
            "@leandown/blueprint/graph-renderer",
          ],
        },
        server: {
          // Lake's build tree (and Mathlib under it) is huge and irrelevant.
          watch: { ignored: ["**/.lake/**"] },
        },
      };
    },

    resolveId(id: string) {
      if (id === RESOLVED_SUMMARY_MODULE) return RESOLVED_SUMMARY_MODULE;
      if (id === RESOLVED_GRAPH_MODULE) return RESOLVED_GRAPH_MODULE;
    },

    async load(id: string) {
      if (!resolvedRoot) {
        // Fallback: configResolved might not have fired yet
        resolvedRoot = findProjectRoot(process.cwd()) ?? process.cwd();
      }
      const srcDir = resolvedSrcDir ?? path.join(resolvedRoot, "src");

      if (id === RESOLVED_SUMMARY_MODULE) {
        const summaryPath = path.join(srcDir, "SUMMARY.md");
        if (fs.existsSync(summaryPath)) {
          this.addWatchFile(summaryPath);
          const summary = parseSummary(fs.readFileSync(summaryPath, "utf-8"));
          return `export const summary = ${JSON.stringify(summary)};`;
        }
        return `export const summary = [];`;
      }

      if (id === RESOLVED_GRAPH_MODULE) {
        const graph = extractGraphData(srcDir, (f) => this.addWatchFile(f));
        let current: Probe | undefined;
        if (hasLeanProject()) {
          current = ensureProbe(graph.nodes.flatMap((n) => n.leanDecls));
          if (isBuild) await current.done;
        }
        const warn = (msg: string) => {
          if (current?.warned.has(msg)) return;
          current?.warned.add(msg);
          console.warn(`[blueprint] ${msg}`);
        };
        return graphModuleCode(graph, current?.facts, warn);
      }
    },

    configResolved(config) {
      resolvedBase = config.base ?? "/";
      isBuild = config.command === "build";

      if (options.projectRoot) {
        resolvedRoot = options.projectRoot;
      } else {
        resolvedRoot = findProjectRoot(config.root) ?? config.root;
      }

      resolvedOutDir = path.resolve(config.root, config.build.outDir);

      const cfg = readConfigIfExists(resolvedRoot);
      resolvedSrcDir = path.resolve(resolvedRoot, cfg?.srcDir ?? "src");
      if (options.leanProjectPath) {
        resolvedLeanPath = path.resolve(resolvedRoot, options.leanProjectPath);
      } else if (cfg?.leanProjectPath) {
        resolvedLeanPath = path.resolve(resolvedRoot, cfg.leanProjectPath);
      }
      resolvedLeanImports = cfg?.leanImports;
    },

    configureServer(server) {
      devServer = server;
      if (!resolvedLeanPath) return;

      // Re-check Lean status when Lean sources change.
      const leanRoot = resolvedLeanPath;
      const lakeDir = `${path.sep}.lake${path.sep}`;
      let timer: ReturnType<typeof setTimeout> | undefined;
      server.watcher.add(leanRoot);
      server.watcher.on("all", (_event, file) => {
        if (!file.endsWith(".lean") || file.includes(lakeDir)) return;
        if (!file.startsWith(leanRoot + path.sep)) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          leanGeneration++;
          if (hasLeanProject()) ensureProbe(lastLeanNames);
        }, 500);
      });

      const docsDir = path.join(resolvedLeanPath, ".lake", "build", "doc");
      const MIME: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".ico": "image/x-icon",
        ".woff2": "font/woff2",
        ".woff": "font/woff",
      };
      const docsMount = resolvedBase.replace(/\/$/, "") + "/docs";
      // Containment boundary for path-traversal protection. Any resolved
      // candidate must live at or below this prefix.
      const docsRoot = path.resolve(docsDir);
      const docsPrefix = docsRoot + path.sep;
      server.middlewares.use(docsMount, (req, res, _next) => {
        const rawPath = (req.url ?? "/").split("?")[0]!.split("#")[0]!;
        let reqPath: string;
        try {
          reqPath = decodeURIComponent(rawPath);
        } catch {
          // Malformed percent-encoding (e.g. "%2"): reject rather than guess.
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Bad Request");
          return;
        }
        // Reject NUL bytes outright (can truncate paths in some syscalls).
        if (reqPath.includes("\0")) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Bad Request");
          return;
        }
        const candidates = [
          path.resolve(docsRoot, "." + reqPath),
          path.resolve(docsRoot, "." + reqPath, "index.html"),
          path.resolve(docsRoot, "." + reqPath.replace(/\/$/, ""), "index.html"),
        ];
        for (const filePath of candidates) {
          // Containment check: the resolved path must be docsRoot itself or a
          // descendant of it. Blocks "/docs/../../../etc/passwd" and friends.
          if (filePath !== docsRoot && !filePath.startsWith(docsPrefix)) {
            continue;
          }
          try {
            if (fs.statSync(filePath).isFile()) {
              res.setHeader("Content-Type", MIME[path.extname(filePath)] ?? "application/octet-stream");
              fs.createReadStream(filePath).pipe(res as any);
              return;
            }
          } catch { /* not found */ }
        }
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem">
<h2>Lean docs not built</h2>
<p>Run <code>blueprint docs</code> in your project root, then reload.</p>
<pre>cd ${resolvedRoot}\nblueprint docs</pre>
</body></html>`);
      });
    },

    async closeBundle() {
      if (!resolvedLeanPath || !resolvedOutDir) return;
      const docsDir = path.join(resolvedLeanPath, ".lake", "build", "doc");
      if (!fs.existsSync(docsDir)) return;
      const distDocsDir = path.join(resolvedOutDir, "docs");
      console.log(`[blueprint] Copying Lean docs to ${distDocsDir}`);
      copyDirSync(docsDir, distDocsDir);
    },

    async transform(code: string, id: string) {
      if (!id.endsWith(".md") || id.includes("node_modules")) return;

      const relId = resolvedRoot ? path.relative(resolvedRoot, id) : id;
      const withDirectives = processDirectives(code, resolvedBase, {
        warn: (msg) => console.warn(`[blueprint] ${relId}: ${msg}`),
      });

      let html: string;
      try {
        const result = await remark()
          .use(remarkLean, {
            leanProjectPath: resolvedLeanPath,
          } as any)
          .use(remarkHtml, { sanitize: false })
          .process(withDirectives);

        html = result.toString();
      } catch (err) {
        console.error(`[blueprint] Error processing ${id}:`, err);
        const result = await remark().use(remarkHtml, { sanitize: false }).process(withDirectives);
        html = result.toString();
      }

      return {
        code: `
          const html = ${JSON.stringify(html)};
          export default html;
          export { html };

          if (import.meta.hot) {
            import.meta.hot.accept((mod) => {
              location.reload();
            });
          }
        `,
        map: null,
      };
    },

    async handleHotUpdate({ file, server, modules }) {
      if (file.endsWith(".md")) {
        // The summary and graph are built from every .md file; rebuild
        // them on the reload.
        for (const id of [RESOLVED_SUMMARY_MODULE, RESOLVED_GRAPH_MODULE]) {
          const mod = server.moduleGraph.getModuleById(id);
          if (mod) server.moduleGraph.invalidateModule(mod);
        }
        server.ws.send({ type: "full-reload" });
        return [];
      }
      return modules;
    },
  };
}
