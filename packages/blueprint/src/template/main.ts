import { summary } from "@leandown/blueprint/summary";
import "@leandown/core/runtime";

type Entry = typeof summary[number];

// Vite resolves all .md files in src/ as transformable modules
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
    return `<li><a href="#${e.route}" class="nav-link${active}">${e.title}</a>${sub}</li>`;
  }).join("");
  return `<ul class="nav-list nav-depth-${depth}">${items}</ul>`;
}

async function navigate(route: string) {
  const entry = findEntry(summary, route) ?? summary[0];
  if (!entry) return;

  const loader = pages[entry.srcPath];
  if (loader) {
    const mod = await loader() as { default: string };
    document.getElementById("content")!.innerHTML = mod.default;
  }

  document.getElementById("sidebar")!.innerHTML = renderNav(summary, entry.route);
  document.title = entry.title;
}

window.addEventListener("hashchange", () => {
  navigate(location.hash.slice(1) || (summary[0]?.route ?? ""));
});

navigate(location.hash.slice(1) || (summary[0]?.route ?? ""));
