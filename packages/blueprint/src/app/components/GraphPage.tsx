import { useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import { renderGraph } from "@leandown/blueprint/graph-renderer";
import { nodes, edges } from "@leandown/blueprint/graph";

const BASE = import.meta.env.BASE_URL ?? "/";

export function GraphPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    document.title = "Dependency graph";
    // Push layout chrome out of the way so the graph fills the viewport.
    const content = document.getElementById("content");
    if (content) content.classList.add("graph-mode");
    return () => {
      if (content) content.classList.remove("graph-mode");
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const cy = renderGraph(containerRef.current, nodes, edges, (route) => {
      router.navigate({ to: `/${route}` });
    });
    return () => { cy.destroy(); };
  }, []);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
