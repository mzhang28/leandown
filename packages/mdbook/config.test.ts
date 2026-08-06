import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveOptions, type PreprocessorContext } from "./config.ts";

/** A Lean project directory that passes the lakefile check, plus its book root. */
function makeBook(options: { built?: boolean } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "leandown-mdbook-test-"));
  const leanDir = path.join(root, "lean");
  fs.mkdirSync(leanDir);
  fs.writeFileSync(path.join(leanDir, "lakefile.toml"), 'name = "demo"\n');
  if (options.built) {
    fs.mkdirSync(path.join(leanDir, ".lake"));
  }
  return { root, leanDir };
}

function context(
  leandown: Record<string, unknown>,
  root?: string
): PreprocessorContext {
  return { root, config: { preprocessor: { leandown } } };
}

describe("resolveOptions", () => {
  test("falls back to core's scratch project when unconfigured", () => {
    expect(resolveOptions(null)).toEqual({});
    expect(resolveOptions({ root: "/somewhere", config: {} })).toEqual({});
  });

  test("resolves lean-project-path against the book root", () => {
    const { root, leanDir } = makeBook({ built: true });
    expect(resolveOptions(context({ "lean-project-path": "lean" }, root))).toEqual({
      leanProjectPath: leanDir,
    });
  });

  test("accepts camelCase keys too", () => {
    const { root, leanDir } = makeBook({ built: true });
    expect(resolveOptions(context({ leanProjectPath: "lean" }, root))).toEqual({
      leanProjectPath: leanDir,
    });
  });

  test("keeps absolute lean-project-path as given", () => {
    const { root, leanDir } = makeBook({ built: true });
    expect(
      resolveOptions(context({ "lean-project-path": leanDir }, root))
    ).toEqual({ leanProjectPath: leanDir });
  });

  test("rejects a path with no lakefile", () => {
    const { root } = makeBook();
    expect(() => resolveOptions(context({ "lean-project-path": "nope" }, root))).toThrow(
      /no lakefile\.toml or lakefile\.lean/
    );
  });

  test("warns but succeeds when the project has not been built", () => {
    const { root, leanDir } = makeBook();
    const warnings: string[] = [];
    const originalError = console.error;
    console.error = (message: string) => warnings.push(message);
    try {
      expect(resolveOptions(context({ "lean-project-path": "lean" }, root))).toEqual({
        leanProjectPath: leanDir,
      });
    } finally {
      console.error = originalError;
    }
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("lake build");
  });

  test("passes through synchronized-hovers and cache-dir", () => {
    const { root } = makeBook({ built: true });
    expect(
      resolveOptions(
        context(
          {
            "lean-project-path": "lean",
            "synchronized-hovers": false,
            "cache-dir": ".leandown-cache",
          },
          root
        )
      )
    ).toMatchObject({
      synchronizedHovers: false,
      cacheDir: path.join(root, ".leandown-cache"),
    });
  });

  test("accepts stringly-typed booleans", () => {
    expect(resolveOptions(context({ "synchronized-hovers": "false" }))).toEqual({
      synchronizedHovers: false,
    });
    expect(resolveOptions(context({ "synchronized-hovers": "true" }))).toEqual({
      synchronizedHovers: true,
    });
  });

  test("rejects options of the wrong type", () => {
    expect(() => resolveOptions(context({ "lean-project-path": 42 }))).toThrow(
      /must be a string/
    );
    expect(() => resolveOptions(context({ "synchronized-hovers": "yes" }))).toThrow(
      /must be a boolean/
    );
  });

  test("ignores explicit nulls", () => {
    expect(
      resolveOptions(context({ "lean-project-path": null, "synchronized-hovers": null }))
    ).toEqual({});
  });
});
