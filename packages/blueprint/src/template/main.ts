import content from "./index.md";

const app = document.getElementById("app");
if (app) {
  app.innerHTML = content;
}

// Load leandown runtime for hover tooltips on Lean code blocks
import "@leandown/core/runtime";
