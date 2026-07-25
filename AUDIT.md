# Code Audit Report: leandown

A code quality and correctness audit of the `leandown` monorepo, covering
`@leandown/core`, `@leandown/blueprint`, `@leandown/comark`, `@leandown/remark`,
`@leandown/markdown-it`, `@leandown/mdbook`, and the VS Code extension.

Findings were verified by reading the source directly; representative lines are
quoted. File references are repo-relative and clickable
(e.g. `packages/core/src/client.ts:626`).

---

## Executive Summary

The most consequential issues cluster around **process/LSP lifecycle management**
and **untrusted input handling**:

- **LSP requests can hang forever.** `sendRequest` has no timeout and no reject
  path; if `lake serve` dies or never answers, `highlight()` and the whole build
  hang indefinitely (core #1).
- **`lake serve` processes are orphaned on exit.** The exit/signal handlers call
  an async `shutdown()` that awaits a request which never resolves, so
  `proc.kill()` never runs and the temp project is deleted out from under a live
  server (core #2).
- **Path traversal in the dev-server docs middleware.** A request like
  `/docs/../../../../etc/passwd` streams arbitrary local files, with no
  containment check (blueprint #3).
- **Background docs can crash the dev server.** `docsCommand({background:true})`
  runs in-process and calls `process.exit(1)` on config errors, tearing down the
  entire Vite dev server; its `spawn("lake")` also has no `.on("error")` handler,
  so a missing `lake` throws an uncaught exception (blueprint #1, #2).
- **The Comark adapter produces corrupted output.** Rewriting a node's tag to the
  string `"html"` is not a raw-HTML passthrough in Comark; the highlighted HTML
  ends up escaped or re-fenced (comark #1).
- **Invalid Typst output.** `TypstBackend` emits nested `#raw(...)` calls that
  don't compile (core #14).

> **Correction to a prior audit:** an earlier version of this document flagged
> Comark's `visitNodes` `slice(2)` as an off-by-one "brittle AST visitor" bug.
> That finding is **incorrect** and has been removed: a `ComarkElement` always
> carries a mandatory attributes object at index 1, so children genuinely start
> at index 2. The real Comark defect is the output transform (comark #1 below).

A later pass also surfaced a class of issues the original audit didn't cover —
**release/packaging robustness** — now captured under
[Build, release & packaging](#build-release--packaging).

---

## Resolution status

**Updated 2026-07-25.** The following findings have since been fixed:

- **Core #1, #4, #9, #12** — `sendRequest` now has a per-request timeout and a
  reject path; the `error`/`exit` handlers reject all pending requests;
  `highlight()` is wrapped in `try/finally` so `didClose` always fires and the
  per-URI `diagnosticsMap`/`compileWaiters` entries are always cleared; the
  compile-wait fallback timer and map entry are torn down once settled; and
  `stdin` writes are guarded so a dead process rejects cleanly. (`28ea638`)
- **Core #2, #3** — exit/signal handlers now kill LSP children synchronously via
  `killSync()` (no orphaned `lake serve`, no early temp-dir delete); `leanHydrate`
  disposes the prior run's global listeners and open tooltips before
  re-hydrating. (`28ea638`)
- **Blueprint #2** — the background docs `spawn` has an `error` handler that
  closes the log fd and prints an actionable message. (`28ea638`)
- **Blueprint #3** — the dev-server docs middleware now `decodeURIComponent`s,
  rejects NUL/malformed input with `400`, and enforces a `docsRoot` containment
  boundary before streaming.
- **mdbook #1** — `processor.shutdown()` runs in a `finally`. (`28ea638`)
- **All [Build, release & packaging](#build-release--packaging) findings.**
  (`3015bed`)

Still open: Core #5–#8, #10, #11, #13, #14; Blueprint #1, #4–#11; Comark #1;
remark/markdown-it #1–#2; mdbook #2–#3; all VS Code items. `@libsql/client`
(build/install #6-adjacent) is intentionally deferred — unusual platforms
without a prebuilt binary are unsupported for now.

---

## `@leandown/core`

### 1. `sendRequest` has no timeout or reject path — LSP failures hang forever `[High]`
`packages/core/src/client.ts:626-637`

```ts
private sendRequest(method: string, params: any): Promise<any> {
  const id = this.nextRequestId++;
  return new Promise((res) => {
    this.pendingRequests.set(id, res);
    ...
    this.proc!.stdin!.write(message);
  });
}
```

The promise only ever resolves from `parseMessages`; there is no `reject` and no
timeout. `semanticTokens/full` (`client.ts:172`) and `$/lean/plainGoal`
(`client.ts:387`) are awaited with **no** `.catch`, so a single missing response
makes `highlight()` — and therefore `processBlock` and the whole build — hang
forever. The `proc.on("error")` handler (`client.ts:59`) only logs; it never
rejects pending requests, and `pendingRequests` entries leak.
**Fix:** add a per-request timeout and reject all pending requests in the
`error`/`exit` handlers.

### 2. Exit/signal handlers don't await async `shutdown()` — orphaned `lake serve`, early temp-dir delete `[High]`
`packages/core/src/processor.ts:77-96`, `client.ts:613-624`

```ts
function cleanupClients() {
  ...
  for (const client of clientPool.values()) {
    client.shutdown();          // async, not awaited
  }
  if (tempProjectPath) { ... fs.rmSync(resolvedPath, {recursive:true, force:true}); }
}
process.on("exit", cleanupClients);
process.on("SIGINT", () => { cleanupClients(); process.exit(0); });
```

`shutdown()` does `await this.sendRequest("shutdown", null)` **before**
`this.proc.kill()`. On `exit`/SIGINT/SIGTERM the process terminates before that
await resolves (finding #1 guarantees it may never resolve), so `proc.kill()`
never runs. Because `spawn` is not `detached`, the heavyweight `lake serve`
children are orphaned. Worse, `rmSync` deletes the temp project directory while
`lake serve` may still be running against it.
**Fix:** on exit/signals call `proc.kill()` directly/synchronously; reserve the
graceful shutdown-request dance for the explicit async `shutdown()`.

### 3. Browser hydration leaks global listeners on every navigation `[Medium-High]`
`packages/core/src/runtime.ts:98, 282-373` (invoked at `runtime.ts:85`)

`leanHydrate` unconditionally does
`document.addEventListener("mouseover"|"mouseout"|"click", ...)` with fresh
anonymous closures and never removes them. `leanAwaitContent` calls
`leanHydrate()` after every content swap (`runtime.ts:85`) — designed to run
repeatedly for pager/SPA navigation. Each navigation stacks another full set of
global listeners over stale `activeTooltips` state, producing duplicated tooltips
and a growing memory leak.
**Fix:** guard against double-init or return a teardown that removes listeners
before re-hydrating.

### 4. `highlight()` has no try/finally — `didClose` and map cleanup skipped on error `[Medium]`
`packages/core/src/client.ts:152-582`

`textDocument/didClose` is sent only on the success path (`client.ts:580`);
`diagnosticsMap.delete` (`client.ts:428`) and `compileWaiters` cleanup are
likewise unguarded. Any rejection between `didOpen` (`client.ts:152`) and
`didClose` leaves the document open in the LSP server and leaks
`diagnosticsMap`/`compileWaiters` entries. Over a long-running dev server this
accumulates LSP-side document state.
**Fix:** wrap the body in try/finally; always `didClose` and clear per-URI map
entries.

### 5. Lake dependency `dir` resolved against `cwd`, not the project path → stale cache `[Medium]`
`packages/core/src/cache.ts:75`

```ts
parts.push(`${pkg.name ?? ""}:${hashLeanDirectory(path.resolve(pkg.dir))}`);
```

`pkg.dir` from `lake-manifest.json` is relative to the project root, but
`path.resolve(pkg.dir)` resolves against `process.cwd()`. When cwd ≠ projectPath
the path is wrong, `collectLeanFiles` returns `[]`, and `hashLeanDirectory`
silently hashes empty content — so `computeProjectFingerprint` stays stable even
after a path-dependency's source changes, serving stale cached highlights.
**Fix:** `path.resolve(projectPath, pkg.dir)`.

### 6. `getPermalinkForUri` runs 4 synchronous `git` subprocesses per token, uncached `[Medium]`
`packages/core/src/client.ts:715-808` (called per token at `client.ts:256`)

For every external-definition token this synchronously shells out to
`git rev-parse --is-inside-work-tree`, `--show-toplevel`,
`git config --get remote.origin.url`, and `git rev-parse HEAD`. There is no
memoization by directory, so a block referencing many stdlib/dep symbols triggers
dozens–hundreds of blocking git invocations, serializing the event loop.
**Fix:** cache results per repo-dir (and commit).

### 7. `computeProjectFingerprint` reads the entire project source into one string `[Medium]`
`packages/core/src/cache.ts:43-54`

```ts
const content = fs.readFileSync(file, "utf8");
parts.push(`${rel}\0${content}`);
...
return hashContent(parts.join("\n"));
```

Every `.lean` file's full contents are concatenated into a single string before
hashing. For a Mathlib-scale dependency tree this reads hundreds of MB into
memory on the first `processBlock`.
**Fix:** feed a streaming hash (`crypto.createHash`) file-by-file; consider
mtime/size for large trees.

### 8. `fileId` can be very short or empty — temp-URI collisions `[Low]`
`packages/core/src/client.ts:141`

```ts
const fileId = Math.random().toString(36).substring(7);
```

`Math.random().toString(36)` isn't guaranteed to be ≥7 chars (e.g. `0.i`), so
`substring(7)` can return an empty string. Concurrent `highlight` calls could
then collide on `tempFileUri`, cross-contaminating `compileWaiters`/`diagnosticsMap`.
**Fix:** use `crypto.randomUUID()` or a monotonic counter.

### 9. `compileWaiters` entry + timer leak on compile timeout `[Low]`
`packages/core/src/client.ts:161-170`

When the `COMPILE_TIMEOUT_MS` branch of `Promise.race` wins, the entry set via
`compileWaiters.set(tempFileUri, …)` is never removed (only `fileProgress`
deletes it, `client.ts:683`). Conversely, when the compile-wait resolves first,
the `setTimeout` timer is never cleared, keeping the event loop alive.
**Fix:** delete the waiter and `clearTimeout` after the race settles.

### 10. `getGoalQueryPositions` strips comments with naive `split("--")` `[Low]`
`packages/core/src/lib.ts:229`

```ts
const cleanText = lineText.split("--")[0]!.trimEnd();
```

`--` inside a string literal or as part of an operator token is misread as a
comment start, truncating the line and producing wrong goal-query positions.

### 11. `parseMessages` silently drops server→client requests carrying an `id` `[Low]`
`packages/core/src/client.ts:675`

Server-initiated requests (`window/workDoneProgress/create`,
`client/registerCapability`, …) have an `id` but aren't in `pendingRequests`, so
they're dropped with no response. Benign today, but could stall if Lean ever
requires a reply.

### 12. `stdin` writes can throw after the process exits `[Low]`
`packages/core/src/client.ts:635, 645`

`this.proc!.stdin!.write(message)` throws synchronously if the child has exited.
Combined with #1's missing error handling this surfaces as an uncaught exception
rather than a clean rejection.

### 13. Dead / duplicated code `[Low]`
- `wrapLeanCodeBlock` (`packages/core/src/html.ts:7-9`) duplicates
  `HtmlBackend.wrapBlock` (`backend.ts:58-60`) verbatim and is effectively dead
  (the processor uses `backend.wrapBlock`).
- `getDatabase` and `ensureDatabaseInitialized` (`cache.ts:88-126`) duplicate the
  cacheDir/dbPath resolution logic; a divergence would silently split caches.

### 14. `TypstBackend` emits invalid nested `#raw(...)` `[High]`
`packages/core/src/backend.ts:140-192`, rendered at `client.ts:544-575`

Within a token span the renderer emits, in order: `renderTokenStart` →
`#lean-token(type:"keyword")[#raw("`, then the span text via `escape()`
(`client.ts:546`) → `#raw("def")`, then `renderTokenEnd` → `")]`. Concatenated,
that is:

```typst
#lean-token(type: "keyword")[#raw("#raw("def")")]
```

The nested `#raw` is invalid Typst; it fails to compile or renders literal
`#raw("def")` text.
**Fix:** `escape()` should return plain escaped text (no `#raw(...)` wrapper) when
called between token boundaries, since the boundaries already open a `#raw("` /
close `")`.

---

## `@leandown/blueprint`

### 1. Background `docsCommand` can kill the dev server via `process.exit` `[High]`
`packages/blueprint/src/commands/serve.ts:43-44`, `commands/docs.ts:33,38,45`

`serve` fires `docsCommand({ background: true }).catch(() => {})`, but
`docsCommand` runs **in the same process** and calls `process.exit(1)` on config
errors (`docs.ts:33`, `:38`, `:45` — e.g. missing `leanProjectPath` directory).
`process.exit` is not a rejection, so `.catch()` can't save it: a misconfigured
lean dir tears down the entire Vite dev server.
**Fix:** in background mode, log/return errors instead of `process.exit`; or have
`serve` validate the lean dir itself.

### 2. Background `spawn("lake", …)` has no `.on("error")` — uncaught exception + fd leak `[High]`
`packages/blueprint/src/commands/docs.ts:55-71`

```ts
const out = fs.openSync(logPath, "w");
const child = spawn("lake", ["build", ":docs"], { cwd: leanDir, stdio: ["ignore", out, out] });
child.on("close", (code) => { fs.closeSync(out); ... });
```

There is no `child.on("error", …)` (confirmed absent across `src/`). If `lake` is
`ENOENT`, Node emits an unhandled `'error'` event and throws — crashing the dev
server asynchronously after startup. The `out` file descriptor also leaks on that
path.
**Fix:** add `child.on("error", …)` that closes `out` and logs the failure.

### 3. Path traversal in the dev-server docs middleware `[High]`
`packages/blueprint/src/vite/blueprint-plugin.ts:196-211`

```ts
const reqPath = (req.url ?? "/").split("?")[0]!;
const candidates = [ path.join(docsDir, reqPath), ... ];
... if (fs.statSync(filePath).isFile()) { ...; fs.createReadStream(filePath).pipe(res as any); }
```

`reqPath` comes straight from the request URL with no containment check and no
`decodeURIComponent`. A request like `/docs/../../../../etc/passwd` yields a path
that normalizes *out* of `docsDir`, and the file is streamed back — arbitrary
local file read on the dev server.
**Fix:** `const resolved = path.resolve(docsDir, "." + decodeURIComponent(reqPath))`,
then reject unless `resolved.startsWith(docsDir + path.sep)`.

### 4. `enrichWithLsp` is an expensive no-op (dead work) `[Medium]`
`packages/blueprint/src/lean/analyzer.ts:160-179`

Phase 2 of `analyzeProject` starts a full `LeanLSPClient`, reads and highlights
up to 20 sources (`sources.slice(0, 20)`), then discards every result. The
`declInfos` map passed in is never mutated, and `LeanDeclInfo.references` is only
ever `[]`. With `useLsp` defaulting to `true` (`analyzer.ts:51`), every analysis
pays the full cost of booting Lean's LSP for zero effect.
**Fix:** wire the highlight results back into `declInfos`, or delete the LSP phase
and the `useLsp` default.

### 5. Graph edge direction/schema inconsistent across the two pipelines `[Medium]`
`packages/blueprint/src/lean/analyzer.ts:257` vs `vite/blueprint-plugin.ts:57`

Two independently-exported implementations produce **opposite** edge conventions
and different keys:
- `analyzer.ts:257`: `edges.push({ from: label, to: useLabel })` — node → dependency.
- `blueprint-plugin.ts:57`: `edges.push({ source: dep, target: label })` — dependency → node.

They also disagree on status schema (`DeclState` enum in `types.ts` vs booleans in
`graph-renderer.ts`). Any consumer mixing `analyzeProject` output with the renderer
gets reversed arrows and a schema mismatch.
**Fix:** unify on one edge schema/direction (the renderer expects `{source,target}`).

### 6. Same-line `@[blueprint "..."]` annotations are silently dropped `[Medium]`
`packages/blueprint/src/lean/analyzer.ts:93-107`

The label-collection loop only attaches annotations where `ann.line < i` (strictly
before the decl line), but `DECL_RE` (`analyzer.ts:29`) explicitly allows same-line
attributes (`(?:@\[[^\]]*\]\s*)*`). For `@[blueprint "foo"] def bar`, `ann.line == i`
so the label is never attached. The test fixtures only place the attribute on the
preceding line, so this is untested.
**Fix:** also match annotations on the decl line itself.

### 7. `$` sequences in directive bodies corrupt output `[Medium]`
`packages/blueprint/src/plugin/index.ts:182`

```ts
result = result.replace(directive.fullMatch, html);
```

The string second-argument to `String.prototype.replace` treats `$$`, `$&`, `` $` ``,
`$'`, `$n` specially. Since `html` embeds the raw directive body (`index.ts:165`),
display-math `$$…$$` collapses to `$…` and `$&`/`$'` get substituted.
**Fix:** use a function replacement: `result.replace(directive.fullMatch, () => html)`.

### 8. Nested directives mis-parsed (close matcher too greedy) `[Medium]`
`packages/blueprint/src/plugin/index.ts:60-65`

The closing tag is found via `closeRegex = /^:::/m`, which matches *any* line
starting with `:::`, including a nested opener like `:::proof`. A
`:::theorem … :::proof … ::: … :::` block terminates the theorem at the `:::proof`
line, truncating its content.
**Fix:** track nesting depth, or require a bare `:::` closer.

### 9. Hash-route collisions from `path.basename` `[Medium]`
`packages/blueprint/src/vite/summary.ts:30`

```ts
const route = path.basename(href, ".md");
```

`./algebra/intro.md` and `./topology/intro.md` both yield route `"intro"`. Since
routes key `location.hash` and `routeMap` (`blueprint-plugin.ts:31`), the second
overwrites the first and navigation/graph nodes point to the wrong page.
**Fix:** derive the route from the full relative path.

### 10. `srcDir` config option is ignored `[Medium]`
`packages/blueprint/src/util.ts:12`, `vite/blueprint-plugin.ts:140`

`BlueprintConfig.srcDir` is defined but the plugin hardcodes
`const srcDir = path.join(resolvedRoot, "src")` and never reads `cfg.srcDir`.
Projects that set it silently get `"src"`.
**Fix:** read `cfg.srcDir` in `configResolved`.

### 11. Lower-severity blueprint items `[Low]`
- **cola `flow.axis` contradicts its comment** (`graph-renderer.ts:287-288`):
  comment says "downward flow" but sets `axis: "x"` (horizontal). Should be `"y"`.
- **`not_ready` color defined but never applied** (`graph-renderer.ts:35`, legend
  `:149`): `resolveStatementColor` (`:67-72`) never returns it; legend advertises a
  state the renderer can't produce.
- **`build`/`closeBundle` hardcode `dist`** (`build.ts:53`,
  `blueprint-plugin.ts:225`), overriding a custom `build.outDir`.
- **`detectSorry` ignores block comments/strings** (`analyzer.ts:147-156`): a
  `sorry` inside `/- … -/` or a string yields a false `not_ready`.
- **Double reload on `.md` HMR** (`blueprint-plugin.ts:257-261` +
  `handleHotUpdate` `:267-272`): both fire on a markdown edit.
- **`allAncestorsProved` treats cycles as proved** (`blueprint-plugin.ts:71-77`):
  revisiting a node returns `true`, so an unproved dependency cycle reports
  `fullyProved`.
- **`parseLakefile` under-parses** (`lakefile.ts:51`): a `[[lean_lib]]` header with
  a trailing comment fails the strict `^\[\[lean_(lib|exe)\]\]$` regex; `LakeLib`
  also drops `root`.

---

## `@leandown/comark`

### 1. Comark adapter produces corrupted output — `node[0]="html"` is not a passthrough `[High]`
`packages/comark/src/index.ts:60-66`

```ts
(node as unknown as unknown[])[0] = "html";
(node as unknown as unknown[])[2] = html;
```

Detection is correct (the traversal recurses into the `pre` wrapper and finds the
inner `code` node), but the **transform is wrong**. Comark has no raw-HTML
passthrough tag — raw HTML is real element nodes carrying `$:{html:1}`. Setting the
tag to the literal string `"html"`:
- in HTML render mode, the highlighted-HTML **string child gets HTML-escaped**, so
  users see literal `&lt;span…` text;
- in markdown render mode, the surviving parent `pre` handler re-serializes the
  child text back into a fenced code block, dumping the raw HTML as code.
Either way the core feature output is corrupted, and the leftover
`{class:'language-lean'}` attrs object stays at `node[1]`.
**Fix:** replace the parent `pre` node with a node marked `$:{html:1}` (matching how
remark uses `type:"html"` and markdown-it uses `html_block`).

> `visitNodes`'s `slice(2)` (`index.ts:71-79`) is **correct** — Comark elements
> always carry a mandatory attributes object at index 1.

---

## `@leandown/remark` & `@leandown/markdown-it`

### 1. markdown-it: lean fences with any extra info string aren't highlighted `[Medium]`
`packages/markdown-it/src/index.ts:49`

```ts
if (token.type === "fence" && token.info.trim() === "lean") {
```

Exact-match on the whole info string means ` ```lean title=x ` (info
`"lean title=x"`) is skipped — inconsistent with the remark plugin, which matches
`node.lang === "lean"` (first word only).
**Fix:** compare the first token: `token.info.trim().split(/\s+/)[0] === "lean"`.

### 2. Unused imports (dead code) `[Low]`
- `packages/remark/src/index.ts:8`: `import type { LeanHighlightOptions }` — never referenced.
- `packages/markdown-it/src/index.ts:3`: same unused import.

---

## `@leandown/mdbook`

### 1. LSP subprocess not shut down on the error path `[Medium]`
`packages/mdbook/main.ts:63-78`

`processor.shutdown()` (`:71`) is only reached on success. If any
`processItem`/`processBlock` throws, control jumps to `catch` (`:75`) which
`console.error` + `process.exit(1)` without calling `shutdown()`, leaving the
pooled Lean LSP child dangling.
**Fix:** `try/finally` with `await processor.shutdown()` in the `finally`.

### 2. Inconsistent `resetDocument` scoping across sub-chapters `[Low]`
`packages/mdbook/main.ts:65-68` vs `processItem` (`:7-17`)

`resetDocument()` runs once per top-level item, but `processItem` recurses into
`chapter.sub_items` without resetting. Sub-chapter blocks accumulate onto their
parent's cumulative Lean context while sibling top-level chapters are isolated —
asymmetric and likely unintended.

### 3. Fence regex is unanchored / mishandles indented and empty blocks `[Low]`
`packages/mdbook/main.ts:21`

```ts
/```lean\r?\n([\s\S]*?)\r?\n```/g
```

Not anchored to line start, so it matches mid-line ` ```lean `; indented fences (in
lists) over-consume to a later ` ``` `; empty lean blocks aren't matched.

---

## Build, release & packaging

These findings concern how the packages are built and published rather than
runtime behaviour. All were found and **fixed** in the 2026-07-25 pass
(`3015bed`); they're recorded here because they were shipping fragilities, not
one-off mistakes.

### 1. `publish-packages.mjs` continued past a failed publish and reported success `[High]` `Fixed`
`scripts/publish-packages.mjs`

Each package's `npm publish` was wrapped in a `try/catch` that only
`console.warn`ed and continued, after which the script printed
"✓ completed successfully" with exit code `0` regardless. Because the script
rewrites internal `workspace:*` deps to `^{version}` before publishing, a failed
`@leandown/core` publish would still push `@leandown/blueprint`/`@leandown/mdbook`
pinned to a `core` version that never landed — a broken release npm can't roll
back, reported to CI as green.
**Fix:** abort on the first failed publish in real runs; dry runs still continue
(an already-published version is expected there) so every package's packaging is
validated.

### 2. `@leandown/markdown-it` and `@leandown/comark` were never published `[Medium]` `Fixed`
`scripts/publish-packages.mjs`

Both were commented out of `PUBLISH_ORDER` while still listed in
`scripts/pack-local.mjs` and `scripts/fix-workspace-deps.mjs`. Anyone running
`npm i @leandown/markdown-it` got whatever stale version last went up, or nothing.
**Fix:** restored both to `PUBLISH_ORDER` (order preserves dependency layering).

### 3. `@leandown/mdbook` sat outside the release pipeline `[Medium]` `Fixed`
`packages/mdbook/package.json`, `scripts/*.mjs`

mdbook appeared in none of `PUBLISH_ORDER`, `pack-local`, or
`fix-workspace-deps`, and its `@leandown/core` dependency was a hand-pinned
`^0.0.16` that drifts from the actual core version instead of `workspace:*`.
**Fix:** added mdbook to all three scripts and switched its core dep to
`workspace:*` (resolved to the concrete `^{version}` at publish time).

### 4. Published entry points resolved to TS source unless one script ran `[High]` `Fixed`
`packages/{core,markdown-it,comark}/package.json`

`exports["."].import` points at `./src/index.ts` while `files` ships only `dist`.
Correct resolution depended entirely on `publish-packages.mjs` promoting
`publishConfig.exports` → top-level. `core`, `markdown-it`, and `comark` also had
no `prepack`, so `dist` wasn't guaranteed fresh (or present) before packing — a
plain `npm publish`/`npm pack` outside the release script would ship a package
whose entry point isn't in the tarball.
**Fix:** added `prepack: "bun run build"` to those three packages so `dist` is
always built before pack/publish (`pnpm pack`/`npm publish` both run `prepack`).

### 5. Promoted `publishConfig.exports` triggered an npm deprecation `[Low]` `Fixed`
`scripts/publish-packages.mjs`

The script copied `publishConfig.exports` to the top level but left the original
in place, so npm warned: *"Unknown publishConfig config 'exports'. This will stop
working in the next major version of npm."*
**Fix:** delete each promoted key from `publishConfig` after hoisting it (and drop
`publishConfig` entirely once empty), silencing the warning and future-proofing
against npm removing the behaviour.

### 6. `mdbook` build had a shell race `[Medium]` `Fixed`
`packages/mdbook/package.json`

The build was
`bun build main.ts … & bun build runtime-entry.ts … && cp …`. The `&`
backgrounded the first build, so `prepack`'s subsequent `chmod +x dist/main.js`
could run before `dist/main.js` had been written.
**Fix:** serialize the three steps with `&&`.

### 7. No actionable message when `lake`/Lean is missing `[Low]` `Fixed`
`packages/core/src/client.ts`, `packages/blueprint/src/commands/docs.ts`

`spawn("lake", …)` in both the core LSP client and blueprint's docs command
surfaced only a raw `spawn lake ENOENT`. (Before core #1's fix, a missing `lake`
also hung the build forever rather than erroring.)
**Fix:** map `ENOENT` to a message pointing at the elan installer in both spawn
sites.

---

## VS Code extension

### 1. No debounce + reentrancy race in document-change sync `[High]`
`packages/vscode/src/extension.ts:40-45` → `syncMarkdownToLean` (`:540-627`)

`onDidChangeTextDocument` fires on every keystroke and calls the fully-async
`syncMarkdownToLean` with no debounce and no in-flight lock. Two rapid edits launch
concurrent runs that race on `applyEdit` + `leanDoc.save()` (`:598-608`), so the
companion `.lean` file can be saved with stale content, desyncing diagnostics/hover.
**Fix:** debounce per-URI and serialize sync per document.

### 2. Full recursive filesystem scan on every keystroke `[High]`
`packages/vscode/src/extension.ts` `getCompanionUris` (`:544`) →
`findClosestLeanProject` (`:356-425`) → `findLeanProjectsInDir` (`:388-407`)

Every change triggers a synchronous recursive `fs.readdirSync` walk (depth 5)
across all workspace folders + repo root. Combined with #1 (no debounce) this
blocks the extension host on large repos.
**Fix:** cache the resolved companion URI/project root per markdown URI.

### 3. Definition provider mutates VS Code's returned objects `[Medium]`
`packages/vscode/src/extension.ts:217-223`

```ts
if ("targetUri" in res) { ...; res.targetUri = state.markdownUri; // mutating command result
```

`res` comes from `vscode.executeDefinitionProvider`, which may cache/reuse it.
Mutating `targetUri` in place can corrupt VS Code internal state. (The `Location`
branch at `:227` already builds a fresh object.)
**Fix:** construct a fresh `vscode.LocationLink`.

### 4. `ensureLeanClientStarted` permanently disables retry on failure `[Medium]`
`packages/vscode/src/extension.ts:653-689`

`state.hasStartedClient = true` is set at `:655` before the
`openTextDocument`/`showTextDocument` block and never reset if that block throws
(`:687` only logs). A transient failure permanently prevents the LSP from starting
for that document.
**Fix:** set the flag only after success, or reset it in the catch.

### 5. Lower-severity VS Code items `[Low]`
- **Untracked `setTimeout`s** (`extension.ts:57-65`, `:680-682`): not stored/cleared,
  so callbacks can run after deactivation against torn-down state.
- **Dead `hasOpenedCompanion` field** (set at `:564,623,684,699`, never read).

---

## Notes on things checked and found OK

- **Comark `visitNodes` `slice(2)`** (`comark/src/index.ts:71-79`): correct — see the
  correction note above.
- **`vscode/src/markdown-parser.ts` line/position preservation**: verified to emit
  exactly one output line per input line in every branch, so line/column offsets map
  1:1 to the synthetic Lean file. (Minor gaps: nested `>>` blockquotes and 4-backtick
  fences aren't detected.)
- **Diagnostics race**: diagnostics are read after `fileProgress` completion, which
  mitigates most timing races; on a compile *timeout* the result is correctly not
  cached (`compileComplete === false`).

---

## Suggested priority order

**Done** (see [Resolution status](#resolution-status)): Core #1–#4, #9, #12;
Blueprint #2, #3; mdbook #1; all Build/release findings.

Remaining, highest-impact first:

1. Blueprint #1 (background docs `process.exit` tearing down the dev server) —
   the last of the dev-server-stability cluster.
2. Comark #1 (corrupted adapter output) and Core #14 (invalid Typst output) —
   broken feature output.
3. VS Code #1/#2 (keystroke-time reentrancy race + full-FS scan on every edit).
4. Core #5 (stale cache from `cwd`-relative dep dir) and #6/#7 (per-token git
   subprocesses; whole-tree read for fingerprinting) — correctness + perf.
5. The remaining Medium/Low correctness and cleanup items.
