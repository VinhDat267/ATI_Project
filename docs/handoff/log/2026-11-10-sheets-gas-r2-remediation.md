# 2026-11-10 · Khắc phục offline 11/12 phát hiện kiểm toán R2 (`GAS-01`, `GAS-02`, `GAS-04`..`GAS-12`) & ghi nhận `GAS-03` đang MỞ (`NOT_RUN`)

- **Task card:** [`docs/handoff/tasks/GAS-REMEDIATION-sheets-r2-fixes.md`](../tasks/GAS-REMEDIATION-sheets-r2-fixes.md)
- **Nhánh:** `VinhDat267/sheets-gas-lease-recovery-argon` (worktree độc lập từ baseline `origin/main` `2eed8d1d4309e833088d6f1d3fa774189049e283`)
- **Phân loại trạng thái (Implemented vs Offline Proven vs Live `NOT_RUN`):**
  1. **Implemented (Đã triển khai mã nguồn):**
     - **Phase 1 (`packages/tool-schemas`):** Mở rộng kiểu dữ liệu `SheetsDigestPreviewInfo` (`range`, `includeAiSummary`), `SheetsDigestDelivery` (`providerSentAt`, `dispatchedScheduleVersion`, `dispatchedConfigHash`) và hợp đồng `SheetsAppendLeaseStore` (`SheetsAppendLeaseStatus`, `SheetsAppendDispatchMetadata`, `SheetsAppendLeaseState`, `SheetsAppendLeaseReconcileInput`, `beginWriteDispatch`, `completeWrite`, `abortUncommittedWrite`, `markUnknownOutcome`, `getLeaseState`, `reconcileUnknownLease`).
     - **Phase 2 (`db/v3` + `packages/tool-adapters`):**
       - Thêm migration `db/v3/0035_sheets_gas_r2_remediation.sql` (`schedule_runs.dispatched_config`, `dispatched_config_hash` + trigger snapshot khi tạo/claim run; bảng `sheets_append_leases` với các trạng thái `'active' | 'dispatched' | 'unknown_outcome' | 'released'`, `heartbeat_at`, `dispatched_at`, `released_at`, `reconciled_at`, `dispatched_meta`).
       - Khắc phục `GAS-01` trong `SlackAdapter.sendMessage`, `GAS-06` & `GAS-07` trong `sheets-shared.ts`, `personal-sheets-adapter.ts`, `sheets-adapter.ts`, và `GAS-11` trong `personal-sheets-adapter.ts`.
       - Khắc phục đầy đủ giao thức `GAS-10` cho cả `PersonalSheetsAdapter` (`mysheets.append_rows`) và `SheetsAdapter` (`sheets.append_rows`): hàng rào `beginWriteDispatch` trước HTTP POST, `completeWrite` khi nhận 200 hợp lệ, `abortUncommittedWrite` khi bị từ chối rõ ràng trước khi ghi, `markUnknownOutcome` khi gặp lỗi mơ hồ sau khi gửi (giữ nguyên `unknown_outcome` qua `release()`), và `reconcileAppendLease` fail-closed (chỉ tự động mở khóa khi xác minh đủ toàn bộ chữ ký dòng trong cửa sổ `A1:Z500` với CAS `(scope_key, lease_id, fencing_token, status = 'unknown_outcome')`; tuyệt đối không xóa lease `'dispatched'` đang bay và không suy diễn `'aborted'` từ việc vắng mặt dòng, lô khớp một phần, dữ liệu đọc lại hỏng hoặc vượt 500 dòng; trường hợp không chứng minh được hoàn tất trên nhà cung cấp được giữ chặn ở `unknown_outcome` và ghi nhận là **Accepted Limitation** yêu cầu quyết định thủ công `manualOperatorDecision` + `acknowledgeDuplicateRisk: true`).
     - **Phase 3 (`apps/chat-api`):**
       - Khắc phục `GAS-01` & `GAS-06` & `GAS-08` trong `sheets-digest-runner.ts` và `run-state.ts`.
       - Khắc phục `GAS-04` trong `schedule-runner.ts` (bảo toàn kết quả `digest_sent` đã gửi thành công ngay cả khi lịch bị `pause`/`cancel`/đổi `version` sau khi claim).
       - Khắc phục `GAS-02`, `GAS-05`, `GAS-08`, `GAS-09` trong `sheets-digest-candidate.ts`, `schedule-service.ts`, `schedule-routes.ts`.
       - Củng cố `PostgresSheetsAppendLeaseStore` (`apps/chat-api/src/services/sheets/sheets-append-lease-store.ts`): `fencing_token` tăng đơn điệu (không xóa dòng khi `release()`, tránh reset token về 1 hoặc xóa nhầm chủ lease mới), heartbeat nền cho request chậm, chặn tự động chiếm quyền khi lease đang `'dispatched'` hoặc `'unknown_outcome'`, và nối vào `adapter-factory.ts`, `gmail-tools-runtime.ts`, `transports/sheets.ts`, `server.ts` (`GAS-10`).
     - **Phase 4 (`apps/chat-web` + `scripts/` + Docs/Evidence):**
       - Cập nhật `api-client.ts`, `ScheduleMoment.tsx` (`GAS-02`), `ScheduleRunRecovery.tsx`, `ScheduleSection.tsx` (`GAS-09`), `PrivacyPage.tsx` (`GAS-02`, `GAS-11`).
       - Nối kịch bản trình duyệt `sheets_digest_v2_recovery` trong `scripts/test-v3-browser.mjs` (`GAS-12`).
       - Tạo runbook & mẫu biên nhận staging trung thực `NOT_RUN` tại `docs/ai-evidence/SHEETS-DIGEST-V2-STAGING-RUNBOOK.md` (phục vụ `GAS-03`).
  2. **Offline Proven (Đã kiểm chứng tự động trên container PostgreSQL 16 cô lập riêng `127.0.0.1:56560` & loopback HTTP):**
     - `packages/tool-schemas/tests/sheets-digest-v2-types.test.ts`: **11 passed**
     - `packages/tool-adapters/tests/sheets/personal-sheets-adapter.test.ts`, `sheets-adapter.test.ts`, `sheets-digest-window.test.ts`: **3 test files passed (88 tests)**
     - `apps/chat-api/tests/services/sheets-gas-r2-remediation.test.ts`, `sheets-digest-delivery-recovery.test.ts`, `sheets-digest-concurrency.test.ts`: **3 test files passed (36 tests)** trên PostgreSQL 16 cô lập (`127.0.0.1:56560/ati_v3`)
     - `apps/chat-web/tests/schedule-sheets-digest-v2.test.tsx`, `mysheets-ui.test.tsx`: **2 test files passed (31 tests)**
     - `npm run typecheck:v3` & `npm run build:v3`: **Exit code 0**
  3. **Live `NOT_RUN` / Missing Evidence (`GAS-03` đang MỞ — chưa được tính là đã sửa xong):**
     - **`GAS-03` vẫn đang ở trạng thái Missing Evidence / `NOT_RUN`**: Chưa thực thi kiểm thử live với Google OAuth + Picker + Sheets API thật hoặc Slack/Gmail/Telegram thật trên môi trường staging. Không tuyên bố hoàn tất cả 12 mục cho tới khi hoàn thành runbook staging thật tại `docs/ai-evidence/SHEETS-DIGEST-V2-STAGING-RUNBOOK.md`.
