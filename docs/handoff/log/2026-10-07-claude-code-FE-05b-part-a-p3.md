# 2026-10-07 · claude-code · FE-05b phần (a), sửa 3 P3 sau review lại

- **Đã làm:**
  - Review lại phần sửa của Codex trong PR #100 (`7474efb..60d1b84`): Đạt, còn 3 P3. Người dùng giao Claude Code sửa luôn trong cùng PR.
  - **Câu hỏi lại từ SSE** (`apps/chat-web/src/hooks/use-sse.ts`): chỉ giữ `context` và các lựa chọn là chuỗi khác rỗng; `question` không phải chuỗi thì dùng câu mặc định. Validator của planner chỉ kiểm `question`, app không có error boundary, nên `context` là object làm cả trang trắng (`option.trim is not a function` với lựa chọn không phải chuỗi).
  - **`apps/chat-web/src/prototype/theme.css`**: bỏ 2 quy tắc `bg-purple-500/5` Codex thêm cho Slack, file trở lại khớp nguyên văn `docs/design/prototypes/theme.css` (chỉ khác dòng ghi nguồn). Hai quy tắc có giá trị bằng đúng giá trị Tailwind tự sinh, nên bỏ đi không đổi giao diện. Thêm test giữ cho file khớp bản gốc.
  - **Logo Slack** (`assets/cockpit-services.json`, `ServiceLogo.tsx`): thay logo một màu `#611f69` (gần như không thấy ở chế độ tối) bằng logo bốn màu chép từ `AppStagePage.tsx`; script kiểm từng `path` có trong file nguồn. `ServiceLogo` có thêm `mono` để vẽ bằng `currentColor`, dùng ở hàng "Chưa kết nối".
- **PR / commit:** PR #100, nhánh `feat/fe-05b-cockpit-parity-a`; commit mã `65f2c9a`, làm trên worktree riêng tách từ `60d1b84`.
- **Kiểm tra đã chạy (lệnh và kết quả):** PostgreSQL tạm (tmpfs) ở 55533, sandbox, tài khoản test của CI.
  - RED (`npx vitest run tests/fe-05b-parity-a.test.tsx tests/fe-04b-prototype-foundation.test.tsx`): 3 failed / 27 passed, exit 1. Lý do: theme.css khác bản gốc; `TypeError: option.trim is not a function`; logo Slack chỉ có một `path`.
  - GREEN: chat-web 450/450. Một test của Codex kiểm `fill="#611f69"` cho lựa chọn "Slack" được đổi sang kiểm bốn màu.
  - Thử bỏ phần thêm sau RED: bỏ `mono` → 1 fail; bỏ kiểm kiểu `context` → 1 fail.
  - `npm run check`: exit 0; v3 1.407 = 47 + 340 + 196 + 25 + 349 + 450; eval 165.
  - `npm run test:browser:v3`: exit 0, 61/61 qua 11 nhóm.
  - App thật, 4 dịch vụ giả: logo Slack bốn màu thấy rõ ở chế độ tối trong thẻ gợi ý và chip "Đã kết nối"; các phép đo của lần review (thẻ gợi ý, viền focus, trạng thái đang tải/lỗi, focus 5 → 6) giữ nguyên kết quả.
  - Trong lần review lại, một lần chạy browser có 1 ca chập chờn: `FE-04: retained landing comparison copy … light` hết 30 giây chờ trang giới thiệu; chạy riêng 10/10 và chạy lại toàn bộ 61/61. Chưa rõ nguyên nhân.
- **Chưa làm / vấn đề phát hiện:**
  - Commit này do Claude Code viết và tự kiểm; nên có người khác xem lại (review độc lập).
  - Logo Jira (`#0052cc`) cũng tối trên nền tối; chưa đo, để FE-10.
- **Việc tiếp theo đề xuất:** merge PR #100 khi người dùng đồng ý; sau đó cập nhật CURRENT-STATE/ROADMAP (ghi cả #98, #99, #100) và giao FE-05b phần (b).
