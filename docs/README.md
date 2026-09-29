# Chỉ mục tài liệu ATI Project

## v3 hiện hành

- [README gốc](../README.md): cài đặt, chạy sandbox/live và lệnh mặc định.
- [Báo cáo dự án](PROJECT-REPORT.md): mục tiêu, kiến trúc, tiến độ; các bảng nghiệm thu cũ được giữ làm ảnh chụp lịch sử.
- [Đặc tả v3](superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md) và [kế hoạch 28 tasks](superpowers/plans/2026-09-29-ai-workflow-platform-v3.md): hành vi thiết kế và lộ trình ban đầu.
- [Kết quả rà soát lại](audits/2026-09-29-v3-review/REMEDIATION-RESULTS.md): mốc 198/198 của đợt khắc phục và giới hạn chưa xác minh; [README gốc](../README.md) ghi số test hiện tại sau chỉnh lối chạy.
- [Quy tắc Git và evidence](GIT-POLICY.md): giữ nguyên log, checkpoint và migration đã theo dõi.

## v2 lịch sử

- [Hướng dẫn B/local](00-BAT-DAU.md), các báo cáo `*-STATUS*.md`, `*-evidence/`, `plans/2026-09-22-mvp-v2-backend/` và `archive/` ghi lại quá trình v2. Lệnh trong các báo cáo thời điểm đó phản ánh CLI lúc báo cáo được viết; các lệnh gốc hiện chạy v3. Dùng hậu tố `:v2` để tái hiện các gate được hỗ trợ.
- Các script v2, migration và evidence được giữ để đối chứng; không suy ra production readiness của v3 từ kết quả v2.

## Quy tắc dọn file sinh ra

- `dist/`, `generated/` và output build/test bị Git bỏ qua có thể tạo lại bằng lệnh build hoặc test tương ứng. Chỉ dọn sau khi xác nhận không có tiến trình đang dùng và đường dẫn không chứa file được Git theo dõi.
- `.artifacts/`, `.cache/`, `.playwright-mcp/` và `runtime/` có thể chứa capture, quan sát hoặc dữ liệu chạy thử chưa được đưa vào Git; xem từng mục trước khi quyết định lưu hay xóa.
- Giữ `node_modules/` khi còn phát triển và `.codegraph/` khi còn dùng chỉ mục. Giữ các thư mục evidence và `archive/` đã theo dõi theo [chính sách Git](GIT-POLICY.md).
