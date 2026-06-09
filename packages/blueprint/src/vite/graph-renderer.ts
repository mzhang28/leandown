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
  /** Statement is formalized (has a Lean declaration). */
  stated?: boolean;
  /** Proof is formalized (no `sorry`). */
  proved?: boolean;
  /** Already in mathlib. */
  mathlib?: boolean;
  /** Fully formalized — proved and all ancestors are proved. */
  fullyProved?: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
}

// ── Color palettes ────────────────────────────────────────────────────────

/** Statement status → border colour (lean-blueprint inspired). */
const STATEMENT_COLORS: Record<string, { color: string; label: string; desc: string }> = {
  mathlib:    { color: "#1a6b1a", label: "In mathlib",    desc: "already in mathlib; no formalization needed" },
  stated:     { color: "#28a745", label: "Stated",        desc: "statement is formalized" },
  can_state:  { color: "#5b7fdb", label: "Ready to state", desc: "all prerequisites are formalized" },
  not_ready:  { color: "#e67e22", label: "Not ready",     desc: "prerequisites still need work" },
};

/** Proof status → fill colour (lean-blueprint inspired). */
const PROOF_COLORS: Record<string, { color: string; label: string; desc: string }> = {
  fully_proved: { color: "#1CAC78", label: "Fully proved",  desc: "proof and all ancestors are formalized" },
  proved:       { color: "#9CEC8B", label: "Proved",        desc: "proof is formalized" },
  can_prove:    { color: "#A3D6FF", label: "Ready to prove", desc: "all proof prerequisites are formalized" },
};

/** Kind → fallback colour (used when no state data is available). */
const KIND_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  theorem:     { bg: "#f4f6fb", border: "#5b7fdb", text: "#1a3a7a" },
  definition:  { bg: "#f2f7ef", border: "#60a64c", text: "#1a4a0a" },
  lemma:       { bg: "#fef9ef", border: "#b8860b", text: "#5a3e00" },
  proof:       { bg: "#f8f8f8", border: "#999",     text: "#444" },
  proposition: { bg: "#f7f0f9", border: "#9b59b6", text: "#4a1a7a" },
  corollary:   { bg: "#f1f7f8", border: "#2e8190", text: "#0a3a45" },
  example:     { bg: "#fef6ef", border: "#e67e22", text: "#7a3500" },
  conjecture:  { bg: "#faf0f0", border: "#c0392b", text: "#6a0a0a" },
  remark:      { bg: "#f6f6f6", border: "#7f8c8d", text: "#444" },
  note:        { bg: "#f8f8f8", border: "#95a5a6", text: "#555" },
};

const KIND_LABELS: Record<string, string> = {
  theorem: "Theorem", definition: "Definition", lemma: "Lemma",
  proof: "Proof", proposition: "Proposition", corollary: "Corollary",
  example: "Example", conjecture: "Conjecture", remark: "Remark", note: "Note",
};

// ── Node colouring ─────────────────────────────────────────────────────────

function resolveStatementColor(node: GraphNode): string | undefined {
  if (node.mathlib) return STATEMENT_COLORS.mathlib!.color;
  if (node.stated)  return STATEMENT_COLORS.stated!.color;
  if (node.fullyProved || node.proved) return STATEMENT_COLORS.can_state!.color;
  return undefined; // no state → fall back to kind colour
}

function resolveProofColor(node: GraphNode): string | undefined {
  if (node.fullyProved) return PROOF_COLORS.fully_proved!.color;
  if (node.proved)      return PROOF_COLORS.proved!.color;
  // `can_prove` when stated but not yet proved (optimistic: all deps ready)
  if (node.stated && !node.proved) return PROOF_COLORS.can_prove!.color;
  return undefined;
}

/** True when at least one node carries state data. */
function hasStateData(nodes: GraphNode[]): boolean {
  return nodes.some((n) => n.mathlib || n.stated || n.proved || n.fullyProved);
}

// ── Legend ──────────────────────────────────────────────────────────────────

function swatch(bg: string, border: string): HTMLElement {
  const s = document.createElement("span");
  s.className = "graph-legend-swatch";
  s.style.backgroundColor = bg;
  s.style.borderColor = border;
  return s;
}

function legendItem(bg: string, border: string, label: string, desc: string): HTMLElement {
  const item = document.createElement("div");
  item.className = "graph-legend-item";
  item.title = desc;
  item.appendChild(swatch(bg, border));
  const lbl = document.createElement("span");
  lbl.className = "graph-legend-label";
  lbl.textContent = label;
  item.appendChild(lbl);
  return item;
}

function renderLegend(container: HTMLElement, nodes: GraphNode[]): void {
  const legend = document.createElement("div");
  legend.className = "graph-legend";

  const title = document.createElement("div");
  title.className = "graph-legend-title";
  title.textContent = "Legend";
  legend.appendChild(title);

  const useState = hasStateData(nodes);

  if (useState) {
    // ── Statement status (border) ──────────────────────────────────
    const secBorder = document.createElement("div");
    secBorder.className = "graph-legend-section";
    const hdrBorder = document.createElement("div");
    hdrBorder.className = "graph-legend-section-title";
    hdrBorder.textContent = "Statement status";
    secBorder.appendChild(hdrBorder);

    for (const st of ["mathlib", "stated", "can_state", "not_ready"] as const) {
      const c = STATEMENT_COLORS[st]!;
      secBorder.appendChild(legendItem("#fff", c.color, c.label, c.desc));
    }
    legend.appendChild(secBorder);

    // ── Proof status (fill) ────────────────────────────────────────
    const secFill = document.createElement("div");
    secFill.className = "graph-legend-section";
    const hdrFill = document.createElement("div");
    hdrFill.className = "graph-legend-section-title";
    hdrFill.textContent = "Proof status";
    secFill.appendChild(hdrFill);

    for (const st of ["fully_proved", "proved", "can_prove"] as const) {
      const c = PROOF_COLORS[st]!;
      secFill.appendChild(legendItem(c.color, c.color, c.label, c.desc));
    }
    legend.appendChild(secFill);
  }

  // ── Kind colours (always shown as reference) ──────────────────────
  const kinds = [...new Set(nodes.map((n) => n.kind))].sort();
  if (kinds.length > 0) {
    const secKind = document.createElement("div");
    secKind.className = "graph-legend-section";
    if (useState) {
      const hdrKind = document.createElement("div");
      hdrKind.className = "graph-legend-section-title";
      hdrKind.textContent = "Node kind";
      secKind.appendChild(hdrKind);
    }
    for (const kind of kinds) {
      const c = KIND_COLORS[kind];
      if (!c) continue;
      secKind.appendChild(legendItem(c.bg, c.border, KIND_LABELS[kind] ?? kind, ""));
    }
    legend.appendChild(secKind);
  }

  container.appendChild(legend);
}

// ── Graph rendering ────────────────────────────────────────────────────────

export function renderGraph(
  container: HTMLElement,
  nodes: GraphNode[],
  edges: GraphEdge[],
  onNavigate?: (route: string) => void,
): cytoscape.Core {
  const validIds = new Set(nodes.map((n) => n.id));

  const cy = cytoscape({
    container,
    elements: [
      ...nodes.map((n) => ({
        data: {
          id: n.id, label: n.label, kind: n.kind,
          lean: n.lean ?? "", route: n.route,
          stated: n.stated ?? false, proved: n.proved ?? false,
          mathlib: n.mathlib ?? false, fullyProved: n.fullyProved ?? false,
        },
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
          "background-color": (ele: cytoscape.NodeSingular) => {
            const n = ele.data();
            if (n.mathlib || n.stated || n.proved || n.fullyProved) {
              return resolveProofColor(n as any) ?? "#fff";
            }
            return KIND_COLORS[n.kind]?.bg ?? "#f6f6f6";
          },
          "border-color": (ele: cytoscape.NodeSingular) => {
            const n = ele.data();
            if (n.mathlib || n.stated || n.proved || n.fullyProved) {
              return resolveStatementColor(n as any) ?? "#aaa";
            }
            return KIND_COLORS[n.kind]?.border ?? "#aaa";
          },
          "border-width": (ele: cytoscape.NodeSingular) => {
            const n = ele.data();
            return (n.mathlib || n.stated) ? 3 : 2;
          },
          "color": (ele: cytoscape.NodeSingular) => {
            return KIND_COLORS[ele.data("kind")]?.text ?? "#333";
          },
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
          "line-color": "#ccc",
          "target-arrow-color": "#ccc",
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
          opacity: 0.7,
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

  renderLegend(container, nodes);

  return cy;
}
