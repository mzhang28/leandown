import type { Plugin as VitePlugin } from "vite";
import { remark } from "remark";
import remarkHtml from "remark-html";
import remarkLean from "@leandown/remark";
import { processDirectives } from "../plugin/index.ts";
import { findProjectRoot, readConfig } from "../util.ts";
import path from "node:path";

export interface BlueprintVitePluginOptions {
  /** Lean project path for LSP highlighting (default: auto-detect from blueprint.json) */
  leanProjectPath?: string;
  /** Project root directory (default: auto-detect) */
  projectRoot?: string;
}

/**
 * Vite plugin that transforms .md files through the blueprint pipeline:
 *
 *   1. Pre-process: convert `:::theorem` directives to HTML sections
 *   2. remark-parse → mdast
 *   3. @leandown/remark → highlight lean code blocks via LSP
 *   4. remark-html → serialize to HTML string
 *
 * The transformed module exports the HTML and a hot-reload handler.
 */
export function blueprintVitePlugin(
  options: BlueprintVitePluginOptions = {}
): VitePlugin {
  let resolvedRoot: string | undefined;
  let resolvedLeanPath: string | undefined;

  return {
    name: "leandown-blueprint",

    configResolved(config) {
      // Use explicit root or detect from Vite's root
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
            resolvedLeanPath = path.resolve(
              resolvedRoot,
              cfg.leanProjectPath
            );
          }
        } catch {
          // No blueprint.json — use a default
        }
      }
    },

    async transform(code: string, id: string) {
      // Only process .md files (not node_modules)
      if (!id.endsWith(".md") || id.includes("node_modules")) return;

      // Step 1: Pre-process blueprint directives (:::theorem etc.) into HTML
      const withDirectives = processDirectives(code);

      // Step 2: Run the remark pipeline
      //   remark-parse → blueprint tree plugin (no-op, already preprocessed) → leandown → remark-html
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
        // Fall back to processing without Lean highlighting
        const result = await remark().use(remarkHtml, { sanitize: false }).process(withDirectives);
        html = result.toString();
      }

      // Step 3: Export as a JS module that provides the HTML
      return {
        code: `
          const html = ${JSON.stringify(html)};
          export default html;
          export { html };

          if (import.meta.hot) {
            import.meta.hot.accept((mod) => {
              // Reload the page when a .md file changes
              location.reload();
            });
          }
        `,
        map: null,
      };
    },

    async handleHotUpdate({ file, server, modules }) {
      // When a .md file changes, trigger a full page reload
      // (simpler and more reliable than HMR for compiled markdown)
      if (file.endsWith(".md")) {
        server.ws.send({ type: "full-reload" });
        return [];
      }
      return modules;
    },
  };
}
