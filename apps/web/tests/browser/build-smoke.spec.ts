import { test, expect } from "@playwright/test";

test.describe("Build smoke", () => {
  test("renders root app and validates smoke status in browser", async ({
    page,
  }) => {
    await page.goto("/");
    const heading = page.locator("h1");
    await expect(heading).toHaveText("ATI Workflow Platform");
    const status = page.locator("#smoke-status");
    await expect(status).toContainText("planning");
  });
});
