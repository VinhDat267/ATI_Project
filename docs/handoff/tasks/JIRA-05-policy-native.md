# JIRA-05 · Chính sách Quyền Native, Capability Directory, Revocation Lease & Source Revalidation

**Trạng thái:** Kế hoạch đã hiệu chỉnh sau phản biện độc lập (P1/P2 Resolved, Ready for Implementation). Runtime Jira mặc định tắt (`MYJIRA_ENABLED=off`).
**Nhiệm vụ:** Xây dựng cơ chế kiểm soát chính sách và bảo vệ dữ liệu toàn diện cho Jira cá nhân trong ATI:
1. Client kiểm tra quyền native Atlassian (`JiraNativeVerifier`): Mở rộng interface của `WorkspaceSiteProjectRepoOptions` để hỗ trợ cả `verifyAdminister` (site admin) và `verifyUserPermissions` (project user permissions: `BROWSE_PROJECTS`, `CREATE_ISSUES`, `ADD_COMMENTS`) thông qua loopback HTTP fixture và endpoint Atlassian REST API `/rest/api/3/mypermissions`, `/rest/api/3/project/search`, đóng gói `JiraTokenManager` và cache LRU composite 6 trường có gắn `identityVersion`.
2. Additive migration `0022_jira_authorization_leases.sql` và Trình quản lý lease (`JiraLeaseManager`):
   - **Tách rời hoàn toàn database transaction khỏi thời gian sống (TTL) của lease:** Tuyệt đối không giữ mở PostgreSQL transaction hay row locks qua cuộc gọi mạng ra ngoài (outbound HTTP I/O). Row lock trong PostgreSQL chỉ tồn tại trong vòng đời transaction, không tự hết hạn theo timestamp cột row TTL.
   - **Transaction ngắn hạn kiểm tra version & commit ngay (`acquireLease`):** Lấy token trước, mở transaction ngắn kiểm tra version các bảng theo thứ tự khóa chuẩn tắc `workspaces` -> `workspace_members` -> `ati_workspaces` -> `ati_workspace_memberships` -> `users` -> `jira_accounts` -> `ati_workspace_jira_sites` -> `ati_workspace_jira_projects` `FOR SHARE`, chèn bản ghi lease (`expires_at = clock_timestamp() + interval '${ttlMs} milliseconds'`), và **commit ngay lập tức**.
   - **Đánh dấu thu hồi (`markRevoked`):** Khi xảy ra thao tác thu hồi chính sách (archive workspace, remove member, deactivate site, deselect project), transaction thu hồi cập nhật policy version (`policy_version + 1`) và cập nhật trạng thái các lease active liên quan thành `revoked`.
   - **Ranh giới trách nhiệm rõ ràng:** Bản ghi lease ngắn hạn đã commit trong JIRA-05 KHÔNG tự động chặn thao tác thu hồi bằng row lock vật lý và KHÔNG đảm bảo tính nguyên tử cho request outbound. Việc chốt guard tuyến tính cuối cùng (linearizable outbound guard) trước khi phát lệnh ghi sang Jira thuộc về Executor ở **JIRA-08**. JIRA-05 chỉ triển khai bản ghi lease kiểm tra version trong transaction ngắn, cơ chế reaper/lọc lease hết hạn, và đánh dấu thu hồi khi có biến động quyền.
   - **Loại trừ Deadlock với Token Rotation:** Cập nhật truy vấn trong `jira-token-manager.ts` sử dụng `FOR UPDATE OF g` để tiến trình xoay vòng token chỉ khóa dòng bảng `jira_oauth_grants`, không khóa lây sang `jira_accounts`. Thao tác ngắt kết nối tài khoản (`disconnect`) ở cấp user account giữ nguyên tính độc lập với lock hierarchy của workspace; ngắt kết nối tăng `identity_version`, tự động vô hiệu hóa lease và cache mà không cần lấy khóa bảng workspace.
   - **Schema Lease & Reaper:** Bổ sung ràng buộc `CHECK (expires_at > acquired_at)`, chỉ mục `idx_jira_leases_active` trên `(workspace_id, cloud_id, expires_at) WHERE status = 'active'`, và phương thức dọn dẹp lease hết hạn (`reapExpiredLeases`).
3. Kích hoạt endpoint Capability Directory `GET /api/jira-workspaces/:id/jira-capabilities` (thay thế mã 503 tạm thời của JIRA-03) tính toán giao điểm giữa các site active của workspace và các site cá nhân được grant cấp quyền, kiểm tra quyền native user qua `JiraNativeVerifier`, trả về DTO chuẩn mà không rò rỉ dữ liệu ngoài quyền của caller.
4. Dịch vụ revalidation nguồn dữ liệu (`JiraPolicyService`): Áp dụng `decideJiraModelUse` từ `@wap/tool-schemas` cho mọi `JiraSourceRef`, kiểm tra đủ 10 block reasons. Xây dựng `JiraHistorySanitizer` lọc và che mờ (mask/redact) nội dung tin nhắn cũ khi xem lại hội thoại (`GET /:id`, `GET /:id/messages/latest`). Đối với `GET /:id/plans/active`, không đưa plan vào message sanitizer mà áp dụng `assertConversationAccessWithFallback` (404 Hidden pattern) hoặc trả về plan bị vô hiệu hóa khi ngữ cảnh Jira không còn hợp lệ.
5. Xây dựng thành phần bộ đệm luồng SSE (`JiraStreamBuffer`): Xây dựng và kiểm thử unit/component độc lập cho khả năng buffer content delta Jira và hủy bỏ khi lease bị revoked. **Không sửa đổi runtime `stream-routes.ts`** trong JIRA-05 vì `stream-routes.ts` là consumer subscription endpoint; việc tích hợp buffer vào luồng producer (`ChatService` / executor event publisher) được chuyển tiếp sang JIRA-08 khi có executor thực tế.
6. Duy trì nghiêm ngặt HTTP 503 cho thao tác tạo hội thoại Jira (`jiraContext: true`) ở môi trường production cho tới JIRA-08.
**Quyền lực chuẩn tắc:**
- Đặc tả thiết kế Jira: [Đặc tả Jira cá nhân và workspace ATI](../../superpowers/specs/2026-10-30-jira-personal-workspaces-design.md) (Mục 6, 7.1, 7.2, 8, 9, 11, 12).
- Bổ sung thiết kế tích hợp: [Jira dùng workspace tổ chức chung](../../superpowers/specs/2026-11-02-jira-shared-workspace-amendment.md).
- Bằng chứng khả thi Provider: [JIRA-01 Provider Facts](../../ai-evidence/JIRA-01-PROVIDER-FACTS.md).
- Hợp đồng kiểu dữ liệu đã MERGE: `packages/tool-schemas/src/myjira-policy.ts`, `myjira-context.ts`, `myjira-dto.ts` (Commit `6c53436`, PR #232).
- Nền tảng dữ liệu & Route đã thi công: [JIRA-03 Workspaces Task Card](JIRA-03-workspaces.md) (PR #240) và [JIRA-04 OAuth Token Task Card](JIRA-04-oauth-token.md).
- Kế hoạch triển khai chi tiết: [JIRA-05 Policy & Native Implementation Plan](../../superpowers/plans/2026-11-02-jira-05-policy-native.md).
**Vai trò phụ trách:** Backend Engineer (`apps/chat-api`, `db/v3`).
**Phụ thuộc:** JIRA-01 (Provider facts), JIRA-02 (Contracts PR #232), JIRA-03 (Workspaces DB/API PR #240), JIRA-04 (OAuth Token Transport). JIRA-05 là điều kiện tiên quyết cho JIRA-07 (Planner multi-site grounding) và JIRA-08 (Executor binding & guards).
**Nhánh thi công dự kiến:** `longnguyen005/jira-05-policy`.

---

## 1. Mục tiêu và phạm vi

### 1.1. Mục tiêu cốt lõi
1. **Kiểm tra quyền Native Atlassian độc lập với Scope OAuth:** Quyền scope OAuth (`read:jira-work`, `write:jira-work`) chỉ là điều kiện cần; điều kiện đủ là quyền native Jira thực tế trên từng site/project/issue (`ADMINISTER`, `BROWSE_PROJECTS`, `CREATE_ISSUES`, `ADD_COMMENTS`). Mở rộng interface verifier của `WorkspaceSiteProjectRepo` để hỗ trợ cả quyền quản trị site và quyền người dùng theo project. Triển khai `JiraNativeVerifier` gọi HTTP có kiểm soát tới Atlassian REST API thông qua token lấy từ `JiraTokenManager`, có cache TTL ngắn hạn gắn chặt với bộ khóa composite `(userId, accountId, identityVersion, workspaceId, cloudId, projectId)`.
2. **Quản lý Authorization Lease bền vững & Khóa Tuần tự Ngắn hạn:**
   - Xây dựng `JiraLeaseManager` quản lý vòng đời lease trong bảng `jira_authorization_leases`.
   - **Tuyệt đối không giữ kết nối hoặc khóa cơ sở dữ liệu qua mạng:** Thao tác xin lease (`acquireLease`) mở transaction ngắn hạn, kiểm tra các phiên bản policy và membership hiện thời bằng câu lệnh `FOR SHARE` theo đúng thứ tự lock hierarchy (`workspaces` -> `workspace_members` -> `ati_workspaces` -> `ati_workspace_memberships` -> `users` -> `jira_accounts` -> `ati_workspace_jira_sites` -> `ati_workspace_jira_projects`), ghi nhận bản ghi lease với `status = 'active'`, và **commit ngay lập tức**.
   - Khi xảy ra thu hồi quyền (revocation): Các hàm nghiệp vụ cập nhật version và gọi `markRevoked` để chuyển trạng thái các lease active liên quan sang `'revoked'`.
   - Thao tác kiểm tra lease trước khi thực hiện bước tiếp theo chỉ cần truy vấn `SELECT status, expires_at FROM jira_authorization_leases WHERE lease_id = $1` với điều kiện `status = 'active' AND expires_at > clock_timestamp()`.
   - Phân định rõ: JIRA-05 chịu trách nhiệm về schema lease, logic ghi nhận version snapshot, và đánh dấu thu hồi. JIRA-08 sẽ cung cấp linearizable outbound guard hoàn chỉnh khi tích hợp với engine thực thi.
3. **Loại trừ Deadlock giữa Token Manager và Lease Hierarchy:**
   - Cập nhật câu lệnh khóa trong `jira-token-manager.ts` thành `SELECT ... FROM jira_oauth_grants g JOIN jira_accounts a ON a.id = g.account_id WHERE a.user_id = $1 AND g.id = $2 FOR UPDATE OF g`, bảo đảm token rotation chỉ khóa dòng bảng `jira_oauth_grants`, không khóa bảng `jira_accounts`.
   - Thao tác `disconnect` trong `jira-oauth-repo.ts` là thao tác độc lập ở cấp user account, chỉ cập nhật `jira_accounts` và `jira_oauth_grants`, không lấy khóa trên các bảng workspace, ngăn ngừa triệt để nguy cơ deadlock AB/BA với các tiến trình quản trị workspace.
4. **Hiện thực hóa Capability Directory:** Chuyển đổi endpoint `GET /api/jira-workspaces/:id/jira-capabilities` từ mã 503 của JIRA-03 thành API hoạt động đầy đủ: xác thực 2 lớp thành viên (tổ chức + Jira), tính toán giao điểm giữa các site active của workspace và các site cá nhân được grant cấp quyền, kiểm tra quyền native của từng project đã chọn qua `JiraNativeVerifier`, trả về danh mục site/project và effective permissions mà không làm rò rỉ dữ liệu ngoài quyền của caller.
5. **Source Revalidation & Cô lập Lịch sử Hội thoại:** Thực thi hàm quyết định chuẩn `decideJiraModelUse` đối với mọi `JiraSourceRef`. Khi người dùng xem lại hội thoại cũ (`GET /api/conversations/:id`, `GET /api/conversations/:id/messages/latest`) hoặc nạp context lịch sử cho model, hệ thống tự động kiểm tra lại tính hợp lệ của nguồn gốc dữ liệu. Nếu bất kỳ ràng buộc nào bị vi phạm (identity đổi, workspace inactive, membership bị remove, site bị tắt, project bị bỏ chọn, version bị lệch, hoặc quyền native bị mất), nội dung phụ thuộc Jira phải bị che mờ (mask/redact) kèm thông báo nguồn gốc, tuyệt đối không trả dữ liệu thô cũ. Khi provider gặp sự cố không xác minh được, áp dụng chính sách fail-closed: che dữ liệu và báo không xác minh được.
   - Đối với endpoint `GET /api/conversations/:id/plans/active`: Không đưa plan vào message content sanitizer; thay vào đó, kiểm soát quyền truy cập qua `assertConversationAccessWithFallback` (404 Hidden Pattern) và trả về plan bị vô hiệu hóa nếu ngữ cảnh Jira không còn hợp lệ.
6. **Xây dựng Thành phần SSE Stream Buffer:** Xây dựng `JiraStreamBuffer` là một component độc lập có unit test đầy đủ: buffer content delta Jira và hủy bỏ nếu lease bị thu hồi. **Không sửa đổi file runtime `stream-routes.ts`** trong JIRA-05 (vì `stream-routes.ts` là consumer subscription endpoint; việc tích hợp buffer vào producer pipeline thuộc phạm vi JIRA-08).
7. **Bảo tồn Ranh giới Sẵn sàng 503:** Duy trì cấm tạo hội thoại Jira (`jiraContext: true`) ở môi trường production (trả về HTTP 503 `WORKSPACE_CONVERSATIONS_UNAVAILABLE`) cho đến khi hoàn tất JIRA-08 (Executor guards).

### 1.2. Phạm vi bao gồm (Scope In)
1. **Additive Migration (`db/v3/0022_jira_authorization_leases.sql`):**
   - Đặt tuần tự sau `0021_jira_oauth_token.sql`. Chạy an toàn và idempotent.
   - Bảng `jira_authorization_leases`: lưu trữ lease cấp quyền bền vững với UUID PK, `lease_id` unique, `workspace_id REFERENCES ati_workspaces(id) ON DELETE CASCADE`, `cloud_id`, `ati_user_id REFERENCES users(id) ON DELETE CASCADE`, `jira_account_id REFERENCES jira_accounts(id) ON DELETE CASCADE`, `atlassian_account_id`, `grant_id REFERENCES jira_oauth_grants(id) ON DELETE CASCADE`, các version snapshots (`membership_version`, `identity_version`, `workspace_version`, `site_policy_version`, `project_policy_version`), `ttl_ms`, `acquired_at`, `expires_at`, `released_at`, `status` (`active`, `released`, `expired`, `revoked`).
   - Ràng buộc check: `CONSTRAINT chk_jira_leases_expiry CHECK (expires_at > acquired_at)`.
   - Compound partial index phục vụ tra cứu lease còn hiệu lực:
     `CREATE INDEX IF NOT EXISTS idx_jira_leases_active ON jira_authorization_leases (workspace_id, cloud_id, expires_at) WHERE status = 'active';`.
2. **Atlassian Native Verifier Client (`apps/chat-api/src/services/jira/jira-native-verifier.ts`):**
   - Mở rộng interface verifier của `WorkspaceSiteProjectRepoOptions` để bao gồm cả `verifyAdminister` và `verifyUserPermissions`.
   - Phương thức `verifyAdminister(evidence)`: gọi `GET https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/mypermissions?permissions=ADMINISTER` và `GET https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/project/search`.
   - Phương thức `verifyUserPermissions(evidence)`: kiểm tra các quyền người dùng thông thường (`BROWSE_PROJECTS`, `CREATE_ISSUES`, `ADD_COMMENTS`) trên site/project cụ thể.
   - Bọc qua `JiraTokenManager` để tự động xoay vòng token khi cần, chuyển tiếp `AbortSignal`, giới hạn body 64 KB, chặn redirect và không để lộ secret.
   - Cache in-memory LRU có TTL ngắn hạn (60s - 300s), khóa phân tách rõ theo `(userId, accountId, identityVersion, workspaceId, cloudId, projectId)`.
3. **Cơ chế Khóa & Authorization Lease Manager (`apps/chat-api/src/services/jira/jira-lease-manager.ts`):**
   - Quản lý vòng đời lease: `acquireLease`, `releaseLease`, `revalidateLease`, `markRevoked`, `reapExpiredLeases`.
   - `acquireLease`: Thực hiện transaction ngắn hạn với các câu lệnh `FOR SHARE` theo đúng thứ tự lock hierarchy (`workspaces` -> `workspace_members` -> `ati_workspaces` -> `ati_workspace_memberships` -> `users` -> `jira_accounts` -> `ati_workspace_jira_sites` -> `ati_workspace_jira_projects`), lưu bản ghi vào `jira_authorization_leases` và COMMIT ngay.
   - `markRevoked`: Đánh dấu các lease active thuộc workspace/site/member bị thu hồi thành `revoked`.
   - Điều chỉnh `jira-token-manager.ts` sang `FOR UPDATE OF g` để triệt tiêu nguy cơ deadlock với `jira_accounts`.
4. **Capability Directory Endpoint (`GET /api/jira-workspaces/:id/jira-capabilities`):**
   - Thay thế hàm trả về 503 tạm thời trong `WorkspaceSiteProjectRepo.getCapabilities`.
   - Tính toán giao điểm giữa các site được kích hoạt của workspace và grant sites của caller.
   - Lọc các project đã chọn (`selected = true`), gọi `JiraNativeVerifier` (qua cache) để lấy quyền native thực tế của caller trên từng project.
   - Trả về `WorkspaceJiraCapabilitiesResponse` chuẩn schema, bảo đảm nguyên tắc 404 Hidden Pattern đối với người ngoài/membership không hợp lệ.
5. **Dịch vụ Revalidation Nguồn & Lọc Lịch sử (`apps/chat-api/src/services/jira/jira-policy-service.ts`, `jira-history-sanitizer.ts`):**
   - Hiện thực hóa hàm `revalidateSourceRef(sourceRef, currentUserId)` gọi trực tiếp `decideJiraModelUse(policy, request)`.
   - Kiểm tra toàn diện 10 lý do từ chối: `identity_changed`, `source_mismatch`, `workspace_inactive`, `membership_inactive`, `site_disabled`, `project_denied`, `policy_stale`, `native_permission_denied`, `provider_unavailable`, `invalid_evidence`.
   - Helper `sanitizeConversationMessages`: kiểm tra mảng `metadata.sourceRefs` trong từng message; tự động che mờ nội dung phụ thuộc Jira nếu nguồn không còn hợp lệ, không trả dữ liệu thô cũ cho API hoặc prompt model.
   - Route `plans/active`: Áp dụng kiểm tra truy cập ngữ cảnh hội thoại, vô hiệu hóa plan nếu ngữ cảnh Jira không hợp lệ, không dùng message sanitizer cho cấu trúc plan.
6. **Thành phần Bộ đệm luồng SSE (`apps/chat-api/src/sse/jira-stream-guard.ts`):**
   - Xây dựng component `JiraStreamBuffer` độc lập có unit test đầy đủ.
   - Hỗ trợ cơ chế buffer các content delta Jira và hủy bỏ toàn bộ khi lease bị thu hồi trước khi hoàn thành bước.
   - Không can thiệp vào file consumer `stream-routes.ts`; việc tích hợp vào producer pipeline thuộc phạm vi JIRA-08.
7. **Bảo tồn Ranh giới Sẵn sàng:**
   - Giữ nguyên cờ tắt `MYJIRA_ENABLED=off` mặc định.
   - Giữ nguyên HTTP 503 cho `POST /api/conversations` khi có `jiraContext: true` ở môi trường production.

### 1.3. Ngoài phạm vi (Scope Out)
- **JIRA-06:** Bộ chuyển đổi công cụ thực thi HTTP adapter (`packages/tool-adapters/src/jira/` cho 5 tools `myjira.*`).
- **JIRA-07:** AI Planner routing và multi-site grounding prompts, working memory LLM.
- **JIRA-08:** Linearizable outbound execution guard, server binding trước hash cho plan approval, gỡ cờ 503 tạo hội thoại production, tích hợp stream buffer vào producer pipeline (`ChatService` / executor).
- **JIRA-09:** Giao diện người dùng Web React/Zustand UI.
- Tuyệt đối không sửa đổi `packages/tool-schemas` (đã đóng ở JIRA-02).
- Không gọi Jira API live trên internet trong task; toàn bộ kiểm thử tích hợp sử dụng loopback HTTP fixture và PostgreSQL test database thật.

---

## 2. Danh mục File phụ trách

| File | Hành động | Mục đích |
|---|---|---|
| `db/v3/0022_jira_authorization_leases.sql` | Tạo mới | Additive migration: Bảng `jira_authorization_leases`, check constraint `expires_at > acquired_at`, compound partial index `(workspace_id, cloud_id, expires_at) WHERE status = 'active'` |
| `apps/chat-api/src/services/jira/jira-native-verifier.ts` | Tạo mới | Client kiểm tra quyền native Atlassian: mở rộng interface verifier cho cả admin và user permissions (`BROWSE_PROJECTS`, `CREATE_ISSUES`, `ADD_COMMENTS`), quản lý cache in-memory TTL phân vùng khóa composite 6 trường |
| `apps/chat-api/src/services/jira/jira-lease-manager.ts` | Tạo mới | Trình quản lý authorization lease: transaction ngắn hạn kiểm tra version snapshot và commit ngay, đánh dấu `markRevoked`, dọn dẹp lease hết hạn `reapExpiredLeases` |
| `apps/chat-api/src/services/jira/jira-token-manager.ts` | Cập nhật | Sửa câu lệnh khóa sang `FOR UPDATE OF g` để triệt tiêu nguy cơ deadlock với `jira_accounts` |
| `apps/chat-api/src/services/jira/jira-policy-service.ts` | Tạo mới | Dịch vụ revalidation nguồn gốc dữ liệu Jira: tích hợp `decideJiraModelUse`, revalidate `JiraSourceRef`, kiểm tra 10 block reasons |
| `apps/chat-api/src/services/jira/jira-history-sanitizer.ts` | Tạo mới | Lọc và làm sạch lịch sử tin nhắn: phát hiện `sourceRefs`, che mờ nội dung phụ thuộc Jira khi mất quyền |
| `apps/chat-api/src/sse/jira-stream-guard.ts` | Tạo mới | Thành phần bộ đệm SSE stream độc lập: buffer content delta Jira, flush khi lease active, hủy bỏ buffer khi quyền bị thu hồi (unit-testable component) |
| `apps/chat-api/src/db/repositories/workspace/workspace-site-project-repo.ts` | Cập nhật | Mở rộng options verifier, hiện thực hóa `getCapabilities` (xóa bỏ mã 503 tạm thời), tích hợp `JiraNativeVerifier` thật |
| `apps/chat-api/src/routes/conversation-routes.ts` | Cập nhật | Tích hợp `jira-history-sanitizer` cho các endpoint đọc tin nhắn (`GET /:id`, `GET /:id/messages/latest`); bảo vệ `GET /:id/plans/active` bằng context access |
| `apps/chat-api/src/app.ts` | Cập nhật | Wire `JiraNativeVerifier`, `JiraLeaseManager`, `JiraPolicyService` và truyền vào các routes liên quan |
| `apps/chat-api/src/server.ts` | Cập nhật | Khởi tạo các dịch vụ chính sách Jira và inject vào `createApp` |
| `apps/chat-api/tests/helpers/jira-native-test-fixture.ts` | Tạo mới | Helper dựng loopback HTTP mock server chuẩn Atlassian REST API `/rest/api/3/mypermissions` và `/rest/api/3/project/search` |
| `apps/chat-api/tests/db/jira-policy-lease-migration.test.ts` | Tạo mới | Kiểm thử PostgreSQL thật: idempotence migration 0001–0022, check constraints, compound partial index |
| `apps/chat-api/tests/services/jira-native-verifier.test.ts` | Tạo mới | Kiểm thử unit/integration: gọi loopback HTTP fixture, phân loại quyền granted/denied/unavailable cho cả admin và user, cache composite hit/miss/eviction |
| `apps/chat-api/tests/services/jira-lease-manager.test.ts` | Tạo mới | Kiểm thử PostgreSQL thật: transaction ngắn hạn cấp lease, đánh dấu thu hồi khi policy thay đổi, reaper dọn dẹp lease hết hạn, và kiểm tra `FOR UPDATE OF g` không khóa lây `jira_accounts` |
| `apps/chat-api/tests/routes/jira-capabilities.test.ts` | Tạo mới | Kiểm thử API route `GET /api/jira-workspaces/:id/jira-capabilities`: giao điểm grant sites và workspace sites, project allowlist, 404 hidden pattern |
| `apps/chat-api/tests/services/jira-source-revalidation.test.ts` | Tạo mới | Kiểm thử revalidation nguồn gốc: kiểm chứng toàn diện 10 block reasons của `decideJiraModelUse`, che mờ nội dung message cũ khi mất quyền |
| `apps/chat-api/tests/sse/jira-stream-guard.test.ts` | Tạo mới | Kiểm thử unit component `JiraStreamBuffer`: buffer content delta, flush khi lease active, hủy bỏ khi lease bị revoked |

---

## 3. Tiêu chí nghiệm thu (Checklist)

- [ ] **Migration Idempotence & Schema Integrity:** Migration `0022_jira_authorization_leases.sql` chạy an toàn sau `0021_jira_oauth_token.sql`. Chạy lặp lại toàn bộ chuỗi migration 0001–0022 nhiều lần không lỗi. Bảng có ràng buộc `CHECK (expires_at > acquired_at)` và chỉ mục compound partial index `idx_jira_leases_active` trên `(workspace_id, cloud_id, expires_at) WHERE status = 'active'`.
- [ ] **Native Permission Verification (Admin & User):** `JiraNativeVerifier` gọi endpoint `/rest/api/3/mypermissions` trên loopback HTTP fixture; phân loại chính xác quyền admin (`ADMINISTER`) và quyền user thường (`BROWSE_PROJECTS`, `CREATE_ISSUES`, `ADD_COMMENTS`); trả về kết quả `granted`, `denied`, hoặc `unavailable` không để lộ token.
- [ ] **Native Cache Composite Partitioning:** Cache quyền native phân tách độc lập theo 6 trường `(userId, accountId, identityVersion, workspaceId, cloudId, projectId)`. Thay đổi `identityVersion` hoặc ngắt kết nối tự động làm vô hiệu hóa cache.
- [ ] **Non-Blocking Short Transaction Lease Records:** `acquireLease` thực hiện transaction ngắn hạn kiểm tra version với `FOR SHARE` theo lock hierarchy, lưu bản ghi lease và COMMIT ngay lập tức; tuyệt đối không giữ kết nối DB hay row lock qua cuộc gọi HTTP mạng.
- [ ] **Revocation Marking & Version Invalidation:** Khi xảy ra thay đổi quyền (archive workspace, remove member, deactivate site, deselect project), các hàm nghiệp vụ tăng version và đánh dấu các lease active liên quan thành `revoked`. Lời gọi `revalidateLease` trên lease bị thu hồi lập tức trả về `revoked`.
- [ ] **Token Rotation Deadlock Freedom:** Câu lệnh trong `jira-token-manager.ts` sử dụng `FOR UPDATE OF g`, bảo đảm token rotation chỉ khóa `jira_oauth_grants`, không khóa lây sang `jira_accounts`, triệt tiêu nguy cơ deadlock với các thao tác lease. Thao tác `disconnect` độc lập ở cấp account không lấy khóa bảng workspace.
- [ ] **Lease Expiry & Reaper Logic:** Truy vấn kiểm tra lease luôn lọc điều kiện `status = 'active' AND expires_at > clock_timestamp()`. Phương thức `reapExpiredLeases` cập nhật chính xác các lease quá hạn thành `expired`.
- [ ] **Capability Directory Implementation:** Endpoint `GET /api/jira-workspaces/:id/jira-capabilities` trả về mã 200 kèm danh mục site/project hợp lệ cho thành viên active; tính đúng giao điểm giữa grant cá nhân và workspace allowlist; trả về 404 Hidden Pattern cho người ngoài hoặc membership bị thu hồi.
- [ ] **Source Revalidation Comprehensive Coverage:** Dịch vụ revalidation kiểm tra đầy đủ 10 lý do chặn của `decideJiraModelUse`: `identity_changed`, `source_mismatch`, `workspace_inactive`, `membership_inactive`, `site_disabled`, `project_denied`, `policy_stale`, `native_permission_denied`, `provider_unavailable`, `invalid_evidence`.
- [ ] **Conversation History Masking & Redaction:** Khi người dùng xem lại hội thoại có `sourceRefs` mà quyền tương ứng đã bị thu hồi, nội dung phụ thuộc Jira được che mờ (masked) kèm lý do rõ ràng; không trả dữ liệu Jira nhạy cảm thô ra API; provider lỗi áp dụng fail-closed và che dữ liệu.
- [ ] **Decoupled Plans/Active Access:** Route `GET /api/conversations/:id/plans/active` áp dụng kiểm tra quyền truy cập ngữ cảnh hội thoại qua `assertConversationAccessWithFallback`, trả về 404 Hidden Pattern khi mất quyền, không đưa cấu trúc plan vào message sanitizer.
- [ ] **Standalone Stream Buffer Component:** Component `JiraStreamBuffer` có test suite độc lập: buffer content delta Jira, flush khi lease active, hủy bỏ và emit lỗi khi quyền bị thu hồi. Không sửa đổi runtime `stream-routes.ts`.
- [ ] **Production 503 Invariant Maintained:** Thao tác tạo hội thoại với `jiraContext: true` tiếp tục trả về HTTP 503 `WORKSPACE_CONVERSATIONS_UNAVAILABLE` ở môi trường production mặc định; chỉ mở trong test fixture nội bộ.
- [ ] **Flag-Off & Zero Secret Leakage:** Mọi log kiểm toán, response lỗi, và thông điệp stream tuyệt đối không chứa access token, refresh token, client secret, hay URL nhạy cảm. Giữ nguyên cờ tắt `MYJIRA_ENABLED=off`.

---

## 4. Lệnh kiểm tra dành cho Parent Codex

> **Quy chuẩn môi trường kiểm thử:**
> Toàn bộ kiểm thử chạy trên instance PostgreSQL chuyên dụng cổng `56534` (hoặc CI loopback `5432` trên database `ati_jira05` hoặc `ati_v3`). Không nạp `.env` live. Parent Codex điều phối Git commits và chạy các lệnh kiểm tra thực tế.

### 4.1. Kiểm tra Migration Schema Lease PostgreSQL:
```bash
DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/db/jira-policy-lease-migration.test.ts
```

### 4.2. Kiểm tra Native Verifier Client & Loopback Fixture:
```bash
RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/services/jira-native-verifier.test.ts
```

### 4.3. Kiểm tra Trình Quản lý Lease, Thu hồi Quyền & Deadlock Freedom:
```bash
DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/services/jira-lease-manager.test.ts
```

### 4.4. Kiểm tra API Routes Capability Directory:
```bash
DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/routes/jira-capabilities.test.ts
```

### 4.5. Kiểm tra Source Revalidation & History Masking:
```bash
DATABASE_URL="$TEST_DATABASE_URL" RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/services/jira-source-revalidation.test.ts
```

### 4.6. Kiểm tra Bộ đệm SSE Stream Buffer (Unit Component):
```bash
RUNTIME_MODE=sandbox npm test -w @wap/chat-api -- tests/sse/jira-stream-guard.test.ts
```

### 4.7. Kiểm tra Typecheck và Full Check toàn hệ thống:
```bash
npm run typecheck:v3
DATABASE_URL="$TEST_DATABASE_URL" npm run check
```

---

## 5. Kết quả

- **Trạng thái:** Chưa thi công code (Planning Phase).
- **Commit kế hoạch:** Sẽ ghi nhận sau khi tạo task card và plan.
- **Bằng chứng chạy thử:** Sẽ được điền sau khi thực hiện TDD RED/GREEN theo kế hoạch.
