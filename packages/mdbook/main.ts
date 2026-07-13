#!/usr/bin/env node
import * as fs from 'fs';
import MarkdownIt from 'markdown-it';
import { LeanHighlightProcessor, MarkdownBackend } from '@leandown/core';

// Walk the book items recursively
async function processItem(item: any, processor: LeanHighlightProcessor) {
  if (item.Chapter) {
    const chapter = item.Chapter;
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

    let book: any;
    if (Array.isArray(parsed)) {
      book = parsed[1];
    } else {
      book = parsed;
    }

    const md = new MarkdownIt();

    const processor = new LeanHighlightProcessor({
      backend: new MarkdownBackend(),
      compileMarkdown: (markdown) => md.render(markdown),
    });

    // Process all chapters
    const items = book.sections || book.items || [];
    for (const item of items) {
      processor.resetDocument();
      await processItem(item, processor);
    }

    // Make sure we shut down the processor LSP client properly
    await processor.shutdown();

    // Write the modified book JSON object to stdout
    process.stdout.write(JSON.stringify(book));
  } catch (error) {
    console.error('Preprocessor error:', error);
    process.exit(1);
  }
}

main();
