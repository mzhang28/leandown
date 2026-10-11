import fs from "node:fs";
import path from "node:path";
import { LeanLSPClient } from "@leandown/core";
import { parseLakefile } from "./lakefile.ts";
import type { DeclFacts, NodeStatus, StatusInput } from "./types.ts";

export type {
  DeclFacts,
  NodeStatus,
  ProofState,
  StatementState,
  StatusInput,
} from "./types.ts";

/** Lean can take a long time to build the project's imports on a cold run. */
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

/** A Lean name we're willing to splice into a command: no whitespace or comments. */
const DECL_NAME_RE = /^[^\s()\[\]{},;"`]+$/;

// ── Library roots ───────────────────────────────────────────────────────

/**
 * Module names to import so that the project's declarations are in scope:
 * the root module of every `lean_lib` in the lakefile.
 */
export function libraryRoots(leanProjectPath: string): string[] {
  const toml = path.join(leanProjectPath, "lakefile.toml");
  if (fs.existsSync(toml)) {
    return parseLakefile(toml).libs.flatMap((lib) => lib.roots ?? [lib.name]);
  }
  const lean = path.join(leanProjectPath, "lakefile.lean");
  if (fs.existsSync(lean)) {
    const roots: string[] = [];
    const src = fs.readFileSync(lean, "utf-8");
    // `lean_lib Foo` or `lean_lib «Foo» where …`; explicit `roots` aren't parsed.
    for (const m of src.matchAll(/^\s*lean_lib\s+«?([\w.']+)»?/gm)) {
      roots.push(m[1]!);
    }
    return roots;
  }
  return [];
}

// ── Probing Lean ────────────────────────────────────────────────────────

export interface ProbeOptions {
  /** Lean project directory (where `lake serve` runs). */
  leanProjectPath: string;
  /** Modules to import. Default: {@link libraryRoots}. */
  imports?: string[];
  /** Give up waiting for Lean after this long. Default: 10 minutes. */
  timeoutMs?: number;
  /** Override the server command, for tests. Default: `lake serve`. */
  command?: [string, ...string[]];
}

export interface ProbeResult {
  facts: Map<string, DeclFacts>;
  /** Names that couldn't be checked because they aren't valid Lean names. */
  invalid: string[];
}

/**
 * Ask Lean whether each name exists and whether it depends on `sorry`.
 *
 * Elaborates one file that imports the project's library roots and runs
 * `#print axioms` on every name. Lean reports `sorryAx` for a declaration
 * that uses `sorry` anywhere in its dependency closure, so "no sorry" here
 * means proved all the way down. Throws if the imports fail (for example,
 * a module has errors) or Lean times out.
 */
export async function probeDeclarations(
  names: Iterable<string>,
  options: ProbeOptions
): Promise<ProbeResult> {
  const unique = [...new Set(names)];
  const valid = unique.filter((n) => DECL_NAME_RE.test(n));
  const invalid = unique.filter((n) => !DECL_NAME_RE.test(n));
  const facts = new Map<string, DeclFacts>();
  if (valid.length === 0) return { facts, invalid };

  const imports = options.imports ?? libraryRoots(options.leanProjectPath);
  const header = imports.map((m) => `import ${m}`);
  const code = [...header, ...valid.map((n) => `#print axioms ${n}`)].join("\n") + "\n";

  const client = new LeanLSPClient(
    options.leanProjectPath,
    options.command ? { command: options.command } : {}
  );
  let result;
  try {
    result = await client.elaborate(code, {
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  } finally {
    await client.shutdown();
  }

  if (!result.compileComplete) {
    throw new Error("timed out waiting for Lean");
  }

  const importErrors = result.diagnostics.filter(
    (d) => d.severity === 1 && d.line < header.length
  );
  if (importErrors.length > 0) {
    // Lake's message is mostly build trace; the `error:` lines say what broke.
    const message = importErrors[0]!.message;
    const errorLines = message.split("\n").filter((l) => l.startsWith("error:"));
    const summary = errorLines.length > 0 ? errorLines.join("\n") : message;
    throw new Error(`importing ${imports.join(", ")} failed:\n${summary}`);
  }

  const byLine = new Map<number, { severity: number; message: string }[]>();
  for (const d of result.diagnostics) {
    const list = byLine.get(d.line) ?? [];
    list.push(d);
    byLine.set(d.line, list);
  }
  valid.forEach((name, i) => {
    const diags = byLine.get(header.length + i) ?? [];
    const failed = diags.length === 0 || diags.some((d) => d.severity === 1);
    facts.set(name, {
      exists: !failed,
      usesSorry: !failed && diags.some((d) => /\bsorryAx\b/.test(d.message)),
    });
  });
  return { facts, invalid };
}

// ── Status computation ──────────────────────────────────────────────────

/**
 * Compute leanblueprint-style statement and proof states for every node.
 *
 * A node is *stated* when it's marked `(mathlib)` or every linked Lean
 * declaration exists, and *proved* when it's stated, linked to Lean, and
 * none of its declarations depends on `sorry` (or it's marked `(mathlib)`).
 * Dependencies on unknown labels are ignored. Nodes on a dependency cycle
 * are never fully proved; `onCycle` is called once per cycle found.
 */
export function computeStatuses(
  nodes: StatusInput[],
  facts: Map<string, DeclFacts>,
  onCycle: (labels: string[]) => void = () => {}
): Map<string, NodeStatus> {
  const byLabel = new Map(nodes.map((n) => [n.label, n]));
  const depsOf = (n: StatusInput) =>
    n.uses.filter((u) => byLabel.has(u)).map((u) => byLabel.get(u)!);

  const stated = new Map<string, boolean>();
  const proved = new Map<string, boolean>();
  for (const n of nodes) {
    const linked = n.leanDecls.length > 0;
    const allExist = linked && n.leanDecls.every((d) => facts.get(d)?.exists);
    const noSorry = n.leanDecls.every((d) => !facts.get(d)?.usesSorry);
    stated.set(n.label, !!n.mathlib || allExist);
    proved.set(n.label, !!n.mathlib || (allExist && noSorry));
  }

  // Fully proved: proved, and every dependency fully proved. DFS with an
  // on-stack marker so a cycle resolves to false instead of looping.
  const fully = new Map<string, boolean>();
  const onStack: string[] = [];
  const visit = (n: StatusInput): boolean => {
    const known = fully.get(n.label);
    if (known !== undefined) return known;
    const at = onStack.indexOf(n.label);
    if (at !== -1) {
      onCycle(onStack.slice(at));
      return false;
    }
    onStack.push(n.label);
    let ok = proved.get(n.label)!;
    for (const d of depsOf(n)) ok = visit(d) && ok;
    onStack.pop();
    fully.set(n.label, ok);
    return ok;
  };
  for (const n of nodes) visit(n);

  const result = new Map<string, NodeStatus>();
  for (const n of nodes) {
    const deps = depsOf(n);
    const isStated = stated.get(n.label)!;
    const isProved = proved.get(n.label)!;
    const isFully = fully.get(n.label)!;
    const status: NodeStatus = {
      stated: isStated,
      proved: isProved,
      fullyProved: isFully,
      statement: n.mathlib
        ? "mathlib"
        : isStated
          ? "stated"
          : deps.every((d) => stated.get(d.label))
            ? "can_state"
            : "not_ready",
    };
    if (isFully) status.proof = "fully_proved";
    else if (isProved) status.proof = "proved";
    else if (isStated && deps.every((d) => proved.get(d.label))) status.proof = "can_prove";
    result.set(n.label, status);
  }
  return result;
}
