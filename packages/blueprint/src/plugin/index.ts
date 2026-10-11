import type { Plugin } from "unified";
import type { Root } from "mdast";

/**
 * Parsed blueprint directive, e.g. from:
 *   :::theorem "label" (lean := "Nat.add_comm") (uses := "label1, label2")
 */
interface ParsedDirective {
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

const OPEN_RE = new RegExp(`^:::(${KINDS_PATTERN})(?:\\s+(.*?))?\\s*$`);
/** Any other `:::name` container (not ours); its close must not end ours. */
const OTHER_OPEN_RE = /^:::[^:\s]/;
const CLOSE_RE = /^:::\s*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

type LineToken =
  | { type: "text"; line: string; lineNo: number }
  | { type: "open"; line: string; lineNo: number; kind: string; info: string }
  | { type: "other-open"; line: string; lineNo: number }
  | { type: "close"; line: string; lineNo: number };

/**
 * Classify each line of `markdown` as directive open/close or plain text.
 * Lines inside fenced code blocks are always plain text.
 */
function tokenizeLines(markdown: string): LineToken[] {
  const tokens: LineToken[] = [];
  let fence: { char: string; len: number } | null = null;
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;
    const fenceMatch = line.match(FENCE_RE);
    if (fence) {
      if (
        fenceMatch &&
        fenceMatch[1]![0] === fence.char &&
        fenceMatch[1]!.length >= fence.len &&
        line.slice(fenceMatch[0].length).trim() === ""
      ) {
        fence = null;
      }
      tokens.push({ type: "text", line, lineNo });
      continue;
    }
    if (fenceMatch) {
      fence = { char: fenceMatch[1]![0]!, len: fenceMatch[1]!.length };
      tokens.push({ type: "text", line, lineNo });
      continue;
    }
    const open = line.match(OPEN_RE);
    if (open) {
      tokens.push({ type: "open", line, lineNo, kind: open[1]!, info: open[2] ?? "" });
    } else if (CLOSE_RE.test(line)) {
      tokens.push({ type: "close", line, lineNo });
    } else if (OTHER_OPEN_RE.test(line)) {
      tokens.push({ type: "other-open", line, lineNo });
    } else {
      tokens.push({ type: "text", line, lineNo });
    }
  }
  return tokens;
}

/**
 * Find every blueprint directive opener in `markdown`, skipping fenced code.
 */
function scanDirectives(
  markdown: string
): { kind: string; label?: string; attrs: Record<string, string>; lineNo: number }[] {
  const result = [];
  for (const t of tokenizeLines(markdown)) {
    if (t.type !== "open") continue;
    const { label, attrs } = parseInfo(t.info);
    result.push({ kind: t.kind, label, attrs, lineNo: t.lineNo });
  }
  return result;
}

/**
 * Parse the info string: `"label" (key := "val") (key2 := "val2")`.
 * Backslash escapes inside quoted values are unescaped.
 */
function parseInfo(
  info: string
): { label?: string; attrs: Record<string, string> } {
  const attrs: Record<string, string> = {};
  let label: string | undefined;

  if (!info.trim()) return { attrs };

  const unescape = (s: string) => s.replace(/\\(.)/g, "$1");

  // Extract quoted label
  const labelMatch = info.match(/^\s*"((?:[^"\\]|\\.)*)"/);
  if (labelMatch) {
    label = unescape(labelMatch[1]!);
  }

  // Parse (key := "value") attributes
  const attrRegex = /\((\w+)\s*:=\s*"((?:[^"\\]|\\.)*)"\)/g;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(info)) !== null) {
    attrs[m[1]!] = unescape(m[2]!);
  }

  return { label, attrs };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render a parsed directive to HTML.
 */
function renderDirective(d: ParsedDirective, base = "/"): string {
  const esc = escapeHtml;
  const dataAttrs: string[] = [`data-blueprint-kind="${d.kind}"`];
  if (d.label) dataAttrs.push(`data-blueprint-label="${esc(d.label)}"`);

  // Lean declarations
  const leanDecls = d.attrs.lean
    ? d.attrs.lean.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  if (leanDecls.length > 0) {
    dataAttrs.push(`data-blueprint-lean="${esc(leanDecls.join(", "))}"`);
  }

  // Dependency uses
  const usesLabels = d.attrs.uses
    ? d.attrs.uses.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  if (usesLabels.length > 0) {
    dataAttrs.push(`data-blueprint-uses="${esc(usesLabels.join(", "))}"`);
  }

  if (d.attrs.owner) dataAttrs.push(`data-blueprint-owner="${esc(d.attrs.owner)}"`);
  if (d.attrs.priority)
    dataAttrs.push(`data-blueprint-priority="${esc(d.attrs.priority)}"`);

  const attrStr = dataAttrs.length > 0 ? " " + dataAttrs.join(" ") : "";

  // Build header
  const kindDisplay = d.kind.charAt(0).toUpperCase() + d.kind.slice(1);
  let header = `<div class="blueprint-header">`;
  header += `<span class="blueprint-kind">${kindDisplay}</span>`;
  if (d.label) {
    header += ` <span class="blueprint-label">${esc(d.label)}</span>`;
  }

  // Chips
  const chips: string[] = [];
  if (leanDecls.length > 0) {
    const title = `Lean: ${leanDecls.join(", ")}`;
    chips.push(
      `<a href="${esc(base)}docs/find/?pattern=${encodeURIComponent(leanDecls[0]!)}#doc" target="_blank" rel="noopener" class="blueprint-chip blueprint-chip--lean" title="${esc(title)}">L∃∀N</a>`
    );
  }
  if (usesLabels.length > 0) {
    chips.push(
      `<span class="blueprint-chip blueprint-chip--uses" title="${esc(`Uses: ${usesLabels.join(", ")}`)}">uses</span>`
    );
  }
  if (d.attrs.owner) {
    chips.push(
      `<span class="blueprint-chip blueprint-chip--owner">${esc(d.attrs.owner)}</span>`
    );
  }
  if (chips.length > 0) {
    header += ` <span class="blueprint-chips">${chips.join(" ")}</span>`;
  }
  header += `</div>`;

  return `<section class="blueprint-node blueprint-node--${d.kind}"${attrStr}>\n${header}\n\n${d.content}\n</section>`;
}

export interface ProcessDirectivesOptions {
  /** Called for each problem found (e.g. an unclosed directive). */
  warn?: (message: string) => void;
}

/**
 * Process all blueprint `:::` directives in markdown text,
 * replacing them with rendered HTML.
 *
 * A directive closes at the next line that is exactly `:::`, matched
 * innermost-first, so directives may nest. Other `:::name` containers are
 * passed through with their own close. Fenced code is never touched.
 * Unclosed directives are left as plain text and reported via `warn`.
 */
function processDirectives(
  markdown: string,
  base = "/",
  options: ProcessDirectivesOptions = {}
): string {
  const warn = options.warn ?? ((msg: string) => console.warn(`[blueprint] ${msg}`));

  interface Frame {
    open: LineToken;
    out: string[];
  }
  const root: string[] = [];
  const stack: Frame[] = [];
  const out = () => (stack.length ? stack[stack.length - 1]!.out : root);

  for (const t of tokenizeLines(markdown)) {
    if (t.type === "open" || t.type === "other-open") {
      stack.push({ open: t, out: [] });
    } else if (t.type === "close" && stack.length > 0) {
      const frame = stack.pop()!;
      if (frame.open.type === "open") {
        const { label, attrs } = parseInfo(frame.open.info);
        out().push(
          renderDirective(
            {
              kind: frame.open.kind,
              label,
              attrsRaw: frame.open.info,
              attrs,
              content: frame.out.join("\n").trim(),
            },
            base
          )
        );
      } else {
        out().push(frame.open.line, ...frame.out, t.line);
      }
    } else {
      out().push(t.line);
    }
  }

  // Unwind anything left open: keep it as plain text.
  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.open.type === "open") {
      warn(`unclosed :::${frame.open.kind} directive at line ${frame.open.lineNo}`);
    }
    out().push(frame.open.line, ...frame.out);
  }

  return root.join("\n");
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

export { processDirectives, parseInfo, scanDirectives, escapeHtml, BLUEPRINT_KINDS };
export type { ParsedDirective };

export default blueprintRemarkPlugin;
