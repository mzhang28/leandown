export interface Diagnostic {
  package: string;
  path: string;
  /** `startLine:startCol-endLine:endCol`, 0-based, or empty. */
  range: string;
  severity: "error" | "warning" | string;
  message: string;
}

export interface BundleFile {
  /** Path within the bundle, without a leading slash. */
  path: string;
  content: Buffer;
}

export interface BundleResult {
  hasError: boolean;
  diagnostics: Diagnostic[];
  /** The emitted files; empty when there are errors. */
  files: BundleFile[];
}

export interface BundleCompiler {
  /** Compiles `entry` for Typst's bundle target, with `root` as the project root. */
  bundle(options: { root: string; entry: string; inputs?: Record<string, string> }): BundleResult;
  /** Forgets cached file contents; call before recompiling after edits. */
  reset(): void;
}

export interface CreateCompilerOptions {
  /** Font files or directories to load. HTML output mostly doesn't need fonts. */
  fontPaths?: string[];
}

export function createCompiler(options?: CreateCompilerOptions): Promise<BundleCompiler>;
