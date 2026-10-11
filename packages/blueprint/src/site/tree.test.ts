import { describe, test, expect } from "bun:test";
import { htmlToTree } from "./tree.ts";

describe("htmlToTree", () => {
  test("keeps tags, attributes and text, including whitespace in pre", () => {
    expect(
      htmlToTree('<pre><code class="language-lean"><span class="lean-keyword" data-hover-id="h1">theorem</span> x :=\n  rfl &amp; &lt;b&gt;</code></pre>'),
    ).toEqual({
      tag: "pre",
      attrs: {},
      children: [
        {
          tag: "code",
          attrs: { class: "language-lean" },
          children: [
            { tag: "span", attrs: { class: "lean-keyword", "data-hover-id": "h1" }, children: ["theorem"] },
            " x :=\n  rfl & <b>",
          ],
        },
      ],
    });
  });

  test("keeps script content verbatim", () => {
    const json = '{"hovers":{"h1":"<b>x</b>"}}';
    expect(htmlToTree(`<script type="application/json">${json}</script>`)).toEqual({
      tag: "script",
      attrs: { type: "application/json" },
      children: [json],
    });
  });

  test("wraps several top-level nodes and drops whitespace between them", () => {
    const tree = htmlToTree("<pre>a</pre>\n<script>b</script>");
    expect(tree).toEqual({
      tag: "div",
      attrs: { class: "lean-block" },
      children: [
        { tag: "pre", attrs: {}, children: ["a"] },
        { tag: "script", attrs: {}, children: ["b"] },
      ],
    });
  });
});
