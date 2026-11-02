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

- [ ] Model/browser giả `connections.myjira` hoặc version không ảnh hưởng binding/hash; token rotation không đổi hash. Preview và receipt chỉ rõ user, workspace, site/project, service connection theo từng bước.
- [ ] Plan nhiều site cùng workspace giữ map `stepId`; site/project mơ hồ bị hỏi lại; site/project bị move hoặc thu hồi không đổi đích âm thầm.
- [ ] `approve`, start, từng step và recovery đều kiểm owner, hai lớp membership, grant/site/project/version/native permission; 404 hidden pattern cho resource không được biết; CAS pending thật.
- [ ] PostgreSQL hai client chứng minh revoke-vs-dispatch và lock order; khi revoke commit không có outbound mới theo quyền cũ. Không giữ token refresh transaction qua HTTP, không deadlock; deadline/hủy thật bằng `AbortSignal`.
- [ ] Đọc/writes Jira qua adapter cá nhân; không dùng legacy `jira.*` cho personal plan. Write timeout/5xx sau dispatch là nonretryable `UNKNOWN`, không replay khi recovery.
- [ ] Revoked/invalid source không vào model, plan, history, raw API, SSE hay receipt; kết quả model về muộn được chặn trước persist và publish. Có test mutation bỏ guard để test fail.
- [ ] Lịch mới có `myjira` bị từ chối; scheduler thiếu workspace/actor từ chối. Kế hoạch kiểm kê lịch legacy được ghi nhận, không tự sửa lịch người dùng.
- [ ] Cờ off giữ hành vi cũ; production opt-in Jira chỉ mở sau khi đầy đủ guard. Test API → executor thật, PostgreSQL thật + loopback Atlassian, typecheck, `npm run check`, browser gate; review độc lập và CI xanh.

## 4. Bàn giao

Triển khai trên một nhánh riêng, TDD theo `docs/superpowers/plans/2026-11-02-jira-08-binding-executor.md`. Điền kết quả tại đây, thêm đúng một file mới trong `docs/handoff/log/`, mô tả PR theo template, không sửa `CURRENT-STATE.md`/`ROADMAP.md`. Chủ dự án review và merge; reviewer cập nhật trạng thái sau merge.

## 5. Kết quả

Chưa triển khai. Đây là task card lập kế hoạch.
