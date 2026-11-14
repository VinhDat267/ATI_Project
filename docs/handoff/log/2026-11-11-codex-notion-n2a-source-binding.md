# 2026-11-11 · NOTION-N2A · Ràng buộc nguồn Notion

- Phạm vi và kết quả tại [task NOTION-N2A](../tasks/NOTION-N2A-source-binding.md).
- So sánh baseline `6de1a31a`. Repro dùng PostgreSQL 16 riêng và provider HTTP loopback. Phiên bản cũ đi qua adapter cho Notion chưa ràng buộc, phiên bản mới chặn trước đọc hoặc gửi.
- Lưu nguồn chính xác qua các lần đổi kết nối mặc định, revalidate trước khi xác nhận và gửi. Khóa PostgreSQL được dùng lại trên cùng client khi ghi marker. Kiểm thử quan sát trực tiếp truy vấn `pg_locks` và config/hash ghi trên lượt đã dispatch.
- API 51 PASS, Web 44 PASS, typecheck và diff check đạt. Nghiệm thu full CI và review cuối theo PR.
- Bản tin Notion tự động không gọi AI trong phạm vi này. Dữ liệu provider thật chưa chạy. Không có migration mới.
