import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Running sequentially to avoid file/LSP lock contentions if any
  reporter: "list",
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
    command: "bun --cwd examples/basic/markdown index.ts",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
