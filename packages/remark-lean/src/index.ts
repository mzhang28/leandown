import { LeanLSPClient } from "./lsp";

export interface RemarkLeanOptions {
  rootUri: string;
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

      const promises: Promise<void>[] = [];
      visit(tree, "code", (node: any) => {
        if (node.lang === "lean") {
          const promise = client.highlight(node.value).then((highlighted) => {
            node.type = "html";
            node.value = `<pre><code class="language-lean">${highlighted}</code></pre>`;
          });
          promises.push(promise);
        }
      });

      await Promise.all(promises);
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