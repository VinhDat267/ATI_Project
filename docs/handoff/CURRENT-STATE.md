# Trạng thái hiện tại

**Cập nhật:** 14/11/2026, `origin/main` `7d41f0a2` (sau #327 và nghiệm thu `GMAIL-04`). Mỗi PR làm đổi trạng thái thì sửa đúng dòng của nó ở đây. Lịch sử đầy đủ trước ngày này nằm ở [`docs/archive/handoff-2026-11-12/CURRENT-STATE.md`](../archive/handoff-2026-11-12/CURRENT-STATE.md).

## Tổng quan

- Planora: chat → AI lập kế hoạch → người dùng duyệt → thực thi trên dịch vụ ngoài, kèm lịch digest định kỳ.
- 12 dịch vụ trong registry runtime, khoảng 95 tool. Chạy được ở `RUNTIME_MODE=sandbox` (fixture) và `live`.
- **CI `main`: ĐỎ** từ #318 vì test chập chờn `apps/chat-api/tests/routes/google-grant-isolation.test.ts` ("a mycalendar scope change cancels an old refresh…", nhận 200 thay vì 409). PR #318 xanh trên chính PR đó.
- **Production: chưa bật.** Chưa nghiệm thu đầy đủ với dịch vụ thật (FLOW-07 còn mở).

## Từng dịch vụ

| Dịch vụ | Trạng thái | Gần nhất | Còn thiếu |
|---|---|---|---|
| Trello | OAuth cá nhân, chọn workspace và bảng; digest sang Slack/Telegram; chuẩn hóa `requestSent: false` pre-dispatch | #325 | Nghiệm thu thật |
| Slack | Bot dùng chung; có `slack.read_messages`; chặn retry 429 trên `postMessage` & siết allowlist `SlackProposalService` | #324 | Slack cá nhân (`myslack`) chưa có trong runtime registry |
| GitHub | OAuth cá nhân, 9 tool; scope theo workspace (#305); chuẩn hóa `requestSent: false` pre-dispatch (#325); kiểm tra live repo membership trên `/api/services` | #324 | Credential phải `active`, nghiệm thu thật |
| Sheets / MySheets | Sheets Digest v2 (#289–#299), khóa chặn ghi Drive (#300); chuẩn hóa `requestSent: false` pre-dispatch (#325) & chuẩn hóa `mimeType` Drive | #324 | Runbook staging GAS-03 chưa chạy |
| Calendar / MyCalendar | Remediation v2 (#315); chuẩn hóa `requestSent: false` pre-dispatch (CalendarAdapter) | #325 | Test chập chờn ở trên; nghiệm thu thật |
| Notion | OAuth bền vững (#317), ràng buộc nguồn digest (#319), trạng thái OAuth `/api/services` (#324), sửa lỗi đọc/`truncated`/bộ lọc/`in_trash`/phân trang/Privacy (#326) | #326 | Nghiệm thu thật |
| Telegram | Bot cá nhân; chặn digest sai binding (#303); chuẩn hóa `requestSent: false` pre-dispatch | #325 | Nghiệm thu thật |
| Jira / MyJira | G2A read containment (#318), `requestSent: false` pre-dispatch (#325); thu hồi lease `syncSites`, ẩn `cloudId` ở Personal Mode, sửa `jira-digest-runner` | #324 | Chỉ dùng trong "Không gian Chung" (site `ati-workflow-test`) |
| Gmail | Gửi/nháp/đọc/nhãn qua OAuth cá nhân; ràng buộc nguồn Telegram digest + kiểm soát origin OAuth | #327 (G2 + đóng `GMAIL-AUDIT-08`..`12`) + `GMAIL-04` nghiệm thu Google Cloud OAuth thật & mặc định `PLANNER_READ_ANSWERS=on` (14/11/2026) | Kết nối lại OAuth trong vòng 7 ngày trước buổi bảo vệ (project Testing hết hạn refresh token sau 7 ngày) |

## Chạy và kiểm tra

- `npm run db:migrate:v3` → `npm run up` (API + web). Cấu hình mẫu ở `.env.example`.
- `npm run typecheck:v3` · `npm run test:v3` · `npm run check` (đầy đủ) · `npm run test:browser:v3`.
- CI (`.github/workflows/v3-check.yml`): job `check` và `browser` chạy song song trên Ubuntu, Node 24, PostgreSQL 16.

## Lỗi và giới hạn đã biết

- Test chập chờn ở trên làm `main` đỏ.
- Gửi tin ra Slack/Telegram/Gmail không có "exactly-once": khi không rõ kết quả, hệ thống dừng ở `needs_attention`, không gửi lại.
- Full check trên Windows hay lỗi vì môi trường (cổng DB, harness); dùng CI làm chuẩn.
