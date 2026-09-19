import { expect, test } from "@playwright/test";
import { fixtureCalls, IDS, openSignedIn } from "../browser/helpers.js";

test.describe("StrictMode development effect replay", () => {
  test("loads run detail and events after StrictMode effect replay and route revisit", async ({
    page,
  }) => {
    // 1. Open running run in development server (where StrictMode executes effects twice)
    await openSignedIn(page, `#/runs/${IDS.running}`);

    // Verify status indicator is displayed in run view
    await expect(page.locator("main").getByText("Đang chạy").first()).toBeVisible();

    // Verify calls occurred
    const calls = await fixtureCalls(page);
    const detailCalls = calls.filter((c) => c.path.includes(`/runs/${IDS.running}`));
    expect(detailCalls.length).toBeGreaterThan(0);

    // 2. Navigate away to history via back button in RunView
    await page.getByRole("link", { name: "Quay lại Lần chạy" }).click();
    await expect(page).toHaveURL(/#\/runs$/);

    const historyCalls = await fixtureCalls(page);

    // 3. Navigate back to the same running run via link in history
    await page.locator(`a[href*="${IDS.running}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(IDS.running));
    await expect(page.locator("main").getByText("Đang chạy").first()).toBeVisible();

    // Verify polling continues cleanly in the revisited controller
    await expect
      .poll(async () => (await fixtureCalls(page)).length)
      .toBeGreaterThan(historyCalls.length);
  });
});
