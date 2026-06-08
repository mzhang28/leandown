# My Blueprint

Welcome to your blueprint project! This document combines informal mathematical
exposition with links to formal Lean 4 proofs.

:::definition "add_def" (lean := "Nat.add")
We write $`a + b` for the result of adding $`b` to $`a`.
:::

:::theorem "add_zero" (lean := "Nat.add_zero") (uses := "add_def")
For every natural number $`n`, adding zero on the right leaves it unchanged:
$`n + 0 = n`.
:::

```lean
theorem add_zero_right (n : Nat) : n + 0 = n := by
  simp
```

:::theorem "add_succ" (lean := "Nat.add_succ") (uses := "add_def")
For all $`m, n`$, we have $`m + \operatorname{succ}(n) = \operatorname{succ}(m + n)`$.
:::

## Next Steps

- Add more chapters in `src/chapters/`
- Create a `lean/` directory with your Lean project
- Run `blueprint build` to generate the static site
- Run `blueprint serve` for live development
