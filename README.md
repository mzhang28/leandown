# remark-lean

[![npm version](https://img.shields.io/npm/v/remark-lean)](https://www.npmjs.com/package/remark-lean)

A [remark](https://github.com/remarkjs/remark) plugin that provides Verso-like features.

## Quick start

You need Lean installed. Optionally, pass `leanProjectPath` as the path to an
existing Lean project. If omitted, a minimal temporary project is created
automatically.

```ts
import { remark } from "remark";
import remarkHtml from "remark-html";
import remarkLean from "remark-lean";

// With an existing project:
const html = await remark()
  .use(remarkLean, { leanProjectPath: "/path/to/lean-project" })
  .use(remarkHtml, { sanitize: false })
  .process(markdown);

// Or without any options — a temp project is created automatically:
const html = await remark()
  .use(remarkLean)
  .use(remarkHtml, { sanitize: false })
  .process(markdown);
```

Then, include the runtime in your page to activate hover behavior.

```ts
import { leanHydrate } from "remark-lean/runtime";
leanHydrate();
```

Default styles are shipped in `remark-lean/dist/lean.css`.

See examples in `examples`.
