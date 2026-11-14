# Việc ưu tiên

Danh sách ngắn, việc trên cùng làm trước. Xong việc nào thì xoá dòng đó trong cùng PR. Lộ trình cũ (tới 12/11/2026) nằm ở [`docs/archive/handoff-2026-11-12/ROADMAP.md`](../archive/handoff-2026-11-12/ROADMAP.md).

1. **Đưa CI `main` về xanh:** sửa test chập chờn `google-grant-isolation.test.ts` (mycalendar scope change).
2. **Nghiệm thu thật từng dịch vụ:** nhóm trưởng kết nối OAuth thật (Gmail `GMAIL-04` đã xong 14/11; còn các dịch vụ khác), chạy 3–5 thao tác chính cho mỗi dịch vụ, ghi kết quả vào bảng trong `CURRENT-STATE.md`.
3. **Dọn PR mở cũ:** #302, #298, #296, #273, #264, #262, #235, #189, #182, #87, #47. Đóng PR đã lỗi thời.
4. **Dọn worktree:** `git worktree prune`; xoá worktree và nhánh đã merge.
