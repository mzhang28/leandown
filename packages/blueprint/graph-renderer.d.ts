export interface GraphNode {
  id: string;
  label: string;
  kind: string;
  lean?: string;
  route: string;
  mathlib?: boolean;
  stated?: boolean;
  proved?: boolean;
  fullyProved?: boolean;
  /** Absent when Lean status isn't available. */
  statement?: "mathlib" | "stated" | "can_state" | "not_ready";
  proof?: "fully_proved" | "proved" | "can_prove";
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
