import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const workerIndex = parseInt(process.env.STRYKER_SANDBOX_WORKER_INDEX || "0", 10);
const port = 5173 + workerIndex;

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  outputDir: "../test-results",
  use: {
    baseURL: `http://localhost:${port}`,
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
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 120000,
    env: {
      PORT: port.toString(),
      REMARK_LEAN_CACHE_DIR: path.resolve(__dirname, "../test-results/.cache"),
    },
  },
});

