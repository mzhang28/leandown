import { Link, useLocation } from "@tanstack/react-router";
import { summary } from "@leandown/blueprint/summary";

type Entry = typeof summary[number] & { children?: Entry[] };

function findEntry(entries: Entry[], route: string): Entry | undefined {
  for (const e of entries) {
    if (e.route === route) return e;
    if (e.children) {
      const hit = findEntry(e.children, route);
      if (hit) return hit;
    }
  }
}

function NavEntries({ entries, current, depth = 0 }: { entries: Entry[]; current: string; depth?: number }) {
  return (
    <ul className={`nav-list nav-depth-${depth}`}>
      {entries.map((e) => {
        const active = e.route === current;
        return (
          <li key={e.route}>
            <Link to={`/${e.route}`} className={`nav-link${active ? " active" : ""}`}>
              {e.title}
            </Link>
            {e.children?.length ? (
              <NavEntries entries={e.children} current={current} depth={depth + 1} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function Sidebar() {
  const location = useLocation();
  // The router strips its basepath, so this is relative to the site root.
  const current = location.pathname.replace(/^\//, "") || (summary[0]?.route ?? "");

  return (
    <nav id="sidebar">
      <NavEntries entries={summary as Entry[]} current={current} />
      <div className="nav-graph">
        <Link to="/graph" className={`nav-link${current === "graph" ? " active" : ""}`}>
          Dependency graph
        </Link>
      </div>
    </nav>
  );
}
