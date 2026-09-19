import { test, expect } from "./fixtures.js";

test.describe("Live Authentication & In-Memory Isolation", () => {
  test("authenticates with live backend, enforces zero storage, and signs out cleanly", async ({
    page,
    liveContext,
  }) => {
    // 1. Visit root which redirects to login view
    await page.goto(`${liveContext.previewUrl}/#/login`);
    await expect(page.getByRole("heading", { name: "Đăng nhập" })).toBeVisible();

    // 2. Submit valid credentials
    await page.getByLabel("Email").fill(liveContext.email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill(liveContext.password);
    await page.getByRole("button", { name: "Đăng nhập" }).click();

    // 3. Confirm transition to authenticated overview
    await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible();

    // 4. Verify in-memory secret isolation: localStorage and sessionStorage must be completely empty
    const localStorageLength = await page.evaluate(() => window.localStorage.length);
    expect(localStorageLength).toBe(0);

    const sessionStorageLength = await page.evaluate(() => window.sessionStorage.length);
    expect(sessionStorageLength).toBe(0);

    // 5. Sign out via account dropdown
    const accountTrigger = page.getByRole("button", {
      name: new RegExp(`Tài khoản ${liveContext.email}`),
    });
    await expect(accountTrigger).toBeVisible();
    await accountTrigger.click();

    const signOutItem = page.getByRole("menuitem", { name: "Đăng xuất" });
    await expect(signOutItem).toBeVisible();
    await signOutItem.click();

    // 6. Confirm redirect back to login
    await expect(page.getByRole("heading", { name: "Đăng nhập" })).toBeVisible();

    // 7. Verify storage remains clean
    const postLogoutLocal = await page.evaluate(() => window.localStorage.length);
    expect(postLogoutLocal).toBe(0);
    const postLogoutSession = await page.evaluate(() => window.sessionStorage.length);
    expect(postLogoutSession).toBe(0);
  });

  test("rejects invalid credentials with 401 error and leaves storage untouched", async ({
    page,
    liveContext,
  }) => {
    await page.goto(`${liveContext.previewUrl}/#/login`);
    await expect(page.getByRole("heading", { name: "Đăng nhập" })).toBeVisible();

    await page.getByLabel("Email").fill(liveContext.email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill("incorrect-password-test");
    await page.getByRole("button", { name: "Đăng nhập" }).click();

    // Alert banner should appear
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Email hoặc mật khẩu không đúng");

    // Storage remains untouched
    const storageLength = await page.evaluate(
      () => window.localStorage.length + window.sessionStorage.length,
    );
    expect(storageLength).toBe(0);
  });
});
