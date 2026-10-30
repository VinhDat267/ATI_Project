# JIRA-00 · Thiết kế Jira OAuth cá nhân và workspace ATI

**Trạng thái:** thiết kế được chủ dự án duyệt 31/10/2026; chuyển sang lập kế hoạch/thi công JIRA-01, chưa nghiệm thu tính năng.
**Ngày:** 30/10/2026. **Phạm vi:** chỉ tài liệu. **Nhánh:** `codex/docs-jira-oauth-workspaces`.
**Nền:** `origin/main` tại `fc12e3fbd683f9ffee53322b4f5fc132d50fc2ac`.

## Yêu cầu

Chủ dự án yêu cầu brainstorm một kế hoạch chi tiết sau khi đã chọn: Jira cá nhân, nhiều site, workspace ATI tự quản lý, duyệt ở ATI và quyền Jira native, chỉ admin hệ thống tạo workspace. Trong phiên này xác nhận thêm workspace chỉ quản lý Jira trước.

## Sản phẩm tài liệu

- [Thiết kế và lộ trình đề xuất](../../superpowers/specs/2026-10-30-jira-personal-workspaces-design.md): yêu cầu và mặc định đề xuất tách biệt, quyền, onboarding, dữ liệu, OAuth/token, API, planner/executor, thu hồi quyền, lộ trình JIRA-01–11, kiểm thử và rollout.
- Một log phiên mới; không sửa CURRENT-STATE, ROADMAP, task khác, source, config hay dependency.

## Tiêu chí

- [x] Đúng quyết định của chủ dự án, không ghi đề xuất của agent thành lựa chọn đã duyệt.
- [x] Dựa trên origin/main mới, ghi rõ phần Google/Slack hiện có và phần Jira còn thiếu.
- [x] Nêu cổng khả thi cho tài khoản chưa có quyền site và điều chưa được kiểm thật.
- [x] Có ranh giới owner/site/workspace/project, chống dùng token chung hoặc stale history để vượt quyền.
- [x] Có lộ trình theo ownership, phụ thuộc, bằng chứng, rollback và giới hạn scope.
- [x] Builder độc lập đọc tài liệu; câu hỏi quan trọng được xử lý hoặc chuyển chủ dự án.
- [x] Kiểm whitespace/link/file tham chiếu cho tài liệu đạt; không tuyên bố test sản phẩm/live đã chạy.

## Kết quả

- Có bản thiết kế 15 mục và lộ trình 11 phần việc JIRA-01–11, các đề xuất chưa duyệt được đánh dấu riêng.
- Builder context mới chỉ đọc, trả “nothing important left”; đây là kiểm độ đủ của thiết kế để lập kế hoạch, không phải review mã hoặc nghiệm thu sản phẩm.
- Kiểm tài liệu: ba Markdown, bốn local links, 15 mục, 11 milestone và hai source reference hiện hữu đạt, exit 0. `git diff --cached --check` đạt, exit 0; kiểm lại trước commit.
- Không sửa product code/CURRENT-STATE/ROADMAP; không chạy product suite, model, OAuth hay Jira thật. Không mở PR triển khai.
- Chủ dự án duyệt ngày 31/10 bằng “Được thực hiện giúp tôi đi”. Đã tạo [card JIRA-01](JIRA-01-oauth-feasibility.md) và [kế hoạch đầu tiên](../../superpowers/plans/2026-10-31-jira-oauth-feasibility.md); các phần phụ thuộc chưa được vượt cổng khả thi. Kết quả ngày 30/10 phía trên được giữ làm lịch sử, không suy ra đã kiểm Jira thật.
