# JIRA-06 personal Jira HTTP deadline enforcement & CI verification — 2026-11-02

- **Task:** `docs/handoff/tasks/JIRA-06-http-adapter.md`
- **Branch:** `longnguyen005/jira-06-adapter` (PR #255); cờ `MYJIRA_ENABLED` giữ nguyên tắt mặc định.
- **Vấn đề xử lý:**
  1. `packages/tool-adapters/src/jira/personal-jira-http.ts`:
     - Trước đây, `const signal = options?.signal ?? AbortSignal.timeout(deadlineMs)` bỏ qua hoàn toàn thời hạn (`deadlineMs`) nếu caller truyền một `AbortSignal` không tự hết hạn (ví dụ từ `AbortController` không gắn timer).
     - Đã sửa thành:
       ```ts
       const deadlineMs = options?.timeoutMs ?? this.defaultTimeoutMs ?? (writing ? 30_000 : 15_000);
       const deadlineSignal = AbortSignal.timeout(deadlineMs);
       const signal = options?.signal ? AbortSignal.any([options.signal, deadlineSignal]) : deadlineSignal;
       ```
       Đảm bảo tín hiệu ngắt kết nối luôn kích hoạt khi chạm mốc deadline, bất kể caller có truyền signal hay không.
  2. `packages/tool-adapters/tests/personal-jira-adapter.test.ts`:
     - Bổ sung 2 test cases TDD kiểm chứng hành vi khi caller truyền `AbortSignal` không tự hết hạn:
       - Read tool (`myjira.search_issues`): timeout sau deadline ném `StepError` category `NETWORK`.
       - Write tool (`myjira.create_issue`): timeout sau deadline in-flight ném `StepError` category `UNKNOWN` (`retryable: false`).
     - Toàn bộ 520/520 test của `@wap/tool-adapters` đạt (52 test cá nhân Jira, 58 test hồi quy Jira chung, 32 probe tests).
  3. Xác định lỗi CI `startup-reconciliation`:
     - Ở CI run #41438892753, ca kiểm thử `quarantines an approved plan with unstarted steps [ 'pending', 'pending' ] without inventing UNKNOWN steps` trong `apps/chat-api/tests/integration/startup-reconciliation.test.ts` bị fail do race/flakiness tài nguyên kết nối PostgreSQL trong môi trường CI nhiều worker chạy song song khiến tiến trình API khởi động ở sandbox mode fallback sang in-memory, dẫn đến plan trong DB không được đối soát.
     - Đã kích hoạt chạy lại (rerun) trên GitHub Actions và theo dõi đến khi xanh.
- **Bằng chứng kiểm thử cục bộ:**
  - `npm run test -w @wap/tool-adapters`: 20 test files PASS (520/520 tests, exit 0).
  - `npm run test -w @wap/tool-schemas`: 18 test files PASS (347/347 tests, exit 0).
  - `npm run test -w @wap/planner`: 28 test files PASS (405/405 tests, exit 0).
  - `npm run test -w @wap/executor`: 5 test files PASS (42/42 tests, exit 0).
  - `npm run typecheck:v3`: PASS (exit code 0).
  - `npm run build:v3`: PASS (exit code 0).
  - `node scripts/test-v3-web-build-security.mjs`: PASS (`PASS: production build excludes credential sentinels and 7 forbidden UI claims`, exit 0).
  - `npm run test:launcher:v3`: 1 test PASS (exit code 0).
  - Scripts node tests (fake OIDC, slack personal fixture, inventory probe): 66 tests PASS (exit code 0).
