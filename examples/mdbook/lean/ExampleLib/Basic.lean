/-- The `n`th triangular number: `0 + 1 + ⋯ + n`. -/
def triangle : Nat → Nat
  | 0 => 0
  | n + 1 => (n + 1) + triangle n

/-- Summing up to `n + 1` adds `n + 1` to the sum up to `n`. -/
theorem triangle_succ (n : Nat) : triangle (n + 1) = (n + 1) + triangle n := rfl
