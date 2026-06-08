export interface LeanBlock {
  /** 0-indexed start line of the Lean code (inclusive) */
  startLine: number;
  /** 0-indexed end line of the Lean code (inclusive) */
  endLine: number;
}

export interface ParseResult {
  /** The generated synthetic Lean code (with same line count and positions) */
  leanContent: string;
  /** List of parsed Lean blocks */
  blocks: LeanBlock[];
}

/**
 * Parses markdown content and returns the synthetic Lean file content
 * alongside the line ranges of all Lean code blocks.
 */
export function parseMarkdownLean(content: string): ParseResult {
  const lines = content.split(/\r?\n/);
  const outputLines: string[] = [];
  const blocks: LeanBlock[] = [];

  let inBlock = false;
  let blockStart = -1;
  let blockquotePrefix = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (!inBlock) {
      const match = line.match(/^([ \t]*>[ \t]*)/);
      const prefix = match ? match[0] : "";
      const cleanLine = prefix ? line.slice(prefix.length) : line;
      const trimmed = cleanLine.trim();

      if (trimmed.startsWith("```lean")) {
        inBlock = true;
        blockStart = i + 1;
        blockquotePrefix = prefix;
        outputLines.push(""); // Replace opening fence with empty line
      } else {
        outputLines.push(""); // Replace regular markdown with empty line
      }
    } else {
      let cleanLine = line;
      let hasPrefix = false;

      if (blockquotePrefix) {
        if (line.startsWith(blockquotePrefix)) {
          cleanLine = line.slice(blockquotePrefix.length);
          hasPrefix = true;
        } else {
          const trimmedPrefix = blockquotePrefix.trim();
          if (line.startsWith(trimmedPrefix)) {
            cleanLine = line.slice(trimmedPrefix.length);
            hasPrefix = true;
          }
        }
      }

      const trimmed = cleanLine.trim();
      if (trimmed.startsWith("```")) {
        inBlock = false;
        if (blockStart <= i - 1) {
          blocks.push({
            startLine: blockStart,
            endLine: i - 1,
          });
        }
        outputLines.push(""); // Replace closing fence with empty line
      } else {
        if (blockquotePrefix && hasPrefix) {
          const prefixLength = line.length - cleanLine.length;
          const spaces = " ".repeat(prefixLength);
          outputLines.push(spaces + cleanLine);
        } else {
          outputLines.push(line);
        }
      }
    }
  }

  // Handle case where file ends without closing fence
  if (inBlock && blockStart < lines.length) {
    blocks.push({
      startLine: blockStart,
      endLine: lines.length - 1,
    });
  }

  return {
    leanContent: outputLines.join("\n"),
    blocks,
  };
}

/**
 * Helper to check if a 0-indexed line number is inside any of the Lean blocks.
 */
export function isLineInLeanBlock(line: number, blocks: LeanBlock[]): boolean {
  for (const block of blocks) {
    if (line >= block.startLine && line <= block.endLine) {
      return true;
    }
  }
  return false;
}
