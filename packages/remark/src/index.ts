import {
  LeanHighlightProcessor,
  wrapLeanCodeBlock,
  LeanLSPClient,
  renderLeanLoadingIndicator,
  LEAN_LOADING_DEFAULT_MESSAGE,
} from "@leandown/core";
import type { LeanHighlightOptions } from "@leandown/core";
import type { Plugin } from "unified";
import type { Root, Code } from "mdast";
import { remark } from "remark";
import remarkHtml from "remark-html";

export interface RemarkLeanOptions {
  leanProjectPath?: string;
  synchronizedHovers?: boolean;
  cacheDir?: string;
}

// Re-export core types for backwards compatibility
export {
  LeanLSPClient,
  wrapLeanCodeBlock,
  renderLeanLoadingIndicator,
  LEAN_LOADING_DEFAULT_MESSAGE,
};

const remarkLean: Plugin<[RemarkLeanOptions?], Root> = function (options: RemarkLeanOptions = {}) {
  const processor = new LeanHighlightProcessor({
    ...options,
    compileMarkdown: (md) =>
      remark().use(remarkHtml).processSync(md).toString(),
  });

  return async (tree: Root) => {
    processor.resetDocument();

    const leanNodes: Code[] = [];
    visit(tree, "code", (node: Code) => {
      if (node.lang === "lean") {
        leanNodes.push(node);
      }
    });

    for (const node of leanNodes) {
      const html = await processor.processBlock(node.value);
      // Cast to mutable to allow transforming in place
      const mutableNode = node as unknown as { type: string; value: string; lang?: string | null; children?: unknown };
      mutableNode.type = "html";
      mutableNode.value = html;
      delete mutableNode.lang;
      delete mutableNode.children;
    }
  };
};

export default remarkLean;

function visit(node: Root | Root["children"][number], type: string, callback: (node: Code) => void): void {
  if (node.type === type) {
    callback(node as Code);
  }
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) {
      visit(child, type, callback);
    }
  }
}