import { test, expect } from "@playwright/test";

test.describe("Build smoke", () => {
  test("renders the fixture login and workspace in a real browser", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("AI Automation Platform");
    await expect(page.getByText("AI Automation Platform", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Đăng nhập" }),
    ).toBeVisible();
    await page.getByLabel("Email").fill("demo@local");
    await page.getByLabel("Mật khẩu", { exact: true }).fill("synthetic-password");
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(
      page.getByRole("heading", { name: "Tổng quan" }),
    ).toBeVisible();
    await expect(page.getByText("Dữ liệu mô phỏng")).toBeVisible();
    for (const width of [375, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole("link", { name: "AI Automation Platform — Tổng quan" })).toBeVisible();
      await expect(page.getByText("AI Automation Platform", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });
});
