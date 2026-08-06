# Using a Lean library

By including a `lean-project-path` in `book.toml`, the preprocessor can check the code blocks inside a Lean project.
```lean
import ExampleLib

#eval triangle 4
```

We can then use the library in other code blocks:

```lean
example : triangle 4 = 10 := by decide
```

```lean
example (n : Nat) : triangle (n + 1) = (n + 1) + triangle n :=
  triangle_succ n
```
