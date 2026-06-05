import { readFile } from "node:fs/promises";
import { remark } from "remark";
import remarkHtml from "remark-html";
import remarkLean from "remark-lean";

const markdown = await readFile("example.md", "utf8");
const html = await remark().use(remarkLean).use(remarkHtml).process(markdown);
console.log(String(html));
