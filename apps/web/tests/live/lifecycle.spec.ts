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

    // 6. Verify receiver database has zero writes prior to approval
    const preCount = await liveContext.api.db!.client<{ n: number }>`
      SELECT count(*)::int AS n FROM hub_receipts WHERE user_id = ${liveContext.api.userId}
    `;
    expect(preCount[0]?.n).toBe(0);

    // 7. Submit approval decision
    await approveButton.click();

    // 8. Verify execution completes
    // Banner updates to "Hoàn tất"
    await expect(page.getByText("Hoàn tất").first()).toBeVisible({ timeout: 25_000 });

    // 9. Verify Activity event log includes terminal event
    await expect(page.getByText(/Lần chạy kết thúc/i)).toBeVisible();

    // 10. Verify receiver database has exactly 2 write records post completion
    const postCount = await liveContext.api.db!.client<{ n: number }>`
      SELECT count(*)::int AS n FROM hub_receipts WHERE user_id = ${liveContext.api.userId}
    `;
    expect(postCount[0]?.n).toBe(2);

    // 11. Verify in-memory secret isolation: zero tokens or secrets in browser storage
    const storageLength = await page.evaluate(
      () => window.localStorage.length + window.sessionStorage.length,
    );
    expect(storageLength).toBe(0);
  });

  test("rejects write operations, updates run status to rejected, and performs zero database writes", async ({
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

    // 5. Wait for the run to reach awaiting_approval
    const rejectButton = page.getByRole("button", { name: "Từ chối ghi" });
    await expect(rejectButton).toBeVisible({ timeout: 25_000 });

    // 6. Submit rejection decision
    await rejectButton.click();

    // 7. Verify run status displays rejected
    await expect(page.getByText(/Đã từ chối/i).first()).toBeVisible({ timeout: 25_000 });

    // 8. Verify receiver database remains at 0 writes
    const receipts = await liveContext.api.db!.client<{ n: number }>`
      SELECT count(*)::int AS n FROM hub_receipts WHERE user_id = ${liveContext.api.userId}
    `;
    expect(receipts[0]?.n).toBe(0);
  });

  test("cancels active planning/running execution cooperatively and performs zero database writes", async ({
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

    // 5. Trigger cooperative cancellation
    const cancelButton = page.getByRole("button", { name: "Yêu cầu huỷ lần chạy" });
    await expect(cancelButton).toBeVisible({ timeout: 25_000 });
    await cancelButton.click();

    // 6. Verify run status displays cancelled
    await expect(page.getByText(/(Đã huỷ|Đã hủy)/i).first()).toBeVisible({ timeout: 25_000 });

    // 7. Verify receiver database remains at 0 writes
    const receipts = await liveContext.api.db!.client<{ n: number }>`
      SELECT count(*)::int AS n FROM hub_receipts WHERE user_id = ${liveContext.api.userId}
    `;
    expect(receipts[0]?.n).toBe(0);
  });
});
