import { expect, test } from "@playwright/test";
import { IDS, openSignedIn } from "./helpers.js";

test.describe("Security & Invariant Audits", () => {
  test("zero credential persistence in web storage across all views", async ({ page }) => {
    await openSignedIn(page, "#/overview");
    const routes = ["#/overview", "#/new", "#/runs", "#/tools", `#/runs/${IDS.approval}`];
    for (const route of routes) {
      await page.goto(`/${route}`);
      const storageCount = await page.evaluate(() => {
        return window.localStorage.length + window.sessionStorage.length;
      });
      expect(storageCount, `Storage must be empty on ${route}`).toBe(0);
      const cookies = await page.context().cookies();
      expect(cookies, `Cookies must be empty on ${route}`).toEqual([]);
    }
  });

  test("XSS canary: payload and error messages render strictly as text children without script execution", async ({ page }) => {
    await openSignedIn(page, "#/new");
    let alertFired = false;
    page.on("dialog", async (dialog) => {
      alertFired = true;
      await dialog.dismiss();
    });

    const xssCanary = '<img src=x onerror="alert(1)"><b>XSS-CANARY-TAG</b>';
    await page.getByLabel("Yêu cầu").fill(xssCanary);
    await page.getByRole("button", { name: "Lập kế hoạch" }).click();

    // Verify raw HTML tags are rendered as escaped text inside the DOM
    const previewContent = page.locator("text=XSS-CANARY-TAG");
    await expect(previewContent).toBeVisible();
    expect(alertFired).toBe(false);

    // Verify no innerHTML injection in DOM
    const rawImage = await page.locator('img[src="x"]').count();
    expect(rawImage).toBe(0);
  });
});
