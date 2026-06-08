import { LeanLSPClient } from "./client.ts";
import { getCachedHighlight, setCachedHighlight, hashContent, CACHE_VERSION } from "./cache.ts";
import { wrapLeanCodeBlock } from "./html.ts";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

export interface LeanHighlightOptions {
  /** Path to a Lean 4 project directory (containing lakefile.toml). Auto-creates a temp project if omitted. */
  leanProjectPath?: string;
  /** Enable hover tooltips, go-to-definition, goals, diagnostics. Default: true */
  synchronizedHovers?: boolean;
  /** Custom directory for the SQLite highlight cache */
  cacheDir?: string;
  /**
   * Compile a markdown string to HTML. Used for rendering hover tooltips, goal states,
   * and diagnostic messages. Each adapter should provide its own implementation using
   * its ecosystem's markdown compiler.
   */
  compileMarkdown: (markdown: string) => Promise<string> | string;
}

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

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leandown-"));

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
    `name = "lean_highlight_scratch"\nversion = "0.1.0"\n`
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

/**
 * High-level processor that manages the lifecycle of Lean code block highlighting
 * across an entire document. Handles LSP client pooling, caching, and cumulative
 * content tracking for multi-block documents.
 *
 * Each adapter (remark, markdown-it, comark, etc.) creates a processor and feeds
 * it code blocks sequentially.
 */
export class LeanHighlightProcessor {
  private cumulativeContent = "";
  private options: LeanHighlightOptions;

  constructor(options: LeanHighlightOptions) {
    this.options = options;
  }

  /**
   * Process a single Lean code block, returning wrapped HTML.
   * Call sequentially for each lean code block in document order.
   * The processor tracks cumulative content across blocks for proper
   * cross-block name resolution.
   */
  async processBlock(content: string): Promise<string> {
    const projectPath = this.options.leanProjectPath ?? getOrCreateTempProject();
    const client = getClient(projectPath);
    await client.start();

    const syncHovers = this.options.synchronizedHovers ?? true;
    const cacheKey = hashContent(JSON.stringify({
      cacheVersion: CACHE_VERSION,
      content,
      prependCode: this.cumulativeContent,
      syncHovers
    }));

    let highlighted = await getCachedHighlight(cacheKey, this.options.cacheDir);

    if (!highlighted) {
      highlighted = await client.highlight(content, {
        synchronizedHovers: syncHovers,
        prependCode: this.cumulativeContent,
        compileMarkdown: this.options.compileMarkdown,
      });
      await setCachedHighlight(cacheKey, highlighted, this.options.cacheDir);
    }

    this.cumulativeContent += content + "\n\n";

    return wrapLeanCodeBlock(highlighted);
  }

  /**
   * Reset cumulative state. Call this before processing a new document
   * to ensure blocks don't carry over state from a previous document.
   */
  resetDocument(): void {
    this.cumulativeContent = "";
  }

  /**
   * Shutdown the LSP client associated with this processor.
   */
  async shutdown(): Promise<void> {
    const projectPath = this.options.leanProjectPath ?? tempProjectPath;
    if (projectPath) {
      const client = clientPool.get(projectPath);
      if (client) {
        await client.shutdown();
        clientPool.delete(projectPath);
      }
    }
  }
}
