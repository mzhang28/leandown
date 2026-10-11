import { describe, test, expect } from "bun:test";
import { processDirectives, parseInfo, scanDirectives } from "./index.ts";

function run(md: string) {
  const warnings: string[] = [];
  const out = processDirectives(md, "/", { warn: (m) => warnings.push(m) });
  return { out, warnings };
}

describe("processDirectives", () => {
  test("renders a simple directive", () => {
    const { out } = run(':::theorem "t1" (lean := "Nat.add_comm")\nBody.\n:::');
    expect(out).toContain('<section class="blueprint-node blueprint-node--theorem"');
    expect(out).toContain('data-blueprint-label="t1"');
    expect(out).toContain("\n\nBody.\n</section>");
    expect(out).not.toContain(":::");
  });

  test("keeps `$` sequences in the body verbatim", () => {
    const body = "We write $`a + b` and $$x$$ and $& and $'.";
    const { out } = run(`intro\n\n:::definition "d"\n${body}\n:::`);
    expect(out).toContain(body);
    expect(out.startsWith("intro\n\n<section")).toBe(true);
  });

  test("nests directives", () => {
    const { out, warnings } = run(
      ':::theorem "t"\nStatement.\n:::proof\nBy cases.\n:::\nAfter.\n:::\nTail.',
    );
    expect(warnings).toEqual([]);
    expect(out).not.toContain(":::");
    expect(out.match(/<section/g)?.length).toBe(2);
    expect(out.match(/<\/section>/g)?.length).toBe(2);
    expect(out.indexOf("blueprint-node--proof")).toBeGreaterThan(out.indexOf("blueprint-node--theorem"));
    expect(out.indexOf("After.")).toBeLessThan(out.lastIndexOf("</section>"));
    expect(out.endsWith("</section>\nTail.")).toBe(true);
  });

  test("leaves an unclosed directive as text and warns", () => {
    const { out, warnings } = run(':::theorem "a"\nA.\n\n:::lemma "b"\nB.\n:::');
    expect(warnings).toEqual(["unclosed :::theorem directive at line 1"]);
    expect(out.startsWith(':::theorem "a"\nA.\n\n<section')).toBe(true);
    expect(out).toContain("blueprint-node--lemma");
  });

  test("ignores directives inside fenced code", () => {
    const md = '```markdown\n:::theorem "x"\nnot real\n:::\n```\n\n~~~~\n:::\n~~~~';
    const { out, warnings } = run(md);
    expect(out).toBe(md);
    expect(warnings).toEqual([]);
  });

  test("processes fenced code inside a directive", () => {
    const { out } = run(':::theorem "t"\n```lean\n:::\n```\n:::');
    expect(out).toContain("```lean\n:::\n```\n</section>");
  });

  test("passes through other ::: containers with their own close", () => {
    const { out } = run(':::theorem "t"\n:::warning\nCareful.\n:::\nMore.\n:::');
    expect(out).toContain(":::warning\nCareful.\n:::\nMore.\n</section>");
  });

  test("escapes labels and attribute values", () => {
    const { out } = run(':::theorem "a<b & c" (owner := "Jane \\"JD\\" Doe")\nX.\n:::');
    expect(out).toContain('data-blueprint-label="a&lt;b &amp; c"');
    expect(out).toContain('data-blueprint-owner="Jane &quot;JD&quot; Doe"');
    expect(out).toContain('<span class="blueprint-label">a&lt;b &amp; c</span>');
  });
});

describe("parseInfo", () => {
  test("unescapes quoted values", () => {
    expect(parseInfo('"a\\"b" (owner := "x\\\\y")')).toEqual({
      label: 'a"b',
      attrs: { owner: "x\\y" },
    });
  });
});

describe("scanDirectives", () => {
  test("skips fenced code and reports line numbers", () => {
    const found = scanDirectives(
      '```\n:::theorem "fake"\n:::\n```\n:::lemma "real" (uses := "a")\n:::',
    );
    expect(found).toEqual([
      { kind: "lemma", label: "real", attrs: { uses: "a" }, lineNo: 5 },
    ]);
  });
});
