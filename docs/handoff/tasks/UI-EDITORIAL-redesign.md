# UI-EDITORIAL · Thiết kế lại toàn diện giao diện Workspace Cockpit & các trang ứng dụng

**Trạng thái:** Sẵn sàng review PR · **Nhánh:** `feat/ui-editorial-redesign` · **Ngày:** 08/11/2026.

## Phạm vi

Theo yêu cầu trực tiếp của chủ dự án trong phiên làm việc ngày 07–08/11/2026, thực hiện thiết kế lại toàn bộ trải nghiệm UI/UX của `apps/chat-web` theo chuẩn `design-taste-v21-app-editorial` (`achromatic-ledger`, `draw.mjs --app` + `inspect.mjs --app`), khắc phục các điểm rối mắt, đè chồng bố cục và phân cấp thông tin chưa hợp lý trên toàn bộ các trang:

1. **Thanh điều hướng & Bộ chuyển Không gian làm việc (`MainNav.tsx`, `WorkspaceSwitcher.tsx`, `CockpitHeader.tsx`):**
   - Tách rõ chiều rộng, z-index và sự kiện mở dropdown `WorkspaceSwitcher` để không đè lên tab `Không gian làm việc` và bấm chuyển đổi không gian mượt trên mọi kích thước màn hình.
2. **Cockpit Moments 1–9 (`RequestMoments.tsx`, `ChatComposer.tsx`, `ClarificationMoment.tsx`, `PlanMoment.tsx`, `ExecutionMoment.tsx`, `ReceiptMoment.tsx`, `RecoveryMoment.tsx`, `ScheduleMoment.tsx`, `ResponseMoment.tsx`, `PlanningErrors.tsx`):**
   - Thu gọn khu vực nhập yêu cầu và thanh biến số `{{biến_số}}`, nhóm quy trình mẫu theo tab (`Quy trình trọng tâm`, `Kịch bản liên dịch vụ`, `Tất cả`) và gom chân trang dịch vụ đã kết nối thành 1 hàng gọn.
   - Thiết kế lại `WorkflowFlowCanvas` chế độ `compact` thành thanh pipeline ngang 1 dòng và bảng biên nhận **Achromatic Ledger** cho `ReceiptMoment` (`Moment 6`) & `ExecutionMoment` (`Moment 5`): khóa cứng đỉnh 2 thẻ biên nhận 50/50 (`items-start`) để mở `Chi tiết kỹ thuật` không làm trôi thẻ bên cạnh, loại bỏ emoji trang trí trên mặt hiển thị, gom chân thẻ cùng hàng và đồng nhất thanh hành động `Bước tiếp theo` cao `32px` (`h-8`) với duy nhất 1 nút chính `#1D1F20`.
3. **Các trang vệ tinh (`SettingsPage.tsx`, `ServiceConnectionCard.tsx`, `HistoryPage.tsx`, `ScheduleSection.tsx`, `GuidePage.tsx`, `SlackProposalInbox.tsx`, `UsersPage.tsx`, `AccountPage.tsx`, callback views):**
   - Chuẩn hóa hệ thẻ kết nối dịch vụ (`ServiceConnectionCard`), trang Nhật ký & Lịch tự động, Cẩm nang, Hộp thư đề xuất Slack, Người dùng và Tài khoản theo cùng hệ lưới viền mảnh `1px`, nền `#FAFAFA` / `#FFFFFF`.
   - Đồng bộ `connectionStatus` của `myjira` cá nhân khi `connected: true` về `'healthy'` trong `apps/chat-api/src/routes/services-routes.ts` khớp với các dịch vụ OAuth cá nhân khác.

## Tiêu chí bàn giao

- [x] Rebase sạch trên `origin/main` (`2831d47d`, giữ nguyên toàn bộ hành vi của PR #280 và PR #281).
- [x] `npm run typecheck:v3`, `npm test -w @wap/chat-web` (`114/114` files), `npm run test:eval:v3` (gồm `static-guard` `2/2` PASS), `npm run build:v3` và `node scripts/test-v3-web-build-security.mjs` đều PASS (`exit code 0`).
- [x] Kiểm định thị giác trên trình duyệt Chromium thật với `inspect.mjs --app` (`judgeApp` đạt `0 FAIL` ở cả desktop `1366px` thu gọn/mở rộng JSON, luồng 3 dịch vụ rẽ nhánh, `Moment 5` và mobile `390px` không tràn ngang).
- [x] Không sửa `docs/handoff/CURRENT-STATE.md` hay `docs/handoff/ROADMAP.md`; không đưa credential hay dữ liệu nhạy cảm vào commit.

## Kết quả

Hoàn tất triển khai, rebase trên `origin/main` (`2831d47d`) và vượt qua toàn bộ kiểm định cục bộ (`typecheck:v3`, `114/114` test files `@wap/chat-web` — `1.191/1.191` tests PASS, `31/31` eval files — `500/501` PASS / `1` skipped, `build:v3` + `test-v3-web-build-security` PASS). Chi tiết bằng chứng ghi tại [log bàn giao](../log/2026-11-08-UI-EDITORIAL-redesign.md).
