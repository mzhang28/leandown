import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initCommand, findLakeProject, mergeGitignore, mergePackageJson } from "./init.ts";

let dir: string;
const quiet = console.log;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "blueprint-init-"));
  console.log = () => {};
});
afterEach(() => {
  console.log = quiet;
  fs.rmSync(dir, { recursive: true, force: true });
});

const read = (rel: string) => fs.readFileSync(path.join(dir, rel), "utf-8");

describe("findLakeProject", () => {
  test("finds a lakefile in the directory or above", () => {
    fs.writeFileSync(path.join(dir, "lakefile.toml"), "");
    fs.mkdirSync(path.join(dir, "blueprint"));
    expect(findLakeProject(dir)).toBe(dir);
    expect(findLakeProject(path.join(dir, "blueprint"))).toBe(dir);
  });
});

describe("mergeGitignore", () => {
  test("appends only missing entries", () => {
    expect(mergeGitignore("/.lake\nnode_modules", ["node_modules/", "dist/"])).toBe("/.lake\nnode_modules\ndist/\n");
    expect(mergeGitignore("dist/\n", ["dist/"])).toBe("dist/\n");
    expect(mergeGitignore("", ["dist/"])).toBe("dist/\n");
  });
});

describe("mergePackageJson", () => {
  test("keeps existing scripts and dependencies", () => {
    const pkg = mergePackageJson({ scripts: { build: "lake build" }, dependencies: { x: "1" } }, "0.0.22");
    expect(pkg.scripts).toEqual({ build: "lake build", dev: "blueprint serve", "blueprint:build": "blueprint build" });
    expect(pkg.dependencies).toEqual({ x: "1", "@leandown/blueprint": "^0.0.22" });
  });

  test("is idempotent", () => {
    const once = mergePackageJson({}, "0.0.22");
    expect(mergePackageJson(once, "0.0.23")).toEqual(once);
  });
});

describe("initCommand", () => {
  test("inside a Lean project, configures it and keeps existing files", async () => {
    fs.writeFileSync(path.join(dir, "lakefile.toml"), 'name = "Foo"\n');
    fs.writeFileSync(path.join(dir, ".gitignore"), "/.lake\n");
    fs.writeFileSync(path.join(dir, "main.typ"), "mine\n");
    await initCommand({ dir, version: "0.0.22" });

    expect(JSON.parse(read("blueprint.json")).leanProjectPath).toBe(".");
    expect(read(".gitignore")).toBe("/.lake\nnode_modules/\ndist/\n.blueprint/\n");
    expect(read("main.typ")).toBe("mine\n");
    expect(fs.existsSync(path.join(dir, "chapters/intro.typ"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "lean"))).toBe(false);
  });

  test("in a subdirectory of a Lean project, points at the parent", async () => {
    fs.writeFileSync(path.join(dir, "lakefile.lean"), "");
    const sub = path.join(dir, "blueprint");
    await initCommand({ dir: sub, version: "0.0.22" });
    expect(JSON.parse(fs.readFileSync(path.join(sub, "blueprint.json"), "utf-8")).leanProjectPath).toBe("..");
  });

  test("outside a Lean project, scaffolds lean/", async () => {
    await initCommand({ dir: path.join(dir, "new"), version: "0.0.22" });
    expect(JSON.parse(read("new/blueprint.json")).leanProjectPath).toBe("./lean");
    expect(fs.existsSync(path.join(dir, "new/lean/.gitkeep"))).toBe(true);
  });
});
