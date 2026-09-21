import { defineConfig, devices } from "@playwright/test";

const strictPort = Number(process.env.WAP_STRICT_PORT ?? "5174");
const strictOrigin = `http://127.0.0.1:${strictPort}`;

export default defineConfig({
  testDir: "./tests/strict-mode",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: strictOrigin,
    trace: "off",
    video: "off",
    screenshot: "off",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `npm run dev -- --port ${strictPort}`,
    url: strictOrigin,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
