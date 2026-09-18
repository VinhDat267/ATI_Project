import { expect, test } from "@playwright/test";

test.describe("fixture session and navigation", () => {
  test("logs in, navigates with hash history, and requires login after reload", async ({
    page,
  }) => {
    await page.goto("/?scenario=succeeded#/overview", {
      waitUntil: "networkidle",
    });

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

    await page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Tạo yêu cầu" }).click();
    await expect(
      page.getByRole("heading", { name: "Bạn muốn hệ thống làm gì?" }),
    ).toBeVisible();
    expect(page.url()).toContain("#/new");

    await page.goBack();
    await expect(
      page.getByRole("heading", { name: "Tổng quan" }),
    ).toBeVisible();
    await page.goForward();
    await expect(
      page.getByRole("heading", { name: "Bạn muốn hệ thống làm gì?" }),
    ).toBeVisible();

    await page.reload({ waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", { name: "Đăng nhập" }),
    ).toBeVisible();
    const fixtureCalls = await page.evaluate(
      () =>
        (
          window as Window & {
            __WAP_FIXTURE_CALLS__?: Array<{ method: string; path: string }>;
          }
        ).__WAP_FIXTURE_CALLS__ ?? [],
    );
    expect(
      fixtureCalls.filter(
        (call) => call.method === "POST" && call.path !== "/auth/login",
      ),
    ).toEqual([]);
  });

  test("closes the mobile navigation with Escape and returns focus", async ({
    page,
  }) => {
    await page.goto("/?scenario=planning#/overview");
    await page.getByLabel("Email").fill("demo@local");
    await page.getByLabel("Mật khẩu", { exact: true }).fill("synthetic-password");
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await page.setViewportSize({ width: 390, height: 800 });

    // The menu is a modal sheet: while it is open the page behind it is
    // hidden from assistive technology, so the dialog is asserted instead.
    const menuButton = page.getByRole("button", { name: "Mở menu" });
    await menuButton.click();
    const sheet = page.getByRole("dialog", { name: "Menu" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Tổng quan" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(menuButton).toHaveAttribute("aria-expanded", "false");
    await expect(menuButton).toBeFocused();
  });
});
