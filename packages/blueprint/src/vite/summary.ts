import { remark } from "remark";
import path from "node:path";
import type { List, ListItem, Paragraph, Link, Text } from "mdast";

export interface SummaryEntry {
  title: string;
  /** Hash route key, e.g. "index" — used as `location.hash` value. */
  route: string;
  /** Path matching import.meta.glob keys, e.g. "./index.md". */
  srcPath: string;
  children?: SummaryEntry[];
}

function linkText(link: Link): string {
  return link.children
    .filter((n): n is Text => n.type === "text")
    .map((n) => n.value)
    .join("");
}

function parseItems(items: ListItem[]): SummaryEntry[] {
  const result: SummaryEntry[] = [];
  for (const item of items) {
    const para = item.children.find((c): c is Paragraph => c.type === "paragraph");
    if (!para) continue;
    const link = para.children.find((c): c is Link => c.type === "link");
    if (!link) continue;

    const href = link.url;
    const route = path.basename(href, ".md");
    const srcPath = href.startsWith("./") ? href : "./" + href;

    const entry: SummaryEntry = { title: linkText(link), route, srcPath };

    const subList = item.children.find((c): c is List => c.type === "list");
    if (subList) entry.children = parseItems(subList.children);

    result.push(entry);
  }
  return result;
}

export function parseSummary(content: string): SummaryEntry[] {
  const tree = remark().parse(content);
  const list = tree.children.find((c): c is List => c.type === "list");
  if (!list) return [];
  return parseItems(list.children);
}
