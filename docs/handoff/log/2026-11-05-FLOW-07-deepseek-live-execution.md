# Handoff Log: FLOW-07 · Thực thi Live trên DeepSeek API trực tiếp (`https://api.deepseek.com`)

- **Ngày:** 2026-11-05
- **Task:** [FLOW-07](../tasks/FLOW-07-live-acceptance.md)
- **Nhánh:** `test/flow-07-live-acceptance` (PR #277) và `fix/flow-review-regressions` (PR #278)

## 1. Phạm vi và Cấu hình DeepSeek Trực tiếp

- Kết nối trực tiếp tới `https://api.deepseek.com` qua `DeepSeekProvider` (`createProviderFromEnv` với `LLM_PROVIDER=deepseek`, `DEEPSEEK_BASE_URL=https://api.deepseek.com`, `requestedModel: deepseek-chat`, `servedModel: deepseek-flash`, `temperature: 0`), hoàn toàn không đi qua `9router`.
- Runner độc lập: `evaluations/current-flows/run-deepseek-live.ts` (kích hoạt bằng `FLOW_07_LIVE=1`).
- Artifact bằng chứng đầy đủ: `docs/ai-evidence/FLOW-07-DEEPSEEK-LIVE/2026-11-04T17-59-39-046Z/summary.json`.

## 2. Các lỗi thực tế phát hiện khi chạy Live với `deepseek-flash` và bản vá

1. **`packages/planner/src/providers/deepseek-provider.ts`:**
   - Bổ sung `temperature: config.temperature ?? 0` cho chế độ `deepseek-chat` (không áp dụng cho `deepseek-reasoner`), loại bỏ dao động ngẫu nhiên do mặc định `temperature = 1.0` của DeepSeek API khi sinh kế hoạch JSON.
2. **`packages/planner/src/planner.ts` (`bindReportEvidenceIfApplicable`):**
   - Xóa `parsed.reportEvidence` do LLM tự sinh trong JSON trước khi server gắn artifact từ `ReportArtifactStore`, tránh lỗi `Report evidence references non-existent step 'undefined'`.
   - Khi `mysheets.read_range` được gọi qua vòng `search` (`searchMode: 'llm'`), `searchEntities()` bọc kết quả singleton `{ range, headers, values }` thành mảng 1 phần tử `[{ range, headers, values }]`. Đã giải bọc phần tử đầu tiên trước khi kiểm tra `headers` và render báo cáo.
3. **`packages/planner/src/search.ts` (`groundingMemory` & `applyWorkflowResourceDefaults`):**
   - Chạy `applyWorkflowResourceDefaults` sau khi hợp nhất `__observed` và kiểm tra trùng với `target.__observed[resource]`, tránh tạo bản ghi `jira_site` trùng (`acme-site` xuất hiện 2 lần làm `findAmbiguousSites` hiểu nhầm là không phân biệt được site).
4. **`packages/tool-schemas/src/report-evidence.ts` (`requiresReportEvidence`):**
   - Bổ sung `the|cards?|trello` vào `sourceMutation` để tác vụ tạo thẻ Trello từ 1 issue đơn lẻ (`DEV-01-explicit`) không bị coi nhầm là báo cáo tổng hợp.
   - Bổ sung `ban phat hanh|cac thay doi` vào `topic` để yêu cầu báo cáo bản phát hành tự nhiên thiếu nguồn (`DEV-03-natural`) bị chặn đúng bởi report evidence guard.
5. **`evaluations/golden-v2/fixtures.ts` & `evaluations/current-flows/cases.json`:**
   - Sửa `mysheets.list_drive_files` trong `fixtures.ts` trả về mảng trực tiếp khớp `outputSchema` (`type: 'array'`), bổ sung `mysheets.aggregate_rows` và `mysheets.search_rows`.

## 3. Kết quả Thực thi Live (`docs/ai-evidence/FLOW-07-DEEPSEEK-LIVE/2026-11-04T17-59-39-046Z/summary.json`)

- **Preflight Connectors (Read-only):**
  - `slack`: `OK` | `github`: `OK` | `calendar`: `OK` | `sheets`: `OK` | `jira`: `OK` | `telegram`: `OK`
  - `notion`: `BLOCKED` (`Notion request failed with HTTP 401`)
  - `trello`: `NOT_RUN` (`TRELLO_ACCESS_TOKEN is required`)
- **6 Core Workflows × 3 Consecutive Runs (18/18 PASS trên `deepseek-flash`):**
  - `OFF-02` (3/3): `kind=plan`, tools `mycalendar.schedule_meet,mysheets.create_doc,gmail.send_message`, `guardValid=true` (6752ms, 6027ms, 5849ms).
  - `OFF-03` (3/3): `kind=plan`, tools `mysheets.read_range,slack.send_message`, `reportEvidence.kind=sheets_summary`, `guardValid=true` (1862ms, 2110ms, 1792ms).
  - `PM-01` (3/3): `kind=plan`, tools `trello.create_card,slack.send_message`, `guardValid=true` (1892ms, 2252ms, 1846ms).
  - `PM-03` (3/3): `kind=plan`, tools `myjira.search_issues,slack.send_message`, `reportEvidence.kind=jira_progress`, `guardValid=true` (1519ms, 2163ms, 2044ms).
  - `DEV-02` (3/3): `kind=plan`, tools `github.list_pull_requests,slack.send_message`, `reportEvidence.kind=github_prs`, `guardValid=true` (2012ms, 2087ms, 3068ms).
  - `DEV-04` (3/3): `kind=plan`, tools `github.list_issues,slack.send_message`, `reportEvidence.kind=github_issues`, `guardValid=true` (2040ms, 3483ms, 3350ms).
- **36 Oracle Regression Cases (36/36 PASS trên `deepseek-flash`):**
  - Toàn bộ 36/36 case (`OFF-01..04`, `PM-01..04`, `DEV-01..04` × `explicit`, `natural`, `underspecified`) khớp 100% `expectedKind` (`kindMatched=true`) và `expectedTools` (`toolsMatched=true`).

## 4. Ranh giới Nghiệm thu

- Đã xác nhận thực thi trực tiếp với LLM provider thật `DeepSeekProvider` (`https://api.deepseek.com`, `servedModel: deepseek-flash`) cho toàn bộ 18 lượt workflow và 36 câu oracle.
- Tìm kiếm tài nguyên trong runner sử dụng `fixtureSearch` có kiểm soát để kiểm chứng tính tất định của planner + `ReportArtifactStore` + `validateReportEvidenceBinding`; việc ghi/đọc lại đối tượng thật trên toàn bộ 8 connector bên ngoài vẫn giữ nguyên ranh giới thực tế (`notion` BLOCKED 401, `trello` NOT_RUN).
