import { parseFragment } from "parse5";

/** An HTML element or text, in the shape the Typst library's `_render` takes. */
export type TreeNode = string | { tag: string; attrs: Record<string, string>; children: TreeNode[] };

interface Parse5Node {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: Parse5Node[];
  content?: Parse5Node;
}

function convert(node: Parse5Node): TreeNode | null {
  if (node.nodeName === "#text") return node.value ?? "";
  if (!node.tagName) return null; // comments, doctype
  const children = (node.content ?? node).childNodes ?? [];
  return {
    tag: node.tagName,
    attrs: Object.fromEntries((node.attrs ?? []).map((a) => [a.name, a.value])),
    children: children.map(convert).filter((c): c is TreeNode => c !== null),
  };
}

/**
 * Parse an HTML fragment (leandown's highlighted output) into a tree that
 * Typst can rebuild with `html.elem`. A fragment with several top-level
 * nodes is wrapped in a `div`.
 */
export function htmlToTree(html: string): TreeNode {
  const nodes = (parseFragment(html) as Parse5Node).childNodes ?? [];
  const children = nodes
    .map(convert)
    .filter((c): c is TreeNode => c !== null && !(typeof c === "string" && c.trim() === ""));
  if (children.length === 1) return children[0]!;
  return { tag: "div", attrs: { class: "lean-block" }, children };
}
