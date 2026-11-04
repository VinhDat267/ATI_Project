# Handoff Log: Audit Remediation FLOW-01..07 & Live Google Workspace Verification

- **Ngày:** 2026-11-04
- **Task:** FLOW-01 .. FLOW-07 (Audit Remediation & Re-run)
- **Nhánh:** `test/flow-07-live-acceptance`
- **Tác giả:** Antigravity Master Orchestrator

## 1. Nội dung khắc phục theo 5 Chặng (Chặng 1 – Chặng 5)

1. **Chặng 1 — Khóa 3 bản vá Live Google Workspace (`a4556163`):**
   - `packages/tool-adapters/src/sheets/personal-sheets-adapter.ts`: Tách bạch `driveApiBase` (`https://www.googleapis.com/drive/v3`) khỏi `apiBase` (`https://sheets.googleapis.com`) để khi `PERSONAL_SHEETS_API_BASE` được cấu hình, các thao tác tạo thư mục Google Drive và lưu tài liệu Google Docs vào thư mục (`folderId`) vẫn gọi đúng Google Drive API v3.
   - `apps/chat-api/src/routes/connections/mysheets.ts`: Chấp nhận người dùng dán nguyên URL Google Sheets (`https://docs.google.com/spreadsheets/d/<id>/edit...`), tự động trích xuất Spreadsheet ID và gọi thêm `GET /v4/spreadsheets/{id}?fields=sheets.properties.title` để khám phá danh sách tab (`sheets`) ngay khi lưu scope.
   - `apps/chat-web/src/pages/Settings/useSettings.ts`: Ẩn 2 thẻ cấu hình dùng chung `calendar` và `sheets` khỏi danh sách `Other services` trên trang Settings để không trùng lặp với 2 thẻ OAuth cá nhân `mycalendar` và `mysheets`.

2. **Chặng 2 — Khép kín đường dây `reportEvidence` từ Planner → ChatService → ExecutionService (`1c3744a4`):**
   - `packages/planner/src/planner.ts`: Bổ sung `ReportArtifactStore` và `bindReportEvidenceIfApplicable` để tự động ghi đè nội dung báo cáo (`github_prs`, `github_issues`, `jira_progress`, `sheets_summary`) từ dữ liệu đọc thực tế, tạo `ReportObservationRecord` và gắn `reportEvidence` kèm SHA-256 `contentHash` vào `PlanResponse`.
   - `packages/planner/src/validator.ts`, `search.ts`, `prompts/system-prompt.ts`: Kiểm chứng `reportEvidence` trong `validatePlan`, tiêm `workflow_resource_defaults` (kèm `cloudId`/`workspaceId` cho `myjira` và `mydrive_file` cho `mysheets.folderId`) vào `groundingMemory` và `buildSystemPrompt`.
   - `apps/chat-api/src/services/chat-service.ts`, `execution-service.ts`, `report-evidence-guard.ts`, `server.ts`: Lưu `workflowContext.resourceDefaults` vào `WorkingMemory`, truyền `reportEvidenceStore` giữa `AIPlanner`, `ChatService` và `ExecutionService`, đồng thời chặn duyệt thực thi (`409 Conflict`) nếu kế hoạch báo cáo bị thiếu hoặc lệch `reportEvidence` / `plan_hash`.

3. **Chặng 3 — Cứng hóa cô lập Playbook & E2E Browser (`bf2573d8`):**
   - `apps/chat-web/src/services/playbook-storage.ts`: Chặn ghi xuống phân vùng ẩn danh (`PLAYBOOK_AUTH_REQUIRED`) khi thiếu `userId` xác thực.
   - `apps/chat-web/tests/browser/playbook-isolation.spec.ts`: Thêm bài kiểm thử Playwright E2E đa viewport (`1440×1000` và `375×812`) xác minh cô lập Playbook giữa 2 tài khoản, cách ly dữ liệu legacy và bảo toàn chỉnh sửa biến/nội dung.

4. **Chặng 4 — Nối `workflowContext` từ Cockpit lên API & hiển thị trạng thái `FLOW-04`/`FLOW-05` (`76723a19`):**
   - `apps/chat-web/src/pages/Cockpit/RequestMoments.tsx`, `Cockpit.tsx`, `Workspace.tsx`, `api-client.ts`: Thêm bộ chọn cấu hình tài nguyên mặc định (`workflow-defaults-editor`) và truyền `workflowContext` (`templateId`, `resourceDefaults`) lên `POST /api/conversations/:id/messages`.
   - `apps/chat-web/src/pages/Cockpit/PlanMoment.tsx`, `ReceiptMoment.tsx`: Hiển thị thời điểm đọc dữ liệu nguồn (`reportEvidence.readAt`) và cảnh báo phạm vi chia sẻ `drive.file` (`google-docs-sharing-notice`) cho luồng `OFF-02` (Google Meet + Google Docs + Gmail).

5. **Chặng 5 — Mở rộng `fixtureSearch` và nâng cấp `live-acceptance.test.ts` chạy qua Pipeline thật:**
   - `evaluations/golden-v2/fixtures.ts`: Bổ sung dữ liệu mẫu và nhánh xử lý cho `mysheets.list_spreadsheets`, `mysheets.list_sheets`, `mysheets.read_range`, `mysheets.list_drive_files`, `mysheets.get_doc`, `github.list_pull_requests`, `github.list_issues`.
   - `packages/tool-schemas/src/registry/trello.ts`: Tinh chỉnh `gatherRules` của `trello.search_lists` để không bắt nhầm cụm `"danh sách Pull Request / issue / ticket / blocker"` thành tên danh sách Trello.
   - `evaluations/tests/live-acceptance.test.ts`: Nâng cấp Gate 2 (`routeIntent`), Gate 3 (18 lượt chạy qua `AIPlanner.processMessage` + `fixtureSearch` + `ReportArtifactStore` + `validateReportEvidenceBinding`), và Gate 4 (6 persona chạy đa lượt qua `AIPlanner.processMessage` với `WorkingMemory` liên tục).
   - Phân tách minh bạch trạng thái nghiệm thu:
     - `LIVE_OBSERVED + OPERATOR_ATTESTED`: Google Docs, Google Drive, Google Sheets, Google Meet (`mycalendar` + `mysheets`), Slack, GitHub, Jira, Telegram.
     - `LIVE_BLOCKED`: Notion (`401 Unauthorized` — được giữ nguyên làm named blocker trong Gate 1).

## 2. Bằng chứng kiểm thử thực tế (Exit Code 0)

```bash
$ npm run typecheck:v3
> typecheck:v3
> tsc -p apps/chat-api/tsconfig.json --noEmit && tsc -p apps/chat-web/tsconfig.json --noEmit
# Exit code: 0
```

```bash
$ npx vitest run --dir evaluations tests/live-acceptance.test.ts tests/current-flow-composition.test.ts golden-v2/fixtures-services.test.ts golden-v2/fixtures-gmail.test.ts golden-v2/cases.test.ts
 ✓ evaluations/golden-v2/fixtures-services.test.ts (28 tests) 18ms
 ✓ evaluations/tests/current-flow-composition.test.ts (10 tests) 32ms
 ✓ evaluations/golden-v2/cases.test.ts (42 tests) 327ms
 ✓ evaluations/golden-v2/fixtures-gmail.test.ts (7 tests) 15ms
 ✓ evaluations/tests/live-acceptance.test.ts (62 tests) 6936ms
 Test Files  5 passed (5)
      Tests  149 passed (149)
# Exit code: 0
```

```bash
$ npx vitest run --dir packages/planner tests/report-evidence.test.ts tests/report-renderers-all.test.ts
 ✓ packages/planner/tests/report-renderers-all.test.ts (18 tests) 51ms
 ✓ packages/planner/tests/report-evidence.test.ts (8 tests) 174ms
 Test Files  2 passed (2)
      Tests  26 passed (26)
# Exit code: 0
```

```bash
$ DATABASE_URL="postgres://ati_v3:ati_v3_local_only@127.0.0.1:56534/ati_v3" npx vitest run --dir apps/chat-api tests/integration/report-evidence.test.ts tests/routes/mysheets-connections.test.ts
 ✓ apps/chat-api/tests/integration/report-evidence.test.ts (5 tests) 4962ms
 ✓ apps/chat-api/tests/routes/mysheets-connections.test.ts (18 tests) 9501ms
 Test Files  2 passed (2)
      Tests  23 passed (23)
# Exit code: 0
```

```bash
$ npx vitest run --dir packages/tool-adapters tests/sheets/personal-sheets-adapter.test.ts
 ✓ packages/tool-adapters/tests/sheets/personal-sheets-adapter.test.ts (32 tests) 94ms
# Exit code: 0
```

```bash
$ Push-Location apps/chat-web; npx vitest run tests/fe-07-settings.test.tsx tests/services/playbook-storage.test.ts tests/services/playbook-variables-and-catalog.test.tsx tests/services/job-readiness.test.tsx tests/services/workflow-defaults.test.ts; Pop-Location; npm run build:v3; node scripts/test-v3-web-build-security.mjs
 Test Files  5 passed (5)
      Tests  59 passed (59)
PASS: production build excludes credential sentinels and 8 forbidden UI claims
# Exit code: 0
```
