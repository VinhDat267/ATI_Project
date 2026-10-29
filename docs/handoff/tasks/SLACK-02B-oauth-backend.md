# SLACK-02B · Backend Hợp nhất OAuth & Chính sách Chấp thuận Tổ chức (F1 Backend)

**Trạng thái:** kế hoạch đã đối soát và cập nhật (chờ leader review)
**Nhánh gợi ý:** `feat/slack-02b-oauth-backend` · **Nền:** `6871087` (hoặc `ac448dd` sau khi merge PR #184 & 02R)
**Vai trò sở hữu:** Backend Engineer (sở hữu `apps/chat-api/`, `db/v3/` và scripts liên quan)
**Phụ thuộc:** SLACK-02A (contracts chuẩn tại `packages/tool-schemas`), PR #184 + 02R callback isolation
**Task cha:** [SLACK-02-personal-connections](SLACK-02-personal-connections.md)
**Kế hoạch chi tiết:** [Kế hoạch Triển khai 02B Backend & Consent](../../superpowers/plans/2026-10-29-slack-02b-consent-backend.md).

---

## 1. Mục tiêu và Phạm vi

Triển khai phần backend còn lại của SLACK-02, trọng tâm là **Chính sách Chấp thuận của Tổ chức (F1 Organization Consent)**, kiểm định nhà cung cấp mô hình tin cậy (Trusted Providers), tính toán metadata sẵn sàng (`processingReady`), thiết lập ranh giới tương thích với PR #184 + 02R và giao diện vòng đời cho Phase 3:
1. **Kế thừa & Không viết lại OAuth:**
   - Tái sử dụng bảng `slack_connections` và `slack_oauth_states` từ PR #184 (`ac448dd`).
   - Tái sử dụng migration `0015_slack_callback_order.sql` từ bản sửa lỗi cô lập callback 02R (`order_seq` CAS check và xóa state cục bộ theo `(id, user_id)`).
   - Tuyệt đối không tạo file migration `0014` trùng lặp. Migration tiếp theo là `0016_slack_processing_consents.sql`.
2. **Chính sách Chấp thuận Tổ chức (F1) & Quản Trị Tin Cậy qua Operator CLI:**
   - Bảng `slack_processing_consents`: Quản lý chấp thuận xử lý dữ liệu của tổ chức với `policy_version`, monotonic `revision`, `status` (`pending` / `granted` / `revoked`), `purposes` (`manual_lookup`, `triage`, `planning`, `digest`, `storage`), `retention_days >= 0` (đây là data retention TTL, không phải ngày hết hạn của consent; 0 là xử lý không lưu bản sao), `organization_representative`, `evidence_ref`, `recorded_by`, `granted_at`, `revoked_at`.
   - Bảng `slack_trusted_providers`: Lưu cấu hình nhà cung cấp tin cậy với monotonic `revision`, `verified`, `no_training`, `configuration_fingerprint`, `evidence_ref`, `verified_by`, `verified_at`, trần lưu trữ `max_retention_days`. Không có trusted defaults hoặc tự động seed `true`. Tuyệt đối không lưu API key vào bảng này.
   - Bảng `slack_policy_events`: Lưu vết sự kiện thay đổi chính sách bền vững (`consent_granted`, `consent_revoked`, `provider_attested`, v.v.) được commit nguyên tử cùng transaction với thay đổi chính sách, sẵn sàng cho Phase 3 (SLACK-03) consume để kích hoạt tombstone/purge.
   - Cung cấp Operator CLI (`apps/chat-api/src/cli/slack-consent.ts`) thực thi ở cấp độ deployment/database access: `grant`, `revoke`, `attest-provider`, `list`.
   - **Ranh giới tin cậy nghiêm ngặt:** KHÔNG tạo HTTP endpoints tạo trust trong slice này. Các API HTTP giữ nguyên phạm vi kết nối của caller và metadata. Kiểm thử phải chứng minh các nỗ lực mutate consent/provider qua HTTP đều bị từ chối/không thay đổi policy.
3. **Runtime Provider Selection, Policy Resolution & Dynamic `processingReady`:**
   - Provider profile được chọn thông qua cấu hình máy chủ (khớp `createProviderFromEnv`), tính toán `configuration_fingerprint` máy chủ sở hữu, tách biệt hoàn toàn với model builder Antigravity.
   - Dịch vụ `SlackPolicyService`: Re-validate kết nối, owner, workspace, actor_id, identityVersion, active session, và persisted consent/provider policy trên mỗi quyết định cấp quyền. Trả về credential-free policy reference kèm revision và policyVersion.
   - Đánh giá động `processingReady` theo 6 tiêu chí đồng thời (fail-closed).
   - Ánh xạ chuẩn 02A: DB `actor_id` -> canonical `slackUserId` (với `slackUserLabel` fallback an toàn là actorId, không gọi `users.info` trước khi có content authorization); DB `disconnected` -> canonical `revoked` (dùng trường legacy nếu cần).
   - Xuất capability qua `GET /api/services` (`personalOAuth: ['myslack']`).

---

## 2. Chi Tiết File Cần Tạo và Cập Nhật

### 2.1. File Tạo Mới
1. `db/v3/0016_slack_processing_consents.sql`:
   - Tạo bảng `slack_trusted_providers` (cấu hình provider tin cậy, monotonic revision, fingerprint, không lưu key).
   - Tạo bảng `slack_processing_consents` (lưu vết chấp thuận của workspace cho từng provider, monotonic revision, purposes, data retention TTL).
   - Tạo bảng `slack_policy_events` (lưu vết sự kiện thay đổi chính sách bền vững cho Phase 3).
2. `apps/chat-api/src/db/repositories/slack-consent-repo.ts`:
   - Tra cứu và cập nhật consent/provider, kiểm tra CAS revision, ghi nhận sự kiện `slack_policy_events` trong cùng transaction.
3. `apps/chat-api/src/services/slack/policy-service.ts`:
   - Dịch vụ giải quyết và kiểm tra chính sách runtime: đối soát binding, kiểm tra 6 tiêu chí fail-closed, fingerprint match.
4. `apps/chat-api/src/cli/slack-consent.ts`:
   - CLI script cho Operator: `grant`, `revoke`, `attest-provider`, `list`.

### 2.2. File Cập Nhật
1. `apps/chat-api/src/db/repositories/slack-connection-repo.ts`:
   - Tích hợp tính toán `consentStatus` và dynamic `processingReady` vào phương thức list.
2. `apps/chat-api/src/routes/connections/slack.ts`:
   - Trả về danh sách kết nối chuẩn 02A canonical (`SlackConnectionPublicInfo`) kèm các trường legacy tương thích an toàn cho UI hiện tại.

### 2.3. File Kiểm Thử
1. `apps/chat-api/tests/db/slack-consent-repo.test.ts`: Kiểm thử repo consent trên PostgreSQL thật (CAS revisions, validation, 0 retention, atomic policy event emission, migration idempotent repeat với real non-empty rows).
2. `apps/chat-api/tests/cli/slack-consent-cli.test.ts`: Kiểm thử lệnh CLI operator thực tế (spawn process, argument validation, CAS check, audit provenance).
3. `apps/chat-api/tests/services/slack-policy-service.test.ts`: Kiểm thử giải quyết chính sách runtime, fingerprint mismatch, tampered binding, retention 0 vs requested retention, purpose check, stale policy version.
4. `apps/chat-api/tests/routes/slack-compatibility.test.ts`: Kiểm thử canonical DTO chuẩn 02A, bảo toàn legacy fields, và chứng minh không có endpoint HTTP nào có thể mutate consent hay provider trust.

---

## 3. Tiêu Chí Nghiệm Thu

- [x] Migration `0016_slack_processing_consents.sql` thực thi an toàn, idempotent trên PostgreSQL thật (lặp lại thành công trên non-empty schema).
- [x] Ranh giới tin cậy nghiêm ngặt: Không có HTTP endpoint tạo trust; chỉ Operator CLI có quyền attestation provider và grant/revoke consent tổ chức. HTTP mutation attempts trả về 404 và không làm thay đổi chính sách.
- [x] `processingReady` chỉ true khi thỏa mãn đồng thời 6 điều kiện; chuyển ngay về `false` khi consent bị thu hồi hoặc provider thay đổi cấu hình mà chưa re-attest.
- [x] Khả năng kết nối được công bố qua `GET /api/services` (`personalOAuth: ['myslack']`).
- [x] Các tests hiện hữu của PR #184 và 02R tiếp tục pass 100% nhờ lớp tương thích chuẩn 02A (`validateSlackConnectionPublicInfo` + safe legacy aliases).
- [x] Không có secret hay token nào bị lọt vào log, exception hay API responses.
- [x] `npm run typecheck:v3` đạt exit code 0; `npm run check` toàn diện đạt 3,167 tests pass (exit code 0); `git diff --check` đạt 0 lỗi whitespace.
- [x] Vượt qua 4/4 ca kiểm thử phản biện độc lập của Leader (`.superpowers/slack02b-resume/leader-policy-review.mts` EXIT 0) và 13/13 ca kiểm thử hợp đồng chính sách nghiêm ngặt (`.superpowers/slack02b-resume/leader-policy-contract-review.mts` EXIT 0).
- [x] Hỗ trợ đầy đủ luồng điều hướng `returnTo` (`/c/<uuid>` kiểm tra quyền sở hữu hội thoại, lưu vào state và bảo toàn tới callback kết quả; tái kiểm tra quyền sở hữu khi callback để an toàn bỏ qua nếu hội thoại bị xóa/chuyển giao) cùng tham số gợi ý workspace `workspaceHint`.

---

## 4. Kết Quả Triển Khai

- **Trạng thái:** Hoàn thành (Completed & Leader Contract Regressions Addressed).
- **Branch:** `feat/slack-02b-consent-backend`.
- **Base Integration Branch:** `integration/slack-personal-20261029`.
- **PR:** #192 (Draft PR).
- **Files đã triển khai & hoàn thiện:**
  - `db/v3/0016_slack_processing_consents.sql`: Tạo bảng `slack_trusted_providers`, `slack_processing_consents`, `slack_policy_events` với monotonic `revision`, constraints chặt chẽ; bổ sung cột và constraint `return_to` cho `slack_oauth_states`.
  - `apps/chat-api/src/db/repositories/slack-consent-repo.ts`: Quản lý CAS atomic update, monotonic revisions, bắt buộc `expectedRevision` khi update/revoke bản ghi hiện hữu (`SLACK_CAS_REVISION_REQUIRED`), retentionDays >= 0, và lưu vết `slack_policy_events`.
  - `apps/chat-api/src/db/repositories/slack-connection-repo.ts`: Lưu trữ và trả về `returnTo` trong `start` và `consume`.
  - `apps/chat-api/src/config/slack-policy-runtime.ts`: Tính toán SHA-256 configuration fingerprint từ runtime model environment (khớp model mặc định `gemini-3.8-flash` từ `packages/planner`, không bịa đặt cấu hình openai-compatible, gắn `accountIdentifier` không chứa bí mật, không cấp fixture account ngầm định, từ chối provider kind lạ).
  - `apps/chat-api/src/cli/slack-consent.ts`: Operator CLI (`attest-provider`, `grant`, `revoke`, `list`) với argument parsing, validation, CAS support.
  - `apps/chat-api/src/services/slack/policy-service.ts`: `resolveSlackModelPolicy` thẩm định fail-closed 6 tiêu chí, kiểm tra toàn diện `expectedPolicyReference` (JSON serializable, chuỗi revision chính tắc `^[1-9][0-9]*$`, từ chối tham chiếu cũ sau revoke/regrant, khóa chặt server-owned runtime config không tin cậy request env, bắt buộc endpoint thật và account id thật); `checkProcessingReady` tính toán dynamic readiness (chặn unready khi retention vượt trần provider).
  - `apps/chat-api/src/services/slack/oauth-client.ts`: Hỗ trợ tham số `team` (gợi ý workspace) trong `authorizationUrl`.
  - `apps/chat-api/src/routes/connections/slack.ts`: Trả về `SlackConnectionPublicInfo` chuẩn 02A (`slackUserId`, `slackUserLabel`, `consentStatus`, dynamic `processingReady`), bảo toàn safe legacy aliases (`actorId`, `processingStatus`), xử lý `returnTo` và trả về envelope `SlackCallbackResult` (`connectionId`, `returnTo`), tái kiểm tra sở hữu hội thoại khi callback để an toàn bỏ qua nếu hội thoại bị xóa/chuyển giao.
  - `apps/chat-api/src/app.ts`: Gắn `conversationOwner` vào `createSlackConnectionRoutes`.
  - `apps/chat-api/package.json`: Thêm script `"admin:slack-consent"`.
- **Bằng chứng kiểm thử thực tế:**
  - `.superpowers/slack02b-resume/leader-policy-contract-review.mts`: **13/13 tests PASS (EXIT 0)** (JSON BigInt fix, full binding/context, empty reference rejection, tampered binding rejection, cross-user in same workspace rejection, noncanonical revision string rejection, server-owned runtime provider configuration, canonical policy reference roundtrips without invented legacy fields, numeric revision rejection, unconfigured service cannot trust caller-supplied env, missing explicit account identity never receives implicit fixture account, unknown runtime provider kind remains unverified, openai-compatible missing actual endpoint remains unverified).
  - `.superpowers/slack02b-resume/leader-policy-review.mts`: **4/4 tests PASS (EXIT 0)** (mô hình 3.8, CAS bắt buộc, unready khi vượt trần retention, từ chối reference cũ).
  - `apps/chat-api/tests/db/slack-consent-repo.test.ts`: **10/10 tests PASS** (PostgreSQL CAS, retention 0, events atomicity, repeat migration, bắt buộc revision).
  - `apps/chat-api/tests/cli/slack-consent-cli.test.ts`: **6/6 tests PASS** (spawn CLI child process, validation, CAS conflict).
  - `apps/chat-api/tests/services/slack-policy-service.test.ts`: **11/11 tests PASS** (fail-closed gates, fingerprint mismatch, purpose checks, expectedPolicyReference revalidation, provider retention cap, canonical revisions string, server-owned config).
  - `apps/chat-api/tests/routes/slack-compatibility.test.ts`: **3/3 tests PASS** (02A envelope validation, legacy aliases, HTTP mutation rejected with 404).
  - `apps/chat-api/tests/routes/slack-connections.test.ts`: **9/9 tests PASS** (setup routes, parallel flows, workspaceHint, returnTo validation, canonical callback result, safe returnTo omission when conversation deleted/transferred).
  - `apps/chat-api/tests/db/slack-connection-repo.test.ts`: **8/8 tests PASS** (02R callback ordering và isolation).
  - `apps/chat-api/tests/services/slack-token-manager.test.ts`: **4/4 tests PASS** (token manager và refresh).
  - `npm run test:slack:foundation`: **56 Node + 49 Vitest PASS** (105 tests).
  - `npm run typecheck:v3`: **EXIT 0** (0 lỗi TypeScript).
  - Toàn bộ `apps/chat-api` suite: **105 files PASS, 753 tests PASS**.
  - Fullcheck toàn dự án (`npm run check`): **EXIT 0**: 2.694 v3 tests + 406 eval + 1 launcher + 66 Node = **3.167 tests PASS**.
  - Whitespace check (`git diff --check`): **0 lỗi**.
  - `apps/chat-api/tests/services/slack-token-manager.test.ts`: **4/4 tests PASS**.
  - `npm run test:slack:foundation`: **56 node tests + 49 vitest tests PASS (105 tests)**.
  - `npm run typecheck:v3`: **EXIT 0**.
  - Toàn bộ `apps/chat-api` suite: **105 files PASS, 751 tests PASS** (thời gian 43.61s).
  - Fullcheck toàn dự án (`npm run check`): **EXIT 0**: 2,694 v3 tests + 406 eval + 1 launcher + 66 Node = **3,167 tests PASS**.
  - Whitespace check (`git diff --check`): **0 lỗi**.


## Quyết định triển khai của điều phối viên

Phạm vi code còn lại được cho triển khai theo [quyết định02B ngày29/10](../decisions/2026-10-29-slack-02b-consent-decisions.md). Tài liệu quyết định này thay thế các ví dụ draft mâu thuẫn trong plan: operator CLI tạo trust, policy/provider có evidence và revision/CAS, quyền theo purpose/config thực tế, sự kiện vòng đời bền vững và metadata tương thích. Chưa cho merge hoặc bật live. Cập nhật plan theo quyết định trước khi viết code.
