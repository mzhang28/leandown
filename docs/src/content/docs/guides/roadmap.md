---
title: Roadmap & Features
description: Feature directory and roadmap for the plugin ecosystem
---

This document details the complete feature set of the **Verso** authoring tool, the custom extensions in the **Verso Website**, and their representation in the local JavaScript/TypeScript `remark-lean` plugin ecosystem.

---

## 1. Core Interactive Features (Shared Implementation)

These interactive features are implemented both in the native Lean **Verso** compiler and mirrored inside the JavaScript/TypeScript `remark-lean` plugin.

### Core Semantic Highlighting
* **Lean Parser Integration**: Tokenizes code blocks leveraging Lean's actual parser and LSP token categories (`keyword`, `variable`, `type`, `function`, `operator`, `string`, `number`, `comment`, `leanSorryLike`, etc.) rather than regex heuristics.
* **HTML AST Conversion**: Translates Markdown `lean` code blocks into custom styled blocks (`<pre><code class="language-lean">`) with annotated spans.
* **State Preservation Across Snippets**: Sequentially executes code blocks under the same context using cumulative prepended states.

### Interactive Proof States
* **Goal State Markers (`⊢`)**: Inserts a turnstile marker at the boundary after each tactic step.
* **Tactic Boundary Resolution**: Correctly places markers immediately following tactic names or punctuation (like `;` and `<;>`) within nested or single-line tactic sequences.
* **"No Goals" Tracking**: Captures empty goal states (e.g., following `rfl` or `grind`) and displays `"no goals"` rather than omitting the marker.
* **Interactive Tooltips**: Hovering over the `⊢` marker reveals hypotheses and goals in that specific state of the proof.

### Synchronized Hover Grouping
* **Identifier References (`data-symbol`)**: Groups matching occurrences of resolved constants, variables, types, or definitions using unique hashes (e.g., `ref-11-16` or `ref-ext-...`).
* **Synchronized Highlighting**: Hovering over any reference highlights all other matching instances of that identifier simultaneously.
* **Auto-Implicit & Scoped Mapping**: Correctly handles scoped name resolutions and auto-implicit parameter variables independently across different definitions in the same file.

### Multi-Level Recursive Tooltips
* **Rich Markdown Renderers**: Formats and compiles raw markdown/signatures inside hover tooltips.
* **Nested Interactive Hovering**: Allows users to hover over identifiers *within* tooltip boxes (e.g., hovering over `Prop` inside a signature tooltip) recursively.
* **Tooltip Stack Controller**: Employs a stack-based state tracker to keep parent tooltips open as long as the mouse is inside any of their active child/descendant tooltips.
* **XSS Sanitization**: Sanitizes tooltip HTML and formats target links with `target="_blank" rel="noopener noreferrer"`.

---

## 2. Verso Native Compiler Architecture (Lean Source)

Verso's native codebase implements a highly extensible compilation architecture.

### Extensible Genre Model
Verso supports different compilation "genres" tailored to different output formats and structures:
* **Blog (`VersoBlog`)**: Renders static pages, posts, and websites.
* **Manual (`VersoManual`)**: Designed for books and reference documentation like the *Lean Language Reference Manual*.
* **Tutorial (`VersoTutorial`)**: Supports interactive step-by-step guides.

### Output Backends
* **HTML**: Standard template rendering for website components.
* **LaTeX / TeX**: Native `toTeX` formatters defined for block directives and inline roles, allowing direct PDF publication.

### Illuminate Diagrams
* **SVG Diagram Rendering**: Integrates with the `Illuminate` library to evaluate inline and block diagram expressions directly into SVGs.
* **InfoView Integration**: Integrates interactive SVG widgets directly with the Lean compiler's InfoView for IDE previews.

### Built-in Genre Directives (`:::`) & Roles (`{}`)

#### A. Blog Genre Extensions
* **Directives**:
  * `:::htmlDiv (class := "...")`: Renders a custom styled `div` container.
  * `:::html <tag>`: Injects raw HTML elements (e.g., images).
  * `:::blob`: Renders raw HTML blobs.
* **Roles**:
  * `{htmlSpan (class := "...")}[text]`: Renders custom styled `span` elements.
  * `{label}` / `{ref}`: Inserts page anchors and reference links.
  * `{page_link}`: Resolves links to other blog pages.
  * `{lean}` / `{leanInline}`: Elaborates and highlights inline Lean terms.
  * `{leanTerm}` / `{leanKw}`: Renders styled inline terms and keywords.

#### B. Manual Genre Extensions
* **Directives**:
  * `:::paragraph`: Groups blocks into logical paragraphs.
  * `:::tactic` / `:::conv`: Renders documentation for tactics and conversion tactics.
  * `:::progress`: Renders progress checklists.
  * `:::draftBlock` / `:::draft`: Hides/shows draft-only contents depending on build target.
  * `:::leanSection`: Sets up scoped variables and namespaces for subsequent code blocks.
  * `:::ioExample`: Elaborates and runs Lean code to capture and print its actual standard IO output.
  * `:::row` / `:::table`: Creates multi-column page layouts and custom tables.
* **Roles**:
  * `{tech}` / `{deftech}`: Terms glossary with key normalization (lowercasing, plural resolution, spacing normalization).
  * `{name}`: Highlights and links global constant names with tooltips showing documentation and signatures.
  * `{module}`: Places module name references.
  * `{option}`: Renders editor options, pulling descriptions directly from the environment.
  * `{inst}`: Assures a type class instance is available.
  * `{margin}`: Renders side marginalia notes.
  * `{citep}` / `{citet}` / `{citehere}`: Textual, parenthetical, and direct bibliography citations.

---

## 3. Verso Website Customizations

The official Verso website defines custom components and syntax rules for its landing pages:

* **Theorem Directive (`:::theorem "Name"`)**: Formats a custom callout box with a theorem's name.
* **Tactic Linker Role (`{tactic}`)**: Looks up a tactic's user-facing name in remote cross-reference data to output links to the official Lean Reference Manual.
* **GLightbox Role (`{lightbox}`)**: Integrates zoomable image lightbox overlays for site screenshots.
* **Verso Source Code Block (`versoSource`)**: Compiles and highlights Verso markup side-by-side with its rendered output inside split panels.
* **Source Permalink Role (`{versoSourceLink}`)**: Computes the exact file and line number range of a block during compile-time, resolving a direct permalink to the source code on GitHub.
* **Ignored Block (`comment`)**: Support for comment blocks that are ignored during documentation generation.

---

## 4. Build, Search, & Deployment Infrastructure

### Client-Side Search System
* **Domain-Aware Indexing (`verso-search`)**: Generates indexes that support client-side searching across domains, mapping display names, class names, and address fragments.

### Multi-Version Deployment Overlays
Verso's release scripts apply automated SEO and metadata overlays across versioned build targets (`/latest/`, `/stable/`, and specific tags like `/4.29.0/`):
* **`noindex` robots meta tags**: Automatically injected into older version directories to restrict search engine indexing, ensuring only the `/latest` manual version appears in web search results.
* **Canonical URL references**: Injected into all historical files to point search engines back to the corresponding page under `/latest/`.
* **Site-wide statistics script insertion**: Injects statistics or analytics scripts into all historical document version headings without requiring a full recompilation.
* **Shared Unicode inputs**: Replaces minified JS files in all `-verso-search` subdirectories with the latest versions to keep input widgets uniform.
