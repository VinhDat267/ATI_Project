# JIRA-05 native policy và capability — 2026-11-02

- **Task:** `docs/handoff/tasks/JIRA-05-policy-native.md`
- **Branch:** `longnguyen005/jira-05-policy`; PR chờ chủ dự án review, không tự merge.
- **Triển khai:** Migration lease 0022; verifier quyền Atlassian và cache theo sáu chiều; lease ngắn hạn, revalidation và thu hồi trong transaction; capability directory với 404 hidden pattern; policy nguồn Jira và che lịch sử; bộ đệm SSE độc lập. Giữ cờ Jira tắt và HTTP 503 tạo hội thoại Jira production.
- **Bằng chứng:** PostgreSQL synthetic riêng: migration 0001–0022 thành công. `npm run check` exit 0: schemas 341, adapters 468, planner 381, executor 42, API 1.567, web 960, evaluation 406; build, security, launcher, Node suites đạt. Browser `jira_slack`: Chromium 1/1 đạt với PostgreSQL synthetic riêng. Antigravity Gemini 3.8 Flash High review kết luận ĐẠT sau sửa hai phát hiện; review agent không tự chạy test.
- **Giới hạn và bước sau:** SSE producer integration và mở hội thoại Jira production thuộc JIRA-08. Không có Jira API live trong task này. Sau merge, reviewer cập nhật `CURRENT-STATE.md` và `ROADMAP.md`.
