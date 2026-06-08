/**
 * Formalization status of a blueprint node's linked Lean declaration.
 *
 * Mirrors the status model from verso-blueprint / leanblueprint:
 *   pending     — not yet linked to any Lean declaration
 *   not_ready   — linked, but the declaration (or a dependency) has `sorry`
 *   can_state   — all statement prerequisites are `sorry`-free
 *   can_prove   — all proof prerequisites are `sorry`-free
 *   proved      — the declaration itself has no `sorry`
 *   fully_proved — proved, and all transitive ancestors are proved too
 */
export type DeclState =
  | "pending"
  | "not_ready"
  | "can_state"
  | "can_prove"
  | "proved"
  | "fully_proved";

/** A single blueprint node (theorem / definition / lemma / …). */
export interface BlueprintNode {
  /** Blueprint label, e.g. "add_zero" */
  label: string;
  /** Node kind */
  kind: string;
  /** Linked Lean declaration names */
  leanDecls: string[];
  /** Blueprint labels this node depends on (from `(uses := "...")`) */
  uses: string[];
  /** Computed formalization status */
  status: DeclState;
  /** Whether this node was auto-linked from a @[blueprint "..."] annotation */
  autoLinked: boolean;
  /** Whether the node's own Lean declaration contains `sorry` */
  hasOwnSorry: boolean;
}

/** A directed edge in the dependency graph. */
export interface BlueprintEdge {
  from: string;
  to: string;
  intent?: "regular" | "technical" | "auxiliary";
}

/** The complete blueprint manifest — consumed by the frontend graph renderer. */
export interface BlueprintManifest {
  /** All nodes keyed by label. */
  nodes: Record<string, BlueprintNode>;
  /** Dependency edges between nodes. */
  edges: BlueprintEdge[];
}

/** Raw per-declaration data extracted from Lean source files. */
export interface LeanDeclInfo {
  /** Fully-qualified Lean name, e.g. "Nat.add_comm" */
  name: string;
  /** Source file path (absolute) */
  filePath: string;
  /** Line in the source file (0-based) */
  line: number;
  /** Whether the declaration body contains `sorry` */
  hasSorry: boolean;
  /** Blueprint labels this declaration is tagged with via @[blueprint "..."] */
  blueprintLabels: string[];
  /** Lean names this declaration references (direct dependencies) */
  references: string[];
}
