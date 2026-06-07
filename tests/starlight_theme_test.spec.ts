import { test, expect } from '@playwright/test';

test('theme toggles correctly', async ({ page }) => {
  await page.goto('http://localhost:4321/remark-lean/stlc/');
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-theme', 'light');

  // get the computed style of the pre element
  const codeBlock = page.locator('pre code.language-lean').first();
  // check color
  const color = await codeBlock.evaluate((el) => {
    return window.getComputedStyle(el).color;
  });
  // one light foreground is #383a42, or rgb(56, 58, 66)
  expect(color).toBe('rgb(56, 58, 66)');

  // now click theme toggle
  await page.getByLabel('Theme').first().selectOption({ label: 'Dark' });
  await expect(root).toHaveAttribute('data-theme', 'dark');
  const darkColor = await codeBlock.evaluate((el) => {
    return window.getComputedStyle(el).color;
  });
  expect(darkColor).toBe('rgb(171, 178, 191)');
});
