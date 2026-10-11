import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { computeStatuses, libraryRoots, probeDeclarations } from "./analyzer.ts";
import type { DeclFacts, StatusInput } from "./types.ts";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const FIXTURES = path.join(import.meta.dirname, "__fixtures__", "test-project");

function facts(entries: Record<string, Partial<DeclFacts>>): Map<string, DeclFacts> {
  return new Map(
    Object.entries(entries).map(([k, v]) => [k, { exists: true, usesSorry: false, ...v }])
  );
}

function node(label: string, leanDecls: string[] = [], uses: string[] = [], mathlib = false): StatusInput {
  return { label, leanDecls, uses, mathlib };
}

describe("computeStatuses", () => {
  test("proved leaf is fully proved", () => {
    const s = computeStatuses([node("a", ["A"])], facts({ A: {} })).get("a")!;
    expect(s).toEqual({ stated: true, proved: true, fullyProved: true, statement: "stated", proof: "fully_proved" });
  });

  test("sorry makes a node stated but not proved", () => {
    const s = computeStatuses([node("a", ["A"])], facts({ A: { usesSorry: true } })).get("a")!;
    expect(s.statement).toBe("stated");
    expect(s.proof).toBe("can_prove");
    expect(s.proved).toBe(false);
  });

  test("missing declaration is not stated", () => {
    const s = computeStatuses([node("a", ["A", "B"])], facts({ A: {}, B: { exists: false } })).get("a")!;
    expect(s.stated).toBe(false);
    expect(s.statement).toBe("can_state");
    expect(s.proof).toBeUndefined();
  });

  test("unlinked node: can_state iff all deps are stated", () => {
    const f = facts({ A: {}, B: { exists: false } });
    const st = computeStatuses(
      [node("a", ["A"]), node("b", ["B"]), node("x", [], ["a"]), node("y", [], ["a", "b"])],
      f
    );
    expect(st.get("x")!.statement).toBe("can_state");
    expect(st.get("y")!.statement).toBe("not_ready");
    expect(st.get("x")!.proof).toBeUndefined();
  });

  test("can_prove needs every dependency proved", () => {
    const f = facts({ A: {}, B: { usesSorry: true }, C: { usesSorry: true }, D: { usesSorry: true } });
    const st = computeStatuses(
      [node("a", ["A"]), node("b", ["B"]), node("c", ["C"], ["a"]), node("d", ["D"], ["b"])],
      f
    );
    expect(st.get("c")!.proof).toBe("can_prove");
    expect(st.get("d")!.proof).toBeUndefined();
  });

  test("proved node with an unproved dependency is proved, not fully", () => {
    const st = computeStatuses(
      [node("a", ["A"]), node("b", ["B"], ["a"])],
      facts({ A: { usesSorry: true }, B: {} })
    );
    expect(st.get("b")!.proof).toBe("proved");
    expect(st.get("b")!.fullyProved).toBe(false);
  });

  test("fully proved propagates through a chain", () => {
    const st = computeStatuses(
      [node("c", ["C"], ["b"]), node("b", ["B"], ["a"]), node("a", ["A"])],
      facts({ A: {}, B: {}, C: {} })
    );
    expect([...st.values()].every((s) => s.proof === "fully_proved")).toBe(true);
  });

  test("mathlib nodes count as stated and proved without Lean", () => {
    const st = computeStatuses([node("m", [], [], true), node("x", ["X"], ["m"])], facts({ X: {} }));
    expect(st.get("m")!.statement).toBe("mathlib");
    expect(st.get("x")!.proof).toBe("fully_proved");
  });

  test("a cycle is never fully proved and is reported", () => {
    const cycles: string[][] = [];
    const st = computeStatuses(
      [node("a", ["A"], ["b"]), node("b", ["B"], ["a"])],
      facts({ A: {}, B: {} }),
      (c) => cycles.push(c)
    );
    expect(st.get("a")!.fullyProved).toBe(false);
    expect(st.get("b")!.fullyProved).toBe(false);
    expect(st.get("a")!.proof).toBe("proved");
    expect(cycles).toEqual([["a", "b"]]);
  });

  test("unknown dependency labels are ignored", () => {
    const s = computeStatuses([node("a", ["A"], ["ghost"])], facts({ A: {} })).get("a")!;
    expect(s.proof).toBe("fully_proved");
  });
});

describe("libraryRoots", () => {
  test("reads lean_lib names from lakefile.toml", () => {
    expect(libraryRoots(FIXTURES)).toEqual(["TestProject"]);
  });

  test("honours explicit roots and lakefile.lean", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blueprint-roots-"));
    try {
      fs.writeFileSync(
        path.join(dir, "lakefile.toml"),
        'name = "X"\n[[lean_lib]]\nname = "A"\nroots = ["A.One", "A.Two"]\n[[lean_lib]]\nname = "B"\n'
      );
      expect(libraryRoots(dir)).toEqual(["A.One", "A.Two", "B"]);
      fs.rmSync(path.join(dir, "lakefile.toml"));
      fs.writeFileSync(
        path.join(dir, "lakefile.lean"),
        "import Lake\nopen Lake DSL\npackage x\nlean_lib «Foo» where\n  srcDir := \".\"\nlean_lib Bar\n"
      );
      expect(libraryRoots(dir)).toEqual(["Foo", "Bar"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

const lake = Bun.which("lake");

describe.skipIf(!lake)("probeDeclarations (real Lean)", () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "blueprint-probe-"));
    fs.cpSync(FIXTURES, dir, { recursive: true });
  });
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("reports existence and sorry, including namespaces and indirect sorry", async () => {
    const { facts, invalid } = await probeDeclarations(
      [
        "NatAdd",
        "Demo.double",
        "Demo.double_zero",
        "double_zero",
        "add_succ_right",
        "add_succ_twice",
        "Nat.add_zero",
        "bad name",
      ],
      { leanProjectPath: dir }
    );
    expect(invalid).toEqual(["bad name"]);
    expect(Object.fromEntries(facts)).toEqual({
      NatAdd: { exists: true, usesSorry: false },
      "Demo.double": { exists: true, usesSorry: false },
      "Demo.double_zero": { exists: true, usesSorry: false },
      double_zero: { exists: false, usesSorry: false },
      add_succ_right: { exists: true, usesSorry: true },
      add_succ_twice: { exists: true, usesSorry: true },
      "Nat.add_zero": { exists: true, usesSorry: false },
    });
  }, 300_000);

  test("throws with Lean's error when a module fails to build", async () => {
    const broken = fs.mkdtempSync(path.join(os.tmpdir(), "blueprint-probe-broken-"));
    try {
      fs.cpSync(FIXTURES, broken, { recursive: true });
      fs.appendFileSync(path.join(broken, "TestProject", "Basic.lean"), "\ntheorem broken : 1 = 2 := rfl\n");
      await expect(probeDeclarations(["NatAdd"], { leanProjectPath: broken })).rejects.toThrow(
        /importing TestProject failed:\nerror: TestProject\/Basic\.lean/
      );
    } finally {
      fs.rmSync(broken, { recursive: true, force: true });
    }
  }, 300_000);
});
