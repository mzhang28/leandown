export interface GraphNode {
  id: string;
  label: string;
  kind: string;
  lean?: string;
  route: string;
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
