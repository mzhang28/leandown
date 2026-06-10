import { describe, test, expect } from "bun:test";
import { HtmlBackend, TypstBackend } from "./backend.ts";
import type { Token, DiagnosticPosition } from "./lib.ts";

describe("HtmlBackend", () => {
  const backend = new HtmlBackend();

  test("name", () => {
    expect(backend.name).toBe("html");
  });

  test("capabilities", () => {
    expect(backend.capabilities).toEqual({
      hovers: true,
      definitions: true,
      goals: true,
      diagnostics: true,
    });
  });

  test("escape", () => {
    expect(backend.escape("def hello <|>")).toBe("def hello &lt;|&gt;");
  });

  test("wrapBlock", () => {
    expect(backend.wrapBlock("code")).toBe('<pre><code class="language-lean">code</code></pre>');
  });

  test("joinLines", () => {
    expect(backend.joinLines(["line1", "line2"])).toBe("line1\nline2");
  });

  test("renderTokenStart & renderTokenEnd", () => {
    const token1: Token = { line: 0, start: 0, length: 3, type: "keyword" };
    expect(backend.renderTokenStart(token1)).toBe('<span class="lean-keyword">');
    expect(backend.renderTokenEnd(token1)).toBe('</span>');

    const token2: Token = {
      line: 0,
      start: 4,
      length: 5,
      type: "function",
      groupId: "ref-1-2",
      permalink: "https://github.com/...",
      isDefinition: true
    };
    expect(backend.renderTokenStart(token2)).toBe(
      '<span class="lean-function" data-symbol="ref-1-2" data-permalink="https://github.com/..." data-is-definition="true">'
    );
  });

  test("renderDiagnostic", () => {
    // Standard diagnostic marker
    const diag1: DiagnosticPosition = {
      character: 5,
      severity: 3,
      message: "some info",
      hoverId: "h1",
    };
    expect(backend.renderDiagnostic(diag1)).toBe(
      '<span class="lean-diagnostic-marker lean-diagnostic-info" data-hover-id="h1">…</span>'
    );

    // Single-line #eval or #check diagnostic
    const diagEvalSingle: DiagnosticPosition = {
      character: 5,
      severity: 3,
      message: "2",
      hoverId: "h2",
      isEvalOrCheck: true,
    };
    expect(backend.renderDiagnostic(diagEvalSingle)).toBe(
      '<span class="lean-diagnostic-inline" data-hover-id="h2">2</span>'
    );

    // Multi-line #eval or #check diagnostic
    const diagEvalMulti: DiagnosticPosition = {
      character: 5,
      severity: 3,
      message: "line 1\nline 2\nline 3",
      hoverId: "h3",
      isEvalOrCheck: true,
    };
    expect(backend.renderDiagnostic(diagEvalMulti)).toBe(
      '<details class="lean-diagnostic-details"><summary class="lean-diagnostic-summary" data-hover-id="h3">line 1</summary><span class="lean-diagnostic-expanded">\nline 2\nline 3</span></details>'
    );
  });
});

describe("TypstBackend", () => {
  const backend = new TypstBackend();

  test("name", () => {
    expect(backend.name).toBe("typst");
  });

  test("capabilities", () => {
    expect(backend.capabilities).toEqual({
      hovers: false,
      definitions: true,
      goals: false,
      diagnostics: false,
    });
  });

  test("escape", () => {
    expect(backend.escape('x = "hello"\\world')).toBe('#raw("x = \\"hello\\"\\\\world")');
  });

  test("wrapBlock", () => {
    const wrapped = backend.wrapBlock("content");
    expect(wrapped).toContain("#block(");
    expect(wrapped).toContain('fill: rgb("f5f5f5")');
    expect(wrapped).toContain("content");
  });

  test("joinLines", () => {
    expect(backend.joinLines(["line1", "line2"])).toBe("line1#linebreak()\nline2");
  });

  test("renderTokenStart & renderTokenEnd", () => {
    // 1. Plain token (no type/id/link)
    const token1: Token = { line: 0, start: 0, length: 3, type: "" };
    expect(backend.renderTokenStart(token1)).toBe('#raw("');
    expect(backend.renderTokenEnd(token1)).toBe('")');

    // 2. Styled token
    const token2: Token = { line: 0, start: 0, length: 3, type: "keyword" };
    expect(backend.renderTokenStart(token2)).toBe('#lean-token(type: "keyword")[#raw("');
    expect(backend.renderTokenEnd(token2)).toBe('")]');

    // 3. Local definition definition token
    const token3: Token = {
      line: 0,
      start: 4,
      length: 5,
      type: "function",
      groupId: "ref-1-2",
      isDefinition: true
    };
    expect(backend.renderTokenStart(token3)).toBe('#lean-token(type: "function", id: "ref_1_2", isDef: true)[#raw("');
    expect(backend.renderTokenEnd(token3)).toBe('")]');

    // 4. Local definition reference token
    const token4: Token = {
      line: 0,
      start: 4,
      length: 5,
      type: "function",
      groupId: "ref-1-2",
    };
    expect(backend.renderTokenStart(token4)).toBe('#lean-token(type: "function", id: "ref_1_2")[#raw("');
    expect(backend.renderTokenEnd(token4)).toBe('")]');

    // 5. External link token
    const token5: Token = {
      line: 0,
      start: 4,
      length: 5,
      type: "function",
      permalink: "https://github.com/..."
    };
    expect(backend.renderTokenStart(token5)).toBe('#lean-token(type: "function", link: "https://github.com/...")[#raw("');
    expect(backend.renderTokenEnd(token5)).toBe('")]');
  });
});
