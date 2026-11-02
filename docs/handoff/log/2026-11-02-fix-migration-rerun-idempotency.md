# 2026-11-02 · antigravity · Fix PostgreSQL Migration Rerun Idempotency (`schedules_kind_check` & `oauth_states_mode_check`)

- **Đã làm:**
  - **Chẩn đoán gốc rễ (`schedules_kind_check` code `23514`):** Script `db/v3/migrate.mjs` chạy lại toàn bộ các file `0001_*.sql` → `0019_*.sql` mỗi lần gọi `npm run db:migrate:v3`. Khi database đã chứa các bản ghi `schedules` có `kind IN ('calendar_digest', 'github_digest', 'telegram_digest')` (từ `0017`–`0019`), bước chạy qua `db/v3/0016_sheets_automation_and_digest.sql` xóa và đặt lại `schedules_kind_check` chỉ gồm `('plan', 'sheets_digest')`, gây lỗi `23514` (`check constraint "schedules_kind_check" of relation "schedules" is violated by some row`). Tương tự, các file `0009` → `0018` đặt lại `oauth_states_mode_check`, `oauth_states_mode_owner_check`, `oauth_states_return_to_check` với tập `mode` hẹp hơn `0019`.
  - **Khắc phục theo TDD (Red → Green):**
    - Viết test tái hiện lỗi trước khi sửa trong `apps/chat-api/tests/db/telegram-oauth-migration.test.ts`, `apps/chat-api/tests/db/github-oauth-migration.test.ts` và `apps/chat-api/tests/db/calendar-digest-migration.test.ts` (chạy lại toàn bộ `runAll()` sau khi đã chèn lịch digest và các bản ghi `oauth_states`).
    - Đồng bộ `schedules_kind_check` và `schedules_kind_digest_check` trong `db/v3/0016_sheets_automation_and_digest.sql` bao gồm đầy đủ `('plan', 'sheets_digest', 'calendar_digest', 'github_digest', 'telegram_digest')`.
    - Đồng bộ `oauth_states_mode_check`, `oauth_states_mode_owner_check` và `oauth_states_return_to_check` trong `db/v3/0009_gmail_personal_connections.sql`, `db/v3/0011_oauth_return_to.sql`, `db/v3/0012_mycalendar_personal_connections.sql`, `db/v3/0013_mysheets_personal_connections.sql`, `db/v3/0014_trello_oauth.sql`, `db/v3/0018_github_oauth_and_digest.sql`.

- **Nhánh:** `fix/migration-rerun-idempotency`. Không sửa `CURRENT-STATE.md` hay `ROADMAP.md`.

- **Kiểm tra đã chạy (lệnh và kết quả):**
  - Trước khi sửa (RED): `npx vitest run apps/chat-api/tests/db/telegram-oauth-migration.test.ts` — FAIL (`error: check constraint "schedules_kind_check" of relation "schedules" is violated by some row`, code `23514`).
  - Sau khi sửa (GREEN):
    - `npm run db:migrate:v3` — exit code 0 (`Applied 0001_v3_core.sql` → `Applied 0019_telegram_oauth_and_digest.sql`).
    - `node --env-file-if-exists=.env ./node_modules/vitest/vitest.mjs run --dir apps/chat-api tests/db/` — 19 test files passed, 106 tests passed (exit code 0).
    - `npm run typecheck:v3` — exit code 0.

- **Chưa làm / vấn đề phát hiện:** Không có.
