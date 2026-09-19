import { test, expect } from "./fixtures.js";

test.describe("Live Run Lifecycle E2E", () => {
  test("creates run with b02Prompt, streams ordered events, approves write, and completes", async ({
    page,
    liveContext,
  }) => {
    test.setTimeout(60_000);

    // 1. Sign in
    await page.goto(`${liveContext.previewUrl}/#/login`);
    await page.getByLabel("Email").fill(liveContext.email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(liveContext.password);
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible();

    // 2. Navigate to New Run view
    await page.goto(`${liveContext.previewUrl}/#/new`);
    await expect(page.getByRole("heading", { name: "Bạn muốn hệ thống làm gì?" })).toBeVisible();

    // 3. Fill and submit b02Prompt
    await page.locator("#request").fill(liveContext.b02Prompt);
    await page.getByRole("button", { name: "Lập kế hoạch" }).click();

    // 4. Confirm route changed to #/runs/<run_id>
    await page.waitForURL(/#\/runs\/[0-9a-f-]{36}/);
    const runUrl = page.url();
    const runId = runUrl.split("/runs/")[1]?.split("?")[0];
    expect(runId).toBeTruthy();

    // 5. Wait for the run to be planned and reach awaiting_approval
    // The dev_fixture planner analyzes b02Prompt and produces write operations requiring approval
    const approveButton = page.getByRole("button", { name: /Duyệt \d+ thao tác ghi/ });
    await expect(approveButton).toBeVisible({ timeout: 25_000 });

    // Verify "Quyết định ghi" section is presented
    await expect(page.getByRole("region", { name: "Quyết định ghi" })).toBeVisible();

    // Verify activity stream contains intermediate events
    await expect(page.getByRole("heading", { name: "Hoạt động" })).toBeVisible();
    await expect(page.getByText(/Bản xem trước sẵn sàng, chờ duyệt/i)).toBeVisible();

    // 6. Submit approval decision
    await approveButton.click();

    // 7. Verify execution completes
    // Banner updates to "Hoàn tất"
    await expect(page.getByText("Hoàn tất").first()).toBeVisible({ timeout: 25_000 });

    // 8. Verify Activity event log includes terminal event
    await expect(page.getByText(/Lần chạy kết thúc/i)).toBeVisible();

    // 9. Verify in-memory secret isolation: zero tokens or secrets in browser storage
    const storageLength = await page.evaluate(
      () => window.localStorage.length + window.sessionStorage.length,
    );
    expect(storageLength).toBe(0);
  });
});
