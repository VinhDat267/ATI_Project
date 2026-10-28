# OAUTH-04 · Slack cá nhân và trợ lý công việc trong ATI

**Trạng thái:** đã đồng ý hướng sửa F1–F4, cập nhật và kiểm tra bản sửa; chờ duyệt toàn văn; chưa triển khai.
**Nhánh tài liệu:** `docs/slack-oauth-design` · **Nền:** `b437f985` (28/10/2026).
**Thiết kế:** [Slack cá nhân và trợ lý công việc](../../superpowers/specs/2026-10-28-slack-personal-oauth-design.md).

## Mục tiêu

Chốt thiết kế cho Slack OAuth danh nghĩa user, Free/Pro, nhiều workspace, toàn bộ API phù hợp quyền/gói; nhận tin mới và đề xuất công việc trong ATI. Cả ba chế độ luật/AI/kết hợp được chọn riêng cho từng user trong từng workspace. Mọi ghi cần duyệt trong ATI.

Chủ dự án đã chốt sau builder check: chỉ đề xuất việc liên quan đến mình hoặc thread mình theo dõi; không nhận toàn bộ công việc chung của kênh.

## Phạm vi task hiện tại

- Tổng hợp quyết định người dùng và phân biệt mặc định do người viết đề xuất.
- Đối chiếu nguồn code/handoff hiện tại và tài liệu Slack chính thức.
- Viết đặc tả đủ cho builder lập kế hoạch; kiểm tra độc lập các điểm còn phải đoán.
- Ghi kết quả, commit tài liệu và gửi chủ dự án duyệt.

Không code sản phẩm, tạo Slack app, cấp quyền, chạy live/model hoặc bật cờ trong task thiết kế này. Sau khi duyệt mới lập kế hoạch và tách task triển khai; các đợt ở mục 11 của thiết kế chưa phải kế hoạch được phê duyệt.

## Tiêu chí hoàn thành task thiết kế

- [x] Có đặc tả với quyết định người dùng, mặc định đề xuất, giới hạn provider và điều kiện đóng feature.
- [x] Builder check độc lập; xử lý ba câu hỏi, đọc lại kết luận `nothing important left`.
- [x] Kiểm tra bản đầu: ba file UTF-8, bảy liên kết tương đối và diff; exit 0.
- [x] Chủ dự án đồng ý bốn hướng xử lý F1–F4; đã bổ sung mục 4.4, 4.5, 9.1, 9.2 và ca nghiệm thu.
- [x] Fresh builder check: F1–F4 đủ ở mức thiết kế, `nothing important left`; kiểm UTF-8/liên kết/diff trên bản cuối theo log sửa.
- [ ] Chủ dự án duyệt toàn văn thiết kế sau sửa.

## Kết quả

- Đã viết bản thiết kế ngày 28/10/2026. Sau review, chủ dự án trả lời `ok` cho bốn hướng sửa đã đề xuất; đã cập nhật theo quyết định đó. Chưa ghi nhận duyệt toàn văn bản sửa hoặc cho phép triển khai/live.
- Đối chiếu code/docs tại `b437f985`; các thông tin Slack dẫn nguồn trực tiếp trong thiết kế.
- Builder check độc lập nêu ba câu hỏi; đã nhận quyết định người dùng về mức liên quan, ghi đề xuất rõ cho phân phối app và nguồn bản tổng hợp. Đọc lại: `nothing important left`.
- Kiểm tra tài liệu: ba file UTF-8 hợp lệ, bảy liên kết tương đối tồn tại, `git diff --cached --check` exit 0. [Log](../log/2026-10-28-slack-oauth-brainstorm.md).
- Kiểm thử sản phẩm, evaluation, OAuth và provider live: **NOT_RUN**, vì chưa triển khai.
- Không sửa `CURRENT-STATE.md`/`ROADMAP.md`; không thay trạng thái các feature đang mở.
- Review chi tiết: [F1–F4 trên bản đầu](../log/2026-10-28-slack-oauth-design-review.md). Bản sửa và kiểm tra mới theo [log xử lý review](../log/2026-10-28-slack-oauth-design-fixes.md); không dùng kết quả builder check cũ để tự kết luận bản sửa đạt.
- Fresh builder check sau sửa: **F1–F4 được trả lời ở mức thiết kế**, không thấy mâu thuẫn trọng yếu, `nothing important left`. Kết quả này không thay cho kiểm thử triển khai/live.
