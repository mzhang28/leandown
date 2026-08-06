#!/usr/bin/env node
import * as fs from 'fs';
import MarkdownIt from 'markdown-it';
import { LeanHighlightProcessor, MarkdownBackend } from '@leandown/core';
import type { LeanHighlightOptions } from '@leandown/core';
import { resolveOptions, type PreprocessorContext } from './config.ts';

// Walk the book items recursively
async function processItem(item: any, processor: LeanHighlightProcessor) {
  if (item.Chapter) {
    const chapter = item.Chapter;
    // Each chapter is its own document: code blocks accumulate within a chapter
    // (so later blocks see earlier definitions) but never across chapters, which
    // would otherwise push a sub-chapter's `import` below the parent's code.
    processor.resetDocument();
    chapter.content = await processMarkdown(chapter.content, processor);
    if (chapter.sub_items) {
      for (const subItem of chapter.sub_items) {
        await processItem(subItem, processor);
      }
    }
  }
}

async function processMarkdown(content: string, processor: LeanHighlightProcessor): Promise<string> {
  // Matches ```lean ... ``` blocks
  const regex = /```lean\r?\n([\s\S]*?)\r?\n```/g;
  let result = "";
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const code = match[1];
    // Process the code block sequentially
    const html = await processor.processBlock(code);

    // Append content before the match and the processed HTML
    result += content.slice(lastIndex, match.index) + html;
    lastIndex = regex.lastIndex;
  }

  result += content.slice(lastIndex);
  return result;
}

async function main() {
  if (process.argv[2] === 'supports') {
    process.exit(0);
  }

  try {
    const input = fs.readFileSync(0, 'utf-8');
    const parsed = JSON.parse(input);

    // mdbook pipes `[context, book]`; a bare book object is also accepted so the
    // preprocessor can be exercised by hand (see examples/mdbook/test.json).
    let context: PreprocessorContext | null = null;
    let book: any;
    if (Array.isArray(parsed)) {
      context = parsed[0];
      book = parsed[1];
    } else {
      book = parsed;
    }

    // A bad `[preprocessor.leandown]` table is a book.toml mistake, not a bug:
    // report it as a plain message instead of a stack trace.
    let options: LeanHighlightOptions;
    try {
      options = resolveOptions(context);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    const md = new MarkdownIt();

    const processor = new LeanHighlightProcessor({
      ...options,
      backend: new MarkdownBackend(),
      compileMarkdown: (markdown) => md.render(markdown),
    });

    try {
      // Process all chapters
      const items = book.sections || book.items || [];
      for (const item of items) {
        await processItem(item, processor);
      }

      // Write the modified book JSON object to stdout
      process.stdout.write(JSON.stringify(book));
    } finally {
      // Always shut down the pooled Lean LSP child, even if processing threw —
      // otherwise the subprocess is left dangling on the error path.
      await processor.shutdown();
    }
  } catch (error) {
    console.error('Preprocessor error:', error);
    process.exit(1);
  }
}

main();
