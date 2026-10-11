<p align="center">
  <img src="logo.svg" alt="leandown logo" width="208" height="128" />
</p>

# leandown

[![npm version](https://img.shields.io/npm/v/@leandown/remark)](https://www.npmjs.com/package/@leandown/remark)

A [remark](https://github.com/remarkjs/remark) plugin that provides Verso-like features.

## Quick start

You need Lean installed.

```ts
import { remark } from "remark";
import remarkHtml from "remark-html";
import remarkLean from "@leandown/remark";

const html = await remark()
  .use(remarkLean)
  .use(remarkHtml, { sanitize: false })
  .process(markdown);
```

Then, include the runtime in your page to activate hover behavior.

```ts
import { leanHydrate } from "@leandown/core/runtime";
leanHydrate();
```

Default styles are shipped in `@leandown/core/lean.css`.

See examples in `examples`.

## Typst output

`TypstBackend` renders Lean blocks as Typst markup (Typst 0.15+). The output
calls `lean-block` and `lean-token`, which are defined in the shipped preamble:
include `@leandown/core/lean.typ` (also exported as the `TYPST_PREAMBLE`
string) once per document, or define your own versions to restyle it.

```ts
import { LeanHighlightProcessor, TypstBackend, TYPST_PREAMBLE } from "@leandown/core";

const processor = new LeanHighlightProcessor({ backend: new TypstBackend() });
const typ = TYPST_PREAMBLE + (await processor.processBlock("def x : Nat := 1"));
```
