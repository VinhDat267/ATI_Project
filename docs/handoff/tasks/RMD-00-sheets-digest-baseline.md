# RMD-00 · Baseline Verification, Multi-Tenant Fixtures & V1 Schedule Inventory (`PR-0`)

**Trạng thái:** Đã hoàn thành · **Nhánh:** `test/tenant-digest-baseline` · **Baseline SHA:** `b05d49a20b68361f3f63b222f9332d744de5b7c6` (rebased onto `main@05bb05fe24dd47b5802cc53ddb67747794c9a214`)

## 1. Mục tiêu & Phạm vi

Thiết lập bộ kiểm chứng cơ sở (Baseline Verification), bộ fixture đa tenant (`Personal User A`, `Personal User B`, `Org A`, `Org B`, `Legacy`), outbound provider spy (`createDigestProviderSpy`), và hàm kiểm kê chỉ đọc (`inspectV1SheetsDigestSchedules`) cho kế hoạch khắc phục Google Sheets Digest Gate A (`RMD-00 → RMD-04`, Spec `v2.4`).

- **Ranh giới (`RMD-00` Rule #8):** PR `RMD-00` chỉ thêm tài liệu, fixture và bài test kiểm kê đang `PASS` (`GREEN`), tuyệt đối không sửa mã nguồn runtime (`apps/chat-api/src/`, `apps/chat-web/src/`, `packages/`, `db/v3/`) và không merge test `RED` làm hỏng CI. Các bài test hồi quy `RED → GREEN` cho `F-01`, `F-02`, `F-03`, `F-04`, `F-08` được ghép trực tiếp vào các PR khắc phục tương ứng (`Task 2`, `Task 3`, `Task 4`).

## 2. Bằng chứng tái hiện lỗi tại Baseline `main@b05d49a20b68361f3f63b222f9332d744de5b7c6`

### 2.1. `F-01` — Lịch `sheets_digest` trong Organization đọc/ghi nhầm credential `workspace_id = NULL` (Legacy)

- **Vị trí mã nguồn:**
  - [`apps/chat-api/src/services/chat-service.ts`](../../../apps/chat-api/src/services/chat-service.ts#L1487-L1508): `ChatService.prepareProposal` gọi `analyzeSheetsDigestCandidate` mà không truyền `workspaceMode`, `workspaceId` hay `recurrence`.
  - [`apps/chat-api/src/services/schedules/sheets-digest-candidate.ts`](../../../apps/chat-api/src/services/schedules/sheets-digest-candidate.ts#L117-L310): gọi `credentialRepo.getCredentials('sheets')` (dòng `117`, `213`) và `credentialRepo.getCredentials('slack')` (dòng `266`) không có tham số `workspaceId` (mặc định `workspaceId = null`), dẫn tới việc tra cứu credential `user_id IS NULL AND workspace_id IS NULL` (Legacy) thay vì `workspace_id = wsA`. Đồng thời cấu hình `version: 1` không lưu `credentialId` cho `sheets` và `slack`.
  - [`apps/chat-api/src/services/schedules/schedule-service.ts`](../../../apps/chat-api/src/services/schedules/schedule-service.ts#L471-L492): `ScheduleService.confirmProposal` gọi lại `analyzeSheetsDigestCandidate` không truyền `workspaceMode`/`workspaceId`, giữ kết nối transaction DB mở trong lúc chạy candidate, và không đối chiếu `sheetsDigestCandidateMatches(sheetsCandidate, recheck)`.
  - [`apps/chat-api/src/services/schedules/sheets-digest-runner.ts`](../../../apps/chat-api/src/services/schedules/sheets-digest-runner.ts#L248-L291): `SheetsDigestRunner.verifyConfigAndScope` gọi `this.options.credentialRepo.getCredentials('sheets')` (dòng `248`) và `getCredentials('slack')` (dòng `272`) với `workspaceId = null`.
  - [`apps/chat-api/src/server.ts`](../../../apps/chat-api/src/server.ts#L287-L310): `createSheetsDigestAdapter` gọi `getAdapterForService(serviceId, { userId, phase: 'execution', connections })` không truyền `workspaceMode` và `workspaceId`.
- **Kịch bản tái hiện & Lệnh chạy:**
  - Seed `Org A` (`workspace_id = wsA`, có `sheets` với `ORG_A_SPREADSHEET_ID` và `slack` với `C_ORG_A_01`) và `Legacy` (`workspace_id = null`, có `sheets` với `LEGACY_SPREADSHEET_ID` và `slack` với `C_LEGACY_01`).
  - Gọi `analyzeSheetsDigestCandidate` cho thành viên trong `Org A`.
  - Lệnh kiểm tra: `npx vitest run apps/chat-api/tests/services/sheets-digest-baseline-inventory.test.ts`
- **Kỳ vọng (Expected) vs. Thực tế tại `b05d49a2` (Actual):**
  - **Expected:** `analyzeSheetsDigestCandidate`, `confirmProposal`, `verifyConfigAndScope`, và `createSheetsDigestAdapter` trong `Org A` chỉ truy vấn `workspace_id = wsA`, khóa `source.credentialId = orgA.sheetsCred.id` và `destination.credentialId = orgA.slackCred.id`, và từ chối hoàn toàn credential `workspace_id = null` hoặc `Org B`.
  - **Actual (`RED` tại `b05d49a2`):** `analyzeSheetsDigestCandidate` bỏ qua `orgA.workspaceId`, đọc credential `workspace_id = null` (Legacy), từ chối `ORG_A_SPREADSHEET_ID` nếu không có trong Legacy, hoặc khớp nhầm `LEGACY_SPREADSHEET_ID` và kênh `C_LEGACY_01` của Legacy mà không gắn `credentialId`.

### 2.2. `F-02` — Đua tranh thu hồi quyền / tạm dừng lịch trước khi gửi & thiếu chốt chặn nguyên tử `delivery_started_at`

- **Vị trí mã nguồn:**
  - [`apps/chat-api/src/services/schedules/sheets-digest-runner.ts`](../../../apps/chat-api/src/services/schedules/sheets-digest-runner.ts#L337-L476): `SheetsDigestRunner.executeDigest(schedule, runVersion, isStillCurrent, outerSignal)` kiểm tra `verifyConfigAndScope` ở đầu hàm (dòng `343`), đọc Google Sheets và chạy AI summary (tốn tới `10s`), sau đó ở dòng `415` chỉ gọi `isStillCurrent()` (chỉ đọc `SELECT version, status FROM schedules WHERE id=$1` ngoài transaction, không kiểm tra `users.status`, `workspace_members.status`, `service_credentials.status/id/scope`, không ghi nhận `delivery_started_at`), rồi gọi thẳng `destAdapter.execute('slack.send_message' | 'gmail.send_message' | 'telegram.send_message')` (dòng `441-464`).
  - [`apps/chat-api/src/services/schedules/schedule-runner.ts`](../../../apps/chat-api/src/services/schedules/schedule-runner.ts#L519-L691): `executeDigestRun` bắt mọi lỗi gửi sau khi kết nối bị ngắt hoặc timeout thành `digest_failed` (dòng `561-564` và `635-659`), cho phép lịch tự động chạy lại hoặc `replan` dù gói tin có thể đã được gửi tới Slack/Gmail/Telegram (nguy cơ gửi trùng báo cáo).
- **Kịch bản tái hiện & Lệnh chạy:**
  - Trong khi `executeDigest` đang ở bước đọc Sheets hoặc tóm tắt AI, thu hồi credential (`deletePersonalCredentials` / `markReconnectRequired`) hoặc vô hiệu hóa thành viên trong `workspace_members`.
- **Kỳ vọng (Expected) vs. Thực tế tại `b05d49a2` (Actual):**
  - **Expected:** Trước khi tạo `destAdapter` và gửi HTTP ra ngoài, runner bắt buộc phải thực hiện `claimSheetsDigestDelivery` trong một transaction ngắn (`conversations FOR UPDATE` → `schedules FOR UPDATE` → `users / workspace_members / service_credentials FOR SHARE NOWAIT` → `schedule_runs FOR UPDATE NOWAIT`), ghi một lần `delivery_started_at = now()`, commit và trả kết nối về pool trước khi gửi mạng. Nếu quyền bị thu hồi trước thời điểm claim commit (`T_revoke < T_claim`), phải dừng ngay (`blocked` / `discarded`) với `0` lần gọi HTTP gửi đi. Nếu lỗi mạng xảy ra sau khi đã claim (`delivery_started_at IS NOT NULL`), phải chuyển sang `needs_attention` (`SHEETS_DELIVERY_UNKNOWN`) thay vì `digest_failed`.
  - **Actual (`RED` tại `b05d49a2`):** `isStillCurrent()` vẫn trả về `true` khi credential bị thu hồi hoặc thành viên tổ chức bị khóa giữa chừng, nên `destAdapter.execute` vẫn phát tán báo cáo ra ngoài; đồng thời lỗi timeout sau khi gửi bị gán `digest_failed` và thiếu cột `delivery_started_at`.

### 2.3. `F-03` — Runtime Tool Catalog loại bỏ `sheets.*` của Tổ chức khi người dùng kết nối `mysheets` cá nhân (kể cả kết nối chỉ dùng Drive/Docs với 0 bảng tính)

- **Vị trí mã nguồn:**
  - [`apps/chat-api/src/services/registered-services.ts`](../../../apps/chat-api/src/services/registered-services.ts#L199-L214): Sau PR #286, khi người dùng có kết nối OAuth `mysheets` đang `active` nhưng chưa chọn bảng tính nào (`spreadsheets.length === 0`), `getToolCatalogFor` vẫn trả về 6 công cụ Google Drive/Docs (`mysheets.list_drive_files`, `mysheets.create_doc`, ...) có `tool.service === 'mysheets'`.
  - [`apps/chat-api/src/config/gmail-tools-runtime.ts`](../../../apps/chat-api/src/config/gmail-tools-runtime.ts#L78-L105): Dòng `78` tính `const hasMySheets = personal.some((t) => t.service === 'mysheets')` và ở cả nhánh `live` (dòng `86, 89`) lẫn `sandbox` (dòng `101, 104`) đều lọc bỏ toàn bộ `t.service === 'sheets'` và `SHEETS_EXTENDED_TOOLS` khi `hasMySheets === true`.
- **Kịch bản tái hiện & Lệnh chạy:**
  - Người dùng trong `Org A` (`workspaceMode: 'organization', workspaceId: wsA`) có cấu hình `sheets` của Tổ chức, đồng thời có kết nối `mysheets` cá nhân (có bảng tính hoặc `spreadsheets: []` chỉ dùng Drive/Docs). Gọi `runtimeTools('live', credentialRepo, encryptionKey, { userId, workspaceMode: 'organization', workspaceId: wsA, mysheetsEnabled: true, ... })`.
- **Kỳ vọng (Expected) vs. Thực tế tại `b05d49a2` (Actual):**
  - **Expected:** Trong `workspaceMode === 'organization'`, các công cụ `sheets.*` (và `SHEETS_EXTENDED_TOOLS`) của Tổ chức phải cùng tồn tại song song với `mysheets.*`. Trong `personal`/`legacy`, kết nối `mysheets` chỉ có 6 công cụ Drive/Docs (`0` bảng tính, không có `mysheets.read_range`) không được làm mất `sheets.*`.
  - **Actual (`RED` tại `b05d49a2`):** `hasMySheets` bằng `true` làm toàn bộ công cụ `sheets.*` và `SHEETS_EXTENDED_TOOLS` của Tổ chức bị xóa khỏi catalog.

### 2.4. `F-04` — `SheetsDigestRunner` chỉ đọc `tail:20` (`limit: 50`) khi tính KPI và thiếu phân tầng phạm vi dữ liệu trung thực (`dataScope`)

- **Vị trí mã nguồn:**
  - [`apps/chat-api/src/services/schedules/sheets-digest-runner.ts`](../../../apps/chat-api/src/services/schedules/sheets-digest-runner.ts#L352-L383): `executeDigest` luôn gọi công cụ công khai `sheets.read_range` / `mysheets.read_range` với `range = "${sheetName}!tail:20"` (hoặc `tail:20`) và `limit: 50`, sau đó truyền `records` (tối đa 20 dòng cuối) vào `analyzeSheetKpiMetrics(headers, records, values)` (dòng `383`) và in ra `"Tổng số dòng: ${metrics.totalRows}"` (dòng `427`).
  - [`packages/tool-adapters/src/sheets/sheets-shared.ts`](../../../packages/tool-adapters/src/sheets/sheets-shared.ts#L66-L268): `resolveReadRange` và `applySmartReadTransform` giới hạn công cụ công khai ở `tail <= 50`, `limit <= 50` và cắt `selectedDataRows = allDataRows.slice(-Math.min(resolved.tailCount, limit))` (20 dòng).
- **Kịch bản tái hiện & Lệnh chạy:**
  - Chạy `SheetsDigestRunner.executeDigest` trên bảng tính có `50` hoặc `500` dòng dữ liệu thực tế, hoặc bảng tính có `20` dòng dữ liệu trên lưới mặc định `gridProperties.rowCount = 1000`, hoặc bảng tính có `650` dòng dữ liệu.
- **Kỳ vọng (Expected) vs. Thực tế tại `b05d49a2` (Actual):**
  - **Expected:** Runner phải đọc qua phương thức nội bộ `readDigestWindow` (quét tối đa `500` dòng dữ liệu trong cửa sổ `A1:Z502` để phát hiện tràn `>500` dòng mà không nới trần công cụ công khai `read_range`), tính đúng tổng doanh thu/số lượng cho `20`, `50`, `500` dòng, và gắn nhãn `dataScope` 3 tầng trung thực (`full_tab_verified`, `full_requested_range`, `partial` khi lưới vật lý `> 501×26` hoặc khi `windowClipped === true`), tuyệt đối không báo `gridProperties.rowCount` (`1000`) là số dòng có dữ liệu hay tuyên bố toàn bảng khi chỉ đọc một phần.
  - **Actual (`RED` tại `b05d49a2`):** `executeDigest` chỉ tính tổng KPI trên 20 dòng cuối cùng (`tail:20`) và báo `"Tổng số dòng: 20"` ngay cả khi bảng tính có 50 hoặc 500 dòng dữ liệu.

### 2.5. `F-08` — Tự động rớt về (fallback) credential `telegram` dùng chung (`user_id IS NULL`) khi người dùng chưa kết nối Telegram cá nhân

- **Vị trí mã nguồn:**
  - [`apps/chat-api/src/services/schedules/sheets-digest-candidate.ts`](../../../apps/chat-api/src/services/schedules/sheets-digest-candidate.ts#L363-L366):
    ```ts
    const tgRec =
      (userId ? await credentialRepo.getPersonalCredentials('telegram', userId) : null) ??
      (await credentialRepo.getCredentials('telegram'));
    ```
  - [`apps/chat-api/src/services/schedules/sheets-digest-runner.ts`](../../../apps/chat-api/src/services/schedules/sheets-digest-runner.ts#L304-L307):
    ```ts
    const tgRec =
      (await this.options.credentialRepo.getPersonalCredentials('telegram', schedule.user_id)) ??
      (await this.options.credentialRepo.getCredentials('telegram'));
    ```
- **Kịch bản tái hiện & Lệnh chạy:**
  - Người dùng chưa kết nối Telegram cá nhân (`getPersonalCredentials('telegram', userId)` trả về `null`), nhưng trong DB tồn tại một dòng `service_credentials` với `service = 'telegram', user_id = NULL, workspace_id = NULL`.
- **Kỳ vọng (Expected) vs. Thực tế tại `b05d49a2` (Actual):**
  - **Expected:** Đích nhận `telegram` chỉ được phép sử dụng kết nối OAuth Telegram cá nhân của chính `schedule.user_id` (`user_id = schedule.user_id AND workspace_id IS NULL`) và phải khóa `destination.credentialId`; nếu người dùng chưa kết nối Telegram cá nhân thì phải từ chối fail-closed, tuyệt đối không fallback sang credential `telegram` có `user_id IS NULL`.
  - **Actual (`RED` tại `b05d49a2`):** Cả `analyzeSheetsDigestCandidate` và `SheetsDigestRunner.verifyConfigAndScope` đều fallback sang `credentialRepo.getCredentials('telegram')` (`user_id IS NULL`) và không lưu `destination.credentialId`.

---

## 3. Kiểm kê Lịch V1 (`inspectV1SheetsDigestSchedules`) & Phân loại Class A vs. Class B

### 3.1. Truy vấn SQL chỉ đọc (Read-Only Inventory Query)

```sql
SELECT
  s.id,
  s.user_id,
  s.conv_id,
  COALESCE(s.workspace_mode, 'legacy') AS workspace_mode,
  s.workspace_id,
  s.status,
  COALESCE((s.digest_config->>'version')::int, 1) AS config_version,
  s.digest_config->'source'->>'service' AS source_service,
  s.digest_config->'destination'->>'service' AS dest_service,
  (s.digest_config->'source'->>'credentialId') IS NOT NULL AS has_source_cred_id,
  (s.digest_config->'destination'->>'credentialId') IS NOT NULL AS has_dest_cred_id,
  s.digest_approved_at,
  u.status AS user_status
FROM schedules s
LEFT JOIN users u ON u.id = s.user_id
WHERE s.kind = 'sheets_digest'
ORDER BY s.created_at ASC, s.id ASC;
```

### 3.2. Quy tắc phân loại & Giới hạn bằng chứng lịch sử (`Spec v2.4` §2.6.1 & §2.6.2 `evaluateV1IdentityProven`)

> **Giới hạn bằng chứng lịch sử (`Pre-Task-3 Condition #1`):**
> Bảng `service_credentials` (`0001_v3_core.sql`, `0009_gmail_personal_connections.sql`) chỉ có các cột `(id, service, user_id, workspace_id, config, created_at, status, status_changed_at)` — **không có cột `updated_at`** và **không có bảng audit lịch sử sửa `config`** trước `0033`. Khi gọi `GmailConnectionRepo.updateConfigIfActive` (`PUT /api/connections/mysheets/scope`, `POST /api/connections/mysheets/quick-create-spreadsheet`) hoặc `CredentialRepo.updateCredentials`, hệ thống thực hiện `UPDATE service_credentials SET config = $1 WHERE id = $2` tại chỗ mà không đổi `id`, `created_at` hay `status_changed_at`.
> Do đó, việc khớp `created_at <= digest_approved_at`, `status_changed_at <= digest_approved_at`, `connectedAt <= digest_approved_at`, và `digest_config_hash` **chỉ chứng minh tính nhất quán hiện tại (`evidenceBoundary: 'consistency_only_not_config_immutability_proof'`) chứ KHÔNG chứng minh tuyệt đối rằng `service_credentials.config` chưa từng bị sửa tại chỗ**. Vì vậy, chính sách vận hành mặc định `SHEETS_DIGEST_V1_COMPAT_POLICY` là `'strict_pause_all'` (fail-closed) trừ khi người vận hành chủ động bật `'allow_consistency_candidate'` sau khi rà soát báo cáo `--mode=inventory`.

1. **Class A (`v1_pinned_consistency_candidate`, `evidenceBoundary: 'consistency_only_not_config_immutability_proof'`):**
   Chỉ các lịch `version: 1` thỏa mãn **đồng thời cả 6 điều kiện nhất quán** sau mới được xếp vào nhóm ứng viên nhất quán Class A (chỉ được phép chạy tiếp hoặc nâng cấp tự động khi người vận hành chủ động chọn `SHEETS_DIGEST_V1_COMPAT_POLICY=allow_consistency_candidate` sau khi kiểm kê; mặc định `strict_pause_all` vẫn tạm dừng để yêu cầu xác nhận lại):
   - `s.workspace_mode IN ('personal', 'legacy') AND s.workspace_id IS NULL`.
   - `config.source.service === 'mysheets'` có `config.source.credentialId` (UUID hợp lệ) **và** `config.source.email` đã được ghi trong `digest_config` từ lúc duyệt.
   - `config.destination.service === 'gmail'` có `config.destination.credentialId` (UUID hợp lệ) **và** `config.destination.recipientEmail` hợp lệ đã được ghi trong `digest_config`.
   - Bản ghi nguồn trong `service_credentials` có `id = config.source.credentialId`, `user_id = s.user_id`, `workspace_id IS NULL`, `status = 'active'`, `created_at <= s.digest_approved_at`, `(status_changed_at IS NULL OR status_changed_at <= s.digest_approved_at)`, `(decSource.connectedAt IS NULL OR decSource.connectedAt <= s.digest_approved_at)`, giải mã khớp `decSource.email === config.source.email` và `config.source.spreadsheetId` nằm trong `allowedScope.spreadsheets` / `selectedSpreadsheets`.
   - Bản ghi đích trong `service_credentials` có `id = config.destination.credentialId`, `user_id = s.user_id`, `workspace_id IS NULL`, `status = 'active'`, `created_at <= s.digest_approved_at`, `(status_changed_at IS NULL OR status_changed_at <= s.digest_approved_at)`, `(decDest.connectedAt IS NULL OR decDest.connectedAt <= s.digest_approved_at)`, và giải mã có `decDest.email` hợp lệ.
   - `users.status = 'active'` và `s.digest_config_hash === computeSheetsDigestHash({ userId: s.user_id, recurrence: s.recurrence, config })`.

2. **Class B (`v1_unpinned_fail_closed`, `evidenceBoundary: 'unpinned_or_inconsistent'`):**
   Mọi lịch `version: 1` không thỏa mãn đầy đủ 6 điều kiện trên — bao gồm **100% lịch `version: 1` trong Organization (`workspace_mode = 'organization'`)**, mọi lịch `version: 1` dùng `sheets`, `slack`, hoặc `telegram` (do v1 chưa từng lưu `credentialId`), hoặc các lịch có credential được tạo mới/xoay vòng/đổi trạng thái sau `digest_approved_at` — đều được phân loại vào `v1_unpinned_fail_closed`, buộc dừng an toàn (`blocked` → tạm dừng chờ xác nhận cấp quyền lại qua `reauthorize-preview`) dưới mọi chính sách để ngăn chặn việc âm thầm gắn nhầm vào credential hiện tại của Tổ chức hoặc hệ thống.

---

## 4. Kết quả (`RMD-00`)

- **Files đã tạo:**
  - [`apps/chat-api/tests/helpers/sheets-digest-tenant-fixtures.ts`](../../../apps/chat-api/tests/helpers/sheets-digest-tenant-fixtures.ts): Bộ khởi tạo dữ liệu kiểm thử đa tenant (`seedSheetsDigestTenants` cho `Personal User A`, `Personal User B`, `Org A`, `Org B`, `Legacy`), bộ spy không gọi mạng (`createDigestProviderSpy`), và hàm kiểm kê chỉ đọc (`inspectV1SheetsDigestSchedules` + `evaluateV1IdentityProven` + `insertTestSheetsDigestSchedule`).
  - [`apps/chat-api/tests/services/sheets-digest-baseline-inventory.test.ts`](../../../apps/chat-api/tests/services/sheets-digest-baseline-inventory.test.ts): Bộ kiểm thử tích hợp PostgreSQL kiểm chứng cô lập dữ liệu giữa 5 tenant, hành vi ghi nhận/reset của `createDigestProviderSpy`, phân loại chính xác Class A (`v1_pinned_consistency_candidate` kèm `evidenceBoundary: 'consistency_only_not_config_immutability_proof'`) vs. Class B (`v1_unpinned_fail_closed`) trên cả 5 trường hợp điển hình, và cam kết `0` thay đổi dữ liệu khi chạy `inspectV1SheetsDigestSchedules`.
  - [`docs/handoff/tasks/RMD-00-sheets-digest-baseline.md`](RMD-00-sheets-digest-baseline.md) & [`docs/handoff/log/2026-11-08-RMD-00-sheets-digest-baseline.md`](../log/2026-11-08-RMD-00-sheets-digest-baseline.md).
- **Kết quả chạy lệnh kiểm thử thực tế:**
  - `npx vitest run apps/chat-api/tests/services/sheets-digest-baseline-inventory.test.ts apps/chat-api/tests/services/sheets-digest.test.ts apps/chat-api/tests/services/schedules/sheets-digest.test.ts apps/chat-api/tests/routes/workspace-isolation.test.ts` → **PASS (`4` test files, `25` tests passed, `exit code 0`)**.
  - `npm run typecheck:v3` → **PASS (`exit code 0`)**.
- **Ranh giới mã nguồn:** `0` file trong `apps/chat-api/src/`, `apps/chat-web/src/`, `packages/`, `db/v3/` bị thay đổi.
