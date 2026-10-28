# 28/10/2026 · Thiết kế Slack OAuth cá nhân

**Task:** [OAUTH-04](../tasks/OAUTH-04-slack-personal.md) · **Nhánh:** `docs/slack-oauth-design`.
**Nền đối chiếu:** `b437f985d479d3a9d413ddd3fb2361eceedf6d5e`.
**Trạng thái:** tài liệu đang chờ duyệt; chưa có triển khai.

## Quyết định từ trao đổi

- Thao tác dưới danh nghĩa user Slack, hỗ trợ Free/Pro và mọi API tương ứng quyền thực tế.
- Một người ATI kết nối nhiều workspace; tiếp cận mọi kênh/DM được phép.
- Có cả luật, AI đánh giá tin mới và kết hợp; chọn riêng theo từng user/workspace.
- Trợ lý gợi ý công việc liên dịch vụ; đề xuất và duyệt **trong ATI**.
- Sau câu hỏi từ builder check, chủ dự án chọn: **việc liên quan đến tôi hoặc thread tôi theo dõi**, không gom mọi việc trong hội thoại được đọc.

## Tài liệu và đối chiếu

- [Thiết kế đầy đủ](../../superpowers/specs/2026-10-28-slack-personal-oauth-design.md), [task thiết kế](../tasks/OAUTH-04-slack-personal.md).
- Đọc handoff hiện hành, log mới nhất và mã credential/adapter/catalog/plan binding. Slack chung hiện dùng bot token và chưa giải quyết nhiều workspace cá nhân.
- Tra tài liệu Slack chính thức: user token/OAuth, gói Free/Pro, method catalog, Events API/authorizations, rotation/revoke, PKCE, metadata và rate limits. Link nguồn ở gần từng khẳng định trong thiết kế.
- Mặc định hybrid, tên `myslack`, hai feature flag tắt, token rotation, giới hạn/retention và bản tổng hợp tùy chọn là **đề xuất của người viết**, không gán cho người dùng.
- Builder nêu ba điểm: mức liên quan công việc, mô hình phân phối app, nguồn xác định việc còn mở. Đã hỏi và nhận câu trả lời của chủ dự án cho điểm đầu. Hai điểm còn lại ghi thành đề xuất rõ: phân phối OAuth ngoài Marketplace; tổng hợp từ proposal ATI và chỉ khẳng định trạng thái task ngoài khi có readback/xác nhận, không đồng bộ liên tục.

## Kiểm tra

- Builder check độc lập: ba câu hỏi đã xử lý như trên; lượt đọc lại kết luận **`nothing important left`**. Đây là kết quả kiểm tra tính đủ của thiết kế, không phải review code hay chấp thuận của chủ dự án.
- Kiểm tra tài liệu: ba file UTF-8 hợp lệ; bảy liên kết tương đối tồn tại; `git diff --cached --check` exit 0. Chỉ ba file của task được stage/commit.
- Checkout chính vẫn ở `main`, giữ nguyên bảy thay đổi có sẵn; bốn log review chưa theo dõi trong worktree được giữ nguyên.
- Test code/browser/PG/model và provider live cho feature: **NOT_RUN** (chưa triển khai).

## Bàn giao

Chỉ commit đúng ba tài liệu của task. Giữ nguyên thay đổi có sẵn ở checkout chính và các log review PR #180 chưa theo dõi trong worktree. Không cập nhật trạng thái/roadmap dự án, không tạo PR triển khai, không push/merge hay bật cờ.

Sau builder check, gửi tài liệu cụ thể để chủ dự án duyệt; sau chấp thuận mới dùng writing-plans để lập kế hoạch. Chưa cam kết mốc hoàn thành cho toàn bộ feature Slack.
