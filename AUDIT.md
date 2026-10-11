# Code Audit Report: leandown

**Date:** 2026-10-10 · **Commit audited:** `3e3e0f9` (v0.0.20)

This is a fresh, independent audit of the whole monorepo. It covers correctness,
robustness and performance in `@leandown/core`, `@leandown/blueprint`, the
remark, markdown-it and comark adapters, `@leandown/mdbook`, the VS Code
extension, and build, release and packaging. It replaces the 2026-07-25 report,
which is still in git history.

How findings were checked: every finding was traced to code, with `file:line`
references that are repo-relative. Findings marked **(verified)** were also
reproduced by running the code. That was done in scratch copies, or with a real
Lean toolchain and packed tarballs for the adapter and packaging checks.
Speculative issues and style nits were dropped.

**Threat model:** document and Lean authors are trusted. Script injection by
whoever writes the Lean or Markdown is out of scope. Escaping bugs are reported
only as correctness issues, meaning legitimate content that breaks the page.
Attacks from *other* parties, such as other local users (V3), stay in scope.

Severity: **High** means a crash, a hang, a security issue or broken output on
common input. **Medium** means wrong results or large slowdowns in realistic
setups. **Low** means an edge case or a hardening item.

---

## Resolution status

- **X2** (dead LSP never restarted): fixed. `LeanServerSupervisor` restarts
  crashed servers with exponential backoff and jitter (`maxRetries`, default
  5), and exposes the connection state. A dead `LeanLSPClient` now rejects
  cleanly instead of hanging.
- **X11** (stderr never drained, concurrent `highlight()` on a fresh client):
  fixed.
- **P1** (stale `bun.lock`): fixed.
- **C1** (`TypstBackend` output never compiles): fixed. Tokens are now Typst
  content blocks, the `lean-block`/`lean-token` preamble ships as
  `@leandown/core/lean.typ`, and the tests compile the output with typst 0.15.
- **V3** (predictable `/tmp` project in the VS Code extension): fixed. The
  fallback project is now a private `mkdtemp` directory per session, removed
  on deactivate.
- **X6** (cache hits still start Lean): fixed; servers now start lazily on the
  first cache miss. The rest of X6 is still open.
- **Release tooling** (P4, F6, pre-built blueprint app): fixed. Nx Release
  replaces the custom publish scripts; exports point at `dist/`.
- **Blueprint** (B1–B7, F1, F2, and most of B10/B11): fixed. A fresh
  `init` → `npm install` → `build`/`serve` now works from packed tarballs,
  including under `base: "/repo/"`. `blueprint build` exits once done.
- **B8/B9** (graph statuses, analyzer): fixed. Graph statuses now come from
  Lean: the analyzer asks Lean, per `lean :=` name, whether it exists,
  whether its own proof uses `sorry`, and whether `sorry` appears below it
  (`063e8e1`), and computes the states from dependencies. B12 and the noted
  parts of B10/B11 are still open.

---

## Executive summary

The most important problems, in order:

1. ~~**A dead LSP is never restarted** (X2). After `lake serve` crashes, every
   later block waits out timeouts and then throws. mdbook exits 0 with empty
   output and hides the cause. **(verified)**~~ **Fixed** (`37b1065`)
2. **One processor's state is shared by concurrent documents** (X3). Astro and
   Vite render pages in parallel, so one page's Lean code leaks into another,
   with wrong `#eval` output and spurious "already declared" errors.
   **(verified)**
3. **O(N²) re-elaboration** (X4). Each block reopens a fresh document holding
   all earlier blocks: 20 blocks took 8.7 s against 0.67 s as one block.
   **(verified)**
4. **The comark adapter emits escaped HTML** (A1). Lean output appears as
   literal text. **(verified)**
5. ~~**The `TypstBackend` output never compiles** (C1). Nested `#raw("#raw(...)")`.
   **(verified)**~~ **Fixed** (`1d53575`)
6. ~~**The blueprint directive parser corrupts content** (B1, B2). `` $` `` /
   `$$` in a body triggers `String.replace` substitution, and the scaffolded
   `index.md` hits this. Nested, unclosed and fenced directives are mangled.
   **(verified)**~~ **Fixed** (`a8893a8`)
7. ~~**Release CI is broken** (P1). `bun.lock` is stale after the 0.0.20 bump,
   so `bun install --frozen-lockfile` fails. **(verified)**~~ **Fixed** (`6e67a85`)
8. ~~**`blueprint build` exits 1 on a fresh `init` project** (B3), because
   `docsCommand` calls `process.exit` inside a `try`.~~ **Fixed** (`a8893a8`)
9. ~~**The VS Code extension uses a predictable `/tmp` project** (V3). Another
   local user can plant a `lakefile.lean` that runs as you.~~ **Fixed** (`f1b8c32`)

---

## Cross-cutting issues in `@leandown/core`

These affect every consumer: remark, markdown-it, comark, mdbook and blueprint.

### X1. Hover registry breaks out of its `<script>` tag `[Medium]` (verified)
`packages/core/src/client.ts:653`, `:396`; `packages/core/src/runtime.ts:247`
```ts
`<script type="application/json" class="lean-hover-data">${JSON.stringify(registry)}</script>`
const word = (lines[l] || "").substring(sChar, eChar);
```
The `registry.words` keys are raw source substrings, and `JSON.stringify` does
not escape `<`. The input `def s : String := "</script>"` closes the script early. The author
is trusted, so this is not a security issue. It is a correctness one: any
legitimate string literal or docstring containing `</script>` (for example,
Lean code about HTML) truncates the JSON. Every hover in that block then stops
working, and JSON text appears on the page. When no
`compileMarkdown` is supplied (the comark default is the identity function),
the `hovers` values are raw markdown or diagnostic text. `runtime.ts:247` then
assigns them to `innerHTML`.
**Fix:** `JSON.stringify(registry).replace(/</g, "\\u003c")`, and also escape
U+2028 and U+2029. When `compileMarkdown` is absent, escape the hover text with
the backend's `escape` before storing it.

### ~~X2. A dead or killed LSP is never detected or respawned `[High]`~~ Fixed in `37b1065`
`packages/core/src/client.ts:59-62`, `:84-88`, `:146`, `:676-700`, `:744`
- The `exit` handler only calls `failAllPending`. `proc` and `initPromise` stay
  set, and `compileWaiters` are never resolved.
- There is no `stdin.on("error")`. A write after the server has died can emit
  an unhandled EPIPE, which crashes the host.
- After `killSync()` or `shutdown()` sets `proc = null`, `start()` returns the
  stale `initPromise` and `this.proc!.stdin` throws a `TypeError`.
- A spawn failure leaves `initPromise` rejected forever, so every later
  document fails, including ones that are fully cached (see X6).
- `shutdown()` sends a request to a dead process. The request timer is
  `unref`'d, so Node exits **0** before the caller's `catch` runs. mdbook then
  reports only "EOF while parsing" (verified on mdbook 0.5.3).

**Fix:**
- On `exit` or `error`, null `proc` and `initPromise` and resolve all waiters.
- Add a `stdin` error listener.
- Respawn the server in `start()` when `proc` is null.
- Skip the `shutdown` request when the process is dead.

### X3. Per-document state is shared by concurrent documents `[High]` (verified)
`packages/core/src/processor.ts:111`, `:142`, `:163`, `:172-174`; adapters `remark/src/index.ts:29,36`, `markdown-it/src/index.ts:34,45`, `comark/src/index.ts:36,45`
Each adapter creates one `LeanHighlightProcessor` per plugin instance, with a
mutable `cumulativeContent`. Two documents processed in parallel overwrite each
other's prefix. Verified with `Promise.all([process(A), process(B)])`: doc B's
`#eval foo` printed doc A's value, and B gained two "already declared" errors.
The wrong output is then **cached**.
**Fix:** keep the state per document, e.g. `processor.document()` returns a
session object, or pass the prefix explicitly.

### X4. Every block re-elaborates all earlier blocks `[Medium, perf]` (verified)
`packages/core/src/processor.ts:142,151-153,163`; `client.ts:169-186`
Block *k* is opened as a fresh `__temp_….lean` holding blocks 1…*k*. It waits
for compilation (up to `COMPILE_TIMEOUT_MS = 30_000`, `client.ts:27`) and then
closes. The cost is O(N²) elaboration, with fresh imports for every block
(Mathlib reloads each time). Any `#eval` with IO side effects reruns N times.
Measured: 20 theorems took **666 ms as one block and 8737 ms as 20 blocks**.
Blocks that hit the 30 s timeout come back partial and are not cached, so they
rerun on every rebuild.
**Fix:** elaborate the whole document once, either as one file or with
incremental `didChange` appends, and slice tokens, hovers and diagnostics by
line range.

### X5. Partial or failed LSP results are cached as final `[Medium]`
`packages/core/src/client.ts:216`, `:239`, `:248`; `processor.ts:158-159`
Hover and definition requests use `.catch(() => null)`, and `tokensRes.error`
is ignored. When requests time out or fail (e.g. ContentModified), the block
renders without hovers or highlighting, and that HTML is cached under a key
that stays the same until the source changes.
**Fix:** count failures and error responses, and skip the cache write if any
occurred.

### X6. Cache key and fingerprint are incomplete or wrong `[Medium]`
`packages/core/src/cache.ts:24`, `:57-83`; `processor.ts:119-124`, `:133-148`
- **Path dependencies hashed in the wrong place:** `cache.ts:75`
  `hashLeanDirectory(path.resolve(pkg.dir))` resolves against `process.cwd()`
  instead of the project path, so edits to path dependencies are never hashed.
  Fix: `path.resolve(projectPath, pkg.dir)`.
- **Inputs missing from the fingerprint:** `lean-toolchain` and
  `lakefile.toml`. After a toolchain bump, cached permalinks still say
  `blob/v4.34.1/…`.
- **`compileMarkdown` not in the key:** remark, markdown-it and comark all
  write `backend: "html"` into the same default cache directory, so they read
  each other's tooltip HTML.
- **Fingerprint memoised forever:** it is computed once per processor. In a
  dev server, editing project `.lean` files never invalidates cached blocks.
- ~~**Cache hits still start Lean:** `client.start()` (`processor.ts:133-135`)
  runs before the cache lookup. A fully cached build still spawns `lake serve`,
  and it fails outright if `lake` is missing.~~ **Fixed** (`37b1065`)
- **VS Code companions hashed:** `collectLeanFiles` skips only
  `.lake`/`.git`/`node_modules`, so the VS Code extension's `.leandown/*.lean`
  companions are hashed. Every save in VS Code invalidates the whole cache.
- **Cache grows without bound:** `cache.ts:144` uses `INSERT OR REPLACE` and
  never evicts rows.

**Fix:**
- Resolve `dir` against the project path.
- Add the toolchain, the lakefile and an adapter or compiler id to the key.
- Recheck the fingerprint for each document.
- Look up the cache before `start()`.
- Skip dot-directories when collecting files.

### X7. Unbounded request fan-out and quadratic hot loops `[Medium, perf]`
`packages/core/src/client.ts:229-253`, `:362`, `:418`, `:587`, `:65`; `lib.ts:260`
- **Fan-out:** one hover request plus one definition request per query token,
  all sent at once with `Promise.all`. Every non-ASCII character is its own
  token, so a 1,000-line block sends about 10–20k concurrent requests, which
  feeds X5.
- **Quadratic loops:** `tokens.find` inside the loop over unique tokens,
  `tokens.some` per comment, and `tokens.filter` per line. Each is O(n·T).
- **Buffering:** `Buffer.concat` on every stdout chunk is quadratic for
  multi-MB responses.

**Fix:** a concurrency pool of about 32 requests, a `Map` keyed by
`line:start:len`, tokens bucketed by line once, and a chunk list for stdout.

### X8. Synchronous `git` subprocesses for every external definition `[Medium, perf]`
`packages/core/src/client.ts:293`, `:857-893`
`getPermalinkForUri` runs before deduplication and spawns up to four
`execSync` git commands for every URI outside the stdlib. A block referencing
Mathlib hundreds of times makes more than 1,000 blocking spawns, which stalls
the event loop and the dev server.
**Fix:** memoise `{gitRoot, remote, HEAD}` for each package root, and compute
permalinks after deduplication.

### X9. One failed request fails the whole document `[Medium]`
`packages/core/src/client.ts:209`, `:441`; adapters have no per-block `try`
`$/lean/plainGoal` and `semanticTokens/full` have no `.catch`, unlike hover and
definition. One timeout on a goal query rejects `highlight()`. No adapter
(remark, markdown-it, comark, mdbook) catches errors per block, so the whole
page or book fails. The goal loop (`:432-444`) also costs one sequential round
trip per non-blank line. After a throw, the block is never appended to
`cumulativeContent` (`processor.ts:163`), so later blocks lose its definitions.
**Fix:**
- Catch errors and treat them as "no goal".
- Batch goal requests.
- In each adapter, fall back to an escaped `<pre><code class="language-lean">` with a warning.
- Append the block to `cumulativeContent` even when highlighting fails.

### X10. Library takes over the host's SIGINT/SIGTERM `[Low]`
`packages/core/src/processor.ts:98-100`
`process.on("SIGINT", () => { cleanupClients(); process.exit(0); })` runs when
the module is imported. In Vite, Astro or mdbook, Ctrl-C exits with code 0
instead of 130 and cuts short the host's own graceful shutdown.
**Fix:** use the `exit` hook with a synchronous kill only, or re-raise the
signal after cleanup.

### X11. Lifecycle and protocol robustness `[Medium/Low]` (partly fixed)
- ~~**stderr never drained** `[Medium]` (`client.ts:62`): stderr uses the default
  pipe and is never read. Heavy lake or lean logging blocks the child after
  about 64 KB, and every request then times out. Fix: `stdio: ["pipe","pipe","inherit"]`
  or a listener that drains it.~~ **Fixed** (`37b1065`)
- ~~**Concurrent `highlight()` on a fresh client** `[Medium]` (`client.ts:146-148`):
  `proc` is set before `initialize` resolves, so a second caller skips the
  await and sends `didOpen` before `initialized`. Fix: always `await this.start()`.~~ **Fixed** (`37b1065`)
- **Server requests taken for responses** `[Low]` (`client.ts:774`): a
  server-to-client request whose id collides with one of ours resolves our
  pending request. Fix: treat a message as a response only when `method` is
  absent, and answer unknown requests with `MethodNotFound`.
- **No clean exit** `[Low]`: remark and comark expose no `shutdown()`, so
  scripts never exit (verified: still running 45 s after "done").
  markdown-it's `shutdown()` kills the pooled client that other processors
  share (`processor.ts:179-187`). Fix: export a `dispose` and reference-count
  pooled clients, or `unref()` the child process when idle.
- **Blocking first call** `[Low]` (`processor.ts:51`): `execSync("lean --version")`
  on the first block can block for about 100 s while elan downloads a
  toolchain (observed).

### ~~C1. `TypstBackend` output never compiles `[High]`~~ Fixed in `1d53575`
`packages/core/src/backend.ts:155-158`, `:195-205`; `client.ts:599`
`escape()` returns `#raw("…")`, and `renderTokenStart` / `renderTokenEnd`
already wrap the text in `#raw("` … `")`. The combined output is
`#lean-token(type: "keyword")[#raw("#raw("def")")]`, a syntax error on every
token. The `link: "${token.permalink}"` value is not escaped either. The tests
check each method on its own and never the combined output.
**Fix:** token start and end should emit only `#lean-token(...)[` and `]`, and
`escape` should own the `#raw("…")`. Escape the permalink as well.

### C2. Comment lexer mishandles char and raw-string literals `[Low]` (verified)
`packages/core/src/lib.ts:226`, `:239-241`
`'"'` starts a string, and `\` is treated as an escape everywhere.
`def q := '"' -- quote` gets no comment token, and the string state stays
inverted for the rest of the block. `r"C:\"` never closes.
**Fix:** recognise `'…'` char literals and `r#*"…"#*` raw strings.

---

## Adapters

### A1. Comark adapter emits escaped text inside a fake `<html>` element `[High]` (verified)
`packages/comark/src/index.ts:64-65`
```ts
(node as unknown as unknown[])[0] = "html";
(node as unknown as unknown[])[2] = html;
```
Comark has no raw-HTML node, and its renderer escapes string children. The
output is
`<pre language="lean"><html class="language-lean">&lt;pre&gt;&lt;code …`, so
Lean output shows as literal text and hydration is impossible.
**Fix:** build comark element tuples from the HTML (e.g. with htmlparser2) and
replace the whole `pre` node.

### A2. Comark streaming mode loses earlier blocks `[Low]`
`packages/comark/src/index.ts:45-58`
With `streaming: true`, `post` reruns on `[...reusableNodes, ...nodes]`, but
the converted blocks no longer match `code`. They never enter
`cumulativeContent`, so later blocks report "unknown identifier".

### A3. markdown-it and remark disagree on which fences are Lean `[Low]`
`packages/markdown-it/src/index.ts:49` (`info.trim() === "lean"`) vs
`packages/remark/src/index.ts:40` (`node.lang === "lean"`). A fence like
```` ```lean title=x ```` is highlighted by remark but not by markdown-it.
**Fix:** compare against `info.trim().split(/\s+/)[0]`.

---

## `@leandown/blueprint`

### ~~B1. `String.replace` substitution corrupts directive bodies containing `$` `[High]`~~ Fixed in `a8893a8` (verified)
`packages/blueprint/src/plugin/index.ts:182`
`result.replace(directive.fullMatch, html)` interprets `` $` ``, `$'`, `$&` and
`$$` in `html`. Leandown's inline-math syntax `` $`…` `` is replaced with the
text that comes before the match. The scaffolded `src/template/index.md:7,11,21`
hits this on a fresh `blueprint init`.
**Fix:** `result.replace(directive.fullMatch, () => html)`, or splice by index.

### ~~B2. Close detection is broken for nested, unclosed or fenced directives `[Medium]`~~ Fixed in `a8893a8` (verified)
`packages/blueprint/src/plugin/index.ts:61-66`; `vite/blueprint-plugin.ts:16,43`
`/^:::/m` treats any line starting with `:::` as the close, including the
next opener.
- **Nested:** `:::theorem … :::proof … ::: :::` renders `</section>proof` and
  leaves stray `:::` lines.
- **Unclosed:** an unclosed directive swallows the next opener.
- **Fenced:** directives inside fenced code are rewritten. The graph scanner
  also creates fake nodes from code fences.

**Fix:** a line-based parser that skips fences, counts depth, requires an
exact `:::` close and warns on unclosed directives.

### ~~B3. `blueprint build` / `serve` die whenever `lake build :docs` fails `[High]`~~ Fixed in `a8893a8`
`packages/blueprint/src/commands/build.ts:35-41`; `commands/docs.ts:24-46,103-107`; `commands/serve.ts:43-46`; `template/blueprint.json:3`
`docsCommand` calls `process.exit(1)`, which neither `try/catch` nor
`.catch()` can intercept. The template sets `leanProjectPath: "./lean"` but
creates an empty `lean/`. So `init` → `install` → `build` exits 1 with no site,
and so does any project without doc-gen4 or without `lake`. In `serve`, a
missing lean directory kills the CLI before Vite starts.
**Fix:** have `docsCommand` throw or return a status. `build` and `serve` should
warn and continue.

### ~~B4. Scaffolded deps pin `^0.0.1`, which on 0.0.x matches only 0.0.1 `[High]`~~ Fixed in `a8893a8`
`packages/blueprint/src/commands/init.ts:124-125`
For a 0.0.x version, caret means `>=0.0.1 <0.0.2`, so new projects install
0.0.1 instead of 0.0.20 (different template and API).
**Fix:** write `^${pkg.version}` using the CLI's own package.json.

### ~~B5. Router has no `basepath`, so sub-path deploys break `[High]`~~ Fixed in `a8893a8`
`packages/blueprint/src/app/router.tsx:30`; `components/Sidebar.tsx:25,40`
With `base: "/repo/"` (a GitHub Pages project site):
- `/repo/ch1` matches no route.
- `/repo/` shows the first page with slug `repo`.
- Sidebar links leave the base path.

**Fix:** `createRouter({ routeTree, basepath: import.meta.env.BASE_URL })`, and
drop the manual `replace(BASE, "")`.

### ~~B6. No HTML escaping of labels or attributes `[Medium]`~~ Fixed in `a8893a8` (verified)
The author is trusted, so this is a correctness issue, not a security one.
`packages/blueprint/src/plugin/index.ts:96-157`
An owner value containing an escaped quote, `(owner := "Jane \"JD\" Doe")`,
breaks the attribute: `\"` is accepted by the regex but never unescaped. Ordinary labels such
as `"a<b"` or `"f & g"` produce broken markup.
**Fix:** unescape `\\.` in `parseInfo`, and pass every interpolated value
through `escapeHtml`.

### ~~B7. Graph is stale in dev, and duplicate labels crash it `[Medium]`~~ Fixed in `a8893a8`
`packages/blueprint/src/vite/blueprint-plugin.ts:51-54`, `:152-155`, `:291-295`
- **Stale graph:** the graph module never calls `addWatchFile` and is never
  invalidated, so new directives or `uses` don't show on `/graph` until the
  server restarts.
- **Duplicate labels:** a duplicate label creates a duplicate cytoscape id,
  which throws "Can not create second element with ID".

**Fix:** watch the scanned files or invalidate the module, and dedupe ids with
a warning.

### ~~B8. Graph statuses don't match the legend `[Medium]`~~ Fixed in `945194b`
`packages/blueprint/src/vite/blueprint-plugin.ts:47-49`, `:71-77`; `vite/graph-renderer.ts:67-80`, `:149-164`, `:287-288`
- **Status not checked:** `stated` means "has a `lean` attribute" and `proved`
  means "has a `proved` attribute". Neither is checked against Lean.
- **Unreachable states:** the `can_state` branch is dead (proved implies
  stated), and `not_ready` is never assigned, yet the legend shows both.
- **`can_prove` ignores dependencies:** it is given to every stated-but-unproved
  node.
- **Cycles:** an unproved cycle reports `fullyProved` (`visited` returns
  `true`).
- **Layout direction:** cola `flow.axis: "x"` lays out left-to-right, while the
  comment says "downward".

**Fix:** compute states from dependency statuses the way leanblueprint does,
detect cycles, and use `axis: "y"`.

### ~~B9. Lean analyzer is wrong, and costly when it runs `[Medium]`~~ Fixed in `945194b`
`packages/blueprint/src/lean/analyzer.ts:29`, `:93-106`, `:127-136`, `:160-179`, `:240-257`, `:323`, `:343-372`
`analyzeProject` isn't called anywhere in the build. It has these defects:
- **Same-line attribute attached to the wrong declaration:** a same-line
  `@[blueprint "foo"] theorem a` attaches `foo` to the **next** declaration.
- **Declaration forms not recognised:** `private`/`protected`/`partial`,
  `abbrev`, `axiom` and `opaque` are not recognised.
- **Names unqualified:** names are recorded without their `namespace`, so
  `lean := "Ns.foo"` misses the lookup and counts as `sorry`.
- **States unreachable:** the `hasOwnSorry` `continue` makes `can_state` and
  `can_prove` unreachable.
- **Edge direction:** edges go user→dependency, the opposite of the Vite graph.
- **Wasted LSP run:** `enrichWithLsp` starts Lean and highlights up to 20 files
  per run, then discards the results. `useLsp` defaults to `true`.

**Fix:** use `ann.line <= i` and start the blocking scan at `ann.line`. Track
namespaces. Compute status from own-sorry plus dependency statuses. Unify the
edge schema. Remove or disable the LSP phase.

### B10. Routing and page-loading edge cases `[Low]`
- `vite/summary.ts:30`: `path.basename` route keys collide (`a/intro.md` and
  `b/intro.md`). A page named `graph.md` is shadowed by `/graph`.
- ~~`app/components/MarkdownPage.tsx:24`: unknown slugs silently show the first
  page.~~ Fixed in `a8893a8`
- ~~`app/components/MarkdownPage.tsx:36-38`: no cancellation and no `.catch`, so
  a late response overwrites the current page and a failed import leaves a
  blank page.~~ Fixed in `a8893a8`

### B11. Config and output paths `[Low]`
- ~~`commands/build.ts:41`, `commands/serve.ts:46`, `vite/blueprint-plugin.ts:175`:
  a `blueprint.json` parse error is silently ignored.~~ Fixed in `a8893a8`
- ~~`util.ts:12` vs `vite/blueprint-plugin.ts:140`: `srcDir` is ignored, and
  `"src"` is hard-coded.~~ Fixed in `a8893a8` for the summary and graph; the
  template's `import.meta.glob` is still relative to `src/main.tsx`.
- ~~`commands/build.ts:53`, `vite/blueprint-plugin.ts:249`: `dist` is
  hard-coded, which overrides `build.outDir`.~~ Fixed in `a8893a8`
- `vite/blueprint-plugin.ts:245-252`: the whole doc-gen4 tree is copied
  synchronously on every build and every watch rebuild.
- `vite/blueprint-plugin.ts:217-221`: `/docs` without a trailing slash serves
  `index.html`, so doc-gen4's relative assets 404. It should redirect to
  `/docs/`.
- `vite/blueprint-plugin.ts:257-261` plus `handleHotUpdate`: a markdown edit
  triggers two reloads.

### B12. `init` defects `[Low]`
- `commands/init.ts:6`: `TEMPLATE_DIR` exists only under `dist/`. Run from
  source, every template is skipped, yet "Created files" is still printed.
- `commands/init.ts:35`: the directory name is substituted into JSON and HTML
  with no escaping, and a string replacer expands `$&`.

---

## `@leandown/mdbook`

### M1. Fence regex swallows prose and breaks neighbouring blocks `[High]` (verified)
`packages/mdbook/main.ts:27`
`` /```lean\r?\n([\s\S]*?)\r?\n```/g `` has no line anchors.
- **Empty block:** an empty `` ```lean `` block captures the following prose
  and corrupts the next fence.
- **Lists and blockquotes:** a Lean fence inside a list or blockquote never
  matches its indented close.
- **Nested fences:** Lean examples inside a ` ````markdown ` fence get
  rewritten.
- **Info strings:** `lean4`, `lean,ignore` and `lean title` are ignored.

**Fix:** walk markdown-it `fence` tokens (markdown-it is already a dependency),
using `token.map` and `token.info`.

### M2. `{{#include}}` inside Lean blocks breaks `[Medium]` (verified)
Preprocessors without ordering run alphabetically, so leandown runs before
`links`. Lean sees `{{#include …}}` and errors. Then `links` injects raw text
into the emitted `<pre>`.
**Fix:** document `after = ["links"]` in the README and `examples/mdbook/book.toml`,
or warn when a block contains `{{#`.

### M3. Errors exit 0 and blocks run serially `[Medium]`
`packages/mdbook/main.ts:9-37`, `:86-101`
- ~~**Error hidden:** see X2. The `finally { await processor.shutdown() }` hangs
  on a dead server and Node exits 0, so the real error is never printed.~~
  **Fixed** with X2: `shutdown()` skips the request on a dead server. `main.ts`
  still needs to exit 1 on errors.
- **One block fails the book:** there's no per-block `catch` (X9).
- **Serial processing:** chapters run one after another, even though they are
  independent.

**Fix:** catch errors, print them and `process.exit(1)` after a bounded
shutdown. Use a per-block fallback, and process chapters concurrently with a
small limit.

### M4. `supports` accepts every renderer `[Low]` (verified)
`packages/mdbook/main.ts:47-49` always exits 0, so markdown, epub and
linkcheck outputs get raw HTML and `<script>` blobs.
**Fix:** `process.exit(process.argv[3] === "html" ? 0 : 1)`.

---

## VS Code extension (`packages/vscode`)

### V1. Every keystroke does a synchronous workspace scan and saves to disk `[High, perf]`
`packages/vscode/src/extension.ts:40-45`, `:374`, `:388-407`, `:479`, `:505`, `:544-548`, `:604-607`
`onDidChangeTextDocument` has no debounce. `getCompanionUris` runs **before**
the "no Lean blocks" early return. It does a synchronous `readdirSync` walk,
depth 5, over every workspace folder. The companion is then saved with
`applyEdit` + `save()` on every change. In a large monorepo, typing in any
README stalls the extension host, and save hooks fire on every keystroke.
**Fix:** check for blocks first, debounce about 200 ms, cache the companion
path in `DocState`, and drop the per-keystroke `save()`.

### V2. Companion path is computed again on each sync but stored only once `[Medium]`
`packages/vscode/src/extension.ts:544`, `:559-566`, `:575-604`
`state.leanUri` is set when the state is created, while later syncs write to a
freshly resolved path. A document open at startup resolves to the `/tmp`
fallback before workspace folders exist, and later syncs then edit
`<proj>/.leandown/…`. Hover, definition, tokens and diagnostics keep reading
the stale companion.
**Fix:** resolve the path once, or migrate the state when the path changes.

### ~~V3. Fixed, predictable `/tmp/leandown-temp-project` `[Medium, security]`~~ Fixed in `f1b8c32`
`packages/vscode/src/extension.ts:432-462`
The directory is reused if it exists, and the lakefile is written only if it
is absent. Another local user can pre-create the directory with a malicious
`lakefile.lean`, and `lake serve` then runs it as the victim. Two VS Code
windows also share the directory and delete each other's companions.
**Fix:** `fs.mkdtempSync` (as core does at `processor.ts:45`), or
`context.globalStorageUri`.

### V4. Semantic tokens are never refreshed `[Medium]`
`packages/vscode/src/extension.ts:257-285`
No `onDidChangeSemanticTokens` is registered. Tokens are requested before the
companion has been updated or elaborated, and are never requested again. After
inserting a line, every highlight is off by one line until the next keystroke.
On first open the file stays uncoloured.
**Fix:** use an `EventEmitter`, fired after the companion sync and when Lean
finishes.

### V5. Deleting the last Lean block deletes the companion `[Medium]`
`packages/vscode/src/extension.ts:548-552`, `:712-715`
Temporarily editing `` ```lean `` to `` ```lea `` unlinks the companion and
discards the state. Retyping it re-elaborates from scratch and flashes the
companion tab open again.
**Fix:** keep the state and file until the Markdown document is closed, and
write an empty companion.

### V6. Smaller extension defects `[Low]`
- **Companion name collisions** (`extension.ts:511,515,519`): `/a/b_c.md` and
  `/a/b/c.md` map to the same flat name, and so do two repos' `README.md` under
  an absolute `tempDir`. Fix: add a hash of `fsPath` to the name.
- **Fence parsing is not CommonMark** (`markdown-parser.ts:37,63`) (verified):
  - It opens on `startsWith("```lean")`, so `leanOutput` is compiled as Lean.
  - It closes on any line starting with three backticks, so 4-backtick fences
    and nested examples are mis-split.
  - `> > ```lean` is not detected.
- **Scheduled tab close** (`extension.ts:678-682`): 1 s after the client
  starts, every tab for the companion is closed, including one the user just
  opened.
- **Missing dependency** (`vscode/package.json`): there is no
  `extensionDependencies: ["leanprover.lean4"]`, so without that extension
  every feature silently does nothing.

---

## Build, release & packaging

### ~~P1. `bun.lock` is stale, so release and docs CI fail at install `[High]`~~ Fixed in `6e67a85`
The bump commit `3e3e0f9` set the versions to 0.0.20, but `bun.lock` still has
0.0.19 entries and mdbook pins `@leandown/core: ^0.0.16`. `bun install --frozen-lockfile`
(`.github/workflows/release.yml:38`, `deploy-docs.yml:46,62`) fails with
"lockfile had changes, but lockfile is frozen".
**Fix:** run `bun install` and commit the lockfile, and make the bump step
update it.

### P2. `pack-local` fails and the blueprint e2e suite never runs `[Medium]` (verified)
- **pack-local fails:** `scripts/pack-local.mjs:49` uses `pnpm pack` in a bun
  workspace and fails with `ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL`.
- **Stale e2e suite** (`tests/blueprint.spec.ts`):
  - **Wrong version:** `:64` hard-codes `PACK_VERSION = "0.0.11"`.
  - **Suite skipped:** `:183` is `test.describe.skip`.
  - **Stale file paths:** it expects `src/main.ts`, while init writes
    `main.tsx`.
  - **Cache never persists:** its project directory is under `test-results/`,
    which Playwright deletes on every run, so the "cache persists" comment is
    false.

**Fix:** reuse the `npm pack` approach from `verify-publish.mjs` and read the
version from package.json.

**Partly fixed** (`50512e7`): `bun run pack` replaces `pack-local.mjs`, and the
spec reads the version from package.json. The suite is still skipped, with
stale paths and a non-persistent cache.

### P3. Stryker/Playwright port isolation never takes effect `[Medium]`
`tests/playwright.config.ts:4`; `tests/blueprint.spec.ts:106`
They read `STRYKER_SANDBOX_WORKER_INDEX`, but Stryker 9 sets
`STRYKER_MUTATOR_WORKER`. All 8 sandboxes therefore use port 5173 with
`reuseExistingServer: true`, so they test whichever mutant bound the port
first. A developer's own dev server on 5173 also silently becomes the server
under test.
**Fix:** derive the port from `STRYKER_MUTATOR_WORKER`, and disable reuse under
Stryker and CI.

### ~~P4. Release scripts check too little `[Low]`~~ Fixed in `50512e7`
- **Publish not idempotent:** `scripts/publish-packages.mjs:106-130` publishes
  every package unconditionally. A version that wasn't bumped aborts the run
  after the earlier packages are already live. Fix: skip versions that
  `npm view` already shows.
- **verify-publish too shallow:** `scripts/verify-publish.mjs:85-93` checks
  only `import` strings, not `types` or whether files exist. It passes
  blueprint's `"./app": "./src/app/main.tsx"`, which ships raw TSX.

### P5. Dependency and metadata issues `[Low]`
- **TypeScript in consumers:** `typescript: ^5` is a peerDependency of the
  runtime packages, so npm auto-installs it for consumers.
- **remark types under pnpm:** `packages/remark/dist/index.d.ts` imports
  `unified` and `mdast` types that are only devDependencies, so they fail to
  resolve under pnpm.
- **Loose comark range:** `comark: ">=0.1.0"` accepts any future major
  version, while the code relies on the 0.4 `post` API.
- **Wrong docs:** the markdown-it and comark READMEs are copies of the remark
  README, and the JSDoc imports reference `markdown-it-lean` / `comark-lean`.

---

## Fresh-install walkthrough

On 2026-10-10 all six packages were published at `c82a1b5` to a local Verdaccio
registry using `scripts/publish-packages.mjs`. New projects then followed each
README using only `npm`.

| Story | Result |
|---|---|
| remark quick start (README) | Correct output, and hovers work in the browser after a Vite build. **The script never exits** (killed after 5 min). |
| `blueprint init` → install → build/serve | **Blocked at three separate steps** (F1, B4, B3). With all three worked around, `serve` shows a **blank page** (F2), and the built site is corrupted (B1). |
| mdbook (README config) | `command = "mdbook-leandown"` **is not found** (F3). With `npx mdbook-leandown` it builds in 2.7 s and exits. |
| Typst via `@leandown/core` (README) | Output compiles with typst 0.15.1. **The script never exits.** |
| markdown-it | The installed package has no README (F4). |

### ~~F1. README's `blueprint init my-blueprint` is rejected `[High]`~~ Fixed in `a8893a8` (verified)
`packages/blueprint/README.md` (Quick Start) vs the CLI. `init` takes only
`--dir`, so a positional argument gives `Unknown arguments` and the first
command a new user runs fails.
**Fix:** accept a positional directory, or correct the README.

### ~~B4 update: the `^0.0.1` pin makes install impossible `[High]`~~ Fixed in `a8893a8` (verified)
0.0.1 was never published (real npm has 0.0.15 and later), so `npm install` and
`bun install` in a scaffolded project fail with `ETARGET` / "No version
matching". No new project can be installed without editing `package.json` by
hand.

### ~~F2. Blueprint dev server renders a blank page for registry installs `[High]`~~ Fixed in `a8893a8` (verified)
`packages/blueprint/package.json` (`"./app": "./src/app/main.tsx"`), `vite/blueprint-plugin.ts` (`optimizeDeps`)
Vite does not pre-bundle the dependencies of the raw-TSX `@leandown/blueprint/app`,
so CommonJS packages reach the browser untransformed. The browser reports
`escape-html … does not provide an export named 'default'`. After that is
fixed, `use-sync-external-store` (pulled in by `@tanstack/react-router`) fails
the same way. Production builds work because Rollup converts CommonJS. The
in-repo e2e setup doesn't catch this because the workspace link changes how
Vite optimises dependencies.
**Fix (verified):** the plugin's `config()` should set `optimizeDeps.include`
to `@leandown/blueprint > react`, `… > react-dom/client`,
`… > @tanstack/react-router`, `… > @leandown/core/runtime`, and
`@leandown/blueprint/graph-renderer`. Ship the app pre-built as well (see P4).
Both parts are done: `./app` ships pre-built since `50512e7`.

### F3. mdbook README config can't find the preprocessor `[Medium]` (verified)
`packages/mdbook/README.md`. The README installs with `--save-dev`, but
`node_modules/.bin` isn't on mdbook's `PATH`, so `command = "mdbook-leandown"`
fails with "wasn't found".
**Fix:** document `command = "npx mdbook-leandown"`, or a global install.

### F4. Symlinked READMEs are not packed `[Low]` (verified)
`packages/{core,remark,markdown-it,comark}/README.md` are symlinks to the root
README, and npm does not pack symlinks. The real `@leandown/remark@0.0.20`
tarball contains only `dist/` and `package.json`. npmjs.com still shows a
README because it comes from publish metadata, but installed packages have
none.
**Fix:** copy the README in `prepack`, or replace the symlinks with real files.

### F5. Scripts that follow the README hang `[High]`
This is X11 "no clean exit" seen from the user's side. The remark quick start
and the Typst snippet both print their output and then never exit, because the
pooled `lake serve` keeps the event loop alive. Any build script that uses them
hangs CI. This should move up from Low.

### ~~F6. `@leandown/core` ships test artefacts `[Low]`~~ Fixed in `50512e7`
`tsc -p tsconfig.build.json` emits `*.test.d.ts` and `__fixtures__/` into
`dist/`, and they are published.
**Fix:** exclude `**/*.test.ts` and `__fixtures__` in `tsconfig.build.json`.

### F7. Scaffolded projects pull in TypeScript `[Low]`
P5 confirmed: `npm ls` in a plain remark project shows `typescript@5.9.3`
installed through the `peerDependencies` of `@leandown/core` and
`@leandown/remark`.

---

## Test coverage gaps

- **Untested modules:**
  - core: `client.ts`, `processor.ts`, `cache.ts`, `runtime.ts`.
  - adapters: markdown-it, comark.
  - blueprint: ~~`plugin/index.ts` (the directive parser)~~ (tested in
    `a8893a8`), `extractGraphData`,
    `parseSummary`, the docs middleware.
  - mdbook: `processMarkdown` / `main()`.
  - vscode: `extension.ts`.
- ~~**No fake LSP:** a stub JSON-RPC server with Content-Length framing would
  allow deterministic tests of X2, X5, X9 and X11 without Lean installed.~~
  **Added** in `37b1065` (`packages/core/src/__fixtures__/fake-lsp.ts`); it can
  be extended for X5 and X9.
- **Backend tests check methods one at a time**, never the assembled output.
  That is how C1 got through.
- **Missing scenarios:**
  - concurrent documents (X3)
  - a failing block, or `lake` missing
  - `</script>` in the output
  - cache hits and invalidation (the cache lives in `test-results/` and is
    wiped every run)
  - process exit and shutdown
  - ~~nested or fenced directives, and `$` in directive bodies~~ (added in `a8893a8`)
  - ~~same-line `@[blueprint]` and namespaces in the analyzer~~ (the
    analyzer now asks Lean; namespaces and indirect sorry are tested in `945194b`)
  - non-root Vite `base`
- **Blueprint e2e can't run as written:** packing is fixed (`50512e7`), but the
  suite is still skipped (see P2).
- **Weak e2e assertions:**
  - `tests/lean.spec.ts:412`: `/(2|…)/` matches any tooltip containing "2".
  - `:455`: reads only the first block's registry, but hover ids restart at
    `h1` in every block.
  - `:132` and `:420-437`: loops that pass with zero elements.
  - `tests/blueprint.spec.ts:441-446`: accepts either 200 or 404.
- **Stryker scope:** `mutate` covers only core and remark.

---

## Suggested fix order

1. **Quick, high-value fixes:**
   - B1 (function replacer)
   - ~~P1 (lockfile)~~
   - B4 (version pin)
   - M4 (`supports`)
   - X6 (the `path.resolve` fix)
   - ~~C1 (Typst escaping)~~
   - X1 (escape `<`)
2. **LSP lifecycle:** ~~X2~~, X9, X10, the rest of X11. ~~Add the fake-LSP test
   harness at the same time.~~
3. **Per-document sessions plus single-pass elaboration:** X3 and X4. These
   also remove most of the X5 and X7 pressure.
4. **Cache correctness:** the rest of X6, and X5.
5. **Blueprint:**
   - B3 and B5, which break basic builds and deploys
   - then a proper directive parser (B2, B6)
   - then the graph and analyzer (B7–B9)
6. **mdbook fence parsing** (M1–M3), **VS Code** (V1–V5) and **test harness repair** (P2, P3).
