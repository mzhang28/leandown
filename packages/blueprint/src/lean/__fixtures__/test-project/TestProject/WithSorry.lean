-- Definitions with sorry (not yet formalized)

theorem add_succ_right (m n : Nat) : m + (Nat.succ n) = Nat.succ (m + n) := by
  sorry

-- No `sorry` of its own, but depends on one.
theorem add_succ_twice (m n : Nat) :
    m + Nat.succ (Nat.succ n) = Nat.succ (Nat.succ (m + n)) := by
  rw [add_succ_right, add_succ_right]
