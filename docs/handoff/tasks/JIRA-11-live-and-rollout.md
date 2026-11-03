# JIRA-11 · Nghiệm thu Atlassian thật (P-LIVE), quét/tạm dừng lịch Jira cũ và chuẩn bị rollout

**Trạng thái:** Phần mã, công cụ quét/tạm dừng lịch định kỳ dùng `jira.*` cũ, cấu hình `.env.example` (`MYJIRA_ENABLED=off`), cập nhật `/privacy` và runbook nghiệm thu đã hoàn tất trên nhánh `feat/jira-11-rollout-prep`. Nghiệm thu Atlassian thật (`P-LIVE`) giữ trạng thái **NOT_RUN** cho tới khi chủ dự án cung cấp `MYJIRA_OAUTH_CLIENT_ID` / `MYJIRA_OAUTH_CLIENT_SECRET` và hai site Jira Cloud thử nghiệm.
**Thiết kế:** [Jira cá nhân/workspace](../../superpowers/specs/2026-10-30-jira-personal-workspaces-design.md) (§9, §10, §11, §12).

## Mục tiêu

1. Cung cấp dịch vụ và CLI quét, tạm dừng (`paused`, `next_run_at = NULL`, `pause_reason = 'legacy_jira_retired'`) mọi lịch định kỳ `active` có kế hoạch chứa bước `jira.*` cũ trước khi cutover hoàn toàn sang `myjira.*`, theo đúng thứ tự khóa `conversations` → `schedules` và ghi rõ lý do bằng tiếng Việt trong hội thoại.
2. Cập nhật `.env.example` (giữ `MYJIRA_ENABLED=off` mặc định), `.gitignore` (`docs/ai-evidence/JIRA-LIVE/`), `/privacy` (`PrivacyPage.tsx`) và `evaluations/README.md` đúng yêu cầu mục 9 & 11 của đặc tả.
3. Chuẩn bị đầy đủ checklist `P-LIVE` (2 site, đổi tài khoản Atlassian, thu hồi quyền, refresh rotation, phê duyệt theo mã băm kế hoạch) để chủ dự án chạy nghiệm thu thật khi có credentials.

## Phạm vi và nghiệm thu

- [x] Dịch vụ `scanAndPauseLegacyJiraSchedules(pool, { dryRun })` tại `apps/chat-api/src/services/jira-legacy-migration.ts` và CLI `scripts/scan-pause-legacy-jira.mjs` (`--dry-run` / `--apply`).
- [x] Kiểm thử tích hợp PostgreSQL thật `apps/chat-api/tests/jira-legacy-migration.test.ts` (2/2 PASS): quét đúng lịch `active` có bước `jira.*`, giữ nguyên lịch `myjira.*` và lịch đã `paused`, khóa `conversations` trước `schedules`, ghi thông báo tiếng Việt vào hội thoại.
- [x] Cập nhật `/privacy` (`apps/chat-web/src/pages/Privacy/PrivacyPage.tsx`) nêu rõ dữ liệu Jira đi qua 9router/model bên thứ ba, lưu giữ lịch sử `conversations`/`plans`/`execution_steps`, và hành vi ngắt kết nối local so với thu hồi grant trên Atlassian (`tests/fe-10-guide-privacy.test.tsx` 6/6 PASS).
- [x] Cập nhật `.env.example` (`MYJIRA_ENABLED=off`), `.gitignore` (`docs/ai-evidence/JIRA-LIVE/`) và `evaluations/README.md`.
- [ ] Nghiệm thu thật với Atlassian (`P-LIVE`) trên 2 site Jira Cloud thật và mở PR riêng bật `MYJIRA_ENABLED=on` (**NOT_RUN** — chờ credentials và thao tác consent của chủ dự án).

## Kết quả

- **Mã và kiểm thử (`feat/jira-11-rollout-prep`, 03/11/2026):**
  - `apps/chat-api/src/services/jira-legacy-migration.ts` + `scripts/scan-pause-legacy-jira.mjs`: hỗ trợ `--dry-run` và `--apply`, cập nhật `status = 'paused', next_run_at = NULL, pause_reason = 'legacy_jira_retired'` trong giao dịch PostgreSQL khóa `conversations` trước `schedules`.
  - `apps/chat-api/tests/jira-legacy-migration.test.ts`: **2/2 PASS** trên PostgreSQL 16 thật.
  - `apps/chat-web/src/pages/Privacy/PrivacyPage.tsx` + `apps/chat-web/tests/fe-10-guide-privacy.test.tsx`: **6/6 PASS**.
  - `.env.example`, `.gitignore` (`git check-ignore docs/ai-evidence/JIRA-LIVE/probe.json` khớp), `evaluations/README.md`: đã cập nhật.
  - `npm run typecheck:v3`, `npm run build:v3`, `node scripts/test-v3-web-build-security.mjs`: **PASS (exit 0)**.
  - `P-LIVE` (Atlassian 3LO thật): **NOT_RUN**; cờ `MYJIRA_ENABLED` giữ `off` theo đúng cổng dừng của đặc tả. Xem [log bàn giao](../log/2026-11-03-jira-11-rollout-prep.md).
