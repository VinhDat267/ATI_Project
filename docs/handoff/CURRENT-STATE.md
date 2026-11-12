# Trạng thái hiện tại

**Cập nhật:** 12/11/2026, `origin/main` `5eef6c39` (sau #318). Mỗi PR làm đổi trạng thái thì sửa đúng dòng của nó ở đây. Lịch sử đầy đủ trước ngày này nằm ở [`docs/archive/handoff-2026-11-12/CURRENT-STATE.md`](../archive/handoff-2026-11-12/CURRENT-STATE.md).

## Tổng quan

- Planora: chat → AI lập kế hoạch → người dùng duyệt → thực thi trên dịch vụ ngoài, kèm lịch digest định kỳ.
- 12 dịch vụ trong registry runtime, khoảng 95 tool. Chạy được ở `RUNTIME_MODE=sandbox` (fixture) và `live`.
- **CI `main`: ĐỎ** từ #318 vì test chập chờn `apps/chat-api/tests/routes/google-grant-isolation.test.ts` ("a mycalendar scope change cancels an old refresh…", nhận 200 thay vì 409). PR #318 xanh trên chính PR đó.
- **Production: chưa bật.** Chưa nghiệm thu đầy đủ với dịch vụ thật (FLOW-07 còn mở).

## Từng dịch vụ

| Dịch vụ | Trạng thái | Gần nhất | Còn thiếu |
|---|---|---|---|
| Trello | OAuth cá nhân, chọn workspace và bảng; digest sang Slack/Telegram | Remediation v3 vào qua #315 | Nghiệm thu thật |
| Slack | Bot dùng chung; có `slack.read_messages` | — | Slack cá nhân (`myslack`) chưa có trong runtime registry |
| GitHub | OAuth cá nhân, 9 tool; scope theo workspace (#305) | #305 | Credential phải `active`, nghiệm thu thật |
| Sheets / MySheets | Sheets Digest v2 (#289–#299), khóa chặn ghi Drive (#300) | #300 | Runbook staging GAS-03 chưa chạy |
| Calendar / MyCalendar | Remediation v2 vào qua #315 | #315 | Test chập chờn ở trên; nghiệm thu thật |
| Notion | OAuth bền vững (#317) | **PR #319** (ràng buộc nguồn digest): CI đỏ ở `static-guard` | Khoảng 10 lỗi audit còn mở (độ phủ dữ liệu, bộ lọc ngày/trạng thái, biên nhận Slack, phân trang tìm database, Privacy); nghiệm thu thật |
| Telegram | Bot cá nhân; chặn digest sai binding (#303) | #303 | Nghiệm thu thật |
| Jira / MyJira | G2A read containment (#318) | #318 | Chỉ dùng trong "Không gian Chung" (site `ati-workflow-test`) |
| Gmail | Gửi/nháp qua OAuth cá nhân | G2 đang làm ở worktree `gmail-g2-main315-integration`, **chưa commit, chưa PR** | Hoàn tất G2, nghiệm thu thật |

## Chạy và kiểm tra

- `npm run db:migrate:v3` → `npm run up` (API + web). Cấu hình mẫu ở `.env.example`.
- `npm run typecheck:v3` · `npm run test:v3` · `npm run check` (đầy đủ) · `npm run test:browser:v3`.
- CI (`.github/workflows/v3-check.yml`): job `check` và `browser` chạy song song trên Ubuntu, Node 24, PostgreSQL 16.

## Lỗi và giới hạn đã biết

- Test chập chờn ở trên làm `main` đỏ.
- Gửi tin ra Slack/Telegram/Gmail không có "exactly-once": khi không rõ kết quả, hệ thống dừng ở `needs_attention`, không gửi lại.
- Full check trên Windows hay lỗi vì môi trường (cổng DB, harness); dùng CI làm chuẩn.
