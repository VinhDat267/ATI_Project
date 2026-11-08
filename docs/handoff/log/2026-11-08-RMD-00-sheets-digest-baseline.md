# RMD-00 — Baseline Verification, Multi-Tenant Fixtures & V1 Schedule Inventory (`PR-0`)

- **Ngày:** 08/11/2026 (Asia/Saigon)
- **Nhánh:** `test/tenant-digest-baseline` (tách từ `main@b05d49a20b68361f3f63b222f9332d744de5b7c6`, rebased lên `main@05bb05fe24dd47b5802cc53ddb67747794c9a214`)
- **Task card:** [`docs/handoff/tasks/RMD-00-sheets-digest-baseline.md`](../tasks/RMD-00-sheets-digest-baseline.md)
- **Đặc tả & Kế hoạch:**
  - [`docs/superpowers/specs/2026-11-08-sheets-digest-gate-a-remediation-design.md`](../../superpowers/specs/2026-11-08-sheets-digest-gate-a-remediation-design.md) (`v2.4`)
  - [`docs/superpowers/plans/2026-11-08-sheets-digest-gate-a-remediation.md`](../../superpowers/plans/2026-11-08-sheets-digest-gate-a-remediation.md) (`v2.4`)

## 1. Tóm tắt thực hiện

1. **Kiểm chứng Baseline tại `b05d49a20b68361f3f63b222f9332d744de5b7c6` (và `05bb05fe24dd47b5802cc53ddb67747794c9a214`):**
   - Ghi nhận chi tiết vị trí mã nguồn, lệnh tái hiện và đối chiếu Expected vs. Actual cho 5 lỗi trọng tâm của Gate A: `F-01` (Organization `sheets_digest` đọc/ghi nhầm credential `workspace_id = null`), `F-02` (thiếu chốt chặn nguyên tử `delivery_started_at` trước khi gửi và xử lý nhầm lỗi mạng sau khi gửi thành `digest_failed`), `F-03` (`gmail-tools-runtime.ts` loại bỏ `sheets.*` của Tổ chức khi kết nối `mysheets` cá nhân, kể cả kết nối chỉ dùng Drive/Docs), `F-04` (`SheetsDigestRunner` chỉ đọc `tail:20` và thiếu `dataScope` 3 tầng trung thực), và `F-08` (tự động rớt về credential `telegram` dùng chung `user_id IS NULL`).
2. **Xây dựng bộ Fixture Đa Tenant & Provider Spy (`apps/chat-api/tests/helpers/sheets-digest-tenant-fixtures.ts`):**
   - Cung cấp `seedSheetsDigestTenants` khởi tạo đầy đủ 5 ngữ cảnh độc lập trên PostgreSQL: `Personal User A`, `Personal User B`, `Org A` (`workspace_id = wsA`), `Org B` (`workspace_id = wsB`), và `Legacy` (`workspace_id = null`).
   - Cung cấp `createDigestProviderSpy` ghi nhận đầy đủ `{ service, toolName, userId, credentialId, workspaceMode, workspaceId, spreadsheetId, targetId, callCount }` mà không phát sinh bất kỳ cuộc gọi HTTP thực tế nào ra ngoài.
   - Cung cấp `inspectV1SheetsDigestSchedules` và `evaluateV1IdentityProven` phân loại chỉ đọc (read-only) toàn bộ lịch `kind = 'sheets_digest'` thành `v1_pinned_consistency_candidate` (Class A, kèm `evidenceBoundary: 'consistency_only_not_config_immutability_proof'`), `v1_unpinned_fail_closed` (Class B, kèm `evidenceBoundary: 'unpinned_or_inconsistent'`) và `v2_ready` theo đúng 6 tiêu chí và ranh giới bằng chứng lịch sử của Spec `v2.4` §2.6.1–2.6.2.
3. **Kiểm thử tích hợp PostgreSQL (`apps/chat-api/tests/services/sheets-digest-baseline-inventory.test.ts`):**
   - Kiểm chứng cô lập dữ liệu giữa `Personal User A`, `Personal User B`, `Org A`, `Org B`, `Legacy`.
   - Kiểm chứng `createDigestProviderSpy` ghi nhận và `reset()` chính xác.
   - Kiểm chứng `inspectV1SheetsDigestSchedules` phân loại đúng cả 5 trường hợp (Class A `mysheets → gmail` với `evidenceBoundary: 'consistency_only_not_config_immutability_proof'`, Class B Organization `sheets → slack`, Class B Personal `mysheets → telegram`, Class B credential có `created_at > digest_approved_at`, Class B credential có `status_changed_at > digest_approved_at`) và đảm bảo `0` thay đổi dữ liệu trong bảng `schedules`.

## 2. Bằng chứng kiểm thử thực tế

- **Test Suite (`RMD-00` + Baseline Suites):**
  `npx vitest run apps/chat-api/tests/services/sheets-digest-baseline-inventory.test.ts apps/chat-api/tests/services/sheets-digest.test.ts apps/chat-api/tests/services/schedules/sheets-digest.test.ts apps/chat-api/tests/routes/workspace-isolation.test.ts`
  → **PASS (`4/4` test files, `25/25` tests passed, `exit code 0`)**.
- **Typecheck:**
  `npm run typecheck:v3`
  → **PASS (`exit code 0`)**.

## 3. Ranh giới

- Tuân thủ nghiêm ngặt `RMD-00` Rule #8: Không sửa bất kỳ file nào trong `apps/chat-api/src/`, `apps/chat-web/src/`, `packages/`, `db/v3/`, `docs/handoff/CURRENT-STATE.md` hoặc `docs/handoff/ROADMAP.md`.
