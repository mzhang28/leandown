import { computePosition, flip, shift, offset, size } from "@floating-ui/dom";

export interface SetupOptions {
  hoveredClass?: string;
  tooltipClass?: string;
}

/**
 * Represents the controller interface for managing a tooltip and its hover state.
 *
 * It contains references to the trigger element, the tooltip DOM element, the hover status,
 * timeout handle for debounced hiding, and a close function to clean up listeners and DOM nodes.
 */
export interface TooltipController {
  element: HTMLElement;
  tooltip: HTMLElement;
  isHovered: boolean;
  hideTimeout: ReturnType<typeof setTimeout> | null;
  close: () => void;
}

/**
 * Recursively checks if a given tooltip controller or any of its child controllers are active.
 *
 * A controller is considered active if it is currently hovered, or if any other controller
 * whose trigger element is contained within this controller's tooltip is active.
 */
export function isControllerActive(c: TooltipController, activeTooltips: TooltipController[]): boolean {
  if (c.isHovered) return true;
  return activeTooltips.some(child => {
    if (child === c) return false;
    if (c.tooltip.contains(child.element)) {
      return isControllerActive(child, activeTooltips);
    }
    return false;
  });
}

export function leanHydrate(options: SetupOptions = {}) {
  const hoveredClass = options.hoveredClass || "lean-hovered";
  const tooltipClass = options.tooltipClass || "lean-tooltip";

  let activeTooltips: TooltipController[] = [];

  function updateTooltips() {
    for (const c of activeTooltips) {
      const active = isControllerActive(c, activeTooltips);
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

    const hovers: string[] = [];
    let current: HTMLElement | null = el;
    while (current) {
      const hoverVal = current.getAttribute("data-hover");
      if (hoverVal) {
        hovers.push(hoverVal);
      }
      if (current.tagName === "PRE" || current.tagName === "BODY") {
        break;
      }
      current = current.parentElement;
    }

    const uniqueHovers: string[] = [];
    for (const h of hovers) {
      if (h && !uniqueHovers.includes(h)) {
        uniqueHovers.push(h);
      }
    }
    tooltip.innerHTML = uniqueHovers.join("<hr>");
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
      middleware: [
        offset(4),
        flip(),
        shift({ padding: 5 }),
        size({
          padding: 10,
          apply({ availableWidth, availableHeight, elements }) {
            Object.assign(elements.floating.style, {
              maxWidth: `${Math.min(320, availableWidth)}px`,
              maxHeight: `${availableHeight}px`,
            });
          },
        })
      ]
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

  let pendingTooltipTimeout: ReturnType<typeof setTimeout> | null = null;
  let pendingTooltipElement: HTMLElement | null = null;

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
      if (pendingTooltipElement !== hover && hover.dataset.hasTooltip !== "true") {
        if (pendingTooltipTimeout) clearTimeout(pendingTooltipTimeout);
        pendingTooltipElement = hover;
        pendingTooltipTimeout = setTimeout(() => {
          if (pendingTooltipElement === hover) {
            createTooltipFor(hover);
            pendingTooltipElement = null;
          }
        }, 500);
      }
    } else {
      if (pendingTooltipTimeout) {
        clearTimeout(pendingTooltipTimeout);
        pendingTooltipTimeout = null;
        pendingTooltipElement = null;
      }
    }
  });

  document.addEventListener("mouseout", (e) => {
    const target = e.target as HTMLElement | null;
    const relatedTarget = e.relatedTarget as HTMLElement | null;
    const symbol = target?.closest("[data-symbol]");
    const hover = target?.closest("[data-hover]") as HTMLElement | null;

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

    if (hover && pendingTooltipElement === hover) {
      const relatedHover = relatedTarget?.closest("[data-hover]");
      if (relatedHover !== hover) {
        if (pendingTooltipTimeout) {
          clearTimeout(pendingTooltipTimeout);
          pendingTooltipTimeout = null;
          pendingTooltipElement = null;
        }
      }
    }
  });

  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    const symbol = target?.closest("[data-symbol]");
    if (symbol) {
      const symbolValue = symbol.getAttribute("data-symbol");
      if (symbolValue) {
        const def = document.querySelector(`[data-symbol="${CSS.escape(symbolValue)}"][data-is-definition="true"]`) as HTMLElement | null;
        if (def) {
          if (def !== target) {
            def.scrollIntoView({ behavior: "smooth", block: "center" });
            
            def.classList.remove("lean-flash");
            void def.offsetWidth; 
            def.classList.add("lean-flash");
            
            setTimeout(() => {
              def.classList.remove("lean-flash");
            }, 1000);
          }
        } else {
          const permalink = symbol.getAttribute("data-permalink");
          if (permalink) {
            window.open(permalink, "_blank");
          }
        }
      }
    }
  });
}

