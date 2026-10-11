/**
 * Statement status of a blueprint node, shown as the node's border colour.
 * Mirrors leanblueprint:
 *   mathlib    — marked `(mathlib)`: already in mathlib
 *   stated     — every linked Lean declaration exists
 *   can_state  — not stated, but every dependency is stated
 *   not_ready  — not stated, and some dependency isn't either
 */
export type StatementState = "mathlib" | "stated" | "can_state" | "not_ready";

/**
 * Proof status of a blueprint node, shown as the node's fill colour.
 *   fully_proved — proved, and every dependency is fully proved
 *   proved       — stated, and no linked declaration depends on `sorry`
 *   can_prove    — stated, and every dependency is proved
 */
export type ProofState = "fully_proved" | "proved" | "can_prove";

/** What Lean reports about one declaration name. */
export interface DeclFacts {
  /** The name resolves to a constant in the project's environment. */
  exists: boolean;
  /** `#print axioms` lists `sorryAx`, i.e. it depends on `sorry` somewhere. */
  usesSorry: boolean;
}

/** Input to status computation: one blueprint node. */
export interface StatusInput {
  label: string;
  /** Fully-qualified Lean declaration names from `(lean := "...")`. */
  leanDecls: string[];
  /** Labels this node depends on, from `(uses := "...")`. */
  uses: string[];
  /** Marked `(mathlib)`. */
  mathlib?: boolean;
}

/** Computed status of one blueprint node. */
export interface NodeStatus {
  stated: boolean;
  proved: boolean;
  fullyProved: boolean;
  statement: StatementState;
  proof?: ProofState;
}
