import { leanHydrate } from "../core/src/runtime.ts";

function init() {
  leanHydrate();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
