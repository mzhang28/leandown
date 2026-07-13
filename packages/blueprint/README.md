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

## CLI Commands

### `blueprint init [--dir <path>]`

Create a new blueprint project in the specified directory.

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
