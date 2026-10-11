// Our typst.ts build adds `NodeCompiler.bundle()`, which compiles for Typst's
// bundle target (several documents and assets from one project). Stock
// typst.ts releases don't have it yet.
import type { CompileDocArgs, NodeError } from "@myriaddreamin/typst-ts-node-compiler";

declare module "@myriaddreamin/typst-ts-node-compiler" {
  interface NodeBundleFile {
    path: string;
    content: Buffer;
  }
  interface NodeBundleOutput {
    paths(): string[];
    files(): NodeBundleFile[];
  }
  interface NodeBundleExecResult {
    get result(): NodeBundleOutput | null;
    takeWarnings(): NodeError | null;
    takeError(): NodeError | null;
    hasError(): boolean;
    printErrors(): void;
    printDiagnostics(): void;
  }
  interface NodeCompiler {
    bundle?(opts: CompileDocArgs): NodeBundleExecResult;
  }
}

export {};
