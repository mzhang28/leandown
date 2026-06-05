# Lean Example

Here is a Lean code block:

```lean
def hello : String := "Hello, Lean!"
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