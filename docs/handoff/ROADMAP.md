# Việc ưu tiên

Danh sách ngắn, việc trên cùng làm trước. Xong việc nào thì xoá dòng đó trong cùng PR. Lộ trình cũ (tới 12/11/2026) nằm ở [`docs/archive/handoff-2026-11-12/ROADMAP.md`](../archive/handoff-2026-11-12/ROADMAP.md).

1. **Đưa CI `main` về xanh:** sửa test chập chờn `google-grant-isolation.test.ts` (mycalendar scope change).
2. **Notion:** sửa `static-guard` cho #319 → merge. Sau đó một PR sửa các lỗi còn lại ảnh hưởng người dùng:
   - Báo rõ khi đọc thiếu dữ liệu (`truncated`/`has_more` đi tới digest, planner, báo cáo).
   - Bộ lọc trạng thái và ngày.
   - Trích xuất nội dung trang ngoài `rich_text`.
   - Phân trang tìm database.
   - Không coi là đã gửi khi Slack thiếu `ts`.
   - Ghi `in_trash`.
   - Sửa trang Privacy ("tối đa 10 database").

   Danh sách lỗi gốc: `D:\ATI-Audits\notion-n1-remediation-design-20261111\02-N1-CANONICAL-FINDINGS-MATRIX.md` (trên máy nhóm trưởng).
3. **Nghiệm thu thật từng dịch vụ:** nhóm trưởng kết nối OAuth thật (Gmail `GMAIL-04` đã xong 14/11; còn các dịch vụ khác), chạy 3–5 thao tác chính cho mỗi dịch vụ, ghi kết quả vào bảng trong `CURRENT-STATE.md`.
4. **Dọn PR mở cũ:** #302, #298, #296, #273, #264, #262, #235, #189, #182, #87, #47. Đóng PR đã lỗi thời.
5. **Dọn worktree:** `git worktree prune`; xoá worktree và nhánh đã merge.
