# NOTION-N2A · Nguồn Notion đã duyệt cho lịch digest

Base `6de1a31a` sau #317.

## Phạm vi

- Ràng buộc nguồn Notion OAuth cá nhân trong lịch Notion → Slack và Notion → Telegram. Preview và hash chứa owner, credential, app, workspace, actor, bot, version, danh sách database và data source.
- Xác nhận kiểm tra lại metadata provider trước transaction và đối chiếu cùng binding với row đang được cấp quyền. Thiếu binding hoặc mất quyền thì yêu cầu xem trước và duyệt lại.
- Runner chỉ đọc nguồn đã ghim. Ngay trước gửi, kiểm tra lại data source và giữ khóa owner xuyên qua bước ghi dấu gửi và dispatch. Lưu config/hash đã gửi cùng marker. Lịch Notion cũ giữ để xem và yêu cầu duyệt lại. Bản tin tự động Notion hiện dùng nội dung tổng hợp từ dữ liệu đọc được, không gửi dữ liệu qua AI.
- Lịch Notion tổ chức và lịch Telegram nhiều dịch vụ có Notion chuyển sang luồng duyệt từng lượt. Báo cáo thiếu dữ liệu, khôi phục khi kết quả gửi chưa rõ và nghiệm thu provider live thuộc các bước tiếp theo.

## Kết quả

- Baseline RED: lịch Telegram cũ chưa có binding đi qua adapter trước khi dừng. GREEN: lịch đó bị chặn trước khi lấy adapter, đọc hoặc gửi.
- PostgreSQL 16 + HTTP loopback: cả 8 trường hợp nguồn A/B, đổi data source ở bước xác nhận và lúc chạy, mất chia sẻ, lưu trữ, thu hồi trước gửi, khóa thu hồi trong lúc gửi và pool một kết nối đều được kiểm tra. Luồng Slack xác nhận và chạy qua ScheduleRunner trên PostgreSQL.
- Sáu suite API OAuth/lịch 51/51 PASS, hai suite Web 44/44 PASS, typecheck và diff check exit 0. Review độc lập phát hiện lỗi endpoint sandbox, JSONB hash và cạn pool. Đã sửa và bổ sung kiểm thử tương ứng. Xem PR để theo dõi CI và kết luận review cuối.

- Slack: test PostgreSQL giữ khóa dòng lượt chạy xác minh runner thoát ngay theo NOWAIT, không gửi. Suite Slack 8/8 PASS.
