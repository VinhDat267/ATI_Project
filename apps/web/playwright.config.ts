import { defineConfig, devices } from "@playwright/test";

const isLiveOnly = process.argv.some(
  (arg) => arg.includes("live") || arg.includes("cleanup.spec"),
);

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "fixture",
      testDir: "./tests/browser",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "live",
      testDir: "./tests/live",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: isLiveOnly
    ? undefined
    : {
        command: "npm run preview",
        url: "http://127.0.0.1:4173",
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
});
