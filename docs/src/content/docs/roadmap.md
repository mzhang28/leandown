---
title: Roadmap
description: Feature directory and roadmap for the plugin ecosystem
---

Here is a straightforward list of features and roadmap items for the Verso authoring tool and `remark-lean`:

* **Lean Parser Integration**: Tokenizes code blocks leveraging Lean's actual parser and LSP token categories rather than regex heuristics.
* **HTML AST Conversion**: Translates Markdown `lean` code blocks into custom styled blocks (`<pre><code class="language-lean">`) with annotated spans.
* **State Preservation**: Sequentially executes code blocks under the same context using cumulative prepended states.
* **Goal State Markers (`⊢`)**: Inserts a turnstile marker at the boundary after each tactic step.
* **Tactic Boundary Resolution**: Correctly places markers immediately following tactic names or punctuation (like `;` and `<;>`) within nested or single-line tactic sequences.
* **"No Goals" Tracking**: Captures empty goal states and displays `"no goals"` rather than omitting the marker.
* **Interactive Tooltips**: Hovering over the `⊢` marker reveals hypotheses and goals in that specific state of the proof.
* **Identifier References (`data-symbol`)**: Groups matching occurrences of resolved constants, variables, types, or definitions using unique hashes.
* **Synchronized Highlighting**: Hovering over any reference highlights all other matching instances of that identifier simultaneously.
* **Auto-Implicit & Scoped Mapping**: Correctly handles scoped name resolutions and auto-implicit parameter variables independently across different definitions in the same file.
* **Rich Markdown Renderers**: Formats and compiles raw markdown/signatures inside hover tooltips.
* **Nested Interactive Hovering**: Allows users to hover over identifiers within tooltip boxes recursively.
* **Tooltip Stack Controller**: Employs a stack-based state tracker to keep parent tooltips open as long as the mouse is inside any of their active child/descendant tooltips.
* **XSS Sanitization**: Sanitizes tooltip HTML and formats target links with `target="_blank" rel="noopener noreferrer"`.
* **Extensible Genre Model**: Supports different compilation "genres" tailored to different output formats and structures: Blog (`VersoBlog`), Manual (`VersoManual`), and Tutorial (`VersoTutorial`).
* **Output Backends**: Supports HTML and LaTeX / TeX (allowing direct PDF publication).
* **SVG Diagram Rendering**: Integrates with the `Illuminate` library to evaluate inline and block diagram expressions directly into SVGs.
* **InfoView Integration**: Integrates interactive SVG widgets directly with the Lean compiler's InfoView for IDE previews.
* **Blog Genre Directives**: Supports `:::htmlDiv (class := "...")` for custom styled `div` containers, `:::html` for injecting raw HTML, and `:::blob`.
* **Blog Genre Roles**: Supports `{htmlSpan (class := "...")}[text]` for custom styled `span` elements, `{label}` / `{ref}` for anchors and links, `{page_link}` for cross-page blog links, `{lean}`/`{leanInline}` for elaborating and highlighting inline terms, and `{leanTerm}`/`{leanKw}` for styled terms.
* **Manual Genre Directives**: Supports `:::paragraph` grouping, `:::tactic`/`:::conv` docs, `:::progress` checklists, target-dependent `:::draftBlock`, `:::leanSection` for scoping variables/namespaces, and `:::ioExample` to capture and print standard IO output.
* **Manual Genre Roles**: Supports `{tech}`/`{deftech}` glossary normalization, `{name}` for global constants (linking to docs/signatures), `{module}` for module references, `{option}` for descriptions from the environment, `{inst}` for type class availability, `{margin}` for side notes, and `{citep}`/`{citet}`/`{citehere}` for citations.
* **Theorem Directive (`:::theorem`)**: Formats a custom callout box with a theorem's name.
* **Tactic Linker Role (`{tactic}`)**: Looks up a tactic's user-facing name in remote cross-reference data to output links to the official Lean Reference Manual.
* **GLightbox Role (`{lightbox}`)**: Integrates zoomable image lightbox overlays for site screenshots.
* **Verso Source Code Block (`versoSource`)**: Compiles and highlights Verso markup side-by-side with its rendered output inside split panels.
* **Source Permalink Role (`{versoSourceLink}`)**: Computes the exact file and line number range of a block during compile-time, resolving a direct permalink to the source code on GitHub.
* **Ignored Block (`comment`)**: Support for comment blocks that are ignored during documentation generation.
* **Client-Side Search System**: Generates indexes (`verso-search`) supporting client-side searching across domains.
* **noindex robots meta tags**: Injected into older version directories to restrict search engine indexing.
* **Canonical URL references**: Injected into all historical files to point search engines back to the corresponding page under `/latest/`.
* **Site-wide statistics script insertion**: Injects statistics or analytics scripts into all historical document version headings.
* **Shared Unicode inputs**: Replaces minified JS files in all `-verso-search` subdirectories with the latest versions to keep input widgets uniform.
