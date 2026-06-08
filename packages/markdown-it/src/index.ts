import type MarkdownIt from "markdown-it";
import { LeanHighlightProcessor } from "@leandown/core";
import type { LeanHighlightOptions } from "@leandown/core";

export interface MarkdownItLeanOptions {
  /** Path to a Lean 4 project directory (containing lakefile.toml). Auto-creates a temp project if omitted. */
  leanProjectPath?: string;
  /** Enable hover tooltips, go-to-definition, goals, diagnostics. Default: true */
  synchronizedHovers?: boolean;
  /** Custom directory for the SQLite highlight cache */
  cacheDir?: string;
}

/**
 * Creates a lean-highlight integration for markdown-it.
 *
 * Because markdown-it's rendering pipeline is synchronous but Lean highlighting
 * requires async LSP communication, this returns an object with an async `render()`
 * method rather than a traditional markdown-it plugin.
 *
 * @example
 * ```typescript
 * import MarkdownIt from "markdown-it";
 * import { createMarkdownItLean } from "markdown-it-lean";
 *
 * const md = new MarkdownIt();
 * const lean = createMarkdownItLean(md, { leanProjectPath: "./my-lean-project" });
 *
 * const html = await lean.render("```lean\ndef hello := 42\n```");
 * await lean.shutdown();
 * ```
 */
export function createMarkdownItLean(md: MarkdownIt, options: MarkdownItLeanOptions = {}) {
  const processor = new LeanHighlightProcessor({
    ...options,
    compileMarkdown: (markdown) => md.render(markdown),
  });

  return {
    /**
     * Async render that processes lean code blocks via the Lean LSP
     * before rendering the rest of the markdown with markdown-it.
     */
    async render(src: string, env?: any): Promise<string> {
      processor.resetDocument();
      const tokens = md.parse(src, env ?? {});

      for (const token of tokens) {
        if (token.type === "fence" && token.info.trim() === "lean") {
          const html = await processor.processBlock(token.content);
          token.type = "html_block";
          token.content = html;
          token.children = null;
        }
      }

      return md.renderer.render(tokens, md.options, env ?? {});
    },

    /** Shutdown the LSP client */
    async shutdown(): Promise<void> {
      await processor.shutdown();
    },
  };
}
