import { LeanLSPClient } from "./lsp";

export interface RemarkLeanOptions {
  rootUri: string;
  synchronizedHovers?: boolean;
}

export { LeanLSPClient };

export default function remarkLean(options: RemarkLeanOptions) {
  if (!options || typeof options.rootUri !== "string") {
    throw new Error("remark-lean: 'rootUri' option is required");
  }

  return async (tree: any) => {
    const client = new LeanLSPClient(options.rootUri);
    try {
      await client.start();

      const leanNodes: any[] = [];
      visit(tree, "code", (node: any) => {
        if (node.lang === "lean") {
          leanNodes.push(node);
        }
      });

      let hasLeanBlocks = leanNodes.length > 0;
      let cumulativeContent = "";
      for (const node of leanNodes) {
        const highlighted = await client.highlight(node.value, {
          synchronizedHovers: options.synchronizedHovers,
          prependCode: cumulativeContent
        });

        cumulativeContent += node.value + "\n\n";

        node.type = "html";
        node.value = `<pre><code class="language-lean">${highlighted}</code></pre>`;
      }


    } finally {
      await client.shutdown();
    }
  };
}

function visit(node: any, type: string, callback: (node: any) => void) {
  if (node.type === type) {
    callback(node);
  }
  if (node.children) {
    for (const child of node.children) {
      visit(child, type, callback);
    }
  }
}