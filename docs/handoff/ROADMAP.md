# Việc ưu tiên

Danh sách ngắn, việc trên cùng làm trước. Xong việc nào thì xoá dòng đó trong cùng PR. Lộ trình cũ (tới 12/11/2026) nằm ở [`docs/archive/handoff-2026-11-12/ROADMAP.md`](../archive/handoff-2026-11-12/ROADMAP.md).

1. **Migration không chạy lại được trên DB đã có lịch Jira/Slack digest (P1, cần chốt cách sửa):** `npm run db:migrate:v3` chạy lại toàn bộ file; 0016–0020 tạo lại `schedules_kind_check` với danh sách loại cũ nên DB có dòng `myjira_digest`/`slack_digest` báo lỗi 23514 và không migrate tiếp được (tái hiện 18/11/2026 trên DB thử). CI không bắt được vì dùng DB trống. Chọn giữa: sửa dòng ràng buộc trong migration cũ (trái quy tắc "không sửa migration đã merge") hoặc cho `migrate.mjs` ghi nhận migration đã chạy.
2. **Renderer báo cáo cố định ghi đè yêu cầu người dùng:** `renderJiraProgressReport`/báo cáo GitHub issue aging thay thế nội dung planner soạn nên bỏ tiền tố người dùng yêu cầu và gắn nhãn sai ngữ cảnh ("Sprint", "tồn đọng quá 7 ngày" khi chỉ hỏi liệt kê). Tái hiện live 18/11/2026 (Jira → Slack, GitHub → Telegram).
3. **Đưa CI `main` về xanh:** sửa test chập chờn `google-grant-isolation.test.ts` (mycalendar scope change).
4. **Nghiệm thu thật từng dịch vụ:** nhóm trưởng kết nối OAuth thật (Gmail `GMAIL-04` đã xong 14/11; còn các dịch vụ khác), chạy 3–5 thao tác chính cho mỗi dịch vụ, ghi kết quả vào bảng trong `CURRENT-STATE.md`.
5. **Dọn PR mở cũ:** #302, #298, #296, #273, #264, #262, #235, #189, #182, #87, #47. Đóng PR đã lỗi thời.
6. **Dọn worktree:** `git worktree prune`; xoá worktree và nhánh đã merge.
7. **Mở rộng Telegram v4 (tuỳ chọn):** nối `runJiraDigest`/`myjiraDigestConnection` ở `server.ts` kèm truyền `connections.telegram` trong `jira-digest-runner.ts`; hỗ trợ webhook mode và lịch tự động lấy tin Telegram làm nguồn tổng hợp sang Trello/Notion/Email.
8. **Trello: giá trị người dùng (sau nghiệm thu):** prompt/nút "biên bản họp → nhiều thẻ"; digest kèm hành động "nhắc người phụ trách"; pin `slackCredentialId` cho digest Slack (candidate chưa có nguồn id); đóng PR #329 (phần khóa refresh Trello đã thay bằng advisory lock) và draft #296.
9. **Automation mức cao hơn (cân nhắc):** lịch ghi định kỳ duyệt một lần theo mẫu cố định (khóa `plan_hash`); trigger sự kiện qua webhook Trello/GitHub.
