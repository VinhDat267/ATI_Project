# 28/10/2026 · Chuyển thiết kế Slack sang kế hoạch phần nền

**Nhánh:** `docs/slack-oauth-design` · **Nền:** `d479b098`.
**Yêu cầu mới:** chủ dự án hỏi “có thể bắt đầu triển rồi đúng không” sau khi nhận bản sửa F1–F4; chuyển thiết kế đã sửa sang bước triển khai, không hỏi lại bốn lựa chọn đã chốt.

## Tài liệu

- [Thiết kế OAUTH-04](../../superpowers/specs/2026-10-28-slack-personal-oauth-design.md): ghi chấp thuận chuyển sang kế hoạch, không gộp với nghiệm thu live.
- [Kế hoạch phần nền](../../superpowers/plans/2026-10-28-slack-foundation.md) và [SLACK-01](../tasks/SLACK-01-foundation.md): năm task có interfaces/RED→GREEN, ownership, lệnh kiểm tra và lộ trình giữ đầy đủ các phần 02–07.
- Đây là bước lập kế hoạch; chưa tạo product code hoặc fake provider.

## Đối chiếu thực tế

- Đọc handoff và ba log gần nhất liên quan; giữ nguyên bảy thay đổi checkout chính và bốn log PR #180 chưa theo dõi.
- Kiểm root package/test scripts và patterns tool-schemas/HTTP fixture hiện có. Không có vitest.config.ts ở root; schema tests ở packages/tool-schemas/tests.
- HTTP đọc tài liệu công khai: sitemap Slack status 200, **343 URL phương thức** tại lần khảo sát; metadata markdown của chat.postMessage và auth.revoke status 200. llms.txt chỉ dẫn markdown/sitemap, không chứa toàn bộ method links. Đây là khảo sát nguồn cho collector, chưa phải inventory đã tạo hoặc nghiệm thu 343 method.
- Thiết kế/plan self-review theo writing-plans: đối chiếu phạm vi, interfaces, task boundaries và năm Review Focus; không dispatch agent trong bước tự kiểm plan.
- Kiểm tài liệu: **PASS**, exit 0; năm file UTF-8/whitespace hợp lệ, **17 liên kết tương đối** tồn tại, tracked diff không có lỗi whitespace; staged kiểm đúng năm file trước commit.
- Test code/browser/PG/model và Slack OAuth/provider live cho card mới: **NOT_RUN**; không code trong lượt lập kế hoạch.

## Handoff

Chủ dự án review kế hoạch cụ thể và chọn Native hoặc subagent-driven theo writing-plans trước khi code. Đề xuất Native cho SLACK-01 với một reviewer độc lập cuối nhánh; không thêm approval giữa từng task sau khi đã chọn. Chưa push/merge, sửa CURRENT-STATE/ROADMAP hoặc thay cờ.
