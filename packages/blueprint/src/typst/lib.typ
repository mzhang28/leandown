// leandown blueprint: Typst library.
//
// The blueprint CLI copies this file to `.blueprint/lib.typ` and writes
// `.blueprint/data.json` (highlighted Lean blocks and node statuses) before
// compiling. Import it with `#import "/.blueprint/lib.typ": *`.

#let _data = json("/.blueprint/data.json")
#let _lean = _data.at("lean", default: (:))
#let _status = _data.at("status", default: (:))

#let _kinds = (
  definition: "Definition",
  theorem: "Theorem",
  lemma: "Lemma",
  proposition: "Proposition",
  corollary: "Corollary",
  example: "Example",
  conjecture: "Conjecture",
  remark: "Remark",
  note: "Note",
)

// Accepts `"a, b"` or `("a", "b")`.
#let _list(v) = if v == none { () } else if type(v) == str {
  v.split(",").map(str.trim).filter(s => s != "")
} else { v }

// Rebuilds an element tree that the CLI produced from leandown's HTML output.
#let _render(n) = if type(n) == str { n } else {
  html.elem(n.tag, attrs: n.attrs, n.children.map(_render).join())
}

#let _node(kind, name, lean: none, uses: (), mathlib: false, body) = {
  let decls = _list(lean)
  let uses = _list(uses)
  let status = _status.at(name, default: none)
  let classes = ("blueprint-node", "blueprint-node--" + kind)
  if status != none {
    classes.push("bp-statement--" + status.statement)
    if "proof" in status { classes.push("bp-proof--" + status.proof) }
  }
  let chips = ()
  if decls.len() > 0 {
    chips.push(html.elem("a", attrs: (
      class: "blueprint-chip blueprint-chip--lean",
      href: "docs/find/?pattern=" + decls.first() + "#doc",
      target: "_blank",
      title: "Lean: " + decls.join(", "),
    ))[L∃∀N])
  }
  if uses.len() > 0 {
    chips.push(html.elem("span", attrs: (
      class: "blueprint-chip blueprint-chip--uses",
      title: "Uses: " + uses.join(", "),
    ))[uses])
  }
  [#metadata((kind: kind, label: name, lean: decls, uses: uses, mathlib: mathlib)) <bp-node>]
  [#figure(
    kind: "blueprint",
    supplement: _kinds.at(kind),
    numbering: "1",
    outlined: false,
    html.elem("section", attrs: (class: classes.join(" "), data-blueprint-label: name))[
      #html.elem("div", attrs: (class: "blueprint-header"))[
        #html.elem("span", attrs: (class: "blueprint-kind"))[
          #_kinds.at(kind) #context counter(figure.where(kind: "blueprint")).display()
        ]
        #html.elem("span", attrs: (class: "blueprint-label"), name)
        #if chips.len() > 0 { html.elem("span", attrs: (class: "blueprint-chips"), chips.join()) }
      ]
      #html.elem("div", attrs: (class: "blueprint-content"), body)
    ],
  ) #label(name)]
}

#let definition = _node.with("definition")
#let theorem = _node.with("theorem")
#let lemma = _node.with("lemma")
#let proposition = _node.with("proposition")
#let corollary = _node.with("corollary")
#let example = _node.with("example")
#let conjecture = _node.with("conjecture")
#let remark = _node.with("remark")
#let note = _node.with("note")

#let proof(body) = html.elem("section", attrs: (class: "blueprint-node blueprint-node--proof"))[
  #html.elem("div", attrs: (class: "blueprint-header"))[
    #html.elem("span", attrs: (class: "blueprint-kind"))[Proof]
  ]
  #html.elem("div", attrs: (class: "blueprint-content"), body)
]

#let _shell(title, current, body, content-class: none) = html.elem("html")[
  #html.elem("head")[
    #html.elem("meta", attrs: (charset: "utf-8"))
    #html.elem("meta", attrs: (name: "viewport", content: "width=device-width, initial-scale=1"))
    #html.elem("title", title)
    #html.elem("link", attrs: (rel: "stylesheet", href: "assets/blueprint.css"))
    #html.elem("script", attrs: (type: "module", src: "assets/page.js"))
  ]
  #html.elem("body")[
    #html.elem("div", attrs: (id: "shell"))[
      #html.elem("nav", attrs: (id: "sidebar"))[#context {
        let item(path, label) = html.elem("li", html.elem("a", attrs: (
          href: path,
          class: if path == current { "nav-link active" } else { "nav-link" },
        ), label))
        html.elem("ul", attrs: (class: "nav-list nav-depth-0"),
          query(<bp-chapter>).map(c => item(c.value.path, c.value.title)).join())
        html.elem("div", attrs: (class: "nav-graph"),
          html.elem("ul", attrs: (class: "nav-list"), item("graph.html", "Dependency graph")))
      }]
      #html.elem("main", attrs: (id: "content", ..if content-class != none { (class: content-class) }), body)
    ]
  ]
]

/// One page of the blueprint, written to `path` (e.g. `"intro.html"`).
#let chapter(path, title: none, body) = document(path, title: title)[
  #_shell(title, path)[
    #metadata((path: path, title: title)) <bp-chapter>
    #body
  ]
]

/// Wraps the whole blueprint: `#show: blueprint.with(title: "…")`.
#let blueprint(title: "Blueprint", body) = {
  show raw.where(lang: "lean", block: true): it => {
    let tree = _lean.at(it.text, default: none)
    if tree == none { it } else { _render(tree) }
  }

  body

  document("graph.html", title: [Dependency graph])[
    #_shell([Dependency graph], "graph.html", content-class: "graph-mode")[
      #html.elem("div", attrs: (id: "graph", style: "width: 100%; height: 100%"))
      #html.elem("script", attrs: (type: "module"), "import { renderGraph } from \"./assets/graph-renderer.js\";\nconst { nodes, edges } = await (await fetch(\"graph.json\")).json();\nrenderGraph(document.getElementById(\"graph\"), nodes, edges, (route) => { location.href = route; });")
    ]
  ]

  context {
    let nodes = query(<bp-node>)
    let known = nodes.map(m => m.value.label)
    let page-of(m) = {
      let before = query(selector(<bp-chapter>).before(m.location()))
      if before.len() > 0 { before.last().value.path } else { "" }
    }
    let graph-nodes = nodes.map(m => {
      let v = m.value
      let n = (id: v.label, label: v.label, kind: v.kind, route: page-of(m) + "#" + v.label, mathlib: v.mathlib)
      if v.lean.len() > 0 { n.insert("lean", v.lean.join(", ")) }
      let s = _status.at(v.label, default: none)
      if s != none { n += s }
      n
    })
    let graph-edges = nodes
      .map(m => m.value.uses.filter(u => u in known).map(u => (source: u, target: m.value.label)))
      .flatten()
    asset("graph.json", json.encode((nodes: graph-nodes, edges: graph-edges)))

    // Read by the CLI between passes; not part of the published site.
    asset("__blueprint/lean-blocks.json",
      json.encode(query(raw.where(lang: "lean", block: true)).map(r => r.text)))
    asset("__blueprint/nodes.json", json.encode(nodes.map(m => m.value)))
  }

  for name in ("blueprint.css", "page.js", "graph-renderer.js") {
    asset("assets/" + name, read("/.blueprint/assets/" + name, encoding: none))
  }
}
