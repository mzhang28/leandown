# Code Audit Report: remark-lean

This document contains a detailed analysis of the code quality, efficiency, correctness, and performance of the `remark-lean` monorepo.

---

## Executive Summary

After auditing the entire codebase (covering `@leandown/core`, `@leandown/blueprint`, `@leandown/remark`, `@leandown/markdown-it`, `@leandown/comark`, and the VS Code extension), we identified **9 main issues** ranging from critical correctness bugs to major performance bottlenecks.

### Key Highlights
- **Performance bottleneck:** The LSP client sends concurrent hover and definition requests for *every single non-whitespace token* (including punctuation like `(`, `:=`, `,` and numbers) without any deduplication, leading to hundreds of concurrent requests for small code blocks.
- **Syntax / Output bug:** The `TypstBackend` generates invalid, nested `#raw` elements that break Typst rendering.
- **Dead / Non-functional code:** The blueprint analyzer's Phase 2 LSP analysis (`enrichWithLsp`) spawns the LSP client, analyzes files, and discards all results without updating the internal data structure.
- **System cleanliness:** Temporary Lean scratch projects are spawned under `/tmp` but never recursively deleted, leaving junk files behind after process exits.

---

## Detailed Findings

### 1. Typst Rendering Output Syntax Bug (Correctness)
* **Location:** [packages/core/src/backend.ts](file:///home/michael/Projects/remark-lean/packages/core/src/backend.ts#L111-L174) and [packages/core/src/client.ts](file:///home/michael/Projects/remark-lean/packages/core/src/client.ts#L525-L560)
* **Severity:** **High**

#### Description
In `client.ts`, highlighted lines are rendered using:
1. `backend.renderTokenStart(token)` (e.g. returns `#lean-token(type: "keyword")[#raw("`)
2. `backend.escape(text)` (e.g. returns `#raw("def")`)
3. `backend.renderTokenEnd(token)` (e.g. returns `")]`)

When combined, this results in nested `#raw` calls in the Typst output:
```typst
#lean-token(type: "keyword")[#raw("#raw("def")")]
```
This is invalid Typst syntax. It will display literal `#raw("def")` characters in the final PDF or fail to compile altogether, instead of styling the word `def` as a keyword.

#### Recommendation
Update `TypstBackend.escape` so that it doesn't wrap raw text in `#raw(...)` if it is called within a token span, or change the rendering logic to pass plain, escaped strings to the token boundaries.

### 2. High LSP Request Volume (Design Decision)
* **Location:** [packages/core/src/client.ts](file:///home/michael/Projects/remark-lean/packages/core/src/client.ts#L179-L203) & [packages/core/src/lib.ts](file:///home/michael/Projects/remark-lean/packages/core/src/lib.ts#L183-L193)
* **Severity:** **Informational / Design Decision**

#### Description
The helper `extractQueryTokens` uses a broad regex matching every non-whitespace character sequence (including punctuation, keywords, and numbers), sending definition and hover requests to the local Lean LSP for each.

#### Rationale & Context
This is an intentional design choice rather than an issue. The design prioritizes **completeness and reliability** over micro-optimization for the following reasons:
1. **Elaborator Extensibility:** The Lean elaborator can be extended with custom keywords and notations. Querying broadly ensures that all custom or newly introduced syntax elements are reliably captured and styled.
2. **LSP Limitations:** The LSP does not guarantee a full returned list of hoverables, so scanning all sequences is necessary to ensure no highlights are missed.
3. **One-time Cost:** The processing occurs at compile/build time. Since the LSP is local, the execution overhead remains very low and has minimal impact on development/production build workflows.

---

### 3. Non-functional / Dead Code in `enrichWithLsp` (Cleanliness / Performance)
* **Location:** [packages/blueprint/src/lean/analyzer.ts](file:///home/michael/Projects/remark-lean/packages/blueprint/src/lean/analyzer.ts#L160-L179)
* **Severity:** **Medium**

#### Description
Phase 2 of `analyzeProject` is supposed to run LSP-based enrichment:
```typescript
async function enrichWithLsp(
  declInfos: Map<string, LeanDeclInfo>,
  projectPath: string,
  sources: string[]
): Promise<void> {
  const client = new LeanLSPClient(projectPath);
  await client.start();

  try {
    for (const srcPath of sources.slice(0, 20)) {
      const content = fs.readFileSync(srcPath, "utf-8");
      await client.highlight("-- LSP probe", {
        synchronizedHovers: false,
        prependCode: content,
      });
    }
  } finally {
    await client.shutdown();
  }
}
```
This code loop starts the LSP client, reads up to 20 files, calls `client.highlight` (which runs without hover/definitions/goals since `synchronizedHovers` is `false`), and then immediately shuts down the client.
The returned values of `client.highlight` are completely ignored, and the `declInfos` map passed into `enrichWithLsp` is **never mutated or read**.
This means `enrichWithLsp` is entirely dead/useless work that delays project analysis by starting a `lake serve` subprocess for nothing. Furthermore, `LeanDeclInfo.references` is defined but only ever set to `[]` and never populated.

#### Recommendation
Either implement the intended diagnostic/reference collection using the returned LSP outputs, or remove the LSP phase from the static blueprint analyzer entirely to speed up execution.

---

### 4. Memory Leak / Uncleared Timers (Resource Leak)
* **Location:** [packages/core/src/client.ts](file:///home/michael/Projects/remark-lean/packages/core/src/client.ts#L152-L157)
* **Severity:** **Low**

#### Description
In `client.ts`, the code races the compilation waiter with a 1500ms timeout:
```typescript
await Promise.race([
  new Promise<void>((resolve) =>
    this.compileWaiters.set(tempFileUri, resolve)
  ),
  new Promise<void>((resolve) => setTimeout(resolve, 1500)),
]);
```
If the compilation completes early (which is the case for cached or small files), the `compileWaiters` promise resolves. However, the `setTimeout` timer is never cleared, which keeps the Node/Bun event loop active longer than necessary and leaks timers.

#### Recommendation
Store the timeout ID and call `clearTimeout(timerId)` when the race completes.

---

### 5. Inverted Graph Edge Direction (Consistency)
* **Location:** [packages/blueprint/src/vite/blueprint-plugin.ts](file:///home/michael/Projects/remark-lean/packages/blueprint/src/vite/blueprint-plugin.ts#L55-L59) vs [packages/blueprint/src/lean/analyzer.ts](file:///home/michael/Projects/remark-lean/packages/blueprint/src/lean/analyzer.ts#L255-L259)
* **Severity:** **Medium**

#### Description
In the Vite plugin:
```typescript
edges.push({ source: dep, target: label });
```
This indicates an edge from `dep` (dependency) to `label` (dependent node), i.e., dependency flow.
But in the blueprint analyzer:
```typescript
edges.push({ from: label, to: useLabel });
```
This indicates an edge from `label` (dependent node) to `useLabel` (dependency), which is the opposite direction and uses different keys (`from`/`to` vs `source`/`target`).
This causes inconsistency in the graph schema generated depending on which tool parses the project files.

#### Recommendation
Align on a single graph schema representation (preferably using Cytoscape's `source`/`target` keys) and ensure edge directions consistently represent either the flow of proof or the direction of dependencies.

---

### 6. Temp Directory Accumulation in `getOrCreateTempProject` (Cleanliness)
* **Location:** [packages/core/src/processor.ts](file:///home/michael/Projects/remark-lean/packages/core/src/processor.ts#L36-L61)
* **Severity:** **Fixed**

#### Description
`getOrCreateTempProject` creates a temporary directory for Lean scratch work:
```typescript
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leandown-"));
```
While `process.on("exit", ...)` triggers client shutdown, the files and folder created under `/tmp` were previously never cleaned up on disk. Over multiple runs of development servers or scripts, this left multiple orphaned `leandown-XXXXXX` directories in the OS temp folder.

#### Fix
Added synchronous cleanup of `tempProjectPath` using `fs.rmSync` inside `cleanupClients` (executed on exit/termination signals). To make the recursive delete bulletproof, it includes path safety checks verifying that the path lies inside `os.tmpdir()`, is not `os.tmpdir()` itself, and begins with `leandown-`. Any deletion errors bubble up and propagate naturally without being caught or swallowed.

---

### 7. Brittle Comark AST Visitor (Correctness)
* **Location:** [packages/comark/src/index.ts](file:///home/michael/Projects/remark-lean/packages/comark/src/index.ts#L71-L79)
* **Severity:** **Medium**

#### Description
In `packages/comark/src/index.ts`:
```typescript
function visitNodes(nodes: ComarkNode[], callback: (node: ComarkNode) => void): void {
  for (const node of nodes) {
    callback(node);
    if (Array.isArray(node) && typeof node[0] === "string") {
      const children = (node as ComarkElement).slice(2) as ComarkNode[];
      visitNodes(children, callback);
    }
  }
}
```
This code assumes the attributes block of a Comark element is always present at index 1, meaning children always start at index 2.
In JSONML/Comark structures, if an element has no attributes, they are often omitted, meaning children start at index 1. Under this scenario, `visitNodes` will skip the first child, and recursively iterate over incorrect index offsets.

#### Recommendation
Validate whether `node[1]` is an attribute object or a child node before slicing children in `visitNodes`.

---

### 8. Lack of Process Spawn Error Handling in LSP Client (Robustness)
* **Location:** [packages/core/src/client.ts](file:///home/michael/Projects/remark-lean/packages/core/src/client.ts#L43-L52) & [packages/blueprint/src/commands/docs.ts](file:///home/michael/Projects/remark-lean/packages/blueprint/src/commands/docs.ts#L57-L61)
* **Severity:** **Medium**

#### Description
If a user runs the tool on a machine where Lean (`lake`) is not installed or not in the PATH:
1. `spawn("lake", ["serve"])` will trigger an `"error"` event.
2. The `initPromise` is not rejected, and the request queue promise (`sendRequest`) will hang indefinitely because stdin write throws or fails silently.
3. In `docsCommand`, spawning background docs has no `.on("error")` handler, which can lead to unhandled crashes if `lake` fails to start.

#### Recommendation
Listen to the `error` event on all spawned child processes, reject pending promises, and cleanly transition status to "failed" to provide descriptive error diagnostics to the user.
