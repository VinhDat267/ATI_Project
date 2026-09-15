import { test, expect } from "@playwright/test";

test.describe("Build smoke", () => {
  test("renders the fixture login and workspace in a real browser", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Đăng nhập" }),
    ).toBeVisible();
    await page.getByLabel("Email").fill("demo@local");
    await page.getByLabel("Mật khẩu").fill("synthetic-password");
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(
      page.getByRole("heading", { name: "Tổng quan" }),
    ).toBeVisible();
    await expect(page.getByText("Dữ liệu mô phỏng")).toBeVisible();
  });
});
