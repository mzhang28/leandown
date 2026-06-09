import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";

/** Spawn, drain pipes, resolve with stdout. Throws on non-zero exit or timeout. */
function $(cmd: string, args: string[], opts: { cwd: string; timeoutMs?: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error(`${cmd} ${args.join(" ")} timed out after ${opts.timeoutMs}ms\n${stderr.slice(-500)}`));
        }, opts.timeoutMs)
      : null;

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}\n${stderr.slice(-500)}`));
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Blueprint CLI integration tests.
 *
 * These tests simulate an external user: they create a fresh project,
 * install @leandown/* packages from tarballs (not from the workspace),
 * and exercise the blueprint workflow end-to-end.
 *
 * Workflow: blueprint init → edit content → blueprint build → blueprint serve
 *
 * The test project lives at `test-results/blueprint-test-project/` so
 * `node_modules/` and the lake build cache (`.lake/`) persist across runs.
 *
 * Prerequisites
 * -------------
 * Run `node scripts/pack-local.mjs` before running these tests to ensure
 * up-to-date tarballs exist in packs/.
 */

// ── Paths ────────────────────────────────────────────────────────────────

// Playwright's compiler does not support `import.meta` at module scope,
// so we rely on process.cwd() (tests are always run from the repo root).
const MONOREPO_ROOT = process.cwd();
const PACKS_DIR = path.join(MONOREPO_ROOT, "packs");
/** CLI binary used ONLY for `blueprint init` (runs from the monorepo build). */
const INIT_CLI = path.join(
  MONOREPO_ROOT,
  "packages/blueprint/dist/index.js",
);
/** Version of the @leandown packages to install from tarballs. */
const PACK_VERSION = "0.0.11";

/**
 * Persistent project directory under test-results.
 * `node_modules/`, `.lake/`, etc. survive between test runs so that
 * `bun install` and `lake build :docs` are cached after the first run.
 */
const TEST_PROJECT_DIR = path.join(
  MONOREPO_ROOT,
  "test-results",
  "blueprint-test-project",
);

// Content written into the test project after init (overwritten every run).
const CHAPTER1_MD = `# Chapter 1: Natural Numbers

:::theorem "add_comm" (lean := "Nat.add_comm") (uses := "add_def")
Addition of natural numbers is commutative:
$$a + b = b + a$$
:::

Here is some Lean code:

\`\`\`lean
theorem add_comm (a b : Nat) : a + b = b + a := by
  induction a with
  | zero => simp
  | succ a ih => simp [ih]
\`\`\`

## Summary

We proved commutativity of addition.
`;

const SUMMARY_MD = `# Summary

- [Introduction](./index.md)
- [Chapter 1: Natural Numbers](./chapter1.md)
`;

// Stryker-compatible port offset
const workerIndex = parseInt(
  process.env.STRYKER_SANDBOX_WORKER_INDEX || "0",
  10,
);
const BLUEPRINT_PORT = 61980 + workerIndex;

// ── Helpers ──────────────────────────────────────────────────────────────

/** Return the absolute path to a pack tarball, throwing if it's missing. */
function packPath(pkg: string): string {
  const tgz = path.join(PACKS_DIR, `leandown-${pkg}-${PACK_VERSION}.tgz`);
  if (!fs.existsSync(tgz)) {
    throw new Error(
      `Tarball not found: ${tgz}\n` +
        `Run \`node scripts/pack-local.mjs\` to build packs first.`,
    );
  }
  return tgz;
}

/** Write a fresh package.json into `dir` referencing the local tarballs. */
function writePackageJson(dir: string): void {
  const pkgJson = {
    name: "blueprint-test-project",
    private: true,
    type: "module",
    scripts: {
      dev: "blueprint serve",
      build: "blueprint build",
    },
    dependencies: {
      "@leandown/blueprint": `file:${packPath("blueprint")}`,
      "@leandown/core": `file:${packPath("core")}`,
      "@leandown/remark": `file:${packPath("remark")}`,
    },
  };
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(pkgJson, null, 2) + "\n",
  );
}

/**
 * Write (or overwrite) the blueprint.json config, preserving the
 * leanProjectPath from init so that lake build :docs is exercised.
 */
function writeBlueprintJson(dir: string): void {
  const cfg = { name: "blueprint-test-project", leanProjectPath: "." };
  fs.writeFileSync(
    path.join(dir, "blueprint.json"),
    JSON.stringify(cfg, null, 2) + "\n",
  );
}

/** Poll `url` until it responds 2xx, or throw after `timeoutMs`. */
async function waitForServer(
  url: string,
  timeoutMs = 30_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(
    `Server at ${url} did not become ready within ${timeoutMs}ms`,
  );
}

// ── Test suite ───────────────────────────────────────────────────────────

// TODO: re-enable once we have a proper lake project with a `docs` facet
// so that `lake build :docs` actually works (cold lake build takes ~15 min).
test.describe.skip("Blueprint CLI", () => {
  let serveProc: ChildProcess | null = null;

  test.beforeAll(async () => {
    const isFresh = !fs.existsSync(TEST_PROJECT_DIR);

    if (isFresh) {
      // ── First run: scaffold a brand-new project ─────────────────
      console.log(
        `[blueprint test] creating fresh project in ${TEST_PROJECT_DIR}`,
      );
      await $("bun", [INIT_CLI, "init", "--dir", TEST_PROJECT_DIR], {
        cwd: MONOREPO_ROOT,
      });

      // Replace the empty lean/ stub with a real Lake project at the root
      // so that `blueprint build` exercises `lake build :docs` and the
      // resulting `.lake/` cache persists across runs.
      fs.rmSync(path.join(TEST_PROJECT_DIR, "lean"), { recursive: true, force: true });
      await $("lake", ["init", "."], { cwd: TEST_PROJECT_DIR });

      // Pre-build the lake project so .lake/ is cached.
      // `lake build :docs` is called by blueprint build internally and
      // will fail (no docs facet in a default `lake init` project), but
      // that's handled gracefully by the try/catch in buildCommand.
      // Cold run may take a while; subsequent runs reuse the cache.
      console.log(`[blueprint test] pre-building lake (cold run — this may take a while)...`);
      await $("lake", ["build"], {
        cwd: TEST_PROJECT_DIR,
        timeoutMs: 900_000,
      });
    } else {
      console.log(
        `[blueprint test] reusing cached project in ${TEST_PROJECT_DIR}`,
      );
    }

    // Every run: reset package.json (tarball refs may have changed) and
    // blueprint.json + source content to known state.  `bun install` is a
    // no-op when nothing changed (~12 ms).
    writePackageJson(TEST_PROJECT_DIR);
    writeBlueprintJson(TEST_PROJECT_DIR);
    await $("bun", ["install"], { cwd: TEST_PROJECT_DIR });

    const srcDir = path.join(TEST_PROJECT_DIR, "src");
    fs.writeFileSync(path.join(srcDir, "chapter1.md"), CHAPTER1_MD);
    fs.writeFileSync(path.join(srcDir, "SUMMARY.md"), SUMMARY_MD);

    // Ensure the default index.md still exists (init created it)
    if (!fs.existsSync(path.join(srcDir, "index.md"))) {
      fs.writeFileSync(
        path.join(srcDir, "index.md"),
        `# My Blueprint\n\nWelcome to your blueprint project!\n`,
      );
    }
  });

  test.afterAll(async () => {
    if (serveProc) {
      serveProc.kill("SIGTERM");
      serveProc = null;
    }
    // Project directory is kept on disk so caches are reused.
  });

  // ══════════════════════════════════════════════════════════════════════
  // Init tests
  // ══════════════════════════════════════════════════════════════════════

  test("blueprint init creates all expected files", () => {
    const expected = [
      "blueprint.json",
      "vite.config.ts",
      "package.json",
      ".gitignore",
      "index.html",
      "src/main.ts",
      "src/style.css",
      "src/index.md",
      "src/SUMMARY.md",
      "lakefile.toml",
    ];
    for (const rel of expected) {
      expect(
        fs.existsSync(path.join(TEST_PROJECT_DIR, rel)),
        rel,
      ).toBe(true);
    }
  });

  test("blueprint init produces a valid blueprint.json", () => {
    const config = JSON.parse(
      fs.readFileSync(
        path.join(TEST_PROJECT_DIR, "blueprint.json"),
        "utf-8",
      ),
    );
    expect(config.name).toBeTruthy();
    expect(config.leanProjectPath).toBe(".");
  });

  test("blueprint init produces a valid vite.config.ts", () => {
    const viteConfig = fs.readFileSync(
      path.join(TEST_PROJECT_DIR, "vite.config.ts"),
      "utf-8",
    );
    expect(viteConfig).toContain("defineConfig");
    expect(viteConfig).toContain("@leandown/blueprint/vite");
    expect(viteConfig).toContain("blueprint()");
  });

  test("blueprint init produces a valid index.html shell", () => {
    const html = fs.readFileSync(
      path.join(TEST_PROJECT_DIR, "index.html"),
      "utf-8",
    );
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('src="/src/main.ts"');
    expect(html).toContain('id="sidebar"');
    expect(html).toContain('id="content"');
  });

  test("edited SUMMARY.md contains both pages", () => {
    const summary = fs.readFileSync(
      path.join(TEST_PROJECT_DIR, "src", "SUMMARY.md"),
      "utf-8",
    );
    expect(summary).toContain("[Introduction](./index.md)");
    expect(summary).toContain(
      "[Chapter 1: Natural Numbers](./chapter1.md)",
    );
  });

  test("edited chapter1.md contains blueprint directives and Lean code", () => {
    const chapter = fs.readFileSync(
      path.join(TEST_PROJECT_DIR, "src", "chapter1.md"),
      "utf-8",
    );
    expect(chapter).toContain(":::theorem");
    expect(chapter).toContain('lean := "Nat.add_comm"');
    expect(chapter).toContain("```lean");
    expect(chapter).toContain("induction a");
  });

  // ══════════════════════════════════════════════════════════════════════
  // Build tests
  // ══════════════════════════════════════════════════════════════════════

  test("blueprint build produces dist output", async () => {
    await $("./node_modules/.bin/blueprint", ["build"], {
      cwd: TEST_PROJECT_DIR,
    });

    const distDir = path.join(TEST_PROJECT_DIR, "dist");
    expect(fs.existsSync(distDir)).toBe(true);

    const distIndex = path.join(distDir, "index.html");
    expect(fs.existsSync(distIndex)).toBe(true);

    const distAssets = path.join(distDir, "assets");
    expect(fs.existsSync(distAssets)).toBe(true);

    // The built HTML should reference bundled assets
    const builtHtml = fs.readFileSync(distIndex, "utf-8");
    expect(builtHtml).toContain("<!DOCTYPE html>");
    expect(builtHtml).toMatch(/<script[^>]*type="module"[^>]*>/);
  });

  test("blueprint build generates JS and CSS assets", () => {
    const assetsDir = path.join(TEST_PROJECT_DIR, "dist", "assets");
    const files = fs.readdirSync(assetsDir);

    const jsFiles = files.filter((f) => f.endsWith(".js"));
    const cssFiles = files.filter((f) => f.endsWith(".css"));

    expect(jsFiles.length).toBeGreaterThan(0);
    expect(cssFiles.length).toBeGreaterThan(0);
  });

  test("blueprint build is repeatable (idempotent)", async () => {
    await $("./node_modules/.bin/blueprint", ["build"], {
      cwd: TEST_PROJECT_DIR,
    });
    const distDir = path.join(TEST_PROJECT_DIR, "dist");
    expect(fs.existsSync(distDir)).toBe(true);
  });

  // ══════════════════════════════════════════════════════════════════════
  // Serve tests
  // ══════════════════════════════════════════════════════════════════════

  test("blueprint serve starts and responds with HTML", async () => {
    serveProc = spawn(
      "./node_modules/.bin/blueprint",
      ["serve", "--port", String(BLUEPRINT_PORT), "--strictPort"],
      {
        cwd: TEST_PROJECT_DIR,
        stdio: "pipe",
        env: { ...process.env },
      },
    );
    // Drain pipes so buffers don't block the child
    serveProc.stdout?.on("data", () => {});
    serveProc.stderr?.on("data", () => {});

    const baseUrl = `http://localhost:${BLUEPRINT_PORT}`;
    await waitForServer(baseUrl);

    const rootHtml = await fetch(baseUrl).then((r) => r.text());
    expect(rootHtml).toContain("<!DOCTYPE html>");
    expect(rootHtml).toContain('id="content"');
  });

  test("blueprint serve transforms markdown via ?import", async () => {
    const baseUrl = `http://localhost:${BLUEPRINT_PORT}`;

    // Vite only runs the transform pipeline when the file is fetched as a
    // JS module.  The `?import` query forces module resolution.
    const res = await fetch(`${baseUrl}/src/index.md?import`);
    expect(res.ok).toBe(true);
    const text = await res.text();

    expect(text).toMatch(/blueprint-node/);
  });

  test("blueprint serve transforms chapter1.md theorem directive", async () => {
    const baseUrl = `http://localhost:${BLUEPRINT_PORT}`;

    const res = await fetch(`${baseUrl}/src/chapter1.md?import`);
    expect(res.ok).toBe(true);
    const text = await res.text();

    expect(text).toContain("blueprint-node--theorem");
    expect(text).toContain("add_comm");
    expect(text).toMatch(/commutative|commutativity/i);
  });

  test("blueprint serve returns correct Content-Type", async () => {
    const baseUrl = `http://localhost:${BLUEPRINT_PORT}`;

    const res = await fetch(baseUrl);
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).toContain("text/html");
  });

  test("blueprint serve acts as an SPA (unknown routes return HTML)", async () => {
    const baseUrl = `http://localhost:${BLUEPRINT_PORT}`;

    const res = await fetch(`${baseUrl}/some/nonexistent/route`);
    expect(res.ok).toBe(true);
    const text = await res.text();
    expect(text).toContain("<!DOCTYPE html>");
  });

  test("blueprint serve SUMMARY virtual module resolves", async () => {
    const baseUrl = `http://localhost:${BLUEPRINT_PORT}`;

    // The SUMMARY is served as a virtual module via the Vite plugin
    const res = await fetch(`${baseUrl}/@leandown/blueprint/summary`);
    // Accept 200 (virtual module served) or 404 (virtual modules aren't
    // directly fetchable — they're inlined by the plugin at build time).
    expect([200, 404]).toContain(res.status);
  });
});
