import { useParams } from "@tanstack/react-router";
import { summary } from "@leandown/blueprint/summary";
import { useContext, useEffect, useState } from "react";
import { PagesContext } from "../main";

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

export function MarkdownPage() {
  const { slug } = useParams({ strict: false }) as { slug?: string };
  const pages = useContext(PagesContext);
  const [html, setHtml] = useState<string | null>(null);

  const entry = slug === undefined ? summary[0] : findEntry(summary as Entry[], slug);

  useEffect(() => {
    if (!entry) {
      setHtml("<p>Page not found.</p>");
      return;
    }
    const loader = pages[entry.srcPath];
    if (!loader) {
      setHtml("<p>Page not found.</p>");
      return;
    }
    // Ignore a load that finishes after the user has moved on.
    let cancelled = false;
    loader().then(
      (mod: any) => {
        if (!cancelled) setHtml(mod.default ?? mod.html ?? String(mod));
      },
      (err: unknown) => {
        console.error(`[blueprint] failed to load ${entry.srcPath}:`, err);
        if (!cancelled) setHtml("<p>Failed to load this page.</p>");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [entry?.srcPath]);

  useEffect(() => {
    document.title = entry?.title ?? "Blueprint";
  }, [entry?.title]);

  if (!html) return null;

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
