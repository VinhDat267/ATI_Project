# JIRA-06 · Personal Jira HTTP adapters

**Status:** In progress on `longnguyen005/jira-06-adapter`; `MYJIRA_ENABLED` remains off.
**Owner:** Integration Engineer, `packages/tool-adapters/`.
**Authority:** `docs/superpowers/specs/2026-10-30-jira-personal-workspaces-design.md` §6, §11–12 and JIRA-02 contracts.
**Depends on:** JIRA-02 tool schemas; JIRA-04 token manager signature; JIRA-05 capability directory shape. JIRA-07 consumes these tool outputs; JIRA-08 binds current policy, lease, and approval before dispatch.

## Scope

Implement `myjira.list_sites`, `search_projects`, `search_issues`, `create_issue`, `add_comment` in a new personal Jira adapter. Resolve opaque site handles only from a caller-scoped capability snapshot; use Bearer access token and Atlassian `ex/jira/{cloudId}/rest/api/3`. Validate all inputs/scope before HTTP; fixed project JQL; metadata-selected standard issue types; plain-text ADF; moved-issue check before comment; bounded deadline/AbortSignal, rate limit, and UNKNOWN for indeterminate writes. Preserve the existing shared `jira.*` adapter.

No changes to schemas, planner, executor, API, web, or runtime feature flag. The snapshot does not replace JIRA-08 per-step authorization and lease checks. No live Atlassian calls.

## Acceptance

- Stateful loopback HTTP tests cover all five tools, exact Bearer/cloud path, site/project denial before transport, JQL injection and cross-project results, ADF and issue type metadata, moved issue, abort/deadline, 429 and ambiguous write outcome.
- `npm run test -w @wap/tool-adapters` passes, including legacy Jira regression; `npm run check` passes on an isolated test environment.
- PR has changed-file list, real command output, commit hash, reviewer gate. Keep flag off.

## Kết quả

- **Trạng thái:** Hoàn thành triển khai và kiểm thử loopback HTTP stateful trên nhánh `longnguyen005/jira-06-adapter`. Cờ tính năng `MYJIRA_ENABLED` giữ nguyên tắt mặc định.
- **Triển khai:**
  - `packages/tool-adapters/src/jira/personal-jira-adapter.ts`: Triển khai `PersonalJiraAdapter` (kế thừa `BaseAdapter`) và factory `createPersonalJiraAdapter`, hỗ trợ đủ 5 tool cá nhân theo contract JIRA-02 (`myjira.list_sites`, `myjira.search_projects`, `myjira.search_issues`, `myjira.create_issue`, `myjira.add_comment`). Phân giải opaque `siteId` chỉ từ snapshot capabilities `WorkspaceJiraCapabilitiesResponse` đã qua xác minh của caller; kiểm tra `workspaceId` khớp tuyệt đối với cấu hình adapter (`AUTH_ERROR` 403 nếu lệch). Kiểm tra chặt chẽ tham số đầu vào (`additionalProperties: false`), phân trang (`limit`), và whitelist `allowedScope.sites` / `allowedScope.projects`. Tạo JQL an toàn bắt buộc project, escape ký tự Lucene và dấu nháy kép chống injection. Hỗ trợ tra cứu nhanh issue key trực tiếp và bỏ qua kết quả 404 khi không tồn tại. Tạo ADF văn bản thuần qua `plainTextToAdf`. Lấy metadata issue type từ Jira createmeta (có phân trang), lọc bỏ subtask và ưu tiên Task hoặc loại chuẩn đầu tiên. Kiểm tra project hiện tại của issue trước khi thêm comment, từ chối issue đã di chuyển sang project ngoài snapshot scope trước khi gọi ghi.
  - `packages/tool-adapters/src/jira/personal-jira-http.ts`: `PersonalJiraHttpTransport` gọi API Jira Cloud qua `${apiBase}/ex/jira/${cloudId}/rest/api/3` với OAuth Bearer token (`Authorization: Bearer <token>`). Áp dụng `redirect: 'error'` để ngăn rò rỉ Bearer token qua redirect. Quản lý pacing slot qua `GlobalRateLimiter` (`myjira:${userId}:${cloudId}`) và xử lý HTTP 429 Retry-After trong giới hạn (tối đa 30s) hoặc từ chối ngay lập tức khi vượt ngân sách. Tự động refresh token một lần khi gặp HTTP 401 với `forceRefresh: true`. Tương thích chữ ký token manager cả 1 tham số (`options`) và 2 tham số (`userId, options`) theo JIRA-04. Phân loại kết quả ghi không xác định (`UNKNOWN` không retry) khi gặp lỗi mạng/socket drop, HTTP 5xx, JSON hỏng hoặc id không hợp lệ trên write request, đảm bảo không tự replay write.
  - `packages/tool-adapters/src/index.ts`: Export `PersonalJiraAdapter`, `PersonalJiraAdapterConfig`, `createPersonalJiraAdapter`, `plainTextToAdf`, `PersonalJiraHttpTransport`, `JiraAccessTokenProvider`, `PersonalJiraHttpConfig`, `createJiraStepError`.
  - `packages/tool-adapters/tests/personal-jira-adapter.test.ts`: Bộ kiểm thử loopback HTTP stateful với 46 test cases kiểm tra độc lập 5 tool, Bearer transport, gateway cloudId path, chặn scope giả mạo trước mạng, JQL injection, từ chối dòng issue chéo project, metadata/createmeta pagination, chuyển đổi ADF, phát hiện moved issue trong/ngoài scope, AbortSignal pre-aborted/in-flight, 429 Retry-After bound, 401 refresh, 403 Forbidden, bảo vệ token không bị lộ và hành vi UNKNOWN không replay khi write gián đoạn.
- **Bằng chứng kiểm thử:**
  - `npm run test -w @wap/tool-adapters`: 20 test files PASS (514/514 tests), gồm 46 test `personal-jira-adapter` và 58 test hồi quy `jira-adapter`; 32 probe tests PASS (exit 0).
  - `npm run test -w @wap/tool-schemas`: 18 test files PASS (347/347 tests, exit 0).
  - `npm run test -w @wap/planner`: 28 test files PASS (405/405 tests, exit 0).
  - `npm run test -w @wap/executor`: 5 test files PASS (42/42 tests, exit 0).
  - `npm run typecheck:v3`: PASS (exit code 0).
  - `npm run build:v3`: PASS (exit code 0).
  - `node scripts/test-v3-web-build-security.mjs`: PASS (exit code 0).
  - `npm run test:launcher:v3`: 1 test PASS (exit code 0).
  - Scripts node tests (fake OIDC, slack personal fixture, inventory probe): 66 tests PASS (exit code 0).
- **Giới hạn & bước tiếp theo:**
  - `MYJIRA_ENABLED` vẫn tắt theo thiết kế. Không gọi Atlassian live trong task này.
  - Phụ thuộc kế tiếp: JIRA-07 (planner đa site Jira) và JIRA-08 (executor binding policy/lease và phê duyệt trước khi dispatch).
