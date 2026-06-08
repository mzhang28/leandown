import fs from "node:fs";
import path from "node:path";
import {
  type BlueprintNode,
  type BlueprintEdge,
  type BlueprintManifest,
  type LeanDeclInfo,
  type DeclState,
} from "./types.ts";
import { type LakeConfig, parseLakefile, findLeanSources } from "./lakefile.ts";
import { LeanLSPClient } from "@leandown/core";

// ── Regex patterns ──────────────────────────────────────────────────────

/**
 * Matches `@[blueprint "label"]` (label in double quotes).
 * Capture group 1 → label.
 */
const BLUEPRINT_ATTR_RE = /@\[blueprint\s+"([^"]+)"\]/g;

/**
 * Matches the start of a Lean declaration:
 *   def, theorem, lemma, example, instance, class, structure, inductive
 *
 * Capture group 1 → keyword
 * Capture group 2 → name
 */
const DECL_RE =
  /^\s*(?:noncomputable\s+)?(?:@\[[^\]]*\]\s*)*(def|theorem|lemma|example|instance|class|structure|inductive)\s+(\S+)/;

/** Matches `sorry` as a token (not inside a string or comment, best-effort). */
const SORRY_RE = /\bsorry\b/;

// ── Public API ───────────────────────────────────────────────────────────

export interface AnalyzerOptions {
  /** Path to the Lean project root (contains lakefile.toml) */
  leanProjectPath: string;
  /** Known blueprint labels from markdown directives */
  blueprintLabels?: Map<string, { kind: string; leanDecls: string[]; uses: string[] }>;
  /** Whether to use LSP for more accurate diagnostics (default: true) */
  useLsp?: boolean;
}

/**
 * Analyze a Lean project and produce a blueprint manifest.
 */
export async function analyzeProject(
  options: AnalyzerOptions
): Promise<BlueprintManifest> {
  const { leanProjectPath, blueprintLabels, useLsp = true } = options;

  const lakefilePath = path.join(leanProjectPath, "lakefile.toml");
  if (!fs.existsSync(lakefilePath)) {
    throw new Error(`No lakefile.toml found in ${leanProjectPath}`);
  }

  const sources = findLeanSources(leanProjectPath);
  if (sources.length === 0) {
    throw new Error(`No .lean files found in ${leanProjectPath}`);
  }

  // ── Phase 1: static analysis ────────────────────────────────────────
  const declInfos = new Map<string, LeanDeclInfo>();

  for (const srcPath of sources) {
    const content = fs.readFileSync(srcPath, "utf-8");
    const lines = content.split("\n");

    // Collect @[blueprint "..."] annotations with their line numbers
    const annotations: { line: number; label: string }[] = [];
    BLUEPRINT_ATTR_RE.lastIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      BLUEPRINT_ATTR_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = BLUEPRINT_ATTR_RE.exec(line)) !== null) {
        annotations.push({ line: i, label: m[1]! });
      }
    }

    // Find declarations and attach preceding @[blueprint "..."] annotations
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const m = DECL_RE.exec(line);
      if (!m) continue;

      const name = m[2]!;

      // Collect @[blueprint "..."] annotations on lines immediately before
      // this declaration (allow blank lines in between).
      const declLabels: string[] = [];
      for (const ann of annotations) {
        if (ann.line < i) {
          // Check there's no other declaration between the annotation and this one
          let blocked = false;
          for (let j = ann.line + 1; j < i; j++) {
            if (DECL_RE.test(lines[j]!)) {
              blocked = true;
              break;
            }
          }
          if (!blocked) {
            declLabels.push(ann.label);
          }
        }
      }

      // Determine if the declaration body has `sorry`
      const hasSorry = detectSorry(lines, i);
      SORRY_RE.lastIndex = 0;

      if (!declInfos.has(name)) {
        declInfos.set(name, {
          name,
          filePath: srcPath,
          line: i,
          hasSorry,
          blueprintLabels: declLabels,
          references: [],
        });
      }
    }
  }

  // ── Phase 2: LSP analysis (optional) ──────────────────────────────────
  if (useLsp) {
    try {
      await enrichWithLsp(declInfos, leanProjectPath, sources);
    } catch (err) {
      console.warn(
        "[blueprint] LSP analysis failed, using static analysis only:",
        (err as Error).message
      );
    }
  }

  // ── Build manifest ───────────────────────────────────────────────────
  return buildManifest(declInfos, blueprintLabels ?? new Map());
}

// ── Sorry detection ────────────────────────────────────────────────────

/**
 * Scan lines from the declaration line to the end of its body for `sorry`.
 */
function detectSorry(lines: string[], declLine: number): boolean {
  const declEnd = findDeclEnd(lines, declLine + 1);
  for (let j = declLine; j <= declEnd && j < lines.length; j++) {
    const codeOnly = lines[j]!.replace(/--.*$/, "");
    if (/\bsorry\b/.test(codeOnly)) {
      return true;
    }
  }
  return false;
}

// ── LSP enrichment ──────────────────────────────────────────────────────

async function enrichWithLsp(
  declInfos: Map<string, LeanDeclInfo>,
  projectPath: string,
  sources: string[]
): Promise<void> {
  const client = new LeanLSPClient(projectPath);
  await client.start();

  try {
    for (const srcPath of sources.slice(0, 20)) {
      const content = fs.readFileSync(srcPath, "utf-8");
      await client.highlight("-- LSP probe", {
        synchronizedHovers: false,
        prependCode: content,
      });
    }
  } finally {
    await client.shutdown();
  }
}

// ── Declaration boundary detection ──────────────────────────────────────

/**
 * Find the end line of the declaration starting at `startLine`.
 * Scans for the next top-level declaration or end-of-file.
 */
function findDeclEnd(lines: string[], startLine: number): number {
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i]!;
    if (DECL_RE.test(line)) {
      return i - 1;
    }
  }
  return lines.length - 1;
}

// ── Manifest builder ────────────────────────────────────────────────────

function buildManifest(
  declInfos: Map<string, LeanDeclInfo>,
  blueprintLabels: Map<string, { kind: string; leanDecls: string[]; uses: string[] }>
): BlueprintManifest {
  const nodes: Record<string, BlueprintNode> = {};
  const edges: BlueprintEdge[] = [];

  // Build lean-name → decl map for cross-referencing
  const byLeanName = new Map<string, LeanDeclInfo>();
  for (const [name, info] of declInfos) {
    byLeanName.set(name, info);
    // Also index by short name (last segment of qualified name)
    const short = name.split(".").pop();
    if (short && short !== name && !byLeanName.has(short)) {
      byLeanName.set(short, info);
    }
  }

  // First pass: create nodes from markdown blueprint labels
  for (const [label, bpInfo] of blueprintLabels) {
    const leanDecls: string[] = [];
    let allSorryFree = true;
    let ownSorry = false;

    for (const leanName of bpInfo.leanDecls) {
      const trimmed = leanName.trim();
      const info = byLeanName.get(trimmed);
      if (info) {
        leanDecls.push(info.name);
        if (info.hasSorry) {
          allSorryFree = false;
          ownSorry = true;
        }
      } else {
        // Declaration not found — treat as unknown (has sorry)
        leanDecls.push(trimmed);
        allSorryFree = false;
        ownSorry = true;
      }
    }

    let status: DeclState = "pending";
    if (leanDecls.length > 0) {
      status = allSorryFree ? "proved" : "not_ready";
    }

    nodes[label] = {
      label,
      kind: bpInfo.kind,
      leanDecls,
      uses: bpInfo.uses,
      status,
      autoLinked: false,
      hasOwnSorry: ownSorry,
    };

    // Create edges from uses
    for (const useLabel of bpInfo.uses) {
      edges.push({ from: label, to: useLabel });
    }
  }

  // Second pass: create nodes from auto-linked declarations
  for (const [, info] of declInfos) {
    for (const label of info.blueprintLabels) {
      if (nodes[label]) continue; // already defined in markdown (markdown wins)

      nodes[label] = {
        label,
        kind: "theorem",
        leanDecls: [info.name],
        uses: [],
        status: info.hasSorry ? "not_ready" : "proved",
        autoLinked: true,
        hasOwnSorry: info.hasSorry,
      };
    }
  }

  // Third pass: compute transitive statuses
  computeTransitiveStatus(nodes, edges);

  return { nodes, edges };
}

/**
 * Compute transitive formalization status for all nodes.
 *
 *   fully_proved  — proved, and all ancestors are fully_proved (or there are none)
 *   proved        — own Lean decl has no `sorry`, or all deps proved (vacuously true with no deps)
 *   can_prove     — all proof dependencies are at least can_state
 *   can_state     — all statement dependencies are at least can_state
 *   not_ready     — has `sorry` or depends on something not_ready / can_state
 *   pending       — no Lean decl linked
 */
function computeTransitiveStatus(
  nodes: Record<string, BlueprintNode>,
  edges: BlueprintEdge[]
): void {
  // Build adjacency list
  const uses = new Map<string, string[]>();
  for (const [label] of Object.entries(nodes)) {
    uses.set(label, []);
  }
  for (const edge of edges) {
    const list = uses.get(edge.from);
    if (list) list.push(edge.to);
  }

  // Iterative fixpoint
  let changed = true;
  let iterations = 0;

  while (changed && iterations < 100) {
    changed = false;
    iterations++;

    for (const [label, node] of Object.entries(nodes)) {
      if (node.status === "pending") continue;

      const deps = uses.get(label) ?? [];
      const depStatuses = deps.map((d) => nodes[d]?.status ?? "pending");

      // A node whose own decl has `sorry` can never advance past not_ready.
      if (node.hasOwnSorry) continue;

      // A node with no deps that is proved → fully_proved
      if (node.status === "proved" && deps.length === 0) {
        node.status = "fully_proved";
        changed = true;
        continue;
      }

      // Proved + all deps fully_proved → fully_proved
      if (
        node.status === "proved" &&
        deps.length > 0 &&
        depStatuses.every((s) => s === "fully_proved")
      ) {
        node.status = "fully_proved";
        changed = true;
        continue;
      }

      // not_ready (own decl clean, but deps not ready) → can_state
      if (
        node.status === "not_ready" &&
        depStatuses.every(
          (s) =>
            s === "proved" ||
            s === "fully_proved" ||
            s === "can_prove" ||
            s === "can_state"
        )
      ) {
        node.status = "can_state";
        changed = true;
        continue;
      }

      // can_state → can_prove when all deps are proved/can_prove/fully_proved
      if (
        node.status === "can_state" &&
        depStatuses.every(
          (s) =>
            s === "proved" ||
            s === "fully_proved" ||
            s === "can_prove"
        )
      ) {
        node.status = "can_prove";
        changed = true;
        continue;
      }
    }
  }
}
