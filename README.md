# remark-lean

A [remark](https://github.com/remarkjs/remark) plugin that provides Verso-like features.

## Quick start

You need Lean installed, and a Lean project already initialized.
Then pass `rootUri` as the path to that project.

```ts
import { remark } from "remark";
import remarkHtml from "remark-html";
import remarkLean from "remark-lean";

const html = await remark()
  .use(remarkLean, { rootUri: "file:///path/to/lean-project" })
  .use(remarkHtml, { sanitize: false })
  .process(markdown);
```

Then, include the runtime in your page to activate hover behavior.

```ts
import { leanHydrate } from "remark-lean/runtime";
leanHydrate();
```

Default styles are shipped in `remark-lean/src/lean.css`.

See examples in `examples`.