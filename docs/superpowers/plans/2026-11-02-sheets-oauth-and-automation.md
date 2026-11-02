# Kế hoạch Triển khai: Google Sheets OAuth & AI Automation v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use `test-driven-development` and `executing-plans` to implement this plan task-by-step via Red-Green-Refactor.

**Goal:** Triển khai hoàn chỉnh Google Sheets OAuth & AI Automation v2 gồm: (1) chọn bảng tính mượt qua cả Google Picker lẫn dán trực tiếp URL/ID kèm tự động khám phá danh sách tab (`sheets?: string[]`); (2) đọc bảng tính thông minh theo tên tab, dải cột (`A:Z`), N dòng cuối (`tail:N`) và ánh xạ dòng tiêu đề (`headerAware` / `headers` & `records`) mà không bắt nhớ tọa độ `A1:Z50`; (3) chống ghi trùng dữ liệu (`append_rows` idempotent deduplication) khi đồng bộ từ GitHub/Jira/Trello/Gmail vào Sheets kết hợp bảo vệ tuyệt đối chống Formula Injection; và (4) chế độ lịch chạy tự động báo cáo KPI/tiến độ từ Sheets (`approvalMode: 'manual' | 'auto_digest'`, `kind = 'sheets_digest'`) gửi vào đích Slack/Telegram đã khóa mỗi sáng không cần duyệt lại.

**Architecture:** Mở rộng có tương thích ngược trên 4 tầng của monorepo v3 (`@wap/tool-schemas`, `@wap/tool-adapters`, `@wap/chat-api`, `@wap/chat-web`) và bổ sung migration PostgreSQL idempotent `db/v3/0016_sheets_automation_and_digest.sql`. Giữ nguyên bất biến 33 tools trong `ALL_TOOLS`, 8 services trong `SERVICE_REGISTRY`, toàn bộ SHA-256 system prompt khi cờ tắt và toàn bộ 11 phép thử đột biến trong `scripts/test-mysheets-mutations.mjs`.

**Tech Stack:** TypeScript (ESM), Node.js, Vitest, PostgreSQL 16 (`pg`), Express, React 18 + Zustand.

---

## Cấu trúc File (File Map)

### Mới tạo (Created)
1. `db/v3/0016_sheets_automation_and_digest.sql` — Migration PostgreSQL bổ sung `schedules.kind` (`'plan' | 'sheets_digest'`), `digest_config`, `digest_config_hash`, `digest_approved_at` và `schedule_runs.status` (`'digest_sent' | 'digest_failed'`), `delivery`.
2. `apps/chat-api/src/services/schedules/sheets-digest-candidate.ts` — Phân tích yêu cầu lịch (`analyzeSheetsDigestCandidate`), kiểm tra điều kiện chỉ đọc từ `mysheets`/`sheets` + gửi tới 1 đích `slack`/`telegram` đã khóa, và tính `computeSheetsDigestHash`.
3. `apps/chat-api/src/services/schedules/sheets-digest-runner.ts` — Thực thi lượt chạy `sheets_digest`: xác minh `digest_config_hash`, kiểm tra quyền nguồn/đích, đọc bảng tính thông minh + trích xuất chỉ số KPI/tiến độ/deadline, tóm tắt AI có giới hạn 10s `AbortSignal` + fallback xác định, lọc chống Slack/Telegram mention injection, kiểm tra lại `schedules.version` & `status` trước khi gửi, tự tạm dừng sau 3 lần `digest_failed` liên tiếp.
4. `apps/chat-api/tests/db/sheets-digest-migration.test.ts` — Kiểm thử thực tế migration `0015` trên PostgreSQL 16 (ràng buộc 2 chiều `schedules_kind_digest_check`, `schedule_runs_delivery_check`, chạy lặp idempotent).
5. `apps/chat-api/tests/services/sheets-digest.test.ts` — Kiểm thử toàn diện `analyzeSheetsDigestCandidate`, `ScheduleService.confirmProposal` (`manual` vs `auto_digest`), và `SheetsDigestRunner` (thành công, AI timeout fallback, hash lệch -> blocked, thu hồi quyền bảng tính/Slack -> blocked, đổi version khi đang đọc -> discarded, 3 lỗi liên tiếp -> auto-pause).

### Chỉnh sửa (Modified)
1. `packages/tool-schemas/src/types.ts` — Bổ sung `sheets?: string[]` vào `PersonalSpreadsheetItem`; thêm `ScheduleKind`, `ScheduleApprovalMode`, `SheetsDigestConfig`, `SheetsDigestCandidate`, `SheetsDigestDelivery`; mở rộng `ScheduleProposalMetadata`, `ScheduleView`, `ScheduleRunState`, `ScheduleRunView`.
2. `packages/tool-schemas/src/mysheets.ts` — Bổ sung các thuộc tính tùy chọn (`tail`, `headerAware` cho `mysheets.read_range`; `deduplicate`, `deduplicateColumn`, `deduplicateColumns` cho `mysheets.append_rows`) và cập nhật mô tả hướng dẫn đọc thông minh theo tên tab / N dòng cuối (`MYSHEETS_TOOLS` nằm ngoài `ALL_TOOLS` nên không ảnh hưởng SHA-256 prompt mặc định).
3. `packages/tool-adapters/src/sheets/sheets-shared.ts` — Bổ sung `normalizeSpreadsheetIdInput`, `resolveReadRange`, `applySmartReadTransform`, `resolveDeduplicationPolicy`, `filterDuplicateRows`, `normalizeCellForDedup`, giữ nguyên từng ký tự dòng `safeRows` (bảo toàn M9).
4. `packages/tool-adapters/src/sheets/sheets-adapter.ts` — Tích hợp `resolveReadRange` / `applySmartReadTransform` vào `sheets.read_range` và `resolveDeduplicationPolicy` / `filterDuplicateRows` vào `sheets.append_rows` (tương thích ngược 100% với test hiện có).
5. `packages/tool-adapters/src/sheets/personal-sheets-adapter.ts` — Tích hợp `resolveReadRange` / `applySmartReadTransform` vào `mysheets.read_range` và `resolveDeduplicationPolicy` / `filterDuplicateRows` vào `mysheets.append_rows` (giữ nguyên các dòng mục tiêu M10, M11).
6. `packages/tool-adapters/src/index.ts` — Export thêm `normalizeSpreadsheetIdInput`, `resolveReadRange`, `applySmartReadTransform`, `resolveDeduplicationPolicy`, `filterDuplicateRows` từ `./sheets/sheets-shared.js`.
7. `apps/chat-api/src/routes/connections/mysheets.ts` — Cho phép `PUT /api/connections/mysheets/scope` nhận cả URL Google Sheets đầy đủ lẫn ID thông qua `normalizeSpreadsheetIdInput`, đồng thời khám phá danh sách tên tab (`sheets?: string[]`) best-effort từ Sheets API (giữ nguyên M3, M4, M5, M6).
8. `apps/chat-api/src/db/repositories/schedule-repo.ts` — Mở rộng `ScheduleRow`, `ScheduleRunRow`, `createOrUpdateFromProposal`, `recordRunStatus` (`digest_sent` kèm `delivery`, `digest_failed`), `countRecentConsecutiveDigestFailures`, `replanRun` (cho phép `digest_failed`), `scheduleToView`, `runToView`.
9. `apps/chat-api/src/services/schedules/run-state.ts` — Ánh xạ `status === 'digest_sent'` và `status === 'digest_failed'` sang `ScheduleRunState`.
10. `apps/chat-api/src/services/schedules/schedule-service.ts` — Hỗ trợ `confirmProposal(userId, convId, messageId, options?: { approvalMode?: ScheduleApprovalMode })` với kiểm tra ứng viên `sheets_digest`, kiểm tra lại phạm vi quyền tại thời điểm confirm, và lưu `kind = 'sheets_digest'`.
11. `apps/chat-api/src/services/schedules/schedule-runner.ts` — Phân nhánh khi `schedule.kind === 'sheets_digest'` sang `SheetsDigestRunner` (cả khi chạy theo giờ hẹn lẫn `runNow` / `replan`).
12. `apps/chat-api/src/routes/schedule-routes.ts` — Nhận `{ approvalMode }` từ `req.body` trong `POST /conversations/:id/schedule-proposals/:messageId/confirm` và truyền xuống `schedules.confirmProposal`.
13. `apps/chat-api/src/services/chat-service.ts` — Trong `prepareProposal`, tính toán `digestCandidate` qua `analyzeSheetsDigestCandidate` khi `proposal.services` có `'mysheets'` hoặc `'sheets'` và đính kèm vào `metadata`.
14. `apps/chat-api/src/config/schedules-runtime.ts` — Khởi tạo `SheetsDigestRunner` và gắn vào `ScheduleRunner` & `ScheduleService`.
15. `apps/chat-web/src/types.ts` — Thêm `sheets?: string[]` vào `PersonalSpreadsheetItem`.
16. `apps/chat-web/src/services/api-client.ts` — Mở rộng `confirmSchedule(convId, messageId, approvalMode?: ScheduleApprovalMode)` gửi `{ approvalMode }` khi được truyền.
17. `apps/chat-web/src/services/schedule-text.ts` — Bổ sung nhãn hiển thị cho `digest_sent` (`'Đã tự gửi báo cáo'`), `digest_failed` (`'Gửi báo cáo thất bại'`) và nhãn chế độ lịch trên `ScheduleView`.
18. `apps/chat-web/src/views/MySheetsCallbackView.tsx` & `apps/chat-web/src/pages/Settings/PersonalMySheets.tsx` — Bổ sung ô dán nhanh URL/ID Google Sheets + nút `"Thêm bảng tính"` bên cạnh Google Picker, và hiển thị danh sách tab (`Tabs: ...`) trên thẻ bảng tính.
19. `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx`, `apps/chat-web/src/pages/Cockpit/ScheduleRunRecovery.tsx`, `apps/chat-web/src/pages/History/ScheduleSection.tsx` — Bổ sung bộ chọn chế độ `Chờ tôi duyệt mỗi lượt` vs `Tự gửi báo cáo, không cần duyệt lại` trên `ScheduleMoment`, hiển thị trạng thái `digest_sent`/`digest_failed` trên `ScheduleSection`, và cho phép thử lại khi `digest_failed` trên `ScheduleRunRecovery`.

---

## Chi tiết Từng Task (TDD Step-by-Step)

### Task 1: Đọc bảng tính thông minh (`Smart Range & Header-Aware`) và Chống ghi trùng (`Idempotent Deduplication Append`) trong `@wap/tool-schemas` & `@wap/tool-adapters`

**Files:**
- Modify: `packages/tool-schemas/src/types.ts`
- Modify: `packages/tool-schemas/src/mysheets.ts`
- Modify: `packages/tool-adapters/src/sheets/sheets-shared.ts`
- Modify: `packages/tool-adapters/src/sheets/sheets-adapter.ts`
- Modify: `packages/tool-adapters/src/sheets/personal-sheets-adapter.ts`
- Modify: `packages/tool-adapters/src/index.ts`
- Modify: `packages/tool-adapters/tests/sheets-adapter.test.ts`
- Modify: `packages/tool-adapters/tests/sheets/personal-sheets-adapter.test.ts`

- [ ] **Step 1: Viết failing tests cho Smart Range (`tab-only`, `A:F`, `tail:N`, `headerAware`) và Idempotent Deduplication Append (`deduplicate`, `deduplicateColumn`, auto sync-key `GH#123` / `JIRA-101` + bảo toàn Formula Injection)** trong `packages/tool-adapters/tests/sheets-adapter.test.ts` và `packages/tool-adapters/tests/sheets/personal-sheets-adapter.test.ts`.
- [ ] **Step 2: Chạy Vitest để xác nhận tests mới đỏ (Red):**
  Run: `npx vitest run packages/tool-adapters/tests/sheets-adapter.test.ts packages/tool-adapters/tests/sheets/personal-sheets-adapter.test.ts`
- [ ] **Step 3: Triển khai trong `packages/tool-schemas/src/types.ts`, `packages/tool-schemas/src/mysheets.ts`, `packages/tool-adapters/src/sheets/sheets-shared.ts`, `sheets-adapter.ts`, `personal-sheets-adapter.ts`, `index.ts`.**
  - Lưu ý bảo toàn tuyệt đối dòng M9 trong `sheets-shared.ts`:
    `row.map((cell: string) => (/^\s*[=+\-@]/u.test(cell) ? "'" + cell : cell))`
  - Bảo toàn tuyệt đối dòng M10, M11 trong `personal-sheets-adapter.ts`.
- [ ] **Step 4: Chạy lại Vitest để xác nhận toàn bộ tests xanh (Green):**
  Run: `npx vitest run packages/tool-schemas/tests/mysheets-schemas.test.ts packages/tool-adapters/tests/sheets-adapter.test.ts packages/tool-adapters/tests/sheets/personal-sheets-adapter.test.ts`

---

### Task 2: Chọn bảng tính bằng URL/ID + Tự động khám phá Tab (`sheets?: string[]`) trong `mysheets` Backend & Frontend UI

**Files:**
- Modify: `apps/chat-api/src/routes/connections/mysheets.ts`
- Modify: `apps/chat-web/src/types.ts`
- Modify: `apps/chat-web/src/views/MySheetsCallbackView.tsx`
- Modify: `apps/chat-web/src/pages/Settings/PersonalMySheets.tsx`
- Modify: `apps/chat-api/tests/routes/mysheets-connections.test.ts`
- Modify: `apps/chat-web/tests/mysheets-ui.test.tsx`

- [ ] **Step 1: Viết failing tests trong `apps/chat-api/tests/routes/mysheets-connections.test.ts` và `apps/chat-web/tests/mysheets-ui.test.tsx`:**
  - Backend: `PUT /api/connections/mysheets/scope` nhận mảng chứa URL đầy đủ `https://docs.google.com/spreadsheets/d/sheet-1/edit#gid=0`, chuẩn hóa thành `sheet-1`, xác thực qua Drive API và đính kèm `sheets: ['Tasks', 'KPI']` khi Sheets API trả về danh sách tab.
  - Frontend: `MySheetsCallbackView` và `PersonalMySheets` cho phép dán URL Google Sheets vào ô `"Dán liên kết hoặc ID Google Sheets"`, bấm `"Thêm bảng tính"`, hiển thị tab badges (`Tabs: Tasks, KPI`) và lưu scope thành công.
- [ ] **Step 2: Chạy Vitest để xác nhận tests mới đỏ (Red):**
  Run: `npx vitest run apps/chat-api/tests/routes/mysheets-connections.test.ts apps/chat-web/tests/mysheets-ui.test.tsx`
- [ ] **Step 3: Triển khai hỗ trợ chuẩn hóa URL/ID + khám phá tab trong `apps/chat-api/src/routes/connections/mysheets.ts` và ô nhập URL/ID + hiển thị tab trong `MySheetsCallbackView.tsx` & `PersonalMySheets.tsx`.**
  - Bảo toàn nguyên vẹn các chuỗi mục tiêu M3, M4, M5, M6 trong `apps/chat-api/src/routes/connections/mysheets.ts`.
- [ ] **Step 4: Chạy lại Vitest để xác nhận toàn bộ tests xanh (Green):**
  Run: `npx vitest run apps/chat-api/tests/routes/mysheets-connections.test.ts apps/chat-web/tests/mysheets-ui.test.tsx`

---

### Task 3: Migration PostgreSQL `db/v3/0016_sheets_automation_and_digest.sql` & Kiểm thử Ràng buộc DB Thực tế

**Files:**
- Create: `db/v3/0016_sheets_automation_and_digest.sql`
- Create: `apps/chat-api/tests/db/sheets-digest-migration.test.ts`

- [ ] **Step 1: Viết bài test migration `apps/chat-api/tests/db/sheets-digest-migration.test.ts`** kiểm thử trên PostgreSQL 16 thật:
  - Chấp nhận `schedules` với `kind = 'plan'` (mặc định) và `kind = 'sheets_digest'` khi có đủ `digest_config` (JSON object), `digest_config_hash` (64 ký tự hex), `digest_approved_at`.
  - Bác bỏ (`23514`) khi `kind = 'plan'` mà có `digest_config`, hoặc `kind = 'sheets_digest'` mà thiếu `digest_config` / `digest_config_hash` sai định dạng / thiếu `digest_approved_at`.
  - Chấp nhận `schedule_runs` với `status = 'digest_sent'` kèm `delivery` (JSON object) và `status = 'digest_failed'` với `delivery IS NULL`.
  - Bác bỏ (`23514`) khi `status = 'digest_sent'` mà `delivery IS NULL`, hoặc `status <> 'digest_sent'` mà `delivery IS NOT NULL`.
  - Chạy lại toàn bộ tập migration `0001..0015` hai lần liên tiếp không lỗi và giữ nguyên dữ liệu.
- [ ] **Step 2: Chạy Vitest để xác nhận test đỏ (Red) trước khi có file `0015`:**
  Run: `npx vitest run apps/chat-api/tests/db/sheets-digest-migration.test.ts`
- [ ] **Step 3: Viết file `db/v3/0016_sheets_automation_and_digest.sql` idempotent.**
- [ ] **Step 4: Chạy toàn bộ DB migration tests trên PostgreSQL 16 để xác nhận xanh 100% (Green):**
  Run: `npx vitest run apps/chat-api/tests/db/schedule-migration.test.ts apps/chat-api/tests/db/mysheets-migration.test.ts apps/chat-api/tests/db/sheets-digest-migration.test.ts`

---

### Task 4: Phát hiện ứng viên `SheetsDigestCandidate`, Xác nhận chế độ lịch (`manual` | `auto_digest`) & Thực thi `SheetsDigestRunner`

**Files:**
- Create: `apps/chat-api/src/services/schedules/sheets-digest-candidate.ts`
- Create: `apps/chat-api/src/services/schedules/sheets-digest-runner.ts`
- Modify: `apps/chat-api/src/db/repositories/schedule-repo.ts`
- Modify: `apps/chat-api/src/services/schedules/run-state.ts`
- Modify: `apps/chat-api/src/services/schedules/schedule-service.ts`
- Modify: `apps/chat-api/src/services/schedules/schedule-runner.ts`
- Modify: `apps/chat-api/src/routes/schedule-routes.ts`
- Modify: `apps/chat-api/src/services/chat-service.ts`
- Modify: `apps/chat-api/src/config/schedules-runtime.ts`
- Create: `apps/chat-api/tests/services/sheets-digest.test.ts`

- [ ] **Step 1: Viết bộ test toàn diện `apps/chat-api/tests/services/sheets-digest.test.ts`:**
  - Phân tích `analyzeSheetsDigestCandidate`: đủ điều kiện khi `mysheets` + `slack` (hoặc `sheets` + `telegram`) chỉ đọc; từ chối khi có ý định ghi (`thêm dòng`, `append`), khi có dịch vụ thứ 3 (`github`, `trello`), hoặc khi chưa chọn bảng tính / chưa khóa kênh đích.
  - `ScheduleService.confirmProposal`: lưu `kind = 'plan'` khi `approvalMode = 'manual'`, lưu `kind = 'sheets_digest'` kèm `digest_config_hash` khi `approvalMode = 'auto_digest'`; từ chối nếu bảng tính hoặc kênh Slack bị gỡ quyền trước lúc bấm xác nhận (TOCTOU).
  - `SheetsDigestRunner`:
    1. Đọc bảng tính qua adapter, tổng hợp chỉ số KPI/tiến độ/deadline + tóm tắt AI (có `AbortSignal`), escape `@channel`/`<!here>`/`<script>`, gửi tin nhắn tới đúng kênh Slack/Telegram đã khóa và lưu `status = 'digest_sent'` kèm `delivery`.
    2. Khi LLM quá hạn 10s hoặc lỗi: tự động fallback sang bản tóm tắt xác định (`summaryMode: 'deterministic'`) và vẫn gửi thành công.
    3. Khi `digest_config_hash` bị lệch hoặc bảng tính bị gỡ khỏi `allowedSpreadsheets` hoặc kênh Slack bị gỡ khỏi `allowedScope`: chặn lượt chạy (`status = 'blocked'`) và tạm dừng lịch (`status = 'paused'`) mà không gọi đọc/gửi.
    4. Khi lịch bị tạm dừng / hủy / đổi `version` trong lúc đang đọc bảng tính: hủy gửi tin nhắn và đánh dấu lượt chạy `'discarded'`.
    5. Khi gửi lỗi 3 lần liên tiếp (`digest_failed`): tự động tạm dừng lịch ở lần thứ 3.
- [ ] **Step 2: Chạy Vitest để xác nhận test mới đỏ (Red):**
  Run: `npx vitest run apps/chat-api/tests/services/sheets-digest.test.ts`
- [ ] **Step 3: Triển khai `sheets-digest-candidate.ts`, `sheets-digest-runner.ts`, cập nhật `schedule-repo.ts`, `run-state.ts`, `schedule-service.ts`, `schedule-runner.ts`, `schedule-routes.ts`, `chat-service.ts`, `schedules-runtime.ts`.**
- [ ] **Step 4: Chạy Vitest cho toàn bộ schedule & mysheets backend tests (Green):**
  Run: `npx vitest run apps/chat-api/tests/services/sheets-digest.test.ts apps/chat-api/tests/services/mysheets-backend.test.ts`

---

### Task 5: Giao diện Chọn Chế độ Lịch (`ScheduleMoment.tsx`), Hiển thị Lượt gửi Báo cáo (`ScheduleSection.tsx`, `ScheduleRunRecovery.tsx`, `schedule-text.ts`)

**Files:**
- Modify: `apps/chat-web/src/services/api-client.ts`
- Modify: `apps/chat-web/src/services/schedule-text.ts`
- Modify: `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx`
- Modify: `apps/chat-web/src/pages/Cockpit/ScheduleRunRecovery.tsx`
- Modify: `apps/chat-web/src/pages/History/ScheduleSection.tsx`
- Modify: `apps/chat-web/tests/mysheets-ui.test.tsx`

- [ ] **Step 1: Viết failing UI tests trong `apps/chat-web/tests/mysheets-ui.test.tsx`** kiểm tra:
  - `ScheduleMoment` hiển thị lựa chọn `"Chờ tôi duyệt mỗi lượt"` và `"Tự gửi báo cáo, không cần duyệt lại"` khi `proposal.digestCandidate` có mặt; khi người dùng chọn `"Tự gửi báo cáo, không cần duyệt lại"` và bấm `"Xác nhận lịch"`, `apiClient.confirmSchedule` được gọi với `(convId, messageId, 'auto_digest')`.
  - Khi `digestCandidate.canAutoDigest === false`, radio `"Tự gửi báo cáo, không cần duyệt lại"` bị `disabled` và hiển thị rõ lý do tiếng Việt `digestCandidate.reason`.
  - `runLabel` và `ScheduleSection` hiển thị đúng `"Đã tự gửi báo cáo"` (kèm tên bảng tính & kênh đích) cho `digest_sent` và `"Gửi báo cáo thất bại"` cho `digest_failed`.
- [ ] **Step 2: Chạy Vitest để xác nhận UI test mới đỏ (Red):**
  Run: `npx vitest run apps/chat-web/tests/mysheets-ui.test.tsx`
- [ ] **Step 3: Triển khai cập nhật trong `api-client.ts`, `schedule-text.ts`, `ScheduleMoment.tsx`, `ScheduleRunRecovery.tsx`, `ScheduleSection.tsx`.**
- [ ] **Step 4: Chạy lại Vitest cho `apps/chat-web` để xác nhận xanh 100% (Green):**
  Run: `npx vitest run apps/chat-web/tests/mysheets-ui.test.tsx`

---

### Task 6: Kiểm định Toàn diện (Full Test Suite, Mutation Testing 11/11, Prompt Hash Invariants, Code Review Loop & Handoff Log)

**Files:**
- Create: `docs/handoff/log/2026-11-02-sheets-oauth-and-automation.md`

- [ ] **Step 1: Chạy kiểm thử đột biến `node scripts/test-mysheets-mutations.mjs` và xác nhận 11/11 mutations bị bắt sống.**
- [ ] **Step 2: Chạy kiểm thử bất biến Planner (`read-answers.test.ts`, `schedules.test.ts`), Tool Schemas, Tool Adapters, Chat API, Chat Web, Typecheck.**
- [ ] **Step 3: Thực hiện vòng lặp Code Audit/Review độc lập đối chiếu từng yêu cầu trong Spec & Plan; viết báo cáo bàn giao tại `docs/handoff/log/2026-11-02-sheets-oauth-and-automation.md` và commit sạch theo chuẩn Conventional Commits.**

---

## Vòng lặp Phản biện & Thẩm định Kế hoạch đối chiếu Codebase (Plan Line-by-Line Audit)

1. **Đối chiếu `scripts/test-mysheets-mutations.mjs`:**
   - M1 (`apps/chat-api/src/config/gmail-tools-runtime.ts`), M2 & M2b (`apps/chat-api/src/services/registered-services.ts`), M7 (`apps/chat-api/src/services/chat-service.ts`), M8 & M8b (`apps/chat-api/src/services/adapter-factory.ts`): Kế hoạch không chỉnh sửa hoặc bảo toàn nguyên trạng các đoạn code này.
   - M3, M4, M5, M6 (`apps/chat-api/src/routes/connections/mysheets.ts`): Task 2 chỉ thêm chuẩn hóa `spreadsheetIds` ở đầu route `PUT /scope` và thêm bước lấy `sheets` sau dòng `fileData = await driveRes.json();` + kiểm tra `mimeType`/`trashed`, giữ nguyên từng ký tự của M3, M4, M5, M6.
   - M9 (`packages/tool-adapters/src/sheets/sheets-shared.ts`): Task 1 giữ nguyên dòng `row.map((cell: string) => (/^\s*[=+\-@]/u.test(cell) ? "'" + cell : cell))`.
   - M10, M11 (`packages/tool-adapters/src/sheets/personal-sheets-adapter.ts`): Task 1 giữ nguyên `this.assertAllowedScope('spreadsheets', value);` và `category: writing ? 'UNKNOWN' : 'NETWORK',`.
2. **Đối chiếu `apps/chat-api/src/services/chat-service.ts` (`prepareProposal`):**
   - Trong `chat-service.ts` dòng 102-123: `prepareProposal` hiện trả về `{ valid: true, metadata, nextRuns }`. Trong Task 4, khi `proposal.services.includes('mysheets') || proposal.services.includes('sheets')`, ta gọi `analyzeSheetsDigestCandidate` và gán `metadata.digestCandidate = candidate` mà không ảnh hưởng bất kỳ nhánh lịch `calendar`/`slack`/`gmail` nào khác (nên mọi bài test lịch hiện có trong `apps/chat-api/tests/` giữ nguyên kết quả 100%).
3. **Đối chiếu `apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx`:**
   - Trong `ScheduleMoment.tsx` dòng 46: `const result = await apiClient.confirmSchedule(convId, message.id);`. Khi không có `digestCandidate` (hoặc người dùng giữ mặc định `'manual'`), gọi `apiClient.confirmSchedule(convId, message.id)` không truyền tham số thứ 3 (hoặc chỉ gửi body `{ approvalMode: 'auto_digest' }` khi `approvalMode === 'auto_digest'`), đảm bảo mọi spy `expect(apiClient.confirmSchedule).toHaveBeenCalledWith(convId, message.id)` trong các bài test lịch cũ không bị gãy!
   - **Phát hiện quan trọng từ Audit:** Nếu `apiClient.confirmSchedule(convId, message.id)` luôn gửi `body: JSON.stringify({ approvalMode: 'manual' })`, các test cũ mock `confirmSchedule` hoặc kiểm tra `fetch` không có `body` có thể bị ảnh hưởng! Do đó:
     - Trong `ScheduleMoment.tsx`: chỉ truyền tham số thứ 3 khi `approvalMode === 'auto_digest'` (`approvalMode === 'auto_digest' ? apiClient.confirmSchedule(convId, message.id, 'auto_digest') : apiClient.confirmSchedule(convId, message.id)`).
     - Trong `apiClient.ts`: `confirmSchedule(convId: string, messageId: string, approvalMode?: ScheduleApprovalMode)` chỉ đính kèm `body: JSON.stringify({ approvalMode })` khi `approvalMode` có mặt!
     - Nhờ vậy, 100% test cũ của `ScheduleMoment` và `apiClient` giữ nguyên chữ ký gọi hàm!

**Kết luận thẩm định Kế hoạch:** **0 lỗi (0 P1 / 0 P2 / 0 P3).** Bắt đầu Bước 4: Thi công tuần tự theo TDD.
