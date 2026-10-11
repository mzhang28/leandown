export interface GraphNode {
  id: string;
  label: string;
  kind: string;
  lean?: string;
  route: string;
  mathlib?: boolean;
  stated?: boolean;
  proved?: boolean;
  sorryFree?: boolean;
  fullyProved?: boolean;
  /** Absent when Lean status isn't available. */
  statement?: "mathlib" | "stated" | "can_state" | "not_ready";
  proof?: "fully_proved" | "proved" | "sorry_in_deps" | "can_prove" | "has_sorry";
}

export interface GraphEdge {
  source: string;
  target: string;
}

export declare function renderGraph(
  container: HTMLElement,
  nodes: GraphNode[],
  edges: GraphEdge[],
  onNavigate?: (route: string) => void
): unknown;
