---
title: Basic Examples
description: Demonstrating basic functionality of @leandown/remark, including interactive goal states and LSP diagnostics.
---

This page demonstrates the core features of `@leandown/remark` in action.


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

## Error and Warning Annotations

Errors and warnings from the Lean LSP are highlighted directly on the offending code with red or yellow squiggly underlines, matching the style of VS Code. Hovering over a squiggly region shows the full diagnostic message.

### Type Errors

The expression below has a type mismatch — `"hello"` is a `String` but a `Nat` is expected. The error is underlined in red:

```lean
def badAdd : Nat := "hello" + 1
```

### Warnings

Unused variables produce a yellow squiggly underline:

```lean
def unused : Nat :=
  let x := 42
  0
```

## Example from verso's homepage

```lean
def Set (α : Type u) : Type u :=
  α → Prop

instance : Membership α (Set α) where
  mem xs x := xs x
```

A function $f$ is surjective if each element of the range is covered by an element of the domain:

```lean
def Surjective (f : α → β) :=
  ∀ y, ∃ x, f x = y
```

```lean
theorem cantor (f : S → Set S) : ¬ Surjective f := by
  intro h
  have ⟨x, p⟩ := h (fun x : S => x ∉ f x)
  have : x ∈ f x ↔ x ∉ f x := by
    constructor <;>
    simp [Membership.mem] at * <;>
    grind
  grind
```

> A nested code block in a blockquote:
>
> ```lean
> def nestedHello (name : String) : String := "Nested " ++ name
> ```

