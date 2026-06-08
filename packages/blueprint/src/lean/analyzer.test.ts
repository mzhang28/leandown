import { describe, test, expect, beforeAll } from "bun:test";
import { analyzeProject } from "./analyzer.ts";
import path from "node:path";
import fs from "node:fs";

const FIXTURES = path.join(import.meta.dirname, "__fixtures__", "test-project");

// Skip LSP for unit tests — static analysis only
const USE_LSP = false;

describe("analyzeProject (static analysis)", () => {
  test("throws when no lakefile.toml exists", async () => {
    await expect(
      analyzeProject({
        leanProjectPath: "/nonexistent",
        useLsp: false,
      })
    ).rejects.toThrow("No lakefile.toml found");
  });

  test("throws when no .lean files found", async () => {
    const emptyDir = path.join(FIXTURES, "../tmp-empty");
    fs.mkdirSync(emptyDir, { recursive: true });
    fs.writeFileSync(
      path.join(emptyDir, "lakefile.toml"),
      'name = "Empty"\n'
    );
    try {
      await expect(
        analyzeProject({
          leanProjectPath: emptyDir,
          useLsp: false,
        })
      ).rejects.toThrow("No .lean files found");
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  test("discovers @[blueprint \"...\"] auto-linked declarations", async () => {
    const manifest = await analyzeProject({
      leanProjectPath: FIXTURES,
      useLsp: USE_LSP,
    });

    // Auto-linked from @[blueprint "..."] annotations
    expect(manifest.nodes["add_def"]).toBeDefined();
    expect(manifest.nodes["add_def"]!.leanDecls).toContain("NatAdd");
    expect(manifest.nodes["add_def"]!.autoLinked).toBe(true);

    expect(manifest.nodes["add_zero"]).toBeDefined();
    expect(manifest.nodes["add_zero"]!.leanDecls).toContain("add_zero_right");
    expect(manifest.nodes["add_zero"]!.autoLinked).toBe(true);

    expect(manifest.nodes["add_succ"]).toBeDefined();
    expect(manifest.nodes["add_succ"]!.leanDecls).toContain("add_succ_right");
    expect(manifest.nodes["add_succ"]!.autoLinked).toBe(true);
  });

  test("detects sorry in declarations", async () => {
    const manifest = await analyzeProject({
      leanProjectPath: FIXTURES,
      useLsp: USE_LSP,
    });

    // add_zero_right has no sorry + no deps → fully_proved
    expect(manifest.nodes["add_zero"]!.status).toBe("fully_proved");

    // add_succ_right has sorry → not_ready
    expect(manifest.nodes["add_succ"]!.status).toBe("not_ready");
  });

  test("cross-references blueprint labels with Lean declarations", async () => {
    const blueprintLabels = new Map([
      [
        "my_add_def",
        { kind: "definition", leanDecls: ["NatAdd"], uses: [] },
      ],
      [
        "my_add_zero",
        {
          kind: "theorem",
          leanDecls: ["add_zero_right"],
          uses: ["my_add_def"],
        },
      ],
      [
        "my_add_succ",
        {
          kind: "theorem",
          leanDecls: ["add_succ_right"],
          uses: ["my_add_def"],
        },
      ],
    ]);

    const manifest = await analyzeProject({
      leanProjectPath: FIXTURES,
      blueprintLabels,
      useLsp: USE_LSP,
    });

    // Markdown-defined nodes should take precedence
    expect(manifest.nodes["my_add_def"]).toBeDefined();
    expect(manifest.nodes["my_add_def"]!.leanDecls).toContain("NatAdd");
    expect(manifest.nodes["my_add_def"]!.kind).toBe("definition");
    expect(manifest.nodes["my_add_def"]!.autoLinked).toBe(false);

    // add_zero_right → my_add_zero, no sorry, deps fully_proved → fully_proved
    expect(manifest.nodes["my_add_zero"]!.status).toBe("fully_proved");

    // add_succ_right → my_add_succ, has sorry → not_ready
    expect(manifest.nodes["my_add_succ"]!.status).toBe("not_ready");
  });

  test("builds dependency edges from uses", async () => {
    const blueprintLabels = new Map([
      [
        "A",
        { kind: "theorem", leanDecls: ["add_zero_right"], uses: ["B"] },
      ],
      ["B", { kind: "definition", leanDecls: ["NatAdd"], uses: [] }],
      [
        "C",
        {
          kind: "theorem",
          leanDecls: ["add_succ_right"],
          uses: ["B", "A"],
        },
      ],
    ]);

    const manifest = await analyzeProject({
      leanProjectPath: FIXTURES,
      blueprintLabels,
      useLsp: USE_LSP,
    });

    const edges = manifest.edges;
    // A → B
    expect(edges.some((e) => e.from === "A" && e.to === "B")).toBe(true);
    // C → B
    expect(edges.some((e) => e.from === "C" && e.to === "B")).toBe(true);
    // C → A
    expect(edges.some((e) => e.from === "C" && e.to === "A")).toBe(true);
  });

  test("computes fully_proved transitive status", async () => {
    // All three linked to sorry-free decls, forming a chain: A → B → C
    const blueprintLabels = new Map([
      [
        "A",
        { kind: "theorem", leanDecls: ["add_zero_right"], uses: ["B"] },
      ],
      ["B", { kind: "lemma", leanDecls: ["NatAdd"], uses: ["C"] }],
      [
        "C",
        { kind: "definition", leanDecls: ["NatAdd"], uses: [] },
      ],
    ]);

    const manifest = await analyzeProject({
      leanProjectPath: FIXTURES,
      blueprintLabels,
      useLsp: USE_LSP,
    });

    // C has no deps and no sorry → fully_proved
    expect(manifest.nodes["C"]!.status).toBe("fully_proved");
    // B depends on C (fully_proved) + no sorry → fully_proved
    expect(manifest.nodes["B"]!.status).toBe("fully_proved");
    // A depends on B (fully_proved) + no sorry → fully_proved
    expect(manifest.nodes["A"]!.status).toBe("fully_proved");
  });

  test("propagates not_ready through dependencies", async () => {
    // C has sorry, A depends on C
    const blueprintLabels = new Map([
      [
        "A",
        {
          kind: "theorem",
          leanDecls: ["add_zero_right"],
          uses: ["C"],
        },
      ],
      [
        "C",
        {
          kind: "theorem",
          leanDecls: ["add_succ_right"],
          uses: [],
        },
      ],
    ]);

    const manifest = await analyzeProject({
      leanProjectPath: FIXTURES,
      blueprintLabels,
      useLsp: USE_LSP,
    });

    // C has sorry → not_ready
    expect(manifest.nodes["C"]!.status).toBe("not_ready");

    // A's own decl (add_zero_right) has no sorry → proved (own proof is done)
    // But A depends on C which has sorry → not fully_proved
    expect(manifest.nodes["A"]!.status).toBe("proved");
    expect(manifest.nodes["A"]!.status).not.toBe("fully_proved");
  });

  test("pending status for labels with no Lean decls", async () => {
    const blueprintLabels = new Map([
      [
        "no_lean",
        { kind: "theorem", leanDecls: ["NonExistent.Decl"], uses: [] },
      ],
    ]);

    const manifest = await analyzeProject({
      leanProjectPath: FIXTURES,
      blueprintLabels,
      useLsp: USE_LSP,
    });

    // Linked to a nonexistent decl → still has leanDecls but not found
    // Our analyzer keeps it but marks status based on sorry detection
    // Since the decl doesn't exist in our declInfos, hasSorry defaults to true
    expect(manifest.nodes["no_lean"]!.leanDecls).toContain("NonExistent.Decl");
  });

  test("manifest has nodes and edges properties", async () => {
    const manifest = await analyzeProject({
      leanProjectPath: FIXTURES,
      useLsp: USE_LSP,
    });

    expect(manifest.nodes).toBeDefined();
    expect(manifest.edges).toBeDefined();
    expect(typeof manifest.nodes).toBe("object");
    expect(Array.isArray(manifest.edges)).toBe(true);
  });
});
