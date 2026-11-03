# 2026-11-03 — Hoàn tất công cụ di trú lịch Jira cũ, cấu hình rollout và tài liệu nghiệm thu (JIRA-11)

## Tác giả & Nhánh
- **Nhánh:** `feat/jira-11-rollout-prep` (tạo từ `main` `7b210e6e` sau khi merge PR #268 và PR #269)
- **Task card:** [`docs/handoff/tasks/JIRA-11-live-and-rollout.md`](../tasks/JIRA-11-live-and-rollout.md)

## Thay đổi chính
1. **Quét và tạm dừng lịch định kỳ `jira.*` cũ (`JIRA-11A`):**
   - Thêm [`apps/chat-api/src/services/jira-legacy-migration.ts`](../../../apps/chat-api/src/services/jira-legacy-migration.ts) (`scanAndPauseLegacyJiraSchedules`, `LEGACY_JIRA_PAUSE_REASON = 'legacy_jira_retired'`, `buildLegacyJiraPausedMessage`).
   - Thêm CLI [`scripts/scan-pause-legacy-jira.mjs`](../../../scripts/scan-pause-legacy-jira.mjs) hỗ trợ `--dry-run` (mặc định) và `--apply`.
   - Khóa `conversations` (`FOR UPDATE`) trước `schedules` (`FOR UPDATE`) đúng quy ước lock ordering của `ScheduleRepo`, đặt `status = 'paused'`, `next_run_at = NULL`, `pause_reason = 'legacy_jira_retired'` và ghi tin nhắn thông báo tiếng Việt vào hội thoại để người dùng kết nối lại Jira OAuth 3LO (`myjira.*`).
2. **Chính sách dữ liệu `/privacy`, cấu hình `.env.example`, `.gitignore` và runbook (`JIRA-11B`):**
   - Cập nhật [`apps/chat-web/src/pages/Privacy/PrivacyPage.tsx`](../../../apps/chat-web/src/pages/Privacy/PrivacyPage.tsx) bổ sung mục "Tài khoản Jira Cloud bạn kết nối" theo mục 9 của đặc tả.
   - Cập nhật [`.env.example`](../../../.env.example) với `MYJIRA_ENABLED=off` mặc định và các biến `MYJIRA_OAUTH_*`.
   - Cập nhật [`.gitignore`](../../../.gitignore) bỏ qua `docs/ai-evidence/JIRA-LIVE/`.
   - Cập nhật [`evaluations/README.md`](../../../evaluations/README.md) với hướng dẫn chạy `EVAL_SET=myjira`, `scripts/scan-pause-legacy-jira.mjs` và lưu ý `P-LIVE`.

## Bằng chứng kiểm thử thực tế
- `npx vitest run apps/chat-api/tests/jira-legacy-migration.test.ts` (PostgreSQL 16 thật): **2/2 PASS**
- `npm test -w @wap/chat-web -- tests/fe-10-guide-privacy.test.tsx`: **6/6 PASS**
- `git check-ignore docs/ai-evidence/JIRA-LIVE/probe.json`: khớp `docs/ai-evidence/JIRA-LIVE/probe.json`
- `npm run typecheck:v3`: **PASS (exit 0)**
- `npm run build:v3`: **PASS (exit 0)**
- `node scripts/test-v3-web-build-security.mjs`: **PASS (exit 0)**

## Trạng thái P-LIVE
- Nghiệm thu trực tiếp với Atlassian OAuth 3LO thật (`P-LIVE`) được ghi nhận trung thực là **NOT_RUN** cho đến khi chủ dự án cấu hình `MYJIRA_OAUTH_CLIENT_ID`, `MYJIRA_OAUTH_CLIENT_SECRET` và thực hiện consent trên 2 site Jira Cloud thật. Cờ `MYJIRA_ENABLED` giữ mặc định `off`.
