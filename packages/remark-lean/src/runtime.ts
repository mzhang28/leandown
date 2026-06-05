import { computePosition, flip, shift, offset } from "@floating-ui/dom";

export interface SetupOptions {
  hoveredClass?: string;
  tooltipClass?: string;
}

export function leanHydrate(options: SetupOptions = {}) {
  const hoveredClass = options.hoveredClass || "lean-hovered";
  const tooltipClass = options.tooltipClass || "lean-tooltip";

  // Create shared tooltip element if it doesn't exist
  let tooltip = document.querySelector(`.${tooltipClass}`) as HTMLElement | null;
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.className = tooltipClass;
    Object.assign(tooltip.style, {
      position: "absolute",
      top: "0",
      left: "0",
      visibility: "hidden"
    });
    document.body.appendChild(tooltip);
  }

  let hideTimeout: ReturnType<typeof setTimeout> | null = null;
  let activeHoverElement: HTMLElement | null = null;

  function showTooltip(hoverElement: HTMLElement) {
    if (!tooltip) return;
    const hoverText = hoverElement.getAttribute("data-hover");
    if (!hoverText) return;

    tooltip.innerHTML = hoverText;
    tooltip.style.visibility = "visible";
    activeHoverElement = hoverElement;

    computePosition(hoverElement, tooltip, {
      placement: "top",
      middleware: [offset(8), flip(), shift({ padding: 5 })]
    }).then(({ x, y }) => {
      if (tooltip) {
        Object.assign(tooltip.style, {
          left: `${x}px`,
          top: `${y}px`
        });
      }
    });
  }

  function hideTooltip() {
    if (hideTimeout) clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      if (tooltip) {
        tooltip.style.visibility = "hidden";
      }
      activeHoverElement = null;
    }, 150);
  }

  if (tooltip) {
    tooltip.addEventListener("mouseenter", () => {
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
      }
    });
    tooltip.addEventListener("mouseleave", () => {
      hideTooltip();
    });
  }

  document.addEventListener("mouseover", (e) => {
    const target = e.target as HTMLElement | null;
    const symbol = target?.closest("[data-symbol]");
    const hover = target?.closest("[data-hover]") as HTMLElement | null;

    if (symbol) {
      const symbolValue = symbol.getAttribute("data-symbol");
      if (symbolValue) {
        document.querySelectorAll(`[data-symbol="${CSS.escape(symbolValue)}"]`).forEach((el) => {
          el.classList.add(hoveredClass);
        });
      }
    }

    if (hover) {
      if (hideTimeout) {
        clearTimeout(hideTimeout);
        hideTimeout = null;
      }
      showTooltip(hover);
    }
  });

  document.addEventListener("mouseout", (e) => {
    const target = e.target as HTMLElement | null;
    const symbol = target?.closest("[data-symbol]");
    const hover = target?.closest("[data-hover]");

    if (symbol) {
      const symbolValue = symbol.getAttribute("data-symbol");
      if (symbolValue) {
        document.querySelectorAll(`[data-symbol="${CSS.escape(symbolValue)}"]`).forEach((el) => {
          el.classList.remove(hoveredClass);
        });
      }
    }

    if (hover) {
      hideTooltip();
    }
  });
}
