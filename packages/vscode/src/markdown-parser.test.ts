import { expect, test } from "bun:test";
import { parseMarkdownLean, isLineInLeanBlock } from "./markdown-parser.ts";

test("parses markdown with single lean block correctly", () => {
  const markdown = `# Title

Some text.

\`\`\`lean
def hello := "world"
#check hello
\`\`\`

More text.`;

  const { leanContent, blocks } = parseMarkdownLean(markdown);

  // Line mapping verification:
  // Original lines:
  // 0: # Title
  // 1: 
  // 2: Some text.
  // 3: 
  // 4: ```lean
  // 5: def hello := "world"
  // 6: #check hello
  // 7: ```
  // 8: 
  // 9: More text.

  const leanLines = leanContent.split("\n");
  expect(leanLines.length).toBe(10);
  expect(leanLines[0]).toBe("");
  expect(leanLines[1]).toBe("");
  expect(leanLines[2]).toBe("");
  expect(leanLines[3]).toBe("");
  expect(leanLines[4]).toBe("");
  expect(leanLines[5]).toBe("def hello := \"world\"");
  expect(leanLines[6]).toBe("#check hello");
  expect(leanLines[7]).toBe("");
  expect(leanLines[8]).toBe("");
  expect(leanLines[9]).toBe("");

  expect(blocks).toEqual([{ startLine: 5, endLine: 6 }]);
  expect(isLineInLeanBlock(5, blocks)).toBe(true);
  expect(isLineInLeanBlock(6, blocks)).toBe(true);
  expect(isLineInLeanBlock(4, blocks)).toBe(false);
  expect(isLineInLeanBlock(7, blocks)).toBe(false);
});

test("parses markdown with multiple lean blocks", () => {
  const markdown = `\`\`\`lean
def a := 1
\`\`\`
Middle.
\`\`\`lean
def b := 2
\`\`\``;

  const { leanContent, blocks } = parseMarkdownLean(markdown);
  const leanLines = leanContent.split("\n");

  expect(leanLines.length).toBe(7);
  expect(leanLines[0]).toBe("");
  expect(leanLines[1]).toBe("def a := 1");
  expect(leanLines[2]).toBe("");
  expect(leanLines[3]).toBe("");
  expect(leanLines[4]).toBe("");
  expect(leanLines[5]).toBe("def b := 2");
  expect(leanLines[6]).toBe("");

  expect(blocks).toEqual([
    { startLine: 1, endLine: 1 },
    { startLine: 5, endLine: 5 },
  ]);
});

test("parses nested code block inside blockquote correctly", () => {
  const markdown = `> A nested code block in a blockquote:
>
> \`\`\`lean
> def nestedHello (name : String) : String := "Nested " ++ name
> \`\`\``;

  const { leanContent, blocks } = parseMarkdownLean(markdown);
  const leanLines = leanContent.split("\n");

  expect(leanLines.length).toBe(5);
  expect(leanLines[0]).toBe("");
  expect(leanLines[1]).toBe("");
  expect(leanLines[2]).toBe("");
  expect(leanLines[3]).toBe("  def nestedHello (name : String) : String := \"Nested \" ++ name");
  expect(leanLines[4]).toBe("");

  expect(blocks).toEqual([{ startLine: 3, endLine: 3 }]);
});
