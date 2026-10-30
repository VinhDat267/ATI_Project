# 30/10/2026 · JIRA-00 · Thiết kế Jira OAuth và workspace ATI

**Yêu cầu:** brainstorm và cung cấp một kế hoạch chi tiết; chỉ tài liệu, chưa triển khai tính năng.
**Nhánh:** `codex/docs-jira-oauth-workspaces`. **Nền:** `fc12e3fbd683f9ffee53322b4f5fc132d50fc2ac`.

## Bối cảnh

- Checkout ban đầu `D:/ATI_Project/ATI_Project` ở nhánh SCHED-03 tại `91642f4`, có `.gitignore` sửa chưa commit không thuộc task; giữ nguyên.
- Đọc trạng thái/bàn giao và các log mới; phát hiện origin/main đã có OAUTH-01/02/03 và SLACK-01 foundation mới hơn checkout ban đầu. Dùng worktree native mới từ origin/main, không chuyển nhánh checkout gốc.
- Worktree: `C:/Users/Admin/.codex/worktrees/jira-oauth-design/ATI_Project`. Git trong sandbox không truy cập đầy đủ thư mục mới; kiểm ngoài sandbox xác nhận sạch và tạo nhánh riêng. Không sửa cấu hình Git để né lỗi quyền.
- Chủ dự án xác nhận trong phiên: workspace quản lý Jira trước, chưa áp dụng cho các dịch vụ khác.

## Tài liệu

- [Thiết kế](../../superpowers/specs/2026-10-30-jira-personal-workspaces-design.md).
- [Task tài liệu](../tasks/JIRA-00-oauth-workspaces-design.md).
- Lộ trình JIRA-01–11 là đề xuất chờ duyệt; chưa tạo task card thi công, không sửa CURRENT-STATE/ROADMAP.
- Đưa cổng kiểm identity-only/no-site lên đầu; không coi tài liệu `/me` hoặc OAuth fixture là bằng chứng onboarding thật đã chạy.

## Kiểm tra và review

- Builder context mới đọc tài liệu và trả đúng kết luận “nothing important left”. Không có câu hỏi sản phẩm mới cần hỏi chủ dự án từ lượt này. Những mặc định đã ghi “Đề xuất” vẫn chờ chủ dự án duyệt; không coi kết luận builder là phê duyệt của chủ dự án.
- Parent kiểm thêm và làm rõ hai đường dễ bỏ sót: route test/lookup legacy không dùng Basic token khi cờ cá nhân bật; model output về muộn/SSE nội dung nguồn phải qua guard persist/publish.
- Static validator chạy bằng Python có sẵn: **PASS, exit 0**, ba Markdown, bốn liên kết local, 15 mục, 11 milestone và hai file source được tham chiếu đều tồn tại. Đây là kiểm cấu trúc/liên kết, không phải unit/integration test.
- `git diff --cached --check`: **exit 0**; chỉ stage ba file task tài liệu. Kiểm lại sau cập nhật cuối trước commit.
- Không chạy code tests, model hoặc Jira live cho thay đổi chỉ tài liệu này. Không tạo app Atlassian, không đọc hoặc in `.env`, không có thao tác ghi Jira.
- Chưa mở PR; bản nháp còn chờ chủ dự án duyệt. Không sửa CURRENT-STATE/ROADMAP và không tạo task card thi công JIRA-01–11 trước khi duyệt thiết kế.
