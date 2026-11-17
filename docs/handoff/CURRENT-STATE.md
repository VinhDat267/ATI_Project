# Trạng thái hiện tại

**Cập nhật:** 14/11/2026, `origin/main` `7d41f0a2` (sau #327 và nghiệm thu `GMAIL-04`). Mỗi PR làm đổi trạng thái thì sửa đúng dòng của nó ở đây. Lịch sử đầy đủ trước ngày này nằm ở [`docs/archive/handoff-2026-11-12/CURRENT-STATE.md`](../archive/handoff-2026-11-12/CURRENT-STATE.md).

## Tổng quan

- Planora: chat → AI lập kế hoạch → người dùng duyệt → thực thi trên dịch vụ ngoài, kèm lịch digest định kỳ.
- 12 dịch vụ trong registry runtime, khoảng 95 tool. Chạy được ở `RUNTIME_MODE=sandbox` (fixture) và `live`.
- **CI `main`: XANH** (5 lần chạy gần nhất đến #337, 16/11/2026). Test `google-grant-isolation.test.ts` từng chập chờn sau #318.
- **Production: chưa bật.** Chưa nghiệm thu đầy đủ với dịch vụ thật (FLOW-07 còn mở).

## Từng dịch vụ

| Dịch vụ | Trạng thái | Gần nhất | Còn thiếu |
|---|---|---|---|
| Trello | OAuth cá nhân, chọn workspace và bảng; 17 tool (thêm nhãn: `search_labels`/`add_label`/`remove_label`, `idLabels` khi tạo thẻ; ghi = rủi ro trung bình; pre-check chỉ lấy `id,idBoard`; chặn chuyển thẻ khác bảng); digest Slack/Telegram có mục "Đã xong", "chưa có hạn", pin credential Telegram, báo đủ/thiếu dữ liệu trung thực; lỗi mạng ≠ `reconnect_required` (không tạm dừng lịch); khóa refresh token đa tiến trình bằng advisory lock PostgreSQL | feat/trello-complete-v3 | Đã chạy thật trên bảng test 16/11/2026 (21/21 tool đọc/ghi/nhãn/scope và xem trước digest); còn gửi digest thật qua Slack/Telegram |
| Slack | Bot dùng chung; có `slack.read_messages`; chặn retry 429 trên `postMessage` & siết allowlist `SlackProposalService` | #324 | Slack cá nhân (`myslack`) chưa có trong runtime registry |
| GitHub | OAuth cá nhân, 13 tool (Issue/PR/Comment/Review) + digest Slack/Telegram; scope theo workspace (Personal & Org); chuẩn hóa `requestSent: false` pre-dispatch (#325); kiểm tra live repo membership trên `/api/services` (#324) | #331 | Đã nghiệm thu OAuth thật (`gho_`), Issue/PR/Comment + digest Telegram trên `VinhDat267/ati-test` (15/11/2026); còn kiểm tra live `request_reviewers` happy-path với cộng tác viên ngoài tác giả PR & digest Slack trực tiếp |
| Sheets / MySheets | Sheets Digest v2 (#289–#299), khóa chặn ghi Drive (#300); chuẩn hóa `requestSent: false` pre-dispatch (#325) & chuẩn hóa `mimeType` Drive | #324 | Runbook staging GAS-03 chưa chạy |
| Calendar / MyCalendar | Remediation v2 (#315); chuẩn hóa `requestSent: false` pre-dispatch (CalendarAdapter) | #325 | Test chập chờn ở trên; nghiệm thu thật |
| Notion | Đã hoàn thiện v3: 11 tool (4 base + 7 OAuth gồm `get_database`, `search_pages`, `append_blocks` Markdown→Blocks, `list_comments`, `add_comment`), OAuth bền vững + phân trang `/search`, cô lập Personal/Org, bộ lọc trạng thái/khoảng ngày/sắp xếp, trích xuất rich blocks, `in_trash`, `requestSent: false`, lan truyền `truncated`, biên nhận Slack `ts` & recovery `mark_sent`/`retry_new_run`, Privacy 10 database | local v3 | Nghiệm thu thật |
| Telegram | Bot cá nhân 1 chạm (`selected` + `/candidate-chats`, tự tải danh sách chat khi `needs_scope`); `telegram.read_messages` qua kho tin 24h theo thời điểm gửi (0037), dọn định kỳ, tìm trên toàn bộ cửa sổ lưu trữ + gợi ý Privacy Mode khi rỗng; bản tin Trello/Calendar/Jira gửi Telegram dạng văn bản thuần; recovery `mark_sent`/`retry_new_run` cho `calendar_digest`/`github_digest`, gồm lịch một lần và biên nhận theo đích đã gửi; quy tắc planner Telegram; chặn digest sai binding (#303); `requestSent: false` pre-dispatch | `fix/telegram-v3-completion` | Đã test đọc/gửi và Privacy Mode với bot thật trước các sửa đổi sau review |
| Jira / MyJira | Đã hoàn thiện v3 trong Organization Workspace: 9 tool (`list_sites`, `search_projects`, `search_issues` kèm `overdueOnly`/`dueWithinDays`/`unassignedOnly`, `get_issue`, `search_users`, `create_issue`, `add_comment`, `update_issue`, `transition_issue`), OAuth 3LO kèm `read:jira-user` và `write:jira-work`, bản tin Slack và Telegram ghim grant Jira, lưu đích gửi để khôi phục lượt `unknown`, chặn lịch khi `JIRA_LLM_EGRESS_ENABLED=off`, giữ `plan_hash`, kiểm tra project trước khi ghi và không tự gửi lại khi `unknown` | `feat/jira-full-v3` | Chưa nghiệm thu live end-to-end với `api.atlassian.com` thật và gửi digest thật (đã kiểm tra Atlassian app `ATI Project` bật sẵn `read:me`, `read:jira-work`, `read:jira-user`, `write:jira-work`); chưa chạy golden set với model thật sau sửa prompt |
| Gmail | 15 tool qua OAuth cá nhân. Đọc tệp ≤ 5 MB, phân trang tìm kiếm, sửa nháp giữ các phần MIME ngoài phạm vi chỉnh sửa, khóa phiên bản nháp và thư nguồn khi duyệt gửi hoặc chuyển tiếp. Bản tin Telegram lấy từng thư khớp bộ lọc và giữ tùy chọn tắt tóm tắt AI khi sửa lịch. | #332 | Xác minh các luồng Gmail v3 mới với Gmail và Telegram thật. Kết nối lại OAuth trong vòng 7 ngày trước buổi bảo vệ (project Testing hết hạn refresh token sau 7 ngày). |

## Chạy và kiểm tra

- `npm run db:migrate:v3` → `npm run up` (API + web). Cấu hình mẫu ở `.env.example`.
- `npm run typecheck:v3` · `npm run test:v3` · `npm run check` (đầy đủ) · `npm run test:browser:v3`.
- CI (`.github/workflows/v3-check.yml`): job `check` và `browser` chạy song song trên Ubuntu, Node 24, PostgreSQL 16.

## Lỗi và giới hạn đã biết

- `google-grant-isolation.test.ts` có thể chập chờn trở lại; nếu CI đỏ ở đây thì chạy lại trước khi điều tra.
- Gửi tin ra Slack/Telegram/Gmail không có "exactly-once": khi không rõ kết quả, hệ thống dừng ở `needs_attention`, không gửi lại.
- Full check trên Windows hay lỗi vì môi trường (cổng DB, harness); dùng CI làm chuẩn.
