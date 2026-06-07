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

## Some STLC Shit

Let's start with a dead simple simply-typed lambda calculus implementation.

```lean
inductive Ty where
  | Bool : Ty
  | Arrow : Ty → Ty → Ty
  deriving DecidableEq

notation a " →' " b => Ty.Arrow a b

inductive Tm : Nat → Type where
  | Var : Fin n → Tm n
  | Lam : Ty → Tm (n+1) → Tm n
  | App : Tm n → Tm n → Tm n
  | True : Tm n
  | False : Tm n
  | Ite : Tm n → Tm n → Tm n → Tm n
  deriving DecidableEq
```

That's the syntax done.
Now let's do typing:

```lean
abbrev Ctx (n : Nat) := Fin n → Ty

def Ctx.empty : Ctx 0 := fun x => x.elim0

def Ctx.push (ctx : Ctx n) (ty : Ty) : Ctx (n+1) := Fin.cases ty ctx

inductive WellTyped : Ctx n → Tm n → Ty → Type where
  | Var : ctx k = ty → WellTyped ctx (.Var k) (ty)
  | Lam : WellTyped (ctx.push A) e B → WellTyped ctx (.Lam A e) (A →' B)
  | App : WellTyped ctx f (A →' B) → WellTyped ctx a A → WellTyped ctx (.App f a) B
  | True : WellTyped ctx .True .Bool
  | False : WellTyped ctx .False .Bool
  | Ite : WellTyped ctx c .Bool → WellTyped ctx ct A → WellTyped ctx cf A → WellTyped ctx (.Ite c ct cf) A

structure InferResult (ctx : Ctx n) (tm : Tm n) where
  ty : Ty
  h : WellTyped ctx tm ty

def infer (ctx : Ctx n) (tm : Tm n) : Except String (InferResult ctx tm) := do
  match tm with
  | .Var k => return ⟨ctx k, .Var rfl⟩
  | .Lam A e =>
    let ⟨B, h⟩ ← infer (ctx.push A) e
    return ⟨A →' B, .Lam h⟩
  | .App f a =>
    let ⟨F, hF⟩ ← infer ctx f
    let (A →' B) := F | throw s!"expected a function"
    let ⟨A', hA'⟩ ← infer ctx a
    if h : A = A' then return ⟨B, .App hF (h ▸ hA')⟩
    else throw s!"argument type does not match"
  | .True => return ⟨.Bool, .True⟩
  | .False => return ⟨.Bool, .False⟩
  | .Ite c ct cf =>
    let ⟨C, hC⟩ ← infer ctx c
    let ⟨Ct, hCt⟩ ← infer ctx ct
    let ⟨Cf, hCf⟩ ← infer ctx cf
    if h1 : C = .Bool then
      if h2 : Ct = Cf then return ⟨Ct, .Ite (h1 ▸ hC) hCt (h2 ▸ hCf)⟩
      else throw s!"branch types don't match"
    else throw s!"condition isn't bool"
```

Ok, how about evaluation?
First, we must define substitution:

```lean
def Tm.rename (tm : Tm n) (f : Fin n → Fin m) : Tm m :=
  match tm with
  | .Var k => .Var (f k)
  | .Lam t e => .Lam t (e.rename (Fin.cases 0 (f · |>.succ)))
  | .App fn a => .App (fn.rename f) (a.rename f)
  | .True => .True
  | .False => .False
  | .Ite c t fa => .Ite (c.rename f) (t.rename f) (fa.rename f)

def Tm.subst (tm : Tm n) (f : Fin n → Tm m) : Tm m :=
  match tm with
  | .Var k => f k
  | .Lam t e => .Lam t (e.subst (Fin.cases (.Var 0) (f · |>.rename .succ)))
  | .App fn a => .App (fn.subst f) (a.subst f)
  | .True => .True
  | .False => .False
  | .Ite c t fa => .Ite (c.subst f) (t.subst f) (fa.subst f)

def Tm.subst1 (e : Tm (n+1)) (a : Tm n) : Tm n := e.subst (Fin.cases a .Var)
```

```lean
inductive IsValue {n : Nat} : Tm n → Prop where
  | True : IsValue .True
  | False : IsValue .False
  | Lam : IsValue (.Lam t e)

abbrev Value := { e : Tm 0 // IsValue e }

abbrev Env := Vector Value 0

inductive Step : Tm 0 → Tm 0 → Type where
  | AppBeta : Step (.App (.Lam t e) a) (e.subst1 a)
  | AppCong1 : Step f f' → Step (.App f a) (.App f' a)
  | AppCong2 : Step a a' → Step (.App f a) (.App f a')

  | IteBeta1 : Step (.Ite .True ct cf) ct
  | IteBeta2 : Step (.Ite .False ct cf) cf
  | IteCong1 : Step c c' → Step (.Ite c ct cf) (.Ite c' ct cf)
  | IteCong2 : Step ct ct' → Step (.Ite c ct cf) (.Ite c ct' cf)
  | IteCong3 : Step cf cf' → Step (.Ite c ct cf) (.Ite c ct cf')
```

Now we need to prove that we did a good thing.
Some basic metatheoretic properties that are proven are progress and preservation.

First, progress:

```lean
inductive StepResult (tm : Tm 0) where
  | Done : IsValue tm → StepResult tm
  | Step : (tm' : Tm 0) → Step tm tm' → StepResult tm

def progress (tm : Tm 0) (wt : WellTyped Ctx.empty tm ty) : StepResult tm :=
  match tm, wt with
  | _, .Lam h => .Done .Lam
  | .App f a, .App h1 h2 =>
    match progress f h1 with
    | .Step f' st => .Step (.App f' a) (.AppCong1 st)
    | .Done _ =>
      match progress a h2 with
      | .Step a' st => .Step (.App f a') (.AppCong2 st)
      | .Done _ =>
        match f with
        | .Lam t e => .Step (e.subst1 a) .AppBeta
  | _, .True => .Done .True
  | _, .False => .Done .False
  | .Ite c ct cf, .Ite hc hct hcf =>
    match progress c hc with
    | .Step c' st => .Step (.Ite c' ct cf) (.IteCong1 st)
    | .Done _ =>
      match progress ct hct with
      | .Step ct' st => .Step (.Ite c ct' cf) (.IteCong2 st)
      | .Done _ =>
        match progress cf hcf with
        | .Step cf' st => .Step (.Ite c ct cf') (.IteCong3 st)
        | .Done _ =>
          match c with
          | .True => .Step ct .IteBeta1
          | .False => .Step cf .IteBeta2
```

Now, preservation:

```lean
def weakening {tm : Tm n} (wt : WellTyped ctx tm ty) (f : Fin n → Fin m) (h : ∀ x, ctx' (f x) = ctx x) : WellTyped ctx' (tm.rename f) ty :=
  match wt with
  | @WellTyped.Var _ _ _ ⟨k, hk⟩ hv => by
    refine .Var ?_
    rw [h _, hv]
  | .Lam w => by
    refine .Lam (weakening w (Fin.cases 0 (f · |>.succ)) ?_)
    intro x
    refine Fin.cases ?_ ?_ x
    · simp only [Ctx.push, Fin.cases_zero]
    · intro x'
      simp only [Ctx.push, Fin.cases_succ, h x']
  | .App wf wa => .App (weakening wf f h) (weakening wa f h)
  | .True => .True
  | .False => .False
  | .Ite wc wct wcf => .Ite (weakening wc f h) (weakening wct f h) (weakening wcf f h)

def subst_preservation (tm : Tm n) (wt : WellTyped ctx tm ty) (f : Fin n → Tm m) (p : ∀ x, WellTyped ctx' (f x) (ctx x)) : WellTyped ctx' (tm.subst f) ty :=
  match wt with
  | .Var h => h ▸ (p _)
  | .Lam h => by
    refine .Lam ?_
    apply subst_preservation _ h
    intro x
    refine Fin.cases ?_ ?_ x
    · exact .Var rfl
    · intro x'
      refine weakening (p x') _ ?_
      intros x''
      simp [Ctx.push, Fin.cases_succ]
  | .App hf ha => .App (subst_preservation _ hf f p) (subst_preservation _ ha f p)
  | .True => .True
  | .False => .False
  | .Ite hc hct hcf => .Ite (subst_preservation _ hc f p) (subst_preservation _ hct f p) (subst_preservation _ hcf f p)

def subst1_preservation {ty' : Ty} (tm : Tm (n+1)) (wt : WellTyped (ctx.push ty') tm ty) (tm' : Tm n) (wt' : WellTyped ctx tm' ty') : WellTyped ctx (tm.subst1 tm') ty :=
  subst_preservation tm wt _ (fun ⟨x, hx⟩ =>
    match x with
    | .zero => by
      simp only [Nat.zero_eq, Fin.zero_eta, Fin.cases_zero]
      exact wt'
    | .succ _ => by
      refine .Var ?_
      simp only [Ctx.push, Nat.succ_eq_add_one, Fin.cases_succ']
  )

def preservation (tm tm' : Tm 0) {ty : Ty} (wt : WellTyped Ctx.empty tm ty) (st : Step tm tm') : WellTyped Ctx.empty tm' ty :=
  match tm, wt, st with
  | .App (.Lam A _) _, .App (.Lam he) ha, .AppBeta => subst1_preservation (ty' := A) _ he _ ha
  | .App f _, .App hf ha, .AppCong1 h => .App (preservation f _ hf h) ha
  | .App _ a, .App hf ha, .AppCong2 h => .App hf (preservation a _ ha h)
  | .Ite .True ct _, .Ite _ hct _, .IteBeta1 => hct
  | .Ite .False _ cf, .Ite _ _ hcf, .IteBeta2 => hcf
  | .Ite c _ _, .Ite hc hct hcf, .IteCong1 h => .Ite (preservation c _ hc h) hct hcf
  | .Ite _ ct _, .Ite hc hct hcf, .IteCong2 h => .Ite hc (preservation ct _ hct h) hcf
  | .Ite _ _ cf, .Ite hc hct hcf, .IteCong3 h => .Ite hc hct (preservation cf _ hcf h)
```

STLC also has the property of strong normalization, which can be proven using the following logical relation:

```lean
```