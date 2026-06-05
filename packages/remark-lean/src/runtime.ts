export interface SetupOptions {
  hoveredClass?: string;
}

export function setupSynchronizedHovers(options: SetupOptions = {}) {
  const hoveredClass = options.hoveredClass || "lean-hovered";

  document.addEventListener("mouseover", (e) => {
    const target = e.target as HTMLElement | null;
    const symbol = target?.closest("[data-symbol]");
    if (!symbol) return;
    const symbolValue = symbol.getAttribute("data-symbol");
    if (!symbolValue) return;

    document.querySelectorAll(`[data-symbol="${CSS.escape(symbolValue)}"]`).forEach((el) => {
      el.classList.add(hoveredClass);
    });
  });

  document.addEventListener("mouseout", (e) => {
    const target = e.target as HTMLElement | null;
    const symbol = target?.closest("[data-symbol]");
    if (!symbol) return;
    const symbolValue = symbol.getAttribute("data-symbol");
    if (!symbolValue) return;

    document.querySelectorAll(`[data-symbol="${CSS.escape(symbolValue)}"]`).forEach((el) => {
      el.classList.remove(hoveredClass);
    });
  });
}
