-- Basic definitions without sorry

def hello := "world"

def NatAdd := Nat.add

theorem add_zero_right (n : Nat) : n + 0 = n := by
  simp

namespace Demo

abbrev double (n : Nat) : Nat := n + n

theorem double_zero : double 0 = 0 := rfl

end Demo
