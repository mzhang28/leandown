import { test, expect, describe, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LeanLSPClient } from "./client.ts";
import {
  LeanServerSupervisor,
  LeanServerUnavailableError,
  type LeanServerOptions,
  type LeanServerState,
  type LeanServerStateInfo,
} from "./supervisor.ts";

const FAKE_LSP = path.join(import.meta.dir, "__fixtures__", "fake-lsp.ts");
const FAST: LeanServerOptions = { baseDelayMs: 10, maxDelayMs: 40 };

const supervisors: LeanServerSupervisor[] = [];
const tempDirs: string[] = [];
afterEach(() => {
  for (const s of supervisors.splice(0)) s.killSync();
  for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leandown-sup-test-"));
  tempDirs.push(dir);
  return dir;
}

/** A supervisor over the fake server, recording every state transition. */
function setup(fakeFlags: string[] = [], options: LeanServerOptions = {}) {
  const dir = tempDir();
  const stateFile = path.join(dir, "state.json");
  const transitions: LeanServerStateInfo[] = [];
  const sup = new LeanServerSupervisor(
    dir,
    { ...FAST, ...options, onStateChange: (i) => transitions.push(i) },
    (p) =>
      new LeanLSPClient(p, {
        command: [process.execPath, FAKE_LSP, `--state=${stateFile}`, ...fakeFlags],
      })
  );
  supervisors.push(sup);
  const states = () => transitions.map((t) => t.state);
  const starts = () =>
    fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")).starts : 0;
  return { sup, transitions, states, starts };
}

function waitForState(sup: LeanServerSupervisor, state: LeanServerState): Promise<void> {
  if (sup.state === state) return Promise.resolve();
  return new Promise((resolve) => {
    const off = sup.onStateChange((i) => {
      if (i.state === state) {
        off();
        resolve();
      }
    });
  });
}

describe("LeanServerSupervisor", () => {
  test("starts lazily and highlights once ready", async () => {
    const { sup, states } = setup();
    expect(sup.state).toBe("idle");
    const res = await sup.highlight("def x := 1");
    expect(res.compileComplete).toBe(true);
    expect(res.html).toContain(`<span class="lean-keyword">def</span> x := 1`);
    expect(states()).toEqual(["starting", "ready"]);
  });

  test("recovers from startup crashes within the retry budget", async () => {
    const { sup, states, starts } = setup(["--crash-starts=3"], { waitForReady: true });
    await sup.highlight("def x := 1");
    expect(sup.state).toBe("ready");
    expect(starts()).toBe(4);
    expect(states().filter((s) => s === "backoff")).toHaveLength(3);
  });

  test("gives up after maxRetries consecutive failures, then fails fast", async () => {
    const { sup, starts, transitions } = setup(["--crash-starts=99"], {
      maxRetries: 2,
      waitForReady: true,
    });
    const err = await sup.highlight("def x := 1").catch((e) => e);
    expect(err).toBeInstanceOf(LeanServerUnavailableError);
    expect(err.state).toBe("failed");
    expect(sup.state).toBe("failed");
    // One initial launch plus two retries.
    expect(starts()).toBe(3);
    expect(transitions.at(-1)?.error?.message).toContain("fake-lsp: crashing on startup");

    const again = await sup.highlight("def y := 2").catch((e) => e);
    expect(again).toBeInstanceOf(LeanServerUnavailableError);
    expect(starts()).toBe(3);
  });

  test("defaults to five retries", async () => {
    const { sup, starts } = setup(["--crash-starts=99"], { waitForReady: true });
    await sup.highlight("x").catch(() => {});
    expect(sup.state).toBe("failed");
    expect(starts()).toBe(6);
  });

  test("waitForReady: a crash mid-highlight is retried on the restarted server", async () => {
    const { sup, states, starts } = setup(["--crash-opens=1"], { waitForReady: true });
    const res = await sup.highlight("CRASH");
    expect(res.compileComplete).toBe(true);
    expect(starts()).toBe(2);
    expect(states()).toEqual(["starting", "ready", "backoff", "starting", "ready"]);
  });

  test("fail-fast: a crash reports the server as down, then it comes back", async () => {
    const { sup } = setup(["--crash-opens=1"]);
    const err = await sup.highlight("CRASH").catch((e) => e);
    expect(err).toBeInstanceOf(LeanServerUnavailableError);
    expect(err.state).toBe("backoff");
    expect(err.nextRetryAt).toBeGreaterThan(0);

    // Calls during backoff fail fast without waiting.
    const during = await sup.highlight("def x := 1").catch((e) => e);
    expect(during).toBeInstanceOf(LeanServerUnavailableError);

    await waitForState(sup, "ready");
    const res = await sup.highlight("def x := 1");
    expect(res.compileComplete).toBe(true);
  });

  test("per-call waitForReady overrides the default", async () => {
    const { sup } = setup(["--crash-opens=1"]);
    const res = await sup.highlight("CRASH", { waitForReady: true });
    expect(res.compileComplete).toBe(true);
  });

  test("backoff delays grow exponentially, with jitter, up to maxDelayMs", async () => {
    const { sup, transitions } = setup(["--crash-starts=99"], {
      baseDelayMs: 20,
      maxDelayMs: 80,
      maxRetries: 4,
      waitForReady: true,
    });
    const delays: number[] = [];
    sup.onStateChange((i) => {
      if (i.state === "backoff") delays.push(i.nextRetryAt! - Date.now());
    });
    await sup.highlight("x").catch(() => {});
    // Ceilings 20, 40, 80, 80 (capped); each delay is jittered into [½, 1] of its ceiling.
    const ceilings = [20, 40, 80, 80];
    expect(delays).toHaveLength(4);
    delays.forEach((d, i) => {
      expect(d).toBeGreaterThanOrEqual(ceilings[i]! / 2 - 1);
      expect(d).toBeLessThanOrEqual(ceilings[i]!);
    });
    expect(transitions.at(-1)?.state).toBe("failed");
  });

  test("failure count resets after stable uptime", async () => {
    const { sup, transitions } = setup(["--crash-starts=1", "--crash-opens=1"], {
      waitForReady: true,
      stableAfterMs: 50,
    });
    await sup.highlight("def x := 1");
    expect(sup.info.failures).toBe(1);
    await new Promise((r) => setTimeout(r, 100));
    expect(sup.info.failures).toBe(0);
    await sup.highlight("CRASH");
    // The crash after the reset counts as the first failure again.
    expect(transitions.filter((t) => t.state === "backoff").at(-1)?.failures).toBe(1);
  });

  test("a missing binary fails immediately without retrying", async () => {
    const dir = tempDir();
    const transitions: LeanServerState[] = [];
    const sup = new LeanServerSupervisor(
      dir,
      { ...FAST, waitForReady: true, onStateChange: (i) => transitions.push(i.state) },
      (p) => new LeanLSPClient(p, { command: ["leandown-no-such-binary"] })
    );
    supervisors.push(sup);
    const err = await sup.highlight("x").catch((e) => e);
    expect(err).toBeInstanceOf(LeanServerUnavailableError);
    expect(err.message).toContain("could not launch `leandown-no-such-binary`");
    expect(transitions).toEqual(["starting", "failed"]);
  });

  test("shutdown stops the server and prevents restarts", async () => {
    const { sup, states } = setup();
    await sup.highlight("def x := 1");
    await sup.shutdown();
    expect(sup.state).toBe("shutdown");
    const err = await sup.highlight("def x := 1").catch((e) => e);
    expect(err).toBeInstanceOf(LeanServerUnavailableError);
    expect(states()).toEqual(["starting", "ready", "shutdown"]);
  });

  test("concurrent callers share one start", async () => {
    const { sup, starts } = setup();
    const results = await Promise.all([sup.highlight("a"), sup.highlight("b"), sup.highlight("c")]);
    expect(results.every((r) => r.compileComplete)).toBe(true);
    expect(starts()).toBe(1);
  });
});

describe("LeanLSPClient death handling", () => {
  test("rejects in-flight and later calls once the process dies", async () => {
    const dir = tempDir();
    const stateFile = path.join(dir, "state.json");
    const client = new LeanLSPClient(dir, {
      command: [process.execPath, FAKE_LSP, `--state=${stateFile}`, "--crash-opens=1"],
    });
    let exitSeen = false;
    client.onExit(() => (exitSeen = true));
    await client.start();
    const err = await client.highlight("CRASH", {}).catch((e) => e);
    expect(err?.name).toBe("LeanServerExitedError");
    expect(err.message).toContain("fake-lsp: crashing on didOpen");
    expect(exitSeen).toBe(true);
    expect(client.exited).toBe(true);
    // A dead client stays dead rather than hanging or throwing a TypeError.
    const later = await client.highlight("def x := 1", {}).catch((e) => e);
    expect(later?.name).toBe("LeanServerExitedError");
    await client.shutdown();
  });
});
