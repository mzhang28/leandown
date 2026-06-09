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

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
