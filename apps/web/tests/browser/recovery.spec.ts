import { expect, test } from "@playwright/test";
import { IDS, fixtureCalls, openSignedIn } from "./helpers";

const NO_REPLAY = /chạy lại|thử lại|retry|resume|đã giải quyết|gửi lại tự động/i;

test.describe("run detail and recovery", () => {
  test("reconcile question prefills a message-only request", async ({ page }) => {
    await openSignedIn(page, `#/runs/${IDS.reconcile}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("tuần 37");
    await expect(page.getByRole("button", { name: NO_REPLAY })).toHaveCount(0);
    const group = page.getByRole("group", { name: /đã có 4 dòng đã gửi/ });
    await expect(group.getByRole("link")).toHaveCount(2);
    await group.getByRole("link", { name: /Đã thấy đủ 4 dòng/ }).click();
    await expect(page).toHaveURL(/#\/new$/);
    await expect(page.getByLabel("Yêu cầu")).toHaveValue(/^Báo vào #nhom-ati rằng/);
    await expect(page.getByText(/bạn trả lời “Đã thấy”/)).toBeVisible();
  });

  test("not-seen answer prefills the full request with a warning", async ({ page }) => {
    await openSignedIn(page, `#/runs/${IDS.reconcile}`);
    await page.getByRole("link", { name: /Không thấy/ }).click();
    await expect(page.getByLabel("Yêu cầu")).toHaveValue(/^Chép tiến độ tuần 37/);
    await expect(page.getByText(/bạn trả lời “Không thấy”/)).toBeVisible();
  });

  test("conflict offers guidance instead of recreating", async ({ page }) => {
    await openSignedIn(page, `#/runs/${IDS.reconcileConflict}`);
    const differs = page.getByRole("button", { name: /Thấy nhưng khác nội dung/ });
    await expect(differs).toHaveAttribute("aria-expanded", "false");
    await differs.click();
    await expect(page.getByText(/Sửa trực tiếp trên bảng/)).toBeVisible();
  });

  test("confirmed reconcile offers a message-only request", async ({ page }) => {
    await openSignedIn(page, `#/runs/${IDS.reconcileConfirmed}`);
    await expect(page.getByText("Đã đối chiếu: thao tác ghi đã vào nơi nhận")).toBeVisible();
    await page.getByRole("link", { name: "Tạo yêu cầu chỉ gửi thông báo" }).click();
    await expect(page.getByLabel("Yêu cầu")).toHaveValue(/^Báo vào #nhom-ati/);
  });

  test("expired run reuses its prompt", async ({ page }) => {
    await openSignedIn(page, `#/runs/${IDS.expired}`);
    await page.getByRole("link", { name: "Dùng lại yêu cầu này" }).click();
    await expect(page.getByLabel("Yêu cầu")).toHaveValue("Chép tiến độ tuần 36 sang “Báo cáo tuần”");
    await expect(page.getByText(/Dùng lại yêu cầu của lần chạy 0f7b52e3/)).toBeVisible();
  });

  test("needs-input run offers the planner suggestion", async ({ page }) => {
    await openSignedIn(page, `#/runs/${IDS.needsInput}`);
    await page.getByRole("link", { name: "Dùng câu gợi ý này" }).click();
    await expect(page.getByLabel("Yêu cầu")).toHaveValue(/board_a, hạn 20\/09\/2026/);
  });

  test("refused run only offers a new request", async ({ page }) => {
    await openSignedIn(page, `#/runs/${IDS.refused}`);
    await expect(page.getByText(/Không có công cụ dịch văn bản/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Tạo yêu cầu mới" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Dùng lại/ })).toHaveCount(0);
  });

  test("approval sends the exact snapshot once", async ({ page }) => {
    await openSignedIn(page, `#/runs/${IDS.approval}`);
    await expect(page.getByRole("timer")).toBeVisible();
    await expect(page.getByText("Thêm 3 dòng vào “Báo cáo tuần”").first()).toBeVisible();
    const approve = page.getByRole("button", { name: "Duyệt 2 thao tác ghi" });
    await expect(approve).toHaveAttribute("aria-describedby", "write-summary expiry");
    await approve.click();
    await expect(page.getByText("Đang thực thi").first()).toBeVisible();
    const calls = await fixtureCalls(page);
    expect(calls.filter((c) => c.method === "POST" && c.path.endsWith("/approval"))).toHaveLength(1);
  });

  test("failed run explains the error without blaming #nhom-ati", async ({ page }) => {
    await openSignedIn(page, `#/runs/${IDS.failed}`);
    await expect(page.getByRole("heading", { name: "Chi tiết lỗi" })).toBeVisible();
    await expect(page.getByText("Chắc chắn chưa ghi")).toBeVisible();
    await expect(page.getByText(/#thong-bao-cu/).first()).toBeVisible();
  });
});
