import "@leandown/blueprint/styles.css";
import "@leandown/core/runtime";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root")!;
createRoot(root).render(<RouterProvider router={router} />);
