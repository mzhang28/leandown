import { computePosition, flip, shift, offset, size } from "@floating-ui/dom";
import { highlightGoalHtml } from "./lib.ts";

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

export interface LeanAwaitContentOptions {
  /** API endpoint that returns `{ content, pager?, title? }` JSON. */
  url: string;
  /** Element or selector for the main rendered content. */
  content: string | HTMLElement;
  /** Optional element or selector for prev/next pager markup. */
  pager?: string | HTMLElement;
}

function resolveElement(target: string | HTMLElement): HTMLElement | null {
  return typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
}

/**
 * Fetches deferred Lean-rendered content, swaps it into the page, and hydrates tooltips.
 */
export async function leanAwaitContent(options: LeanAwaitContentOptions): Promise<void> {
  const contentEl = resolveElement(options.content);
  if (!contentEl) {
    throw new Error("leanAwaitContent: content element not found");
  }

  const response = await fetch(options.url);
  if (!response.ok) {
    throw new Error(`leanAwaitContent: request failed (${response.status})`);
  }

  const data = (await response.json()) as {
    content: string;
    pager?: string;
    title?: string;
  };

  contentEl.innerHTML = data.content;
  contentEl.removeAttribute("aria-busy");

  if (options.pager && data.pager) {
    const pagerEl = resolveElement(options.pager);
    if (pagerEl) pagerEl.innerHTML = data.pager;
  }

  if (data.title) {
    document.title = data.title;
  }

  leanHydrate();
}

function resolveHoverElement(target: HTMLElement | null): HTMLElement | null {
  if (!target) return null;
  // Diagnostic squiggles wrap token hovers; Lean shows the diagnostic, not inner spans.
  const squiggly = target.closest(
    ".lean-squiggly-error[data-hover-id], .lean-squiggly-warning[data-hover-id]"
  ) as HTMLElement | null;
  if (squiggly) return squiggly;
  return target.closest("[data-hover-id], [data-hover]") as HTMLElement | null;
}

export function leanHydrate(options: SetupOptions = {}) {
  console.log("Lean hydration started");
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

    let hoverData: any = null;
    if (parentTooltipElement && (parentTooltipElement as any)._leanHoverData) {
      hoverData = (parentTooltipElement as any)._leanHoverData;
    } else {
      const pre = el.closest("pre");
      if (pre) {
        if ((pre as any)._leanHoverData) {
          hoverData = (pre as any)._leanHoverData;
        } else {
          const script = pre.querySelector(".lean-hover-data") ||
            (pre.nextElementSibling?.classList.contains("lean-hover-data") ? pre.nextElementSibling : null);
          if (script) {
            try {
              hoverData = JSON.parse(script.textContent || "{}");
              (pre as any)._leanHoverData = hoverData;
            } catch (e) {
              console.error("Failed to parse hover data registry", e);
            }
          }
        }
      }
    }

    (tooltip as any)._leanHoverData = hoverData;

    // Match Lean: show only the hover for the most specific (innermost) region.
    const hoverIds: string[] = [];
    const directHovers: string[] = [];
    const hoverId = el.getAttribute("data-hover-id");
    if (hoverId) {
      hoverIds.push(hoverId);
    }
    const directHover = el.getAttribute("data-hover");
    if (directHover) {
      directHovers.push(directHover);
    }

    const uniqueHtmls: string[] = [];
    if (hoverData && hoverData.hovers) {
      for (const id of hoverIds) {
        const baseHtml = hoverData.hovers[id];
        if (baseHtml) {
          const reconstructedHtml = highlightGoalHtml(baseHtml, hoverData.words || {});
          if (!uniqueHtmls.includes(reconstructedHtml)) {
            uniqueHtmls.push(reconstructedHtml);
          }
        }
      }
    }

    for (const h of directHovers) {
      if (h && !uniqueHtmls.includes(h)) {
        uniqueHtmls.push(h);
      }
    }

    tooltip.innerHTML = uniqueHtmls.join("<hr>");
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
    const hover = resolveHoverElement(target);

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
    const hover = resolveHoverElement(target);

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
      const relatedHover = resolveHoverElement(relatedTarget);
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

  const blockCount = document.querySelectorAll(".lean-hover-data").length;
  console.log(`Lean hydration ended. Hydrated ${blockCount} block(s).`);
}

