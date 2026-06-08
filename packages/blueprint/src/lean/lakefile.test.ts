import { describe, test, expect } from "bun:test";
import { parseLakefile, findLeanSources } from "./lakefile.ts";
import path from "node:path";

const FIXTURES = path.join(import.meta.dirname, "__fixtures__", "test-project");

describe("parseLakefile", () => {
  test("parses name", () => {
    const config = parseLakefile(path.join(FIXTURES, "lakefile.toml"));
    expect(config.name).toBe("TestProject");
  });

  test("parses version", () => {
    const config = parseLakefile(path.join(FIXTURES, "lakefile.toml"));
    expect(config.version).toBe("0.1.0");
  });

  test("parses defaultTargets", () => {
    const config = parseLakefile(path.join(FIXTURES, "lakefile.toml"));
    expect(config.defaultTargets).toEqual(["TestProject"]);
  });

  test("parses lean_lib entries", () => {
    const config = parseLakefile(path.join(FIXTURES, "lakefile.toml"));
    expect(config.libs.length).toBe(1);
    expect(config.libs[0]!.name).toBe("TestProject");
  });

  test("parses lakefile with multiple libs", () => {
    const tmpDir = path.join(FIXTURES, "../tmp-libs");
    const tmpPath = path.join(tmpDir, "lakefile.toml");
    try {
      require("fs").mkdirSync(tmpDir, { recursive: true });
      require("fs").writeFileSync(
        tmpPath,
        `name = "Multi"\n\n[[lean_lib]]\nname = "LibA"\n\n[[lean_lib]]\nname = "LibB"\n\n[[lean_exe]]\nname = "exe"\nroot = "Main"\n`
      );
      const config = parseLakefile(tmpPath);
      expect(config.libs.length).toBe(2);
      expect(config.libs[0]!.name).toBe("LibA");
      expect(config.libs[1]!.name).toBe("LibB");
      expect(config.exes.length).toBe(1);
      expect(config.exes[0]!.name).toBe("exe");
      expect(config.exes[0]!.root).toBe("Main");
    } finally {
      require("fs").rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("parses defaultTargets as array", () => {
    const tmpDir = path.join(FIXTURES, "../tmp-arr");
    const tmpPath = path.join(tmpDir, "lakefile.toml");
    try {
      require("fs").mkdirSync(tmpDir, { recursive: true });
      require("fs").writeFileSync(
        tmpPath,
        `name = "Arr"\ndefaultTargets = ["a", "b", "c"]\n`
      );
      const config = parseLakefile(tmpPath);
      expect(config.defaultTargets).toEqual(["a", "b", "c"]);
    } finally {
      require("fs").rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("handles comments and blank lines", () => {
    const tmpDir = path.join(FIXTURES, "../tmp-comments");
    const tmpPath = path.join(tmpDir, "lakefile.toml");
    try {
      require("fs").mkdirSync(tmpDir, { recursive: true });
      require("fs").writeFileSync(
        tmpPath,
        `# This is a comment\nname = "CommentTest"\n\n# Another comment\n[[lean_lib]]\nname = "Lib"\n`
      );
      const config = parseLakefile(tmpPath);
      expect(config.name).toBe("CommentTest");
      expect(config.libs.length).toBe(1);
    } finally {
      require("fs").rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("findLeanSources", () => {
  test("finds .lean files recursively", () => {
    const sources = findLeanSources(FIXTURES);
    // Should find TestProject.lean and the module files
    expect(sources.length).toBeGreaterThanOrEqual(3);

    // All paths should end with .lean
    for (const src of sources) {
      expect(src.endsWith(".lean")).toBe(true);
    }

    // Should include the root module
    const rootMod = sources.find((s) => s.endsWith("TestProject.lean"));
    expect(rootMod).toBeDefined();

    // Should include Basic.lean
    const basicMod = sources.find((s) => s.endsWith("Basic.lean"));
    expect(basicMod).toBeDefined();

    // Should include WithSorry.lean
    const sorryMod = sources.find((s) => s.endsWith("WithSorry.lean"));
    expect(sorryMod).toBeDefined();
  });

  test("excludes hidden directories and build artifacts", () => {
    const sources = findLeanSources(FIXTURES);
    // No files from .lake, _build, etc.
    for (const src of sources) {
      expect(src.includes(".lake")).toBe(false);
      expect(src.includes("_build")).toBe(false);
      expect(src.includes(".git")).toBe(false);
    }
  });

  test("returns empty array for non-existent path", () => {
    const sources = findLeanSources("/nonexistent/path/12345");
    expect(sources).toEqual([]);
  });
});
