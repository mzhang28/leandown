import cytoscape from "cytoscape";
// @ts-ignore — no bundled types for cytoscape-dagre
import dagre from "cytoscape-dagre";

cytoscape.use(dagre);

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

const KIND_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  theorem:     { bg: "#dde8fb", border: "#5b7fdb", text: "#1a3a7a" },
  definition:  { bg: "#ddf0d6", border: "#60a64c", text: "#1a4a0a" },
  lemma:       { bg: "#fef3d0", border: "#b8860b", text: "#5a3e00" },
  proof:       { bg: "#eeeeee", border: "#888888", text: "#333333" },
  proposition: { bg: "#ead5f7", border: "#9b59b6", text: "#4a1a7a" },
  corollary:   { bg: "#d5eef0", border: "#2e8190", text: "#0a3a45" },
  example:     { bg: "#fde8cc", border: "#e67e22", text: "#7a3500" },
  conjecture:  { bg: "#f5d0d0", border: "#c0392b", text: "#6a0a0a" },
  remark:      { bg: "#e8e8e8", border: "#7f8c8d", text: "#333333" },
  note:        { bg: "#eeeeee", border: "#95a5a6", text: "#444444" },
};

export function renderGraph(
  container: HTMLElement,
  nodes: GraphNode[],
  edges: GraphEdge[],
  onNavigate?: (route: string) => void
): cytoscape.Core {
  const validIds = new Set(nodes.map((n) => n.id));

  const cy = cytoscape({
    container,
    elements: [
      ...nodes.map((n) => ({
        data: { id: n.id, label: n.label, kind: n.kind, lean: n.lean ?? "", route: n.route },
      })),
      ...edges
        .filter((e) => validIds.has(e.source) && validIds.has(e.target))
        .map((e) => ({ data: { source: e.source, target: e.target } })),
    ],
    style: [
      {
        selector: "node",
        style: {
          label: "data(label)",
          "text-valign": "center",
          "text-halign": "center",
          "font-size": "11px",
          "font-family": "system-ui, sans-serif",
          "padding": "8px",
          "shape": "round-rectangle",
          "background-color": (ele: cytoscape.NodeSingular) => KIND_COLORS[ele.data("kind")]?.bg ?? "#eeeeee",
          "border-color": (ele: cytoscape.NodeSingular) => KIND_COLORS[ele.data("kind")]?.border ?? "#aaa",
          "border-width": 2,
          "color": (ele: cytoscape.NodeSingular) => KIND_COLORS[ele.data("kind")]?.text ?? "#333",
          "width": "label",
          "height": "label",
        },
      },
      {
        selector: "node:hover",
        style: { "border-width": 3, "border-color": "#222" },
      },
      {
        selector: "node.faded",
        style: { opacity: 0.25 },
      },
      {
        selector: "edge",
        style: {
          width: 1.5,
          "line-color": "#d0d0d0",
          "target-arrow-color": "#d0d0d0",
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
          opacity: 0.8,
        },
      },
      {
        selector: "edge.highlighted",
        style: {
          "line-color": "#5b7fdb",
          "target-arrow-color": "#5b7fdb",
          width: 2,
          opacity: 1,
        },
      },
    ],
    layout: {
      name: "dagre",
      rankDir: "BT",
      rankSep: 60,
      nodeSep: 24,
      padding: 32,
    } as any,
    minZoom: 0.15,
    maxZoom: 4,
    wheelSensitivity: 0.25,
  });

  // highlight connected edges on hover
  cy.on("mouseover", "node", (e) => {
    container.style.cursor = "pointer";
    const node = e.target;
    cy.elements().not(node).not(node.connectedEdges()).addClass("faded");
    node.connectedEdges().addClass("highlighted");
  });

  cy.on("mouseout", "node", () => {
    container.style.cursor = "default";
    cy.elements().removeClass("faded highlighted");
  });

  if (onNavigate) {
    cy.on("tap", "node", (e) => {
      const route = e.target.data("route") as string;
      if (route) onNavigate(route);
    });
  }

  return cy;
}
