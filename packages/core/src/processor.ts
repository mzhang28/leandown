import {
  LeanServerSupervisor,
  type LeanServerOptions,
  type LeanServerStateInfo,
} from "./supervisor.ts";
import {
  getCachedHighlight,
  setCachedHighlight,
  hashContent,
  CACHE_VERSION,
  computeProjectFingerprint,
} from "./cache.ts";
import { wrapLeanCodeBlock } from "./html.ts";
import { type LeanHighlightBackend, HtmlBackend } from "./backend.ts";
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
  compileMarkdown?: (markdown: string) => Promise<string> | string;
  /** Custom backend for rendering the highlighted output. Defaults to HtmlBackend. */
  backend?: LeanHighlightBackend;
  /**
   * Lean server restart policy. Crashed servers are restarted with exponential
   * backoff, up to `maxRetries` (default 5) consecutive failures. Blocks wait
   * through a restart unless `waitForReady: false`. State changes are logged
   * to stderr unless `onStateChange` is given. The first processor created for
   * a project path decides the policy for that path's shared server.
   */
  server?: LeanServerOptions;
}

function logStateChange(info: LeanServerStateInfo): void {
  const why = info.error ? `: ${info.error.message.split("\n")[0]}` : "";
  if (info.state === "backoff") {
    const secs = (((info.nextRetryAt ?? Date.now()) - Date.now()) / 1000).toFixed(1);
    console.warn(
      `leandown: Lean server stopped${why}. Restarting in ${secs}s (attempt ${info.failures}/${info.maxRetries}).`
    );
  } else if (info.state === "failed") {
    console.error(`leandown: Lean server failed after ${info.failures} attempt(s)${why}`);
  } else if (info.state === "ready" && info.failures > 0) {
    console.warn("leandown: Lean server restarted.");
  }
}

const clientPool = new Map<string, LeanServerSupervisor>();
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

function getServer(projectPath: string, options: LeanServerOptions = {}): LeanServerSupervisor {
  let server = clientPool.get(projectPath);
  if (!server) {
    server = new LeanServerSupervisor(projectPath, {
      ...options,
      waitForReady: options.waitForReady ?? true,
      onStateChange: options.onStateChange ?? logStateChange,
    });
    clientPool.set(projectPath, server);
  }
  return server;
}

function cleanupClients() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  // Kill synchronously: on exit/signal the process won't stay alive long enough
  // to await the graceful shutdown request, so `proc.kill()` must run directly
  // (otherwise `lake serve` children are orphaned and the temp dir is deleted
  // out from under a still-running server).
  for (const server of clientPool.values()) {
    server.killSync();
  }
  if (tempProjectPath) {
    const resolvedPath = path.resolve(tempProjectPath);
    // Safety checks: ensure it is a subfolder in the temp directory and starts with "leandown-"
    const isInsideTmp = resolvedPath.startsWith(os.tmpdir());
    const isLeandownDir = path.basename(resolvedPath).startsWith("leandown-");
    if (isInsideTmp && isLeandownDir && resolvedPath !== os.tmpdir()) {
      fs.rmSync(resolvedPath, { recursive: true, force: true });
    }
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
  private projectFingerprint: string | null = null;

  constructor(options: LeanHighlightOptions) {
    this.options = options;
  }

  private getProjectFingerprint(projectPath: string): string {
    if (this.projectFingerprint === null) {
      this.projectFingerprint = computeProjectFingerprint(projectPath);
    }
    return this.projectFingerprint;
  }

  /**
   * Process a single Lean code block, returning wrapped HTML.
   * Call sequentially for each lean code block in document order.
   * The processor tracks cumulative content across blocks for proper
   * cross-block name resolution.
   */
  async processBlock(content: string): Promise<string> {
    const projectPath = this.options.leanProjectPath ?? getOrCreateTempProject();

    const syncHovers = this.options.synchronizedHovers ?? true;
    const backend = this.options.backend ?? new HtmlBackend();
    const cacheKey = hashContent(JSON.stringify({
      cacheVersion: CACHE_VERSION,
      content,
      prependCode: this.cumulativeContent,
      syncHovers,
      backend: backend.name,
      projectFingerprint: this.getProjectFingerprint(projectPath),
    }));

    let highlighted = await getCachedHighlight(cacheKey, this.options.cacheDir);

    if (!highlighted) {
      // The server starts lazily here, so fully cached builds never launch Lean.
      const result = await getServer(projectPath, this.options.server).highlight(content, {
        synchronizedHovers: syncHovers,
        prependCode: this.cumulativeContent,
        compileMarkdown: this.options.compileMarkdown,
        backend,
      });
      highlighted = result.html;
      if (result.compileComplete) {
        await setCachedHighlight(cacheKey, highlighted, this.options.cacheDir);
      }
    }

    this.cumulativeContent += content + "\n\n";

    return backend.wrapBlock(highlighted);
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
      const server = clientPool.get(projectPath);
      if (server) {
        await server.shutdown();
        clientPool.delete(projectPath);
      }
    }
  }
}
