---
title: Lean 4 Integration
description: Example of Lean 4 integration in Markdown
---

This page demonstrates the seamless integration of **Lean 4** syntax highlighting and rich hover information directly within a markdown document.

```lean
def hello (name : String) : String :=
  s!"Hello, {name}!"

#eval hello "World"
```

Try hovering over `hello` or `String` above! You can also click on the identifiers to jump to their definitions.
