import * as fs from 'fs';
import * as path from 'path';
import type { LeanHighlightOptions } from '@leandown/core';

/**
 * The first element of the JSON array mdbook pipes to a preprocessor. Only the
 * fields this preprocessor reads are modelled.
 */
export interface PreprocessorContext {
  /** Absolute path to the book's root directory (the one holding book.toml). */
  root?: string;
  config?: {
    preprocessor?: Record<string, Record<string, unknown>>;
  };
}

/** Reads a key from the `[preprocessor.leandown]` table, accepting kebab- or camelCase. */
function readOption(
  config: Record<string, unknown>,
  kebabKey: string,
  camelKey: string
): unknown {
  const value = config[kebabKey] ?? config[camelKey];
  return value === null ? undefined : value;
}

function readStringOption(
  config: Record<string, unknown>,
  kebabKey: string,
  camelKey: string
): string | undefined {
  const value = readOption(config, kebabKey, camelKey);
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(
      `leandown: [preprocessor.leandown] ${kebabKey} must be a string, got ${JSON.stringify(value)}`
    );
  }
  return value;
}

function readBooleanOption(
  config: Record<string, unknown>,
  kebabKey: string,
  camelKey: string
): boolean | undefined {
  const value = readOption(config, kebabKey, camelKey);
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(
    `leandown: [preprocessor.leandown] ${kebabKey} must be a boolean, got ${JSON.stringify(value)}`
  );
}

/**
 * Resolves a configured Lean project directory and checks that it looks usable.
 *
 * The path is resolved against the book root, so `lean-project-path = "lean"` in
 * book.toml means "the `lean` directory next to book.toml" regardless of which
 * directory mdbook was invoked from.
 */
function resolveLeanProjectPath(configured: string, bookRoot: string): string {
  const projectPath = path.resolve(bookRoot, configured);

  const hasLakefile = ['lakefile.toml', 'lakefile.lean'].some((name) =>
    fs.existsSync(path.join(projectPath, name))
  );
  if (!hasLakefile) {
    throw new Error(
      `leandown: lean-project-path "${configured}" resolved to ${projectPath}, ` +
        'which contains no lakefile.toml or lakefile.lean. Point it at a Lean 4 ' +
        'package directory (relative paths are resolved from the book root).'
    );
  }

  // Imports only resolve against build artifacts, so an unbuilt project turns
  // every `import` in the book into an unhelpful "unknown module" error. Warn
  // rather than fail: a book may legitimately contain only self-contained
  // blocks that need no imports.
  if (!fs.existsSync(path.join(projectPath, '.lake'))) {
    console.error(
      `leandown: ${projectPath} has not been built (no .lake directory). ` +
        'Run `lake build` there so `import`s in Lean code blocks resolve.'
    );
  }

  return projectPath;
}

/**
 * Translates the `[preprocessor.leandown]` table from book.toml into core
 * highlighting options. Without `lean-project-path`, core falls back to a
 * throwaway scratch project that can only compile import-free snippets.
 */
export function resolveOptions(context: PreprocessorContext | null): LeanHighlightOptions {
  const config = context?.config?.preprocessor?.leandown ?? {};
  const bookRoot = context?.root ?? process.cwd();

  const options: LeanHighlightOptions = {};

  const leanProjectPath = readStringOption(config, 'lean-project-path', 'leanProjectPath');
  if (leanProjectPath !== undefined) {
    options.leanProjectPath = resolveLeanProjectPath(leanProjectPath, bookRoot);
  }

  const synchronizedHovers = readBooleanOption(config, 'synchronized-hovers', 'synchronizedHovers');
  if (synchronizedHovers !== undefined) {
    options.synchronizedHovers = synchronizedHovers;
  }

  const cacheDir = readStringOption(config, 'cache-dir', 'cacheDir');
  if (cacheDir !== undefined) {
    options.cacheDir = path.resolve(bookRoot, cacheDir);
  }

  return options;
}
