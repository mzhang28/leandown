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
 * Proof status of a stated blueprint node, shown as the node's fill colour.
 *   fully_proved  — no `sorry` anywhere below it, and every dependency
 *                   is fully proved
 *   proved        — no `sorry` anywhere below it, but some blueprint
 *                   dependency isn't fully proved
 *   sorry_in_deps — its own proof is done, but something it uses in Lean
 *                   still has `sorry`
 *   can_prove     — its own proof has `sorry`, and every dependency's
 *                   proof is done
 *   has_sorry     — its own proof has `sorry`, and some dependency's proof
 *                   isn't done yet
 */
export type ProofState = "fully_proved" | "proved" | "sorry_in_deps" | "can_prove" | "has_sorry";

/** What Lean reports about one declaration name. */
export interface DeclFacts {
  /** The name resolves to a constant in the project's environment. */
  exists: boolean;
  /** Its own definition or proof uses `sorry`. */
  ownSorry: boolean;
  /** `sorry` appears somewhere in its dependency closure (including itself). */
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
  /** Its own proof is done: no linked declaration uses `sorry` directly. */
  proved: boolean;
  /** No `sorry` anywhere in the linked declarations' dependency closure. */
  sorryFree: boolean;
  fullyProved: boolean;
  statement: StatementState;
  proof?: ProofState;
}
