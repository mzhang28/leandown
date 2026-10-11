-- Definitions with sorry (not yet formalized)

theorem add_succ_right (m n : Nat) : m + (Nat.succ n) = Nat.succ (m + n) := by
  sorry

-- No `sorry` of its own, but depends on one.
theorem add_succ_twice (m n : Nat) :
    m + Nat.succ (Nat.succ n) = Nat.succ (Nat.succ (m + n)) := by
  rw [add_succ_right, add_succ_right]

def todoDef : Nat := sorry

-- `sorry` buried in a `have`.
theorem partial_have (n : Nat) : n + 0 = n ∧ 0 + n = n := by
  have h : 0 + n = n := sorry
  exact ⟨rfl, h⟩

-- Complete, but built on `todoDef`.
def usesTodo : Nat := todoDef + 1

-- Lean moves the proof into an auxiliary declaration.
def subtypeTodo : {n : Nat // n > 0} := ⟨1, by sorry⟩
