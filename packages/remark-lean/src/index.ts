import { LeanLSPClient } from "./lsp";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface RemarkLeanOptions {
  rootUri: string;
  synchronizedHovers?: boolean;
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

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function getCachePath(hash: string): string {
  const cacheDir = path.resolve(process.cwd(), "node_modules", ".cache", "remark-lean");
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  return path.join(cacheDir, `${hash}.json`);
}

function getCachedHighlight(hash: string): string | null {
  const p = getCachePath(hash);
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    } catch (e) {
      return null;
    }
  }
  return null;
}

function setCachedHighlight(hash: string, html: string) {
  const p = getCachePath(hash);
  try {
    fs.writeFileSync(p, JSON.stringify(html), "utf-8");
  } catch (e) {
    // ignore
  }
}

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
        content: node.value,
        prependCode: cumulativeContent,
        syncHovers
      }));

      let highlighted = getCachedHighlight(cacheKey);

      if (!highlighted) {
        highlighted = await client.highlight(node.value, {
          synchronizedHovers: syncHovers,
          prependCode: cumulativeContent
        });
        setCachedHighlight(cacheKey, highlighted);
      }

      cumulativeContent += node.value + "\n\n";

      node.type = "html";
      node.value = `<pre><code class="language-lean">${highlighted}</code></pre>`;
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