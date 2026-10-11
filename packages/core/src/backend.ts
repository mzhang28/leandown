import escapeHtml from "escape-html";
import type { Token, GoalPosition, DiagnosticPosition, DiagnosticSpan } from "./lib.ts";

/**
 * Prefixed to every line of `#eval` / `#check` output so results read as output
 * rather than as more source code.
 */
export const OUTPUT_MARKER = ">> ";

/** Blank lines stay blank so trailing newlines don't leave a dangling marker. */
const markOutputLines = (text: string): string =>
  text
    .split("\n")
    .map((line) => (line ? OUTPUT_MARKER + line : line))
    .join("\n");

export interface LeanHighlightBackend {
  /** The name of the backend (used for cache isolation). */
  readonly name: string;

  /** Capabilities supported by this backend. */
  readonly capabilities?: {
    hovers?: boolean;
    definitions?: boolean;
    goals?: boolean;
    diagnostics?: boolean;
  };

  /** Escape text for this backend. */
  escape(text: string): string;

  /** Wrap the entire highlighted block of code. */
  wrapBlock(content: string): string;

  /** Join highlighted lines together. */
  joinLines(lines: string[]): string;

  /** Render the start of a token span. */
  renderTokenStart(token: Token): string;

  /** Render the end of a token span. */
  renderTokenEnd(token: Token): string;

  /** Render a goal marker. */
  renderGoal?(goal: GoalPosition): string;

  /** Render a diagnostic marker. */
  renderDiagnostic?(diagnostic: DiagnosticPosition): string;

  /** Render the start of a squiggly diagnostic span. */
  renderSquigglyStart?(span: DiagnosticSpan): string;

  /** Render the end of a squiggly diagnostic span. */
  renderSquigglyEnd?(span: DiagnosticSpan): string;
}

export class HtmlBackend implements LeanHighlightBackend {
  readonly name: string = "html";

  readonly capabilities = {
    hovers: true,
    definitions: true,
    goals: true,
    diagnostics: true,
  };

  escape(text: string): string {
    return escapeHtml(text);
  }

  wrapBlock(content: string): string {
    return `<pre><code class="language-lean">${content}</code></pre>`;
  }

  joinLines(lines: string[]): string {
    return lines.join("\n");
  }

  renderTokenStart(token: Token): string {
    let dataAttr = "";
    if (token.groupId) dataAttr += ` data-symbol="${token.groupId}"`;
    if (token.hoverId) dataAttr += ` data-hover-id="${token.hoverId}"`;
    if (token.permalink) dataAttr += ` data-permalink="${escapeHtml(token.permalink)}"`;
    if (token.isDefinition) dataAttr += ` data-is-definition="true"`;

    const cls = token.type ? `lean-${token.type}` : "lean-hover-span";
    return `<span class="${cls}"${dataAttr}>`;
  }

  renderTokenEnd(token: Token): string {
    return "</span>";
  }

  renderGoal(goal: GoalPosition): string {
    return `<span class="lean-goal-marker" data-hover-id="${goal.hoverId}">…</span>`;
  }

  renderDiagnostic(diagnostic: DiagnosticPosition): string {
    const severityClass =
      diagnostic.severity === 1
        ? "lean-diagnostic-error"
        : diagnostic.severity === 2
        ? "lean-diagnostic-warning"
        : "lean-diagnostic-info";

    if (diagnostic.isEvalOrCheck) {
      const msgLines = diagnostic.message.split(/\r?\n/);
      const firstLine = msgLines[0] || "";
      const restLines = msgLines.slice(1).join("\n");

      if (restLines) {
        return `<details class="lean-diagnostic-details"><summary class="lean-diagnostic-summary" data-hover-id="${
          diagnostic.hoverId
        }">${escapeHtml(
          markOutputLines(firstLine)
        )}</summary><span class="lean-diagnostic-expanded">\n${escapeHtml(
          markOutputLines(restLines)
        )}</span></details>`;
      } else {
        return `<span class="lean-diagnostic-inline" data-hover-id="${
          diagnostic.hoverId
        }">${escapeHtml(markOutputLines(firstLine))}</span>`;
      }
    }

    return `<span class="lean-diagnostic-marker ${severityClass}" data-hover-id="${
      diagnostic.hoverId
    }">…</span>`;
  }

  renderSquigglyStart(span: DiagnosticSpan): string {
    const severityClass =
      span.severity === 1 ? "lean-squiggly-error" : "lean-squiggly-warning";
    const hoverAttr = span.hoverId
      ? ` data-hover-id="${span.hoverId}"`
      : "";
    return `<span class="${severityClass}"${hoverAttr}>`;
  }

  renderSquigglyEnd(span: DiagnosticSpan): string {
    return "</span>";
  }
}

/** Quote `text` as a Typst string literal. */
const typstString = (text: string): string =>
  `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * Typst definitions that {@link TypstBackend} output relies on: `lean-block`
 * wraps each code block and `lean-token` styles each highlighted token.
 * Include it once per document (it also ships as `@leandown/core/lean.typ`),
 * or define your own `lean-block` / `lean-token` to restyle the output.
 */
export const TYPST_PREAMBLE = `// leandown: Lean highlighting for Typst (0.15+).
// Generated code calls lean-block and lean-token; redefine either to restyle.

#let lean-colors = (
  keyword: rgb("#a626a4"),
  variable: rgb("#e45649"),
  property: rgb("#c18401"),
  function: rgb("#4078f2"),
  method: rgb("#4078f2"),
  namespace: rgb("#c18401"),
  type: rgb("#0184bc"),
  class: rgb("#0184bc"),
  struct: rgb("#0184bc"),
  interface: rgb("#0184bc"),
  string: rgb("#50a14f"),
  number: rgb("#986801"),
  comment: rgb("#2e7d32"),
  operator: rgb("#0184bc"),
  leanSorryLike: rgb("#e45649"),
)

// One highlighted token. \`type\` is the semantic token type, \`id\` groups
// occurrences of the same local name (\`isDef\` marks its definition), and
// \`link\` is a permalink to an external definition.
#let lean-token(type: none, id: none, isDef: false, link: none, body) = {
  let styled = if type != none and type in lean-colors {
    text(fill: lean-colors.at(type), body)
  } else {
    body
  }
  if link != none { std.link(link, styled) } else { styled }
}

#let lean-block(body) = block(
  fill: rgb("#fafafa"),
  stroke: 0.5pt + rgb("#e5e5e6"),
  inset: 8pt,
  radius: 4pt,
  width: 100%,
  body,
)
`;

/**
 * Renders Typst markup. Every run of source text becomes `#raw("…")`, and
 * tokens wrap their text in `#lean-token(...)[…]` content blocks, which nest
 * the same way HTML spans do. Requires {@link TYPST_PREAMBLE}.
 */
export class TypstBackend implements LeanHighlightBackend {
  readonly name = "typst";

  readonly capabilities = {
    hovers: false,
    definitions: true,
    goals: false,
    diagnostics: false,
  };

  escape(text: string): string {
    // Lines come from splitting on "\n", so CRLF sources leave a trailing "\r".
    const clean = text.replace(/\r/g, "");
    return clean ? `#raw(${typstString(clean)})` : "";
  }

  wrapBlock(content: string): string {
    return `#lean-block[\n${content}\n]\n`;
  }

  joinLines(lines: string[]): string {
    return lines.join("#linebreak()\n");
  }

  renderTokenStart(token: Token): string {
    const attrs: string[] = [];
    if (token.type) attrs.push(`type: ${typstString(token.type)}`);
    if (token.groupId) {
      attrs.push(`id: ${typstString(token.groupId.replace(/-/g, "_"))}`);
      if (token.isDefinition) attrs.push("isDef: true");
    }
    if (token.permalink) attrs.push(`link: ${typstString(token.permalink)}`);
    // Unstyled tokens add nothing; their text is still emitted via escape().
    return attrs.length ? `#lean-token(${attrs.join(", ")})[` : "";
  }

  renderTokenEnd(token: Token): string {
    return token.type || token.groupId || token.permalink ? "]" : "";
  }
}

export class MarkdownBackend extends HtmlBackend {
  override readonly name = "markdown";
}

