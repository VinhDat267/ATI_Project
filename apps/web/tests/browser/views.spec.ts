import { expect, test } from "@playwright/test";
import { fixtureCalls, openSignedIn } from "./helpers";

test.describe("tools", () => {
  test("shows server status and re-checks with one GET", async ({ page }) => {
    await openSignedIn(page, "#/tools");
    await expect(page.getByText("Đã kết nối")).toBeVisible();
    await expect(page.getByText("Đang tắt theo cấu hình")).toBeVisible();
    const before = (await fixtureCalls(page)).filter((c) => c.path === "/servers").length;
    await page.getByRole("button", { name: "Kiểm tra lại" }).click();
    await expect(page.getByRole("button", { name: "Kiểm tra lại" })).toBeEnabled();
    const after = (await fixtureCalls(page)).filter((c) => c.path === "/servers").length;
    expect(after).toBe(before + 1);
  });
});

test.describe("request composer", () => {
  test("creates a run from a prompt and opens it", async ({ page }) => {
    await openSignedIn(page, "#/new");
    await page.getByRole("button", { name: "Lập kế hoạch" }).click();
    await expect(page.getByText("Nhập yêu cầu trước khi lập kế hoạch.")).toBeVisible();
    await page.getByLabel("Yêu cầu").fill("Gửi tiêu đề thẻ mới vào #nhom-ati");
    await page.getByRole("button", { name: "Lập kế hoạch" }).click();
    await expect(page).toHaveURL(/#\/runs\/e5a0c7d3-/);
    const calls = await fixtureCalls(page);
    expect(calls.filter((c) => c.method === "POST" && c.path === "/runs")).toHaveLength(1);
  });

  test("rejects a malformed input value before sending", async ({ page }) => {
    await openSignedIn(page, "#/new");
    await page.getByLabel("Yêu cầu").fill("Liệt kê thẻ");
    await page.getByText("Tuỳ chọn nâng cao").click();
    await page.getByRole("button", { name: "Thêm giá trị" }).click();
    await page.getByLabel("Khoá").fill("Bad Key");
    await expect(page.getByText(/Khoá dùng chữ thường/)).toBeVisible();
    await page.getByRole("button", { name: "Lập kế hoạch" }).click();
    const calls = await fixtureCalls(page);
    expect(calls.filter((c) => c.method === "POST" && c.path === "/runs")).toHaveLength(0);
  });
});

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
        .getByRole("link", { name: "Danh sách công việc cần xử lý: 3" }),
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
