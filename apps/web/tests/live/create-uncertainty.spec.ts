import { test, expect } from "./fixtures.js";

test.describe("Create Run — Uncertainty Fence E2E", () => {
  test("maintains uncertainty fence, rejects reconciliation with older run of same prompt, and blocks re-POST", async ({
    page,
    liveContext,
  }) => {
    test.setTimeout(60_000);

    // 1. Pre-create a run on the backend with the exact same prompt
    const token = await liveContext.api.login();
    const precreateRes = await liveContext.api.call("/runs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        source_prompt: liveContext.b02Prompt,
        inputs: {},
        time_zone: "Asia/Ho_Chi_Minh",
      }),
    });
    expect(precreateRes.status).toBe(202);
    const precreatedRun = await precreateRes.json();
    const precreatedRunId = precreatedRun.run_id;
    expect(precreatedRunId).toBeTruthy();

    // 2. Sign in to the frontend app
    await page.goto(`${liveContext.previewUrl}/#/login`);
    await page.getByLabel("Email").fill(liveContext.email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(liveContext.password);
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible();

    // 3. Navigate to New Run view
    await page.goto(`${liveContext.previewUrl}/#/new`);
    await expect(
      page.getByRole("heading", { name: "Bạn muốn hệ thống làm gì?" }),
    ).toBeVisible();

    // 4. Intercept the client's POST to /api/v1/runs:
    // Forward the POST to the backend via route.fetch(), but abort the response to the browser
    // to simulate a network disconnection / dropped response.
    let postCount = 0;
    await page.route("**/api/v1/runs", async (route) => {
      if (route.request().method() === "POST") {
        postCount++;
        try {
          await route.fetch();
        } catch {
          // ignore backend fetch errors if any
        }
        await route.abort("failed");
      } else {
        await route.continue();
      }
    });

    // 5. Fill the same prompt and click "Lập kế hoạch"
    await page.locator("#request").fill(liveContext.b02Prompt);
    await page.getByRole("button", { name: "Lập kế hoạch" }).click();

    // 6. Verify that exactly one POST occurred and the uncertainty banner is shown
    expect(postCount).toBe(1);
    const bannerTitle = page.getByText(
      "Chưa xác nhận được lần chạy đã được tạo hay chưa",
    );
    await expect(bannerTitle).toBeVisible();

    // Verify submit button is disabled in confirming state
    const submitButton = page.getByRole("button", { name: "Chờ xác nhận…" });
    await expect(submitButton).toBeDisabled();

    // Verify absence of forbidden retry/reset buttons ("Tạo yêu cầu mới khác", "Kiểm tra máy chủ")
    await expect(
      page.getByRole("button", { name: "Tạo yêu cầu mới khác" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Kiểm tra máy chủ" }),
    ).toHaveCount(0);

    // 7. Click "Mở Lần chạy để kiểm tra" to navigate to HistoryView (SPA navigation)
    await page.getByRole("link", { name: "Mở Lần chạy để kiểm tra" }).click();
    await expect(page).toHaveURL(/#\/runs$/);
    await expect(page.getByRole("heading", { name: "Lần chạy" })).toBeVisible();

    // History list loads and contains the precreated run with the identical prompt
    await expect(
      page.locator(`a[href*="${precreatedRunId}"]`).first(),
    ).toBeVisible();

    // Refresh history list via "Làm mới" button
    await page.getByRole("button", { name: "Làm mới" }).click();
    await expect(
      page.locator(`a[href*="${precreatedRunId}"]`).first(),
    ).toBeVisible();

    // Verify history load did NOT auto-navigate to the precreated run
    expect(page.url()).toMatch(/#\/runs$/);

    // 8. Navigate back to New Run view via SPA link
    await page.getByRole("link", { name: "Tạo yêu cầu" }).first().click();
    await expect(page).toHaveURL(/#\/new$/);

    // 9. Verify the uncertainty fence is STILL active on NewRunView
    await expect(bannerTitle).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Chờ xác nhận…" }),
    ).toBeDisabled();

    // 10. Attempt keyboard submission (Ctrl+Enter) in the textarea
    await page.locator("#request").focus();
    await page.keyboard.press("Control+Enter");

    // Give time to ensure no network calls are dispatched
    await page.waitForTimeout(500);

    // Verify NO second POST was sent
    expect(postCount).toBe(1);

    // Verify the page did not navigate away to precreated run
    expect(page.url()).toMatch(/#\/new$/);
  });
});
