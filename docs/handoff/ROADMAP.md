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
3. **Gmail G2 + Audit 08–12:** đã tích hợp và kiểm thử cục bộ trên `main` (bao gồm sửa 2 lỗi CI `A04-R6`/`A04-R7-B` và đóng `GMAIL-AUDIT-08`..`12`); chờ lệnh commit/PR và nghiệm thu thật Google Cloud OAuth (`GMAIL-04`).
4. **Nghiệm thu thật từng dịch vụ:** nhóm trưởng kết nối OAuth thật, chạy 3–5 thao tác chính cho mỗi dịch vụ, ghi kết quả vào bảng trong `CURRENT-STATE.md`.
5. **Dọn PR mở cũ:** #302, #298, #296, #273, #264, #262, #235, #189, #182, #87, #47. Đóng PR đã lỗi thời.
6. **Dọn worktree:** `git worktree prune`; xoá worktree và nhánh đã merge.
