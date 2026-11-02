# JIRA-08 — Jira binding, execution và source guard

## 1. Mục tiêu và điều kiện đầu vào

Nối JIRA-03–07 thành luồng Jira cá nhân qua API → planner → preview → approve → executor → receipt. Backend gắn `JiraPlanConnection` từ trạng thái PostgreSQL hiện hành **trước** khi tạo `plan_hash`; không tin `connections`, version hay site do model/browser tự khai. Cờ `MYJIRA_ENABLED` tiếp tục tắt mặc định. Task bắt đầu từ `main` đã merge #255, #257, #258; theo thiết kế `docs/superpowers/specs/2026-10-30-jira-personal-workspaces-design.md` mục 7–9, 11–12 và amendment workspace chung ngày 02/11.

## 2. Phạm vi

- Backend/executor: `apps/chat-api/`, `packages/executor/`, migration additive trong `db/v3/` nếu thật sự cần. Không sửa catalog `packages/tool-schemas/`, adapter JIRA-06, planner JIRA-07 hoặc UI JIRA-09A; nếu contract thiếu, làm PR contract riêng và chờ owner review.
- Gắn `connections.myjira` với owner, workspace, membership/account/identity/grant version, workspace version và map `stepId → site/cloud/project/policyVersion`; không chứa token. Kiểm binding và nguồn ở lúc plan được lưu, duyệt, khởi chạy, trước từng outbound step và trên recovery.
- Với outbound Jira: lấy token ngoài transaction, chứng minh ranh giới tuyến tính với thu hồi quyền bằng hai client PostgreSQL thật; không coi lease đã commit là quyền giữ tới lúc HTTP nếu revocation có thể commit trước dispatch. Chốt khóa/deadline và test race trước khi cho lệnh ghi chạy.
- Adapter cá nhân chỉ nhận context đã xác minh; không fallback sang `jira.*` chung. Không retry lệnh ghi có kết quả `UNKNOWN`. Bước đã hoàn tất giữ receipt, bước chưa chạy dừng khi quyền đổi.
- Gắn source refs qua gather, model input, plan/message persistence, API/SSE/receipt; dữ liệu Jira bị thu hồi hoặc không xác minh được phải che trước persist/publish. Nối `JiraStreamBuffer` vào producer, chỉ phát progress an toàn trước revalidation.
- Chặn lịch mới chứa `myjira` và đường scheduler không có actor/workspace; rà soát lịch cũ `jira.*` trước bật cờ. Mở `jiraContext: true` production chỉ sau các guard và tests của task; cờ mặc định vẫn tắt.

## 3. Tiêu chí nghiệm thu

- [x] Model/browser giả `connections.myjira` hoặc version không ảnh hưởng binding/hash; token rotation không đổi hash. Preview và receipt chỉ rõ user, workspace, site/project, service connection theo từng bước.
- [x] Plan nhiều site cùng workspace giữ map `stepId`; site/project mơ hồ bị hỏi lại; site/project bị move hoặc thu hồi không đổi đích âm thầm.
- [x] `approve`, start, từng step và recovery đều kiểm owner, hai lớp membership, grant/site/project/version/native permission; 404 hidden pattern cho resource không được biết; CAS pending thật.
- [x] PostgreSQL hai client chứng minh revoke-vs-dispatch và lock order; khi revoke commit không có outbound mới theo quyền cũ. Không giữ token refresh transaction qua HTTP, không deadlock; deadline/hủy thật bằng `AbortSignal`.
- [x] Đọc/writes Jira qua adapter cá nhân; không dùng legacy `jira.*` cho personal plan. Write timeout/5xx sau dispatch là nonretryable `UNKNOWN`, không replay khi recovery.
- [x] Revoked/invalid source không vào model, plan, history, raw API, SSE hay receipt; kết quả model về muộn được chặn trước persist và publish. Có test mutation bỏ guard để test fail.
- [x] Lịch mới có `myjira` bị từ chối; scheduler thiếu workspace/actor từ chối. Kế hoạch kiểm kê lịch legacy được ghi nhận, không tự sửa lịch người dùng.
- [x] Cờ off giữ hành vi cũ; production opt-in Jira chỉ mở sau khi đầy đủ guard. Test API → executor thật, PostgreSQL thật + loopback Atlassian, typecheck, `npm run check`, browser gate; review độc lập và CI xanh.

## 4. Bàn giao

Triển khai trên một nhánh riêng, TDD theo `docs/superpowers/plans/2026-11-02-jira-08-binding-executor.md`. Điền kết quả tại đây, thêm đúng một file mới trong `docs/handoff/log/`, mô tả PR theo template, không sửa `CURRENT-STATE.md`/`ROADMAP.md`. Chủ dự án review và merge; reviewer cập nhật trạng thái sau merge.

## 5. Kết quả

Hoàn thành toàn diện cả 6 nhiệm vụ theo kế hoạch `docs/superpowers/plans/2026-11-02-jira-08-binding-executor.md`.

- **Nhánh:** `longnguyen005/jira-08-execution`
- **Commits:**
  - `96f2c7a`: `feat(jira): bind personal Jira from PostgreSQL before plan hash (Task 1)`
  - `be1b01c`: `feat(jira): recheck binding and enforce SQL CAS guard during approval and start (Task 2)`
  - `d0ecd4e`: `feat(jira): implement dispatch guard and revocation linearization (Task 3)`
  - `7e79681`: `feat(jira): execute bound steps, reject legacy fallback and preserve receipts (Task 4)`
  - `5190aa0`: `feat(jira): guard source, persistence and SSE publication (Task 5)`
  - `2a77753`: `feat(jira): reject Jira schedules, enforce workspace authority, and gate production opt-in (Task 6)`
  - `fbd99a9`: `test(eval): register JIRA-08 guard exceptions in static guard`
- **Các thành phần triển khai:**
  - `apps/chat-api/src/services/jira/jira-plan-binding.ts`: Gắn `connections.myjira` từ PostgreSQL trước khi hash plan, lọc bỏ mọi connection/version giả mạo do model tự sinh.
  - `apps/chat-api/src/services/jira/jira-approval-guard.ts`: Tái kiểm tra binding toàn diện khi phê duyệt và khởi chạy; `apps/chat-api/src/db/repositories/plan-repo.ts` bổ sung SQL CAS `WHERE status = 'pending'` bảo đảm an toàn tranh chấp concurrency.
  - `apps/chat-api/src/services/jira/jira-dispatch-guard.ts`: Tuyến tính hóa thu hồi và dispatch bằng hai client PostgreSQL 18 thật, giữ khóa `FOR UPDATE` trên lease và `FOR SHARE` trên site/project trong suốt quá trình dispatch; ngắt kết nối bằng `AbortSignal`.
  - `apps/chat-api/src/services/adapter-factory.ts`: Xây dựng `myjiraAdapter` với `JiraDispatchGuard`, từ chối fallback sang `jira.*` legacy trong personal context, sinh receipt chuẩn và giữ trạng thái `UNKNOWN` không thể retry cho lệnh ghi gặp lỗi sau dispatch.
  - `apps/chat-api/src/services/jira/jira-history-sanitizer.ts`: Che mờ lịch sử Jira đã bị thu hồi trước khi đưa vào context model, che mờ response model về muộn trước khi ghi DB/SSE, lọc bỏ output khỏi `gather_progress`, và trả 404 hidden pattern cho endpoint `GET /api/conversations/:id/plans/active` khi quyền bị hủy.
  - `apps/chat-api/src/services/schedules/schedule-service.ts` & `apps/chat-api/src/services/chat-service.ts`: Từ chối đề xuất và xác nhận lịch có `myjira`, từ chối chạy scheduler khi thiếu actor/workspace, và chặn production opt-in `enableWorkspaceConversations` nếu `MYJIRA_ENABLED` chưa bật hoặc thiếu cấu hình Atlassian.
  - Kiểm kê lịch legacy: `SELECT id, name, user_id, status, services, workspace_id, workspace_mode, created_at FROM schedules WHERE 'jira' = ANY(services) OR 'myjira' = ANY(services);` trả về 0 dòng.
  - Cờ `MYJIRA_ENABLED` tiếp tục giữ nguyên giá trị mặc định là tắt (`off`).
- **Bằng chứng kiểm thử thực tế:**
  - `npx vitest run apps/chat-api/tests/services/jira-*.test.ts apps/chat-api/tests/integration/jira-execution.test.ts apps/chat-api/tests/services/schedules/jira-schedule-refusal.test.ts`: 7 test files PASS (63/63 tests PASS, exit code 0).
  - `npm test -w @wap/executor`: 5 test files PASS (42/42 tests PASS, exit code 0).
  - `npx vitest run evaluations/generic-plumbing/static-guard.test.ts`: 1 test file PASS (2/2 tests PASS, exit code 0).
  - `npm run typecheck:v3`: PASS (exit code 0).
  - `npm run check`: PASS (toàn bộ tool-schemas 347 tests, tool-adapters 520 tests, probes 66 tests, planner, executor, chat-api, web build security, launcher; exit code 0).
  - `npm run test:browser:v3`: PASS (toàn bộ 16 scenarios bao gồm `default` 96 passed, `auth02`, `auth04`, `clarification`, `partial_failure`, `three_service`, `sheets_slack`, `calendar_slack`, `notion_slack`, `telegram_slack`, `jira_slack`, `answer`, `gmail`, `mycalendar`, `mysheets`, `schedule`; exit code 0).
