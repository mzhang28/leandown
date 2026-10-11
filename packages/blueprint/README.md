# @leandown/blueprint

CLI for Lean blueprint projects: mathematical documents written in
[Typst](https://typst.app), linked to Lean 4 declarations, with a dependency
graph that tracks formalization progress.

Blueprints compile to a static HTML site: one page per chapter, Typst math as
MathML, Lean code highlighted with hovers (via leandown), and `@label`
references that work across pages.

> **Status:** this uses Typst's experimental HTML and bundle export, through
> leandown's build of typst.ts (stock typst.ts can't compile bundles yet).

## Quick start

```sh
blueprint init my-blueprint
cd my-blueprint
bun install
(cd lean && lake init MyProject)   # or put your Lean project in lean/
bun run dev                        # live preview
bun run build                      # static site in dist/
```

## Writing a blueprint

`main.typ` lists the chapters; each becomes a page:

```typst
#import "/.blueprint/lib.typ": *
#show: blueprint.with(title: "My Blueprint")

#chapter("index.html", title: [Introduction], include "chapters/intro.typ")
#chapter("groups.html", title: [Groups], include "chapters/groups.typ")
```

Chapters use the node functions:

```typst
#import "/.blueprint/lib.typ": *

#definition("add_def", lean: "Nat.add")[
  We write $a + b$ for the result of adding $b$ to $a$.
]

#theorem("add_zero", lean: "Nat.add_zero", uses: ("add_def",))[
  For every $n$, $n + 0 = n$.
]

#proof[By induction, using @add_def.]
```

- Kinds: `definition`, `theorem`, `lemma`, `proposition`, `corollary`,
  `example`, `conjecture`, `remark`, `note`, and `proof`.
- `lean:` takes fully qualified Lean names (a string, comma-separated, or an
  array). `uses:` takes the labels this node depends on. `mathlib: true` marks
  something already in mathlib.
- Refer to any node with `@label`; it renders as "Theorem 2" and links to it,
  on whatever page it lives.
- ` ```lean ` code blocks are highlighted by the Lean server, with hovers.

## Dependency graph

`graph.html` shows every node and its `uses` edges, coloured by checking each
`lean:` name against Lean:

- Border (statement): **stated** when every declaration exists; otherwise
  **ready to state** if every dependency is stated, else **not ready**.
- Fill (proof): **fully proved** (no `sorry` anywhere below, dependencies
  fully proved), **proved** (no `sorry` below), **proved, sorry below** (its
  own proof is done but something it uses has `sorry`), **ready to prove** (its
  proof has `sorry`, every dependency's proof is done), **in progress**.

Blueprint imports the root module of every `lean_lib` in your lakefile to
check names; set `"leanImports"` in `blueprint.json` to import something else.

## blueprint.json

```json
{
  "name": "my-blueprint",
  "leanProjectPath": "./lean",
  "entry": "main.typ",
  "outDir": "dist"
}
```

## Commands

- `blueprint init [dir]` — scaffold a project.
- `blueprint serve [--port N] [--host H]` — build, serve with live reload, and
  rebuild when `.typ` or `.lean` files change.
- `blueprint build` — build the static site (and copy doc-gen4 output to
  `dist/docs/` when available, for the L∃∀N links).
- `blueprint docs` — run `lake build :docs`.

## How it works

The CLI copies its Typst library to `.blueprint/lib.typ` and compiles the
project twice. The first pass reports the Lean blocks and nodes; leandown
highlights the blocks and checks the declarations, and writes the results to
`.blueprint/data.json`, which the second pass renders.
