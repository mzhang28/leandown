import { LeanLSPClient } from "./lsp";
import { getCachedHighlight, setCachedHighlight, hashContent, CACHE_VERSION } from "./cache";

export interface RemarkLeanOptions {
  rootUri: string;
  synchronizedHovers?: boolean;
  cacheDir?: string;
}

export { LeanLSPClient };

const clientPool = new Map<string, LeanLSPClient>();
let isShuttingDown = false;

function getClient(rootUri: string): LeanLSPClient {
  if (!clientPool.has(rootUri)) {
    const client = new LeanLSPClient(rootUri);
    clientPool.set(rootUri, client);
  }
  return clientPool.get(rootUri)!;
}

function cleanupClients() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  for (const client of clientPool.values()) {
    client.shutdown();
  }
}

process.on("exit", cleanupClients);
process.on("SIGINT", () => { cleanupClients(); process.exit(0); });
process.on("SIGTERM", () => { cleanupClients(); process.exit(0); });

export default function remarkLean(options: RemarkLeanOptions) {
  if (!options || typeof options.rootUri !== "string") {
    throw new Error("remark-lean: 'rootUri' option is required");
  }

  return async (tree: any) => {
    const client = getClient(options.rootUri);
    await client.start();

    const leanNodes: any[] = [];
    visit(tree, "code", (node: any) => {
      if (node.lang === "lean") {
        leanNodes.push(node);
      }
    });

    let cumulativeContent = "";
    for (const node of leanNodes) {
      const syncHovers = options.synchronizedHovers ?? true;
      const cacheKey = hashContent(JSON.stringify({
        cacheVersion: CACHE_VERSION,
        content: node.value,
        prependCode: cumulativeContent,
        syncHovers
      }));

      let highlighted = await getCachedHighlight(cacheKey, options.cacheDir);

      if (!highlighted) {
        highlighted = await client.highlight(node.value, {
          synchronizedHovers: syncHovers,
          prependCode: cumulativeContent
        });
        await setCachedHighlight(cacheKey, highlighted, options.cacheDir);
      }

      cumulativeContent += node.value + "\n\n";

      node.type = "html";
      node.value = wrapLeanCodeBlock(highlighted);
    }
  };
}

/**
 * Wraps highlighted Lean code in a preformatted HTML block.
 *
 * This function takes the raw highlighted HTML string and returns it wrapped
 * within standard `<pre><code class="language-lean">` tags for web rendering.
 */
export function wrapLeanCodeBlock(highlightedHtml: string): string {
  return `<pre><code class="language-lean">${highlightedHtml}</code></pre>`;
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