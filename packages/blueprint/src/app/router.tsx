import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Layout } from "./components/Layout";
import { MarkdownPage } from "./components/MarkdownPage";
import { GraphPage } from "./components/GraphPage";

const rootRoute = createRootRoute({
  component: Layout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: MarkdownPage,
});

const graphRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/graph",
  component: GraphPage,
});

const markdownRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$slug",
  component: MarkdownPage,
});

const routeTree = rootRoute.addChildren([indexRoute, graphRoute, markdownRoute]);

// A relative base ("./") can't be a router basepath; fall back to the root.
const BASE = import.meta.env.BASE_URL ?? "/";

export const router = createRouter({
  routeTree,
  basepath: BASE.startsWith("/") ? BASE : "/",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
