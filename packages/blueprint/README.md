# @leandown/blueprint

All-in-one CLI for managing Lean blueprint projects — markdown-based mathematical
documents with Lean formalization tracking.

Built on [leandown](https://github.com/mzhang28/leandown) (remark + Lean LSP)
and [Vite](https://vitejs.dev/).

## Quick Start

```bash
# Create a new blueprint project
blueprint init my-blueprint
cd my-blueprint
bun install

# Start the dev server (Vite + HMR)
blueprint serve

# Build for production
blueprint build
```

## Project Structure

```
my-blueprint/
  blueprint.json        — project configuration
  vite.config.ts        — Vite config (uses @leandown/blueprint/vite)
  index.html            — Vite entry point
  src/
    main.ts             — JS entry (imports .md files)
    style.css           — blueprint styles
    index.md            — main blueprint content
    chapters/           — additional chapter files
  lean/                 — Lean 4 project (optional)
  dist/                 — production output (after build)
```

## Blueprint Markdown

Write mathematical exposition with labeled nodes connected to Lean code:

```markdown
:::definition "add_def" (lean := "Nat.add")
We write $`a + b` for the result of adding $`b` to $`a`.
:::

:::theorem "add_zero" (lean := "Nat.add_zero") (uses := "add_def")
For every natural number $`n`, $`n + 0 = n`.
:::

```lean
theorem add_zero_right (n : Nat) : n + 0 = n := by
  simp
```
```

### Directive Kinds

- `:::theorem` — theorem statement
- `:::definition` — definition
- `:::lemma` — lemma
- `:::proof` — proof
- `:::proposition` — proposition
- `:::corollary` — corollary
- `:::example` — example
- `:::conjecture` — conjecture
- `:::remark` — remark
- `:::note` — note

### Attributes

- `(lean := "Name1, Name2")` — associate Lean declarations
- `(uses := "label1, label2")` — declare dependencies on other nodes
- `(owner := "name")` — assign an owner
- `(priority := "high")` — set priority
- `(mathlib)` — already in mathlib; counts as stated and proved

Lean names in `lean :=` must be fully qualified (`Ns.foo`, not `foo`).

### Dependency graph

`/graph` shows every labelled node and its `uses` edges. When
`leanProjectPath` points at a Lean project, each node is coloured by
leanblueprint's status model, checked against Lean itself:

- **Stated** — every `lean :=` declaration exists.
- **Proved** — stated, and `#print axioms` shows no `sorryAx` for any of
  them (so no `sorry` anywhere in their dependency closure).
- **Fully proved** — proved, and every dependency is fully proved.
- **Ready to state / Ready to prove** — every dependency is stated / proved.

To check names, blueprint imports the root module of every `lean_lib` in your
lakefile. Set `"leanImports": ["MyLib.Foo", …]` in `blueprint.json` to import
something else. `blueprint build` waits for the check. `blueprint serve` runs
it in the background, re-runs it when `.lean` files change, and reloads the
graph page when it's done. If the check fails (for example, a module doesn't
compile), the graph falls back to colouring nodes by kind and prints Lean's
error.

## CLI Commands

### `blueprint init [dir]`

Create a new blueprint project in `dir` (or `--dir <path>`), defaulting to the
current directory.

### `blueprint build`

Build the blueprint for production. Runs `vite build` — Vite handles
the entire pipeline: markdown → HTML, assets, bundling.

### `blueprint serve`

Start the Vite dev server with HMR. Edit `.md` files and the browser
reloads instantly. Lean code blocks are highlighted via the Lean LSP.

## Architecture

The CLI is a thin wrapper around Vite. A custom Vite plugin (`@leandown/blueprint/vite`)
transforms `.md` files through the blueprint pipeline:

1. Pre-process `:::directive` containers → HTML sections
2. `remark-parse` → mdast
3. `@leandown/remark` → highlight Lean code blocks via LSP
4. `remark-html` → serialize to HTML

## Dependencies

- [Vite](https://vitejs.dev/) — build pipeline + dev server
- [cmd-ts](https://github.com/schnittstabil/cmd-ts) — CLI framework
- [@leandown/core](../core/) — Lean 4 code highlighting engine
- [@leandown/remark](../remark/) — remark plugin for Lean blocks
- [remark](https://remark.js.org/) / [unified](https://unifiedjs.com/) — markdown processing
