import { expect, test } from "@playwright/test";
import { openSignedIn } from "./helpers";

test.describe("overview and history", () => {
  test("overview lists runs needing attention as whole-card links", async ({ page }) => {
    await openSignedIn(page, "#/overview");
    const attention = page.getByRole("region", { name: "Cần xử lý" });
    // Pending approval + two reconcile runs with unconfirmed writes; the
    // confirmed reconcile run is not asking for anything.
    await expect(attention.getByRole("link")).toHaveCount(3);
    await expect(
      page
        .getByRole("navigation", { name: "Điều hướng chính" })
        .getByRole("link", { name: "Lần chạy cần xử lý: 3" }),
    ).toBeVisible();
    await attention.getByRole("link", { name: /tuần 38/ }).click();
    await expect(page).toHaveURL(/#\/runs\/7c1e2a90/);
  });

  test("history filters by group and accent-free search", async ({ page }) => {
    await openSignedIn(page, "#/runs");
    await page.getByRole("button", { name: /Không hoàn tất/ }).click();
    await page.getByRole("searchbox").fill("bao cao");
    await expect(page.getByRole("link", { name: /tuần 36/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /tuần 38/ })).toHaveCount(0);
    await page.getByRole("searchbox").fill("khong co gi");
    await expect(page.getByText("Không có lần chạy nào khớp")).toBeVisible();
    await page.getByRole("button", { name: "Bỏ lọc" }).click();
    await expect(page.getByRole("searchbox")).toHaveValue("");
    await expect(page.getByText("12 kết quả")).toBeVisible();
  });

  test("history keeps its filter after visiting a run", async ({ page }) => {
    await openSignedIn(page, "#/runs");
    await page.getByRole("button", { name: /Cần xử lý/ }).click();
    await page.getByRole("link", { name: /tuần 38/ }).click();
    await expect(page).toHaveURL(/#\/runs\/7c1e2a90/);
    await page.goBack();
    await expect(page.getByRole("button", { name: /Cần xử lý/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
