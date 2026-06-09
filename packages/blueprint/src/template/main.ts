import { summary } from "@leandown/blueprint/summary";
import { nodes as graphNodes, edges as graphEdges } from "@leandown/blueprint/graph";
import "@leandown/core/runtime";

type Entry = typeof summary[number];

const pages = import.meta.glob("./**/*.md");

function findEntry(entries: Entry[], route: string): Entry | undefined {
  for (const e of entries) {
    if (e.route === route) return e;
    if (e.children) {
      const hit = findEntry(e.children, route);
      if (hit) return hit;
    }
  }
}

function renderNav(entries: Entry[], current: string, depth = 0): string {
  if (!entries.length) return "";
  const items = entries.map((e) => {
    const active = e.route === current ? " active" : "";
    const sub = e.children?.length ? renderNav(e.children, current, depth + 1) : "";
    return `<li><a href="/${e.route}" class="nav-link${active}">${e.title}</a>${sub}</li>`;
  }).join("");
  return `<ul class="nav-list nav-depth-${depth}">${items}</ul>`;
}

function renderSidebar(current: string): string {
  const graphActive = current === "graph" ? " active" : "";
  return renderNav(summary, current)
    + `<div class="nav-graph"><a href="/graph" class="nav-link${graphActive}">Dependency graph</a></div>`;
}

async function navigate(route: string) {
  const content = document.getElementById("content")!;
  const sidebar = document.getElementById("sidebar")!;

  if (route === "graph") {
    content.innerHTML = "";
    content.classList.add("graph-mode");
    sidebar.innerHTML = renderSidebar("graph");
    document.title = "Dependency graph";
    const { renderGraph } = await import("@leandown/blueprint/graph-renderer");
    renderGraph(content, graphNodes, graphEdges, push);
    return;
  }

  content.classList.remove("graph-mode");

  const entry = findEntry(summary, route) ?? summary[0];
  if (!entry) return;

  const loader = pages[entry.srcPath];
  if (loader) {
    const mod = await loader() as { default: string };
    content.innerHTML = mod.default;
  }

  sidebar.innerHTML = renderSidebar(entry.route);
  document.title = entry.title;
}

function push(route: string) {
  history.pushState(null, "", `/${route}`);
  navigate(route);
}

document.addEventListener("click", (e) => {
  const a = (e.target as Element).closest("a[href]") as HTMLAnchorElement | null;
  if (!a || a.target === "_blank") return;
  const href = a.getAttribute("href")!;
  if (href.startsWith("/") && !href.startsWith("//")) {
    e.preventDefault();
    push(href.slice(1));
  }
});

window.addEventListener("popstate", () => {
  navigate(location.pathname.slice(1) || (summary[0]?.route ?? ""));
});

navigate(location.pathname.slice(1) || (summary[0]?.route ?? ""));
