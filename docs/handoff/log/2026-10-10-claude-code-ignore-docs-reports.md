# 2026-10-10 · claude-code · ignore docs/reports

- **Đã làm:** thêm `docs/reports/` vào `.gitignore`. Thư mục này ở máy nhóm trưởng chứa báo cáo môn học (`.docx`), trước đây untracked nhưng chưa bị ignore; quy tắc ở CURRENT-STATE mục 1 và 7 cấm commit báo cáo lên repo công khai. Phát hiện khi audit trạng thái dự án cùng ngày. Theo yêu cầu người dùng, thêm luôn `.github/agents` và `.github/hooks` (cấu hình agent và hook riêng ở máy nhóm trưởng, trước đó chỉ có trong thay đổi chưa commit của người dùng).
- **PR / commit:** nhánh `chore/ignore-docs-reports`.
- **Kiểm tra đã chạy (lệnh và kết quả):** tạo file thử `docs/reports/probe.docx`, `git check-ignore -v` trả `.gitignore:74:docs/reports/`, `git status` không liệt kê file thử; đã xoá file thử. `git diff --check` exit 0. Không chạy test ứng dụng (chỉ sửa ignore và tài liệu).
- **Chưa làm / vấn đề phát hiện:** không có.
- **Việc tiếp theo đề xuất:** không có.
