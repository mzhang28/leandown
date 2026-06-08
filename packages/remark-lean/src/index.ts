import { LeanLSPClient } from "./lsp";
import { getCachedHighlight, setCachedHighlight, hashContent, CACHE_VERSION } from "./cache";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

export interface RemarkLeanOptions {
  leanProjectPath?: string;
  synchronizedHovers?: boolean;
  cacheDir?: string;
}

export { LeanLSPClient };

const clientPool = new Map<string, LeanLSPClient>();
let isShuttingDown = false;
let tempProjectPath: string | null = null;

/**
 * Returns a path to a minimal Lean project suitable for use as an empty
 * scratch workspace. The project is created once per process in a system
 * temp directory and reused on subsequent calls.
 */
function getOrCreateTempProject(): string {
  if (tempProjectPath !== null) return tempProjectPath;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remark-lean-"));

  // Determine the active Lean toolchain version so the temp project uses the
  // same version that `lake serve` will pick up.
  let toolchain = "leanprover/lean4:stable";
  try {
    const output = execSync("lean --version", { encoding: "utf8" });
    const match = output.match(/version\s+([v0-9.]+)/i);
    if (match && match[1]) {
      const ver = match[1].startsWith("v") ? match[1] : `v${match[1]}`;
      toolchain = `leanprover/lean4:${ver}`;
    }
  } catch (_) {}

  fs.writeFileSync(
    path.join(dir, "lakefile.toml"),
    `name = "remark_lean_scratch"\nversion = "0.1.0"\n`
  );
  fs.writeFileSync(path.join(dir, "lean-toolchain"), toolchain);

  tempProjectPath = dir;
  return dir;
}

function getClient(projectPath: string): LeanLSPClient {
  if (!clientPool.has(projectPath)) {
    const client = new LeanLSPClient(projectPath);
    clientPool.set(projectPath, client);
  }
  return clientPool.get(projectPath)!;
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

export default function remarkLean(options: RemarkLeanOptions = {}) {
  return async (tree: any) => {
    const projectPath = options.leanProjectPath ?? getOrCreateTempProject();
    const client = getClient(projectPath);
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