---
title: Basic Examples
description: Demonstrating basic functionality of remark-lean, including interactive goal states and LSP diagnostics.
---

This page demonstrates the core features of `remark-lean` in action.

## Interactive Proof States

Interactive proof states are shown using ellipsis markers (`…`) at the end of proof lines or tactic steps. Hovering over them displays the hypotheses and current goals.

```lean
def hello := "world"

theorem basic_proof (A B : Prop) (hA : A) (hB : B) : A ∧ B := by
  constructor
  · exact hA
  · exact hB
```

## Evaluations and Type Checks

Diagnostics from the Lean LSP, such as the output of `#eval` and `#check`, are also shown using ellipsis markers (`…`). Hovering over them reveals the evaluated output or checked types.

### Evaluating Expressions

Hover over the marker next to `#eval` to see the result:

```lean
#eval 1 + 1
#eval "Hello " ++ "Lean!"
```

### Checking Types

Hover over the marker next to `#check` to see the type signature:

```lean
#check Nat.add
#check hello
```
