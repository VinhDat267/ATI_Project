# 2026-11-10 · Hoàn tất khắc phục 12 phát hiện kiểm toán độc lập R2 cho Google Sheets & Scheduled Digest (`GAS-01` .. `GAS-12`)

- **Task card:** [`docs/handoff/tasks/GAS-REMEDIATION-sheets-r2-fixes.md`](../tasks/GAS-REMEDIATION-sheets-r2-fixes.md)
- **Nhánh:** `VinhDat267/sheets-gas-remediation-argon` (worktree độc lập từ baseline `origin/main` `2eed8d1d4309e833088d6f1d3fa774189049e283`)
- **Phạm vi thực hiện (tuân thủ tuần tự 4 pha sở hữu module):**
  1. **Phase 1 (`packages/tool-schemas`):** Mở rộng kiểu dữ liệu `SheetsDigestPreviewInfo` (`range`, `includeAiSummary`), `SheetsDigestDelivery` (`providerSentAt`, `dispatchedScheduleVersion`, `dispatchedConfigHash`) và hợp đồng `SheetsAppendLeaseStore`.
  2. **Phase 2 (`db/v3` + `packages/tool-adapters`):**
     - Thêm migration `db/v3/0035_sheets_gas_r2_remediation.sql` (`schedule_runs.dispatched_config`, `dispatched_config_hash` + trigger snapshot khi tạo/claim run; bảng `sheets_append_leases`).
     - Khắc phục `GAS-01` trong `SlackAdapter.sendMessage`, `GAS-06` & `GAS-07` & `GAS-10` trong `sheets-shared.ts`, `personal-sheets-adapter.ts`, `sheets-adapter.ts`, và `GAS-11` trong `personal-sheets-adapter.ts`.
  3. **Phase 3 (`apps/chat-api`):**
     - Khắc phục `GAS-01` & `GAS-06` & `GAS-08` trong `sheets-digest-runner.ts` và `run-state.ts`.
     - Khắc phục `GAS-04` trong `schedule-runner.ts` (bảo toàn kết quả `digest_sent` đã gửi thành công ngay cả khi lịch bị `pause`/`cancel`/đổi `version` sau khi claim).
     - Khắc phục `GAS-02`, `GAS-05`, `GAS-08`, `GAS-09` trong `sheets-digest-candidate.ts`, `schedule-service.ts`, `schedule-routes.ts`.
     - Bổ sung `PostgresSheetsAppendLeaseStore` (`apps/chat-api/src/services/sheets/sheets-append-lease-store.ts`) và nối vào `adapter-factory.ts`, `gmail-tools-runtime.ts`, `transports/sheets.ts`, `server.ts` (`GAS-10`).
  4. **Phase 4 (`apps/chat-web` + `scripts/` + Docs/Evidence):**
     - Cập nhật `api-client.ts`, `ScheduleMoment.tsx` (`GAS-02`), `ScheduleRunRecovery.tsx`, `ScheduleSection.tsx` (`GAS-09`), `PrivacyPage.tsx` (`GAS-02`, `GAS-11`).
     - Nối kịch bản trình duyệt `sheets_digest_v2_recovery` trong `scripts/test-v3-browser.mjs` (`GAS-12`).
     - Tạo runbook & mẫu biên nhận staging trung thực `NOT_RUN` tại `docs/ai-evidence/SHEETS-DIGEST-V2-STAGING-RUNBOOK.md` (`GAS-03`).
- **Kết quả kiểm thử thực tế (PostgreSQL thật trên cổng test `56534` & Chromium E2E):**
  - `packages/tool-schemas/tests/sheets-digest-v2-types.test.ts`: **13 passed**
  - `packages/tool-adapters/tests`: **24 test files passed (658 tests)**
  - `apps/chat-api/tests/services/sheets-gas-r2-remediation.test.ts`, `sheets-digest-delivery-recovery.test.ts`, `sheets-digest-concurrency.test.ts`: **3 test files passed (33 tests)**
  - `apps/chat-web/tests/schedule-sheets-digest-v2.test.tsx`, `mysheets-ui.test.tsx`, `schedule-sheets-digest-v2-real-backend.test.tsx`: **3 test files passed (34 tests)**
  - `SCENARIO=sheets_digest_v2_recovery node scripts/test-v3-browser.mjs`: **1 passed**
  - `npm run typecheck:v3` & `npm run build:v3`: **Exit code 0**
- **Còn lại (ngoài phạm vi tự động hóa):**
  - Chạy nghiệm thu thủ công trên môi trường staging thật theo `docs/ai-evidence/SHEETS-DIGEST-V2-STAGING-RUNBOOK.md` (`GAS-03`, hiện đánh dấu `NOT_RUN`).
