# @leandown/mdbook

An [mdbook](https://rust-lang.github.io/mdBook/) preprocessor that runs every
` ```lean ` block through the Lean language server, replacing it with
syntax-highlighted HTML carrying hover tooltips, go-to-definition permalinks,
proof goals, and diagnostics.

## Install

```bash
npm install --save-dev @leandown/mdbook
```

Lean 4 must be installed and `lake` on your `PATH`.

## Configure

```toml
# book.toml
[preprocessor.leandown]
command = "mdbook-leandown"
```

Then copy the browser runtime and stylesheet out of the package into your book
root and reference them, so the rendered blocks become interactive:

```bash
cp node_modules/@leandown/mdbook/dist/index.js leandown.js
cp node_modules/@leandown/mdbook/dist/leandown.css leandown.css
```

```toml
[output.html]
additional-js = ["leandown.js"]
additional-css = ["leandown.css"]
```

### Options

All options live in the `[preprocessor.leandown]` table. Keys are kebab-case, but
camelCase is accepted too.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `lean-project-path` | string | *(a temporary scratch project)* | Lean 4 package directory whose libraries the book's code blocks may `import`. Relative paths resolve from the book root (the directory holding `book.toml`). |
| `synchronized-hovers` | bool | `true` | Emit hover tooltips, go-to-definition links, goals, and diagnostics. Turning this off highlights faster but produces static output. |
| `cache-dir` | string | `node_modules/.cache/leandown` under the book root | Where to keep the highlight cache. Relative paths resolve from the book root. |

### Using your own Lean libraries

By default each block is checked in an empty scratch project, so it can only use
Lean's built-in prelude. Point `lean-project-path` at a real Lean package to give
the whole book that package's dependencies:

```toml
[preprocessor.leandown]
command = "mdbook-leandown"
lean-project-path = "lean"
```

```lean
import ExampleLib   -- a library built by ./lean
import Mathlib      -- or anything ./lean depends on
```

Two things to keep in mind:

- **Build the project first.** Imports resolve against build artifacts, so run
  `lake build` (and `lake exe cache get` for Mathlib) in that directory before
  building the book. The preprocessor warns on stderr when the project has no
  `.lake` directory at all.
- **Put imports in a chapter's first block.** Blocks accumulate within a chapter
  so later blocks can use earlier definitions, and Lean requires `import` to come
  before any other command. Each chapter — including sub-chapters — starts fresh,
  so every chapter that needs a library imports it itself.

A complete, runnable book is in
[`examples/mdbook`](https://github.com/mzhang28/leandown/tree/main/examples/mdbook).
