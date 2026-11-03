# 02/11/2026 · Planora · Khảo sát và kế hoạch migration giao diện

- **Yêu cầu:** chuyển toàn bộ giao diện hiện tại về Planora cũ; lập kế hoạch và chỉ ra màn thiếu. Chủ dự án xác nhận khôi phục cả bố cục sidebar/chat.
- **Task:** [PLANORA-00](../tasks/PLANORA-00-ui-migration-plan.md).
- **Nhánh:** `codex/planora-migration-plan`, worktree riêng tạo từ main `1977ec7dc9735e058b64440f965e214b0751fbf8`. Không chuyển nhánh hoặc sửa thay đổi .gitignore chưa commit ở thư mục gốc.
- **Source thị giác:** `Frontend_UXUI@ef13c5695ce2da030ff613422b4f8d6e1d7e72c3`; bản design chuẩn hóa `codex/docs/planora-design@6b324aa` được đánh dấu còn draft.
- **Đã làm:** spec/inventory phân biệt có mẫu/thiếu Planora, kế hoạch 15 task, card này và nhật ký. Bổ sung đầy đủ workspace, auth nâng cao, OAuth/scope/Jira, lịch/digest, account/admin, help/privacy/404, dark mode và state phục hồi.
- **Đề xuất:** nền main + lớp trình bày Planora, giữ domain/API/store/hooks; không merge #262. Phần thay hình thức/phương pháp chuyển đổi chưa phải code đã triển khai.
- **Builder check:** reviewer độc lập chỉ đọc spec/code, không sửa/không chạy test; kết luận “nothing important left”, đã đối chiếu 22 route entries và 13 trạng thái selectMoment.
- **Kiểm thực tế:** Python assertions đọc routes.ts, cockpit-moment.ts và hai tài liệu, kiểm 22 route entries, 13 state, PL-01 đến PL-15 đúng thứ tự, 8 callback view và 24 path hiện có, link spec tồn tại và không trailing whitespace. **exit 0**. Output: `PASS: 22 route entries; 13 Cockpit states; 15 sequential task IDs; 8 callback views; 24 existing source paths; plan/spec link; no trailing whitespace.`
- **Diff check:** `git -c core.whitespace=cr-at-eol diff --cached --check`: **exit 0**; chỉ bốn tài liệu của PLANORA-00. SHA tài liệu lấy bằng `git log -1 --format=%H` tại nhánh này.
- **Chưa làm:** sửa product code, cài dependency, dựng app/ảnh, chạy unit/integration/browser hoặc model/provider thật, đổi DB/flags, đóng/merge PR #262, tạo PR triển khai, sửa CURRENT-STATE/ROADMAP. Không có kết luận đã đạt visual parity.
- **Việc tiếp theo:** chủ dự án duyệt đề xuất và kế hoạch; khi thi công khóa lại main mới nhất, tạo task card từng PL-xx, chụp baseline và duyệt bốn mẫu ở PL-01 trước khi chuyển hàng loạt.
