/**
 * Compiles TypstBackend output with a real `typst` binary (0.15+), found via
 * $TYPST or PATH. Skipped when no suitable binary is available.
 */
import { test, expect, describe } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TypstBackend, TYPST_PREAMBLE } from "./backend.ts";
import { LeanLSPClient } from "./client.ts";
import type { Token } from "./lib.ts";

const FAKE_LSP = path.join(import.meta.dir, "__fixtures__", "fake-lsp.ts");

function findTypst(): string | null {
  const bin = process.env.TYPST ?? Bun.which("typst");
  if (!bin) return null;
  const out = spawnSync(bin, ["--version"], { encoding: "utf8" }).stdout ?? "";
  const [, major, minor] = /typst (\d+)\.(\d+)/.exec(out) ?? [];
  return Number(major) > 0 || Number(minor) >= 15 ? bin : null;
}

const typst = findTypst();
if (!typst) console.warn("typst.test.ts: no typst >= 0.15 found (set $TYPST); skipping");

/** Write `body` after the preamble, compile it, and return its raw texts and link targets. */
function compile(body: string): { raws: string[]; links: string[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leandown-typst-test-"));
  const file = path.join(dir, "doc.typ");
  fs.writeFileSync(file, TYPST_PREAMBLE + "\n" + body);
  try {
    const compiled = spawnSync(typst!, ["compile", file, path.join(dir, "doc.pdf")], {
      encoding: "utf8",
    });
    // Any error or warning (e.g. an unknown font) fails the test.
    expect(compiled.stderr).toBe("");
    expect(compiled.status).toBe(0);

    const evaluate = (expr: string): string[] => {
      const res = spawnSync(typst!, ["eval", expr, "--in", file], { encoding: "utf8" });
      expect(res.status).toBe(0);
      return JSON.parse(res.stdout);
    };
    return {
      raws: evaluate("query(raw).map(it => it.text)"),
      links: evaluate("query(link).map(it => it.dest)"),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!typst)("TypstBackend output compiles with typst 0.15", () => {
  const backend = new TypstBackend();

  test("nested tokens and markup-significant characters", () => {
    const outer: Token = {
      line: 0,
      start: 0,
      length: 9,
      type: "hover-span",
      permalink: 'https://github.com/a/b/blob/x/F.lean?q="1"#L2',
    };
    const inner: Token = { line: 0, start: 1, length: 1, type: "variable", groupId: "ref-0-1", isDefinition: true };
    const kw: Token = { line: 0, start: 0, length: 3, type: "keyword" };
    const lines = [
      backend.renderTokenStart(kw) + backend.escape("def") + backend.renderTokenEnd(kw) +
        backend.escape(" f ") +
        backend.renderTokenStart(outer) +
        backend.escape("(") +
        backend.renderTokenStart(inner) + backend.escape("n") + backend.renderTokenEnd(inner) +
        backend.escape(" : ℕ)") +
        backend.renderTokenEnd(outer),
      backend.escape(`  "q\\"x" ] [ # $ * _ @l <a> // /* \\ ⟨⟩ → ∀ \r`),
      "",
      backend.escape("  rfl"),
    ];
    const { raws, links } = compile(backend.wrapBlock(backend.joinLines(lines)));
    expect(raws.join("")).toBe(
      `def f (n : ℕ)  "q\\"x" ] [ # $ * _ @l <a> // /* \\ ⟨⟩ → ∀   rfl`
    );
    expect(links).toEqual(['https://github.com/a/b/blob/x/F.lean?q="1"#L2']);
  });

  test("full pipeline through LeanLSPClient", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leandown-typst-test-"));
    const client = new LeanLSPClient(dir, { command: [process.execPath, FAKE_LSP] });
    const source = 'def x : Nat := 1\r\ntheorem t : x = 1 := by\r\n  rfl -- "done" \\ #ok';
    try {
      const res = await client.highlight(source, { backend });
      expect(res.html).toContain('#lean-token(type: "keyword")[#raw("def")]');
      const { raws } = compile(backend.wrapBlock(res.html));
      expect(raws.join("")).toBe(source.replace(/\r?\n/g, ""));
    } finally {
      await client.shutdown();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
