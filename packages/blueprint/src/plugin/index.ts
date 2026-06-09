import type { Plugin } from "unified";
import type { Root } from "mdast";

/**
 * Parsed blueprint directive, e.g. from:
 *   :::theorem "label" (lean := "Nat.add_comm") (uses := "label1, label2")
 */
interface ParsedDirective {
  /** Full match text */
  fullMatch: string;
  /** Directive kind: theorem, definition, lemma, proof, etc. */
  kind: string;
  /** Optional label identifier */
  label?: string;
  /** Raw attributes string */
  attrsRaw: string;
  /** Parsed key-value attributes */
  attrs: Record<string, string>;
  /** Content inside the directive */
  content: string;
}

/**
 * Recognized blueprint directive kinds.
 */
const BLUEPRINT_KINDS = [
  "theorem",
  "definition",
  "lemma",
  "proof",
  "proposition",
  "corollary",
  "example",
  "conjecture",
  "remark",
  "note",
] as const;

const KINDS_PATTERN = BLUEPRINT_KINDS.join("|");

/**
 * Parse a `:::kind "label" (key := "value") ...` directive from markdown text.
 */
function parseDirective(text: string): ParsedDirective | null {
  const openRegex = new RegExp(
    `^:::(${KINDS_PATTERN})\\s*(.*?)\\s*$`,
    "m"
  );
  const match = text.match(openRegex);
  if (!match) return null;

  const kind = match[1]!;
  const infoStr = match[2] || "";
  const openEnd = match.index! + match[0].length;

  // Parse label and attributes from the info string
  const { label, attrs } = parseInfo(infoStr);

  // Find matching closing `:::`
  const rest = text.slice(openEnd);
  const closeRegex = /^:::/m;
  const closeMatch = rest.match(closeRegex);
  if (!closeMatch) return null; // No closing tag found

  const content = rest.slice(0, closeMatch.index).trim();
  const closeEnd = openEnd + closeMatch.index! + closeMatch[0].length;

  return {
    fullMatch: text.slice(match.index!, closeEnd),
    kind,
    label,
    attrsRaw: infoStr,
    attrs,
    content,
  };
}

/**
 * Parse the info string: `"label" (key := "val") (key2 := "val2")`
 */
function parseInfo(
  info: string
): { label?: string; attrs: Record<string, string> } {
  const attrs: Record<string, string> = {};
  let label: string | undefined;

  if (!info.trim()) return { attrs };

  // Extract quoted label
  const labelMatch = info.match(/^\s*"([^"]*)"/);
  if (labelMatch) {
    label = labelMatch[1];
  }

  // Parse (key := "value") attributes
  const attrRegex = /\((\w+)\s*:=\s*"((?:[^"\\]|\\.)*)"\)/g;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(info)) !== null) {
    attrs[m[1]!] = m[2]!;
  }

  return { label, attrs };
}

/**
 * Render a parsed directive to HTML.
 */
function renderDirective(d: ParsedDirective): string {
  const dataAttrs: string[] = [`data-blueprint-kind="${d.kind}"`];
  if (d.label) dataAttrs.push(`data-blueprint-label="${d.label}"`);

  // Lean declarations
  const leanDecls = d.attrs.lean
    ? d.attrs.lean.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  if (leanDecls.length > 0) {
    dataAttrs.push(`data-blueprint-lean="${leanDecls.join(", ")}"`);
  }

  // Dependency uses
  const usesLabels = d.attrs.uses
    ? d.attrs.uses.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  if (usesLabels.length > 0) {
    dataAttrs.push(`data-blueprint-uses="${usesLabels.join(", ")}"`);
  }

  if (d.attrs.owner) dataAttrs.push(`data-blueprint-owner="${d.attrs.owner}"`);
  if (d.attrs.priority)
    dataAttrs.push(`data-blueprint-priority="${d.attrs.priority}"`);

  const attrStr = dataAttrs.length > 0 ? " " + dataAttrs.join(" ") : "";

  // Build header
  const kindDisplay = d.kind.charAt(0).toUpperCase() + d.kind.slice(1);
  let header = `<div class="blueprint-header">`;
  header += `<span class="blueprint-kind">${kindDisplay}</span>`;
  if (d.label) {
    header += ` <span class="blueprint-label">${d.label}</span>`;
  }

  // Chips
  const chips: string[] = [];
  if (leanDecls.length > 0) {
    const title = `Lean: ${leanDecls.join(", ")}`;
    chips.push(
      `<a href="/docs/find/?pattern=${encodeURIComponent(leanDecls[0]!)}#doc" target="_blank" rel="noopener" class="blueprint-chip blueprint-chip--lean" title="${title}">L∃∀N</a>`
    );
  }
  if (usesLabels.length > 0) {
    chips.push(
      `<span class="blueprint-chip blueprint-chip--uses" title="Uses: ${usesLabels.join(", ")}">uses</span>`
    );
  }
  if (d.attrs.owner) {
    chips.push(
      `<span class="blueprint-chip blueprint-chip--owner">${d.attrs.owner}</span>`
    );
  }
  if (chips.length > 0) {
    header += ` <span class="blueprint-chips">${chips.join(" ")}</span>`;
  }
  header += `</div>`;

  return `<section class="blueprint-node blueprint-node--${d.kind}"${attrStr}>\n${header}\n\n${d.content}\n</section>`;
}

/**
 * Process all blueprint `:::` directives in markdown text,
 * replacing them with rendered HTML.
 */
function processDirectives(markdown: string): string {
  let result = markdown;
  let iterations = 0;
  const maxIterations = 1000;

  while (iterations < maxIterations) {
    const directive = parseDirective(result);
    if (!directive) break;

    const html = renderDirective(directive);
    result = result.replace(directive.fullMatch, html);
    iterations++;
  }

  return result;
}

/**
 * A remark plugin that pre-processes markdown text to convert blueprint
 * `:::theorem`, `:::definition`, `:::proof`, etc. container directives
 * into HTML sections before the markdown parser runs.
 *
 * This works as a text-level preprocessor: it scans the raw markdown for
 * `:::` directives and replaces them with rendered `<section>` elements.
 * The rest of the markdown (inside the sections) is processed normally
 * by remark-parse and subsequent plugins.
 */
const blueprintRemarkPlugin: Plugin<[], Root> = function () {
  // This is a workaround: we process the raw value in the parser phase.
  // We use a minimal approach — the plugin hooks into the compiler to
  // preprocess text. Actually, we'll use it as a bridge: the remark
  // pipeline calls process() and we preprocess there.
  //
  // For now, the simplest approach: export the text processor.
  // The Vite plugin will call it before remark-parse.
  return (tree: Root) => {
    // The tree is already parsed at this point.
    // We scan for html nodes that contain unprocessed ::: markers.
    // Actually — the pre-processing already happened at the text level
    // in the Vite plugin. This is a no-op in the tree phase.
    //
    // In future, this can do tree-level metadata extraction
    // (collecting labels, building cross-reference index, etc.)
  };
};

export { processDirectives, parseInfo, BLUEPRINT_KINDS };
export type { ParsedDirective };

export default blueprintRemarkPlugin;
