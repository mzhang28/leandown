-- Basic definitions without sorry

def hello := "world"

@[blueprint "add_def"]
def NatAdd := Nat.add

@[blueprint "add_zero"]
theorem add_zero_right (n : Nat) : n + 0 = n := by
  simp
