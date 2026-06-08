import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Running sequentially to avoid file/LSP lock contentions if any
  reporter: "list",
  outputDir: "../test-results",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome", // Use system-installed Google Chrome
      },
    },
  ],
  webServer: {
    command: "bun --cwd ../examples/basic/markdown index.ts",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 120000,
    env: {
      REMARK_LEAN_CACHE_DIR: path.resolve(__dirname, "../test-results/.cache"),
    },
  },
});
