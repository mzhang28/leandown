import { test, expect, type Locator } from "@playwright/test";

/**
 * Asserts that the tooltip is positioned near the anchor element,
 * i.e. not stuck at the top-left corner of the page.
 *
 * Checks:
 *  - Vertical: the tooltip's edge is within `maxVerticalGap` px of the anchor's edge.
 *  - Horizontal: the centre-to-centre distance is within `maxHorizontalGap` px.
 */
async function expectTooltipNear(
  tooltip: Locator,
  anchor: Locator,
  { maxVerticalGap = 150, maxHorizontalGap = 300 } = {},
) {
  const tooltipBox = await tooltip.boundingBox();
  const anchorBox = await anchor.boundingBox();
  expect(tooltipBox, "tooltip bounding box should exist").not.toBeNull();
  expect(anchorBox, "anchor bounding box should exist").not.toBeNull();

  // Vertical: either the tooltip sits above or below the anchor
  const gapAbove = Math.abs(
    (tooltipBox!.y + tooltipBox!.height) - anchorBox!.y,
  );
  const gapBelow = Math.abs(
    tooltipBox!.y - (anchorBox!.y + anchorBox!.height),
  );
  expect(
    gapAbove < maxVerticalGap || gapBelow < maxVerticalGap,
    `tooltip should be near the anchor vertically (gapAbove=${gapAbove.toFixed(0)}, gapBelow=${gapBelow.toFixed(0)})`,
  ).toBe(true);

  // Horizontal: centres should be reasonably close
  const tooltipCenterX = tooltipBox!.x + tooltipBox!.width / 2;
  const anchorCenterX = anchorBox!.x + anchorBox!.width / 2;
  expect(
    Math.abs(tooltipCenterX - anchorCenterX),
    "tooltip should be near the anchor horizontally",
  ).toBeLessThan(maxHorizontalGap);
}

test.describe("Lean Markdown Renderer E2E Tests", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should load the page and render semantic highlights", async ({ page }) => {
    await expect(page).toHaveTitle("Lean Markdown Renderer");

    // Check that there is at least one lean code block
    const codeBlocks = page.locator("pre code.language-lean");
    await expect(codeBlocks.first()).toBeVisible();
    await expect(await codeBlocks.count()).toBeGreaterThan(0);

    // Verify key syntax highlighted classes are populated
    const keywords = page.locator(".lean-keyword");
    await expect(keywords.first()).toBeVisible();
    const firstKeywordText = await keywords.first().innerText();
    expect(firstKeywordText).toMatch(/^(def|instance|theorem|by|constructor|simp|grind|where|mem)$/);

    const variables = page.locator(".lean-variable");
    await expect(variables.first()).toBeVisible();
  });

  test("should synchronize hovers for identifiers with the same data-symbol", async ({ page }) => {
    const symbols = page.locator("[data-symbol]");
    await expect(symbols.first()).toBeVisible();

    const firstSymbol = symbols.first();
    const symbolId = await firstSymbol.getAttribute("data-symbol");
    expect(symbolId).toBeTruthy();

    const siblingSymbols = page.locator(`[data-symbol="${symbolId}"]`);
    const siblingCount = await siblingSymbols.count();

    // No highlights initially
    await expect(page.locator(".lean-hovered")).toHaveCount(0);

    // Hover highlights all matching symbols
    await firstSymbol.hover();
    for (let i = 0; i < siblingCount; i++) {
      await expect(siblingSymbols.nth(i)).toHaveClass(/lean-hovered/);
    }

    // Moving away removes highlights
    await page.locator("h1").hover();
    for (let i = 0; i < siblingCount; i++) {
      await expect(siblingSymbols.nth(i)).not.toHaveClass(/lean-hovered/);
    }
  });

  test("should show tooltip on hover and support nested/stacked tooltips", async ({ page }) => {
    const hoverable = page.locator("[data-hover]").first();
    await expect(hoverable).toBeVisible();

    await hoverable.hover();

    const tooltip = page.locator(".lean-tooltip").first();
    await expect(tooltip).toBeVisible();

    // Tooltip should appear near the hovered element, not at the page origin
    await expectTooltipNear(tooltip, hoverable);

    // Check that tooltip has some content
    const tooltipText = await tooltip.innerText();
    expect(tooltipText.length).toBeGreaterThan(0);

    // Nested tooltips: hover over an identifier inside the tooltip
    const subHoverable = tooltip.locator("[data-hover]");
    if (await subHoverable.count() > 0) {
      await subHoverable.first().hover();

      const allTooltips = page.locator(".lean-tooltip");
      await expect(allTooltips).toHaveCount(2);

      // Parent tooltip stays open (stack-based controller)
      await expect(tooltip).toBeVisible();
    }

    // Moving away closes all tooltips
    await page.locator("h1").hover();
    await page.waitForTimeout(400);
    await expect(page.locator(".lean-tooltip")).toHaveCount(0);
  });

  test("should display goal state when hovering over proof state markers (⊢)", async ({ page }) => {
    const goalMarkers = page.locator("span.lean-goal-marker");
    await expect(goalMarkers.first()).toBeVisible();

    const firstGoal = goalMarkers.first();
    await firstGoal.hover();

    const tooltip = page.locator(".lean-tooltip").first();
    await expect(tooltip).toBeVisible();

    // Tooltip should appear near the goal marker, not at the page origin
    await expectTooltipNear(tooltip, firstGoal);

    const tooltipText = await tooltip.innerText();
    expect(tooltipText).toMatch(/(⊢|no goals|S : Type)/);

    // Moving away closes the tooltip
    await page.locator("h1").hover();
    await page.waitForTimeout(400);
    await expect(page.locator(".lean-tooltip")).toHaveCount(0);
  });
});
