import {
  LeanLSPClient,
  LeanServerExitedError,
  type LeanHighlightResult,
} from "./client.ts";
import type { LeanHighlightBackend } from "./backend.ts";

/**
 * Connection state of a supervised Lean server, modelled on gRPC channel
 * connectivity states.
 *
 *   idle      — not started yet; the first call starts it
 *   starting  — process spawned, `initialize` in progress
 *   ready     — accepting requests
 *   backoff   — crashed; a restart is scheduled at `nextRetryAt`
 *   failed    — gave up after `maxRetries` consecutive failures (terminal)
 *   shutdown  — shut down on purpose (terminal)
 */
export type LeanServerState =
  | "idle"
  | "starting"
  | "ready"
  | "backoff"
  | "failed"
  | "shutdown";

export interface LeanServerStateInfo {
  state: LeanServerState;
  /** Consecutive failures since the server was last stable. */
  failures: number;
  maxRetries: number;
  /** Epoch ms of the next restart attempt, while in `backoff`. */
  nextRetryAt?: number;
  /** Why the server last died. */
  error?: Error;
}

export interface LeanServerOptions {
  /** Restarts allowed after consecutive failures before giving up. Default: 5 */
  maxRetries?: number;
  /** Delay before the first restart; doubles on each further failure. Default: 500 */
  baseDelayMs?: number;
  /** Upper bound on the restart delay. Default: 30_000 */
  maxDelayMs?: number;
  /** Time spent `ready` after which the failure count resets. Default: 60_000 */
  stableAfterMs?: number;
  /**
   * While the server is restarting, wait for it (true) or reject immediately
   * with {@link LeanServerUnavailableError} (false). Calls always wait while
   * the server is starting for the first time. Default: false
   */
  waitForReady?: boolean;
  /** Called on every state transition. */
  onStateChange?: (info: LeanServerStateInfo) => void;
}

/** The Lean server is down (restarting, given up, or shut down). */
export class LeanServerUnavailableError extends Error {
  override name = "LeanServerUnavailableError";
  readonly state: LeanServerState;
  readonly failures: number;
  readonly nextRetryAt?: number;
  constructor(info: LeanServerStateInfo) {
    const why = info.error ? `: ${info.error.message}` : "";
    const detail =
      info.state === "backoff"
        ? `restarting (attempt ${info.failures}/${info.maxRetries}, retry in ${Math.max(
            0,
            (info.nextRetryAt ?? Date.now()) - Date.now()
          )}ms)`
        : info.state === "failed"
          ? `gave up after ${info.failures} consecutive failures`
          : info.state;
    super(`Lean server unavailable — ${detail}${why}`, { cause: info.error });
    this.state = info.state;
    this.failures = info.failures;
    this.nextRetryAt = info.nextRetryAt;
  }
}

export type LeanClientFactory = (projectPath: string) => LeanLSPClient;

interface ReadyWaiter {
  /** Keep waiting through a restart (true), or reject on entering backoff. */
  wait: boolean;
  resolve: (client: LeanLSPClient) => void;
  reject: (err: Error) => void;
}

/**
 * Keeps a Lean server running for one project. When the process dies it is
 * restarted in the background with exponential backoff (with jitter), up to
 * `maxRetries` consecutive failures. Callers see the current state through
 * {@link state} / `onStateChange`, and calls made while the server is down
 * either wait for it or fail fast, per `waitForReady`.
 */
export class LeanServerSupervisor {
  private _state: LeanServerState = "idle";
  private client: LeanLSPClient | null = null;
  private failures = 0;
  private lastError: Error | undefined;
  private nextRetryAt: number | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private waiters: ReadyWaiter[] = [];
  private listeners = new Set<(info: LeanServerStateInfo) => void>();

  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly stableAfterMs: number;
  private readonly waitForReady: boolean;

  constructor(
    private readonly projectPath: string,
    options: LeanServerOptions = {},
    private readonly createClient: LeanClientFactory = (p) => new LeanLSPClient(p)
  ) {
    this.maxRetries = options.maxRetries ?? 5;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 30_000;
    this.stableAfterMs = options.stableAfterMs ?? 60_000;
    this.waitForReady = options.waitForReady ?? false;
    if (options.onStateChange) this.listeners.add(options.onStateChange);
  }

  get state(): LeanServerState {
    return this._state;
  }

  get info(): LeanServerStateInfo {
    return {
      state: this._state,
      failures: this.failures,
      maxRetries: this.maxRetries,
      nextRetryAt: this._state === "backoff" ? this.nextRetryAt : undefined,
      error: this.lastError,
    };
  }

  /** Subscribe to state transitions. Returns an unsubscribe function. */
  onStateChange(listener: (info: LeanServerStateInfo) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Highlight `content` on a ready server. If the server dies mid-call and
   * `waitForReady` is set, the call is retried once the server is back.
   */
  async highlight(
    content: string,
    options: {
      synchronizedHovers?: boolean;
      prependCode?: string;
      compileMarkdown?: (markdown: string) => Promise<string> | string;
      backend?: LeanHighlightBackend;
      waitForReady?: boolean;
    } = {}
  ): Promise<LeanHighlightResult> {
    const wait = options.waitForReady ?? this.waitForReady;
    // Bounded separately from the supervisor's failure count, which resets
    // after stable uptime: a block that reliably crashes the server late
    // would otherwise be retried forever.
    for (let attempt = 0; ; attempt++) {
      const client = await this.acquire(wait);
      let exitErr: Error;
      try {
        const result = await client.highlight(content, options);
        // Some per-token requests swallow errors, so a call can "succeed"
        // after the server died under it. That result may be partial.
        if (!client.exited) return result;
        exitErr = new LeanServerExitedError("Lean server exited during highlight");
      } catch (err) {
        if (!(err instanceof LeanServerExitedError) || !client.exited) throw err;
        exitErr = err;
      }
      if (!wait || attempt >= this.maxRetries) {
        throw new LeanServerUnavailableError({ ...this.info, error: exitErr });
      }
    }
  }

  /** Resolve with a ready client, starting or waiting for one as needed. */
  acquire(waitForReady = this.waitForReady): Promise<LeanLSPClient> {
    switch (this._state) {
      case "ready":
        return Promise.resolve(this.client!);
      case "failed":
      case "shutdown":
        return Promise.reject(new LeanServerUnavailableError(this.info));
      case "backoff":
        if (!waitForReady) return Promise.reject(new LeanServerUnavailableError(this.info));
        break;
      case "idle":
        this.launch();
        break;
      case "starting":
        break;
    }
    return new Promise((resolve, reject) =>
      this.waiters.push({ wait: waitForReady, resolve, reject })
    );
  }

  /** Gracefully stop the server. No further restarts happen. */
  async shutdown(): Promise<void> {
    const client = this.stop();
    await client?.shutdown();
  }

  /** Synchronously kill the server; safe in `exit`/signal handlers. */
  killSync(): void {
    this.stop()?.killSync();
  }

  private stop(): LeanLSPClient | null {
    if (this._state === "shutdown") return null;
    const client = this.client;
    this.client = null;
    this.clearTimers();
    this.setState("shutdown");
    this.rejectWaiters();
    return client;
  }

  private launch(): void {
    const client = this.createClient(this.projectPath);
    this.client = client;
    this.setState("starting");
    client.onExit((err) => this.handleDeath(client, err));
    client.start().then(
      () => {
        if (this.client !== client || this._state !== "starting") return;
        this.setState("ready");
        this.stableTimer = setTimeout(() => {
          this.failures = 0;
          this.stableTimer = null;
        }, this.stableAfterMs);
        this.stableTimer.unref?.();
        const waiters = this.waiters;
        this.waiters = [];
        for (const w of waiters) w.resolve(client);
      },
      (err) => this.handleDeath(client, err instanceof Error ? err : new Error(String(err)))
    );
  }

  private handleDeath(client: LeanLSPClient, err: Error): void {
    if (this.client !== client || this._state === "shutdown") return;
    this.client = null;
    // Covers failures where the process is still alive (e.g. `initialize`
    // timed out): make sure it is gone before starting another.
    client.killSync();
    this.clearTimers();
    this.lastError = err;

    // A missing binary won't fix itself; retrying only delays the error.
    const spawnError = err instanceof LeanServerExitedError ? err.spawnError : undefined;
    if (this.failures >= this.maxRetries || spawnError?.code === "ENOENT") {
      this.failures++;
      this.setState("failed");
      this.rejectWaiters();
      return;
    }

    const delay = this.backoffDelay(this.failures);
    this.failures++;
    this.nextRetryAt = Date.now() + delay;
    // Deliberately not unref'd: a caller waiting for the restart must keep
    // the process alive until it happens.
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.launch();
    }, delay);
    this.setState("backoff");
    this.rejectWaiters((w) => !w.wait);
  }

  /** base·2ⁿ capped at maxDelayMs, jittered into [½, 1] of that. */
  private backoffDelay(failures: number): number {
    const exp = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** failures);
    return Math.round(exp / 2 + Math.random() * (exp / 2));
  }

  private rejectWaiters(which: (w: ReadyWaiter) => boolean = () => true): void {
    const rejected = this.waiters.filter(which);
    this.waiters = this.waiters.filter((w) => !which(w));
    if (rejected.length === 0) return;
    const err = new LeanServerUnavailableError(this.info);
    for (const w of rejected) w.reject(err);
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.retryTimer = null;
    this.stableTimer = null;
  }

  private setState(state: LeanServerState): void {
    this._state = state;
    const info = this.info;
    for (const listener of this.listeners) {
      try {
        listener(info);
      } catch (e) {
        console.error("leandown: onStateChange listener threw", e);
      }
    }
  }
}
