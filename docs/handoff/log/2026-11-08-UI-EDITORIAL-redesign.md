# UI-EDITORIAL — Thiết kế lại giao diện Workspace Cockpit & các trang ứng dụng (`achromatic-ledger`)

- **Ngày:** 08/11/2026 (Asia/Saigon)
- **Nhánh:** `feat/ui-editorial-redesign` (rebase trực tiếp trên `origin/main` tại `2831d47d78dd0bc21fd66377c080ecbbf830d2bb`, bao gồm PR #280 và PR #281)
- **Commit triển khai:** `b42f00d2c6286800b851aa49833482a513bba48c`
- **Task card:** [`docs/handoff/tasks/UI-EDITORIAL-redesign.md`](../tasks/UI-EDITORIAL-redesign.md)

## 1. Tóm tắt thay đổi

1. **Điều hướng & Bộ chọn Không gian làm việc (`MainNav.tsx`, `WorkspaceSwitcher.tsx`, `CockpitHeader.tsx`):**
   - Khắc phục triệt để lỗi pill `WorkspaceSwitcher` đè lên chữ `Không gian làm việc` và lỗi không bấm mở được menu chuyển đổi không gian.
2. **Cockpit Moments 1–9 & Sơ đồ luồng (`WorkflowFlowCanvas.tsx`, `RequestMoments.tsx`, `ChatComposer.tsx`, `ClarificationMoment.tsx`, `PlanMoment.tsx`, `ExecutionMoment.tsx`, `ReceiptMoment.tsx`, `RecoveryMoment.tsx`, `ScheduleMoment.tsx`, `ResponseMoment.tsx`, `PlanningErrors.tsx`):**
   - Thiết kế lại trang bắt đầu (`Moment 1`) với thanh điền biến số gọn, bộ lọc tab quy trình mẫu (tự động ẩn quy trình Gmail khi cờ Gmail tắt, giữ CTA `Kết nối Gmail` khi bật cờ nhưng chưa nối — bảo toàn hợp đồng PR #281) và thanh trạng thái kết nối 1 dòng.
   - Chuyển `WorkflowFlowCanvas` ở chế độ `compact` sang thanh pipeline ngang 1 dòng (`GitHub · Tạo mới ---- Slack · Gửi tin` cùng hàng với chip ánh xạ dữ liệu).
   - Thiết kế lại `ReceiptMoment` (`Moment 6`) và `ExecutionMoment` (`Moment 5`) theo hướng **Achromatic Ledger** (`design-taste-v21-app-editorial`):
     - Đổi lưới `#receipt-chain` từ 3 cột căn giữa sang 2 cột `md:grid-cols-2 items-start gap-4`, đưa nhãn truyền biến vào thẻ nhận (`↳ Từ Việc 1: url`) để khi bung `Chi tiết kỹ thuật` ở thẻ trái, thẻ phải vẫn giữ nguyên tọa độ đỉnh (`card1Top = 320px === card2Top = 320px`).
     - Ưu tiên tiêu đề thực tế của kết quả thay vì lặp `Issue #N`, gom `Chi tiết kỹ thuật` và thời lượng (`tabular-nums`) lên cùng 1 hàng chân thẻ khi không có link ngoài, tách thanh header tool/timestamp cho khối `<pre>` JSON cuộn ngang không gãy URL.
     - Chuẩn hóa thanh `Bước tiếp theo` về cao độ đồng nhất `32px` (`h-8`) với duy nhất 1 nút chính `#1D1F20`.
3. **Các trang ứng dụng & Đồng bộ trạng thái dịch vụ (`Settings/`, `History/`, `Guide/`, `Users/`, `Account/`, `SlackProposalInbox.tsx`, `views/*CallbackView.tsx`, `services-routes.ts`):**
   - Bổ sung `ServiceConnectionCard.tsx` và đồng bộ giao diện toàn bộ trang Cài đặt kết nối, Nhật ký & Lịch chạy định kỳ, Cẩm nang, Hộp thư đề xuất Slack, Người dùng, Tài khoản và các màn callback OAuth.
   - Giữ mã nguồn sạch chuẩn `static-guard`: truy xuất tài khoản `plan.connections` động theo catalog trong `PlanMoment.tsx`, gom `SCHEDULE_EVENT_TEMPLATES` vào `job-readiness.ts` và dùng mã `myslack` cho biểu tượng `PersonalSlack.tsx`.

## 2. Bằng chứng kiểm thử thực tế

- **Typecheck:** `npm run typecheck:v3` → **PASS (`exit code 0`)**.
- **Unit & Integration Tests (`@wap/chat-web`):** `npm test -w @wap/chat-web` → **`114/114` test files PASS (`1.193/1.193` tests PASS, `exit code 0`)**.
- **API Route Tests (`@wap/chat-api`):** `npm test -w @wap/chat-api -- tests/routes/myjira-app-wiring.test.ts` → **`17/17` tests PASS (`exit code 0`)**.
- **Evaluation & Static Guard Suite:** `npm run test:eval:v3` → **`31/31` test files PASS (`500` passed, `1` skipped, `exit code 0`)**, trong đó `evaluations/generic-plumbing/static-guard.test.ts` đạt **`2/2` PASS (`0` vi phạm)**.
- **Production Bundle & Security Sentinel Check:** `npm run build:v3 && node scripts/test-v3-web-build-security.mjs` → **PASS (`PASS: production build excludes credential sentinels and 8 forbidden UI claims`, `exit code 0`)**.
- **Playwright Browser E2E (`scripts/test-v3-browser.mjs`):** **`23/23` kịch bản E2E PASS (`exit code 0`)**, bao gồm `slack_assistant`, `slack_write`, `slack_read`, `slack_oauth`, `default` (`FE-02` → `FE-12`), `auth02`, `auth04`, `clarification`, `partial_failure`, `three_service`, `four_service`, `nine_service`, `sheets_slack`, `calendar_slack`, `notion_slack`, `telegram_slack`, `jira_slack`, `answer`, `gmail`, `mycalendar`, `mysheets`, `schedule`.
- **Kiểm định thị giác Chromium + `inspect.mjs --app` (`judgeApp`):** **`0 FAIL`** trên cả 5 kịch bản (Desktop `1366px` thu gọn, Desktop `1366px` bung `Chi tiết kỹ thuật`, Fan-out 3 dịch vụ, `Moment 5` đang thực thi, Mobile `390px` `no-horizontal-overflow: true`).

## 3. Ranh giới

- Bản PR này chỉ thay đổi tầng giao diện hiển thị (`apps/chat-web`) và 1 dòng đồng bộ trạng thái `healthy` của `myjira` cá nhân trong `apps/chat-api/src/routes/services-routes.ts`; không thay đổi schema DB, planner prompt, executor hay bất kỳ luồng bảo mật OAuth/token nào của PR #280 & #281.
- Không sửa `docs/handoff/CURRENT-STATE.md` và `docs/handoff/ROADMAP.md` (dành cho reviewer cập nhật sau khi merge).
