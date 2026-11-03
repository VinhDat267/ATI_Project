# 02/11/2026 · Planora · Handoff chi tiết và PR tài liệu

- **Yêu cầu:** viết handoff chi tiết cho kế hoạch đổi toàn bộ giao diện sang Planora rồi mở PR.
- **Task:** [PLANORA-00](../tasks/PLANORA-00-ui-migration-plan.md).
- **Nhánh/base:** `codex/planora-migration-plan`, base main `1977ec7dc9735e058b64440f965e214b0751fbf8`; commit kế hoạch có sẵn `23b3eefa642b0970c153cb334a6c672ae1ea8641`.
- **Đã làm:** [handoff chi tiết](../PLANORA-MIGRATION-HANDOFF.md) ghi yêu cầu đã chốt, proposal chưa duyệt, mốc/source Git, PR cũ, kiến trúc giữ logic main, giao diện thiếu, thứ tự 15 task, bất biến, cách nhận PL-01, môi trường kiểm thử, bằng chứng/giới hạn và prompt giao việc. Cập nhật Kết quả/link của PLANORA-00; spec/plan cũ đi cùng PR.
- **Đã xác minh GitHub:** main vẫn `1977ec7`; chưa có PR mở từ nhánh tài liệu này trước phiên. PR #262 OPEN/DRAFT/CONFLICTING, giữ làm nguồn tham khảo.
- **Kiểm tra tài liệu:** `python .cache/planora-handoff-check.py` (checker cục bộ, không commit): **exit 0**. Output: `PASS: 6 Markdown files; 19 local links; 22 route entries; 13 Cockpit states; 8 callback views; PL-01..15 match plan/handoff.` Checker đọc sáu tài liệu, routes.ts/cockpit-moment.ts và tám callback, kiểm link tương đối, thứ tự task, EOF/whitespace, mẫu credential phổ biến và tập file diff so với origin/main.
- **Diff:** `git -c core.whitespace=cr-at-eol diff --cached --check`: **exit 0**. Diff toàn PR chỉ sáu Markdown, không có product code hoặc CURRENT-STATE/ROADMAP.
- **Review độc lập:** **Đạt cho PR tài liệu**, không có finding P1/P2/P3. Reviewer đọc actual diff sáu Markdown, đối chiếu code/source Git và checklist; chạy lại `python .cache/planora-handoff-check.py`, `git diff --check origin/main`, `git diff --cached --check`: cả ba **exit 0**. Kết quả review này chỉ áp dụng tài liệu, không chứng nhận runtime/visual parity.
- **Môi trường kiểm tra:** WindowsApps Python alias không khởi động được trong lượt sandbox giới hạn; checker đã chạy thành công trong lượt được cấp quyền. Lượt không khởi động được interpreter không được tính là bằng chứng kiểm thử hành vi.
- **Phạm vi PR:** chỉ sáu tài liệu thuộc PLANORA-00; không có product code hoặc CURRENT-STATE/ROADMAP.
- **Chưa chạy:** unit/integration/eval/typecheck/build/browser/model/provider live cục bộ vì thay đổi chỉ là Markdown. CI repo có thể chạy full check/browser khi mở PR; trạng thái được báo riêng, không suy ra từ validation tài liệu.
- **Chưa làm:** chuyển giao diện, bắt đầu PL-01, chụp mẫu, bật flag, thay DB, đóng/merge #262, merge/deploy tài liệu hoặc sản phẩm. Chọn bố cục Planora đã được chốt, còn chi tiết thiết kế/kế hoạch vẫn dự thảo.
- **Bàn giao:** reviewer xem spec/plan/handoff và giới hạn kiểm chứng; chủ dự án duyệt trước khi nhận task triển khai. PR/link/commit cuối được trả trong chat và có thể tra bằng `gh pr list --head codex/planora-migration-plan`.
