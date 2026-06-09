import type { Plugin as VitePlugin } from "vite";
import { remark } from "remark";
import remarkHtml from "remark-html";
import remarkLean from "@leandown/remark";
import { processDirectives, parseInfo, BLUEPRINT_KINDS } from "../plugin/index.ts";
import { findProjectRoot, readConfig } from "../util.ts";
import { parseSummary } from "./summary.ts";
import path from "node:path";
import fs from "node:fs";

const SUMMARY_MODULE = "@leandown/blueprint/summary";
const RESOLVED_SUMMARY_MODULE = "\0blueprint-summary";
const GRAPH_MODULE = "@leandown/blueprint/graph";
const RESOLVED_GRAPH_MODULE = "\0blueprint-graph";

const DIRECTIVE_OPEN_RE = new RegExp(`^:::(${BLUEPRINT_KINDS.join("|")})\\s*(.*?)\\s*$`, "gm");

function extractGraphData(srcDir: string): { nodes: any[]; edges: any[] } {
  const nodes: any[] = [];
  const edges: any[] = [];
  if (!fs.existsSync(srcDir)) return { nodes, edges };

  // Build route map from SUMMARY.md
  const routeMap = new Map<string, string>();
  const summaryPath = path.join(srcDir, "SUMMARY.md");
  if (fs.existsSync(summaryPath)) {
    const entries = parseSummary(fs.readFileSync(summaryPath, "utf-8"));
    function walk(list: any[]) {
      for (const e of list) {
        routeMap.set(e.srcPath, e.route);
        if (e.children) walk(e.children);
      }
    }
    walk(entries);
  }

  for (const [srcPath, route] of routeMap) {
    const absPath = path.resolve(srcDir, srcPath.replace(/^\.\//, ""));
    if (!fs.existsSync(absPath)) continue;
    const content = fs.readFileSync(absPath, "utf-8");
    DIRECTIVE_OPEN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DIRECTIVE_OPEN_RE.exec(content)) !== null) {
      const kind = m[1]!;
      const { label, attrs } = parseInfo(m[2] ?? "");
      if (!label) continue;
      nodes.push({ id: label, label, kind, lean: attrs.lean, route });
      if (attrs.uses) {
        for (const dep of attrs.uses.split(",").map((s: string) => s.trim()).filter(Boolean)) {
          edges.push({ source: label, target: dep });
        }
      }
    }
  }
  return { nodes, edges };
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
          exclude: [SUMMARY_MODULE, GRAPH_MODULE],
        },
      };
    },

    resolveId(id: string) {
      if (id === RESOLVED_SUMMARY_MODULE) return RESOLVED_SUMMARY_MODULE;
      if (id === RESOLVED_GRAPH_MODULE) return RESOLVED_GRAPH_MODULE;
    },

    load(id: string) {
      if (!resolvedRoot) return;
      const srcDir = path.join(resolvedRoot, "src");

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
        const { nodes, edges } = extractGraphData(srcDir);
        return `export const nodes = ${JSON.stringify(nodes)};\nexport const edges = ${JSON.stringify(edges)};`;
      }
    },

    configResolved(config) {
      if (options.projectRoot) {
        resolvedRoot = options.projectRoot;
      } else {
        resolvedRoot = findProjectRoot(config.root) ?? config.root;
      }

      if (options.leanProjectPath) {
        resolvedLeanPath = path.resolve(resolvedRoot, options.leanProjectPath);
      } else {
        try {
          const cfg = readConfig(resolvedRoot);
          if (cfg.leanProjectPath) {
            resolvedLeanPath = path.resolve(resolvedRoot, cfg.leanProjectPath);
          }
        } catch {
          // No blueprint.json — use defaults
        }
      }
    },

    configureServer(server) {
      if (!resolvedLeanPath) return;
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
      server.middlewares.use("/docs", (req, res, _next) => {
        const reqPath = (req.url ?? "/").split("?")[0]!;
        const candidates = [
          path.join(docsDir, reqPath),
          path.join(docsDir, reqPath, "index.html"),
          path.join(docsDir, reqPath.replace(/\/$/, ""), "index.html"),
        ];
        for (const filePath of candidates) {
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
      if (!resolvedLeanPath || !resolvedRoot) return;
      const docsDir = path.join(resolvedLeanPath, ".lake", "build", "doc");
      if (!fs.existsSync(docsDir)) return;
      const distDocsDir = path.join(resolvedRoot, "dist", "docs");
      console.log(`[blueprint] Copying Lean docs to ${distDocsDir}`);
      copyDirSync(docsDir, distDocsDir);
    },

    async transform(code: string, id: string) {
      if (!id.endsWith(".md") || id.includes("node_modules")) return;

      const withDirectives = processDirectives(code);

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
        server.ws.send({ type: "full-reload" });
        return [];
      }
      return modules;
    },
  };
}
