import { LeanHighlightProcessor } from "@leandown/core";
import type { ComarkPlugin, ComarkNode, ComarkElement, ComarkParsePostState } from "comark";

export interface ComarkLeanOptions {
  /** Path to a Lean 4 project directory (containing lakefile.toml). Auto-creates a temp project if omitted. */
  leanProjectPath?: string;
  /** Enable hover tooltips, go-to-definition, goals, diagnostics. Default: true */
  synchronizedHovers?: boolean;
  /** Custom directory for the SQLite highlight cache */
  cacheDir?: string;
  /**
   * Compile a markdown string to HTML for hover tooltips.
   * Since Comark's rendering is component-based, you must provide a
   * string-based markdown compiler for tooltip content.
   * If omitted, raw markdown is returned as-is.
   */
  compileMarkdown?: (markdown: string) => Promise<string> | string;
}

/**
 * Creates a Comark plugin for syntax-highlighting Lean 4 code blocks.
 *
 * @example
 * ```typescript
 * import { parse } from "comark";
 * import { leanPlugin } from "comark-lean";
 *
 * const result = await parse(content, {
 *   plugins: [
 *     leanPlugin({ leanProjectPath: "./my-lean-project" })
 *   ]
 * });
 * ```
 */
export function leanPlugin(options: ComarkLeanOptions = {}): ComarkPlugin {
  const processor = new LeanHighlightProcessor({
    ...options,
    compileMarkdown: options.compileMarkdown ?? ((md) => md),
  });

  return {
    name: "lean-highlight",

    async post(state: ComarkParsePostState) {
      processor.resetDocument();

      const leanNodes: ComarkElement[] = [];
      visitNodes(state.tree.nodes, (node) => {
        if (
          Array.isArray(node) &&
          node[0] === "code" &&
          typeof node[1] === "object" &&
          node[1] !== null &&
          (node[1] as { class?: string }).class === "language-lean"
        ) {
          leanNodes.push(node as ComarkElement);
        }
      });

      for (const node of leanNodes) {
        const content = typeof node[2] === "string" ? node[2] : "";
        const html = await processor.processBlock(content);
        // Replace the code element in-place with an html element
        (node as unknown as unknown[])[0] = "html";
        (node as unknown as unknown[])[2] = html;
      }
    },
  };
}

function visitNodes(nodes: ComarkNode[], callback: (node: ComarkNode) => void): void {
  for (const node of nodes) {
    callback(node);
    if (Array.isArray(node) && typeof node[0] === "string") {
      const children = (node as ComarkElement).slice(2) as ComarkNode[];
      visitNodes(children, callback);
    }
  }
}
