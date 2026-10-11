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

/** Prefix of the info message `#blueprint_status` logs for each name. */
const STATUS_TAG = "blueprint-status ";

/**
 * Lean source for `#blueprint_status <name>`, which logs whether the name
 * exists, whether its own definition uses `sorry` (including auxiliary
 * declarations Lean split off from it, like `foo.proof_1`), and whether
 * `sorry` appears anywhere in its dependency closure. Keep it ASCII: Bun
 * escapes non-ASCII characters in template literals, which `String.raw`
 * would then pass through to Lean verbatim.
 */
const STATUS_COMMAND = String.raw`
open Lean in
private def blueprintIsAux (root c : Name) : Bool :=
  c != root && root.isPrefixOf c &&
    (c.isInternal || match c with
      | .str _ s => s.startsWith "proof_" || s.startsWith "match_" || s.startsWith "eq_"
      | _ => false)

open Lean in
private def blueprintOwnSorry (env : Environment) (root : Name) : Bool := Id.run do
  let mut todo := #[root]
  let mut seen : NameSet := {}
  while !todo.isEmpty do
    let n := todo.back!
    todo := todo.pop
    if seen.contains n then continue
    seen := seen.insert n
    let some ci := env.find? n | continue
    let value? := match ci with
      | .thmInfo v => some v.value
      | .defnInfo v => some v.value
      | .opaqueInfo v => some v.value
      | _ => none
    for e in ci.type :: value?.toList do
      if e.hasSorry then return true
      for c in e.getUsedConstants do
        if blueprintIsAux root c then todo := todo.push c
  return false

open Lean Elab Command in
elab "#blueprint_status " id:ident : command => do
  let n? <- try some <$> liftCoreM (realizeGlobalConstNoOverload id) catch _ => pure none
  match n? with
  | none => logInfo m!"${STATUS_TAG}{Json.compress (Json.mkObj [("exists", false)])}"
  | some n =>
    let axioms <- liftCoreM (collectAxioms n)
    let own := blueprintOwnSorry (<- getEnv) n
    logInfo m!"${STATUS_TAG}{Json.compress (Json.mkObj [("exists", true), ("ownSorry", own), ("usesSorry", axioms.contains ${"``"}sorryAx)])}"
`;

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
 * Ask Lean whether each name exists, whether its own definition uses
 * `sorry`, and whether `sorry` appears anywhere it depends on.
 *
 * Elaborates one file that imports the project's library roots and runs
 * `#blueprint_status` (see {@link STATUS_COMMAND}) on every name. Throws if
 * the imports fail (for example, a module has errors) or Lean times out.
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
  const header = [...imports, "Lean"].map((m) => `import ${m}`);
  const preamble = STATUS_COMMAND.split("\n");
  const first = header.length + preamble.length;
  const code =
    [...header, ...preamble, ...valid.map((n) => `#blueprint_status ${n}`)].join("\n") + "\n";

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
  // An error in our own command means this Lean can't run it; say so
  // rather than reporting every name as missing.
  const commandError = result.diagnostics.find(
    (d) => d.severity === 1 && d.line >= header.length && d.line < first
  );
  if (commandError) {
    throw new Error(`Lean rejected the status command: ${commandError.message}`);
  }

  valid.forEach((name, i) => {
    const status = (byLine.get(first + i) ?? []).find((d) => d.message.startsWith(STATUS_TAG));
    const parsed = status ? JSON.parse(status.message.slice(STATUS_TAG.length)) : {};
    facts.set(name, {
      exists: parsed.exists === true,
      ownSorry: parsed.ownSorry === true,
      usesSorry: parsed.usesSorry === true,
    });
  });
  return { facts, invalid };
}

// ── Status computation ──────────────────────────────────────────────────

/**
 * Compute statement and proof states for every node.
 *
 * A node is *stated* when it's marked `(mathlib)` or every linked Lean
 * declaration exists. Its own proof is *done* when it's stated and none of
 * its declarations uses `sorry` directly; `sorry` further down the
 * dependency closure doesn't count against it, but is shown separately.
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
  const sorryFree = new Map<string, boolean>();
  for (const n of nodes) {
    const linked = n.leanDecls.length > 0;
    const declFacts = n.leanDecls.map((d) => facts.get(d));
    const allExist = linked && declFacts.every((f) => f?.exists);
    stated.set(n.label, !!n.mathlib || allExist);
    proved.set(n.label, !!n.mathlib || (allExist && declFacts.every((f) => !f!.ownSorry)));
    sorryFree.set(n.label, !!n.mathlib || (allExist && declFacts.every((f) => !f!.usesSorry)));
  }

  // Fully proved: sorry-free, and every dependency fully proved. DFS with
  // an on-stack marker so a cycle resolves to false instead of looping.
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
    let ok = sorryFree.get(n.label)!;
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
    const isSorryFree = sorryFree.get(n.label)!;
    const isFully = fully.get(n.label)!;
    const status: NodeStatus = {
      stated: isStated,
      proved: isProved,
      sorryFree: isSorryFree,
      fullyProved: isFully,
      statement: n.mathlib
        ? "mathlib"
        : isStated
          ? "stated"
          : deps.every((d) => stated.get(d.label))
            ? "can_state"
            : "not_ready",
    };
    if (isStated) {
      if (isFully) status.proof = "fully_proved";
      else if (isProved && isSorryFree) status.proof = "proved";
      else if (isProved) status.proof = "sorry_in_deps";
      else if (deps.every((d) => proved.get(d.label))) status.proof = "can_prove";
      else status.proof = "has_sorry";
    }
    result.set(n.label, status);
  }
  return result;
}
