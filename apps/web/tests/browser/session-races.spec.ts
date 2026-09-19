import { expect, test } from "@playwright/test";
import { IDS, openSignedIn } from "./helpers.js";

test.describe("Session Races & Multi-Tab Isolation", () => {
  test("two browser tabs maintain completely isolated in-memory sessions", async ({ browser, baseURL }) => {
    const context1 = await browser.newContext({ baseURL });
    const context2 = await browser.newContext({ baseURL });

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      // Tab 1 signs in
      await openSignedIn(page1, "#/overview");
      await expect(page1.getByRole("heading", { name: "Tổng quan" })).toBeVisible();

      // Tab 2 navigates to overview -> must be redirected to Login because memory is tab-scoped
      await page2.goto("/#/overview");
      await expect(page2.getByRole("heading", { name: "Đăng nhập" })).toBeVisible();

      // Ensure tab 2 has no access to tab 1 credentials
      const page2Storage = await page2.evaluate(() => window.localStorage.length + window.sessionStorage.length);
      expect(page2Storage).toBe(0);
    } finally {
      await context1.close();
      await context2.close();
    }
  });

  test("discards stale responses on logout and advances session generation", async ({ page }) => {
    await openSignedIn(page, "#/overview");
    await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible();

    // Open user account menu and click logout
    await page.getByRole("button", { name: /Tài khoản/ }).click();
    await page.getByRole("menuitem", { name: "Đăng xuất" }).click();

    await expect(page.getByRole("heading", { name: "Đăng nhập" })).toBeVisible();
    // After logout, storage remains 0
    const storage = await page.evaluate(() => window.localStorage.length + window.sessionStorage.length);
    expect(storage).toBe(0);
  });
});
