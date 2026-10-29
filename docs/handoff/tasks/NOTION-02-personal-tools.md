# NOTION-02 · Công cụ Notion cá nhân trong workflow

**Trạng thái:** backlog tiếp theo, chưa triển khai; phụ thuộc NOTION-01 OAuth/setup được review/merge. Card này làm rõ ranh giới phần OAuth đã làm, không phải bằng chứng tool cá nhân đã có.

## Phạm vi cần thiết

- Chốt namespace/catalog cá nhân và quy tắc định tuyến, không rơi về token Notion chung khi người dùng yêu cầu tài khoản riêng. Giữ nguyên `notion.*` chung khi feature tắt.
- Đọc database, tạo page và nối văn bản trong database đã chọn, với access token của đúng chủ/workspace; không mở resource tùy ý ngoài phạm vi Notion đã chia sẻ và ATI đã chọn.
- Binding server-owned qua gather → memory → plan → execution: owner, connectionId, workspace, actor/bot, identityVersion và selected databases; không bind lại sang connection mới sau lookup. Nhiều workspace thiếu lựa chọn phải hỏi trước tra cứu.
- Preview/receipt hiện integration/workspace/database đúng; hash trước duyệt, kiểm lại quyền/generation và scope trước dispatch. Không có write trước duyệt; UNKNOWN không retry.
- Token refresh/thu hồi dùng kho NOTION-01, không đổi token identity khi refresh; source/answer/memory sau mất quyền được xử lý phù hợp.
- Hồi quy shared Notion/Slack/Google; schema/adapter/API/UI, DB races và AbortSignal thật; labels trước campaign model, đo ×3 và nghiệm thu Notion thật theo P-LIVE trước bật tool.

## Kết quả

NOT_RUN. Chưa có catalog/tool cá nhân và chưa tuyên bố workflow Notion OAuth hoạt động. Bước OAuth/setup ở [NOTION-01](NOTION-01-oauth-connections.md).
