import { computePosition, flip, shift, offset } from "@floating-ui/dom";

export interface SetupOptions {
  hoveredClass?: string;
  tooltipClass?: string;
}

export function leanHydrate(options: SetupOptions = {}) {
  const hoveredClass = options.hoveredClass || "lean-hovered";
  const tooltipClass = options.tooltipClass || "lean-tooltip";

  interface TooltipController {
    element: HTMLElement;
    tooltip: HTMLElement;
    isHovered: boolean;
    hideTimeout: ReturnType<typeof setTimeout> | null;
    close: () => void;
  }
  let activeTooltips: TooltipController[] = [];

  function isControllerActive(c: TooltipController): boolean {
    if (c.isHovered) return true;
    return activeTooltips.some(child => {
      if (child === c) return false;
      if (c.tooltip.contains(child.element)) {
        return isControllerActive(child);
      }
      return false;
    });
  }

  function updateTooltips() {
    for (const c of activeTooltips) {
      const active = isControllerActive(c);
      if (active) {
        if (c.hideTimeout) {
          clearTimeout(c.hideTimeout);
          c.hideTimeout = null;
        }
      } else {
        if (!c.hideTimeout) {
          c.hideTimeout = setTimeout(() => {
            c.close();
            updateTooltips();
          }, 250);
        }
      }
    }
  }

  function createTooltipFor(el: HTMLElement) {
    if (el.dataset.hasTooltip === "true") return;
    el.dataset.hasTooltip = "true";

    const parentTooltipElement = el.closest(`.${tooltipClass}`) as HTMLElement | null;
    
    if (!parentTooltipElement) {
      // Close all top-level tooltips
      [...activeTooltips].forEach(c => c.close());
      activeTooltips = [];
    }

    const tooltip = document.createElement("div");
    tooltip.className = tooltipClass;
    Object.assign(tooltip.style, {
      position: "absolute",
      top: "0",
      left: "0",
      visibility: "hidden"
    });
    tooltip.innerHTML = el.getAttribute("data-hover") || "";
    document.body.appendChild(tooltip);

    let isMouseInHover = true;
    let isMouseInTooltip = false;

    const controller: TooltipController = {
      element: el,
      tooltip: tooltip,
      isHovered: true,
      hideTimeout: null,
      close: () => {
        if (controller.hideTimeout) {
          clearTimeout(controller.hideTimeout);
          controller.hideTimeout = null;
        }
        tooltip.remove();
        el.dataset.hasTooltip = "false";
        el.removeEventListener("mouseleave", onMouseLeaveEl);
        el.removeEventListener("mouseenter", onMouseEnterEl);
        activeTooltips = activeTooltips.filter(c => c !== controller);
      }
    };
    activeTooltips.push(controller);

    function setHoverState(hover: boolean, tooltipHover: boolean) {
      isMouseInHover = hover;
      isMouseInTooltip = tooltipHover;
      controller.isHovered = isMouseInHover || isMouseInTooltip;
      updateTooltips();
    }

    function onMouseEnterEl() {
      setHoverState(true, isMouseInTooltip);
    }

    function onMouseLeaveEl() {
      setHoverState(false, isMouseInTooltip);
    }

    el.addEventListener("mouseenter", onMouseEnterEl);
    el.addEventListener("mouseleave", onMouseLeaveEl);

    tooltip.addEventListener("mouseenter", () => {
      setHoverState(isMouseInHover, true);
    });

    tooltip.addEventListener("mouseleave", () => {
      setHoverState(isMouseInHover, false);
    });

    computePosition(el, tooltip, {
      placement: "top",
      middleware: [offset(4), flip(), shift({ padding: 5 })]
    }).then(({ x, y }) => {
      if (activeTooltips.includes(controller)) {
        Object.assign(tooltip.style, {
          left: `${x}px`,
          top: `${y}px`,
          visibility: "visible"
        });
      }
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
      createTooltipFor(hover);
    }
  });

  document.addEventListener("mouseout", (e) => {
    const target = e.target as HTMLElement | null;
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    const symbol = target?.closest("[data-symbol]");

    if (symbol) {
      const symbolValue = symbol.getAttribute("data-symbol");
      const relatedSymbol = relatedTarget?.closest("[data-symbol]");
      if (!relatedSymbol || relatedSymbol.getAttribute("data-symbol") !== symbolValue) {
        if (symbolValue) {
          document.querySelectorAll(`[data-symbol="${CSS.escape(symbolValue)}"]`).forEach((el) => {
            el.classList.remove(hoveredClass);
          });
        }
      }
    }
  });
}
