import "@leandown/core/runtime";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { createRoot } from "react-dom/client";
import { createContext } from "react";

export type PageModule = () => Promise<string>;

export const PagesContext = createContext<Record<string, PageModule>>({});

export function BlueprintApp({ pages }: { pages: Record<string, PageModule> }) {
  return (
    <PagesContext.Provider value={pages}>
      <RouterProvider router={router} />
    </PagesContext.Provider>
  );
}

export function mount(el: HTMLElement, pages: Record<string, PageModule>) {
  createRoot(el).render(<BlueprintApp pages={pages} />);
}
