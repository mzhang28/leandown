import { useParams, useLocation } from "@tanstack/react-router";
import { summary } from "@leandown/blueprint/summary";
import { useEffect, useState } from "react";

type Entry = typeof summary[number] & { children?: Entry[] };

const BASE = import.meta.env.BASE_URL ?? "/";

function findEntry(entries: Entry[], route: string): Entry | undefined {
  for (const e of entries) {
    if (e.route === route) return e;
    if (e.children) {
      const hit = findEntry(e.children, route);
      if (hit) return hit;
    }
  }
}

const pages = import.meta.glob("./**/*.md", { query: "?import", import: "default" });

export function MarkdownPage() {
  const { slug } = useParams({ strict: false }) as { slug?: string };
  const location = useLocation();
  const [html, setHtml] = useState<string | null>(null);

  const route = slug ?? (summary[0]?.route ?? "index");
  const entry = findEntry(summary as Entry[], route) ?? summary[0];

  useEffect(() => {
    if (!entry) return;
    const loader = pages[entry.srcPath];
    if (!loader) {
      setHtml("<p>Page not found.</p>");
      return;
    }
    loader().then((mod: any) => {
      setHtml(typeof mod === "string" ? mod : mod?.default ?? mod?.html ?? String(mod));
    });
  }, [entry?.srcPath]);

  useEffect(() => {
    document.title = entry?.title ?? "Blueprint";
  }, [entry?.title]);

  if (!html) return null;

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
