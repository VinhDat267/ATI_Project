# Slack Personal Connection Backend: Organization Consent (F1) & Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện tầng backend cho SLACK-02B tập trung vào thiết lập ranh giới chính sách chấp thuận của tổ chức (F1 Organization Consent), lưu trữ và kiểm định nhà cung cấp mô hình tin cậy (Trusted Providers) qua Operator CLI, lưu vết sự kiện thay đổi chính sách bền vững (`slack_policy_events`), tính toán metadata sẵn sàng xử lý (`processingReady`), giải quyết chính sách thực thi an toàn fail-closed cho model (`resolveSlackModelPolicy`), và duy trì tính tương thích chuẩn 02A cho endpoint `/api/connections/myslack`.

**Architecture & Decisions:**
- Tuân thủ toàn diện quyết định của Leader tại [`docs/handoff/decisions/2026-10-29-slack-02b-consent-decisions.md`](../../handoff/decisions/2026-10-29-slack-02b-consent-decisions.md).
- Kế thừa và tái sử dụng bảng `slack_connections` và `slack_oauth_states` từ PR #184 (`ac448dd`) kết hợp bản sửa lỗi cô lập callback 02R (`0015_slack_callback_order.sql`).
- Migration `0016_slack_processing_consents.sql` tạo 3 bảng:
  1. `slack_trusted_providers`: lưu cấu hình provider tin cậy, cờ `verified`, `no_training`, trần lưu trữ `max_retention_days`, `configuration_fingerprint`, monotonic `revision`, `evidence_ref`, `verified_by`, `verified_at`. Tuyệt đối không lưu API keys.
  2. `slack_processing_consents`: keyed theo `(workspace_id, provider_id)`, lưu `policy_version`, monotonic `revision`, `status` (`pending`, `granted`, `revoked`), danh sách `purposes text[]`, `retention_days >= 0`, `organization_representative`, `evidence_ref`, `recorded_by`, `granted_at`, `revoked_at`.
  3. `slack_policy_events`: sự kiện thay đổi chính sách bền vững (durable audit events) được commit atomically trong cùng transaction với mọi thao tác grant/revoke/re-attest, phục vụ Phase 3 purge/tombstone.
- **Ranh giới ủy quyền tin cậy (Trusted Boundary):** KHÔNG cung cấp HTTP endpoints tạo lòng tin. Mọi thao tác chứng thực provider (`attest-provider`), cấp chấp thuận (`grant`), thu hồi (`revoke`) chỉ được thực hiện qua **Operator CLI** (`apps/chat-api/src/cli/slack-consent.ts`) yêu cầu quyền truy cập cơ sở hạ tầng / DB trực tiếp.
- **Data retention TTL:** `retentionDays` kiểm soát thời hạn lưu trữ dữ liệu sau xử lý, KHÔNG phải ngày hết hạn của consent. `retentionDays = 0` hoàn toàn hợp lệ (cho phép xử lý thời gian thực mà không lưu bản sao).
- **Runtime Policy Service:** `resolveSlackModelPolicy` kiểm tra 6 tiêu chí fail-closed: (1) connection `active`, (2) consent `granted`, (3) đủ evidence & representative, (4) provider verified & noTraining, (5) purposes hợp lệ (`manual_lookup`, `triage`, `planning`, `digest`, `storage`), (6) `requestedRetentionDays <= maxRetentionDays`. Khóa theo cấu hình runtime provider fingerprint.
- **Tương thích 02A:** `GET /api/connections/myslack` trả về envelope chuẩn `{ connections: SlackConnectionPublicInfo[] }` thỏa mãn validator 02A, bảo toàn các trường an toàn cho UI hiện tại (`actorId`, `processingStatus`).

**Tech Stack:** Node.js `^22.12.0 || >=24.0.0`, TypeScript 5.8, Express 5.2.1, PostgreSQL 16 (`pg.Pool`), Vitest 4.
**Spec:** [Slack cá nhân và trợ lý công việc trong ATI](../specs/2026-10-28-slack-personal-oauth-design.md) (mục 4, 8, 9, 10).
**Hợp đồng chuẩn tắc:** [`packages/tool-schemas/src/myslack-connection.ts`](../../packages/tool-schemas/src/myslack-connection.ts), [`myslack-policy.ts`](../../packages/tool-schemas/src/myslack-policy.ts).

---

## Global Constraints

1. **Bắt buộc `policyVersion` & Revisions:** `policyVersion` là chuỗi non-blank. Các bản ghi có monotonic `revision bigint` tăng dần để hỗ trợ CAS concurrency.
2. **Cho phép `retentionDays >= 0`:** Giá trị `retentionDays = 0` là hoàn toàn hợp lệ (không lưu trữ bản sao). Từ chối số âm, số thập phân, NaN và Infinity.
3. **Phân biệt điều kiện theo trạng thái:** Trạng thái `pending` không yêu cầu evidence; trạng thái `granted` bắt buộc có đầy đủ `organizationRepresentative`, `evidenceRef`, `recordedBy`, `grantedAt`.
4. **Không tạo endpoint HTTP tạo trust:** Không cho phép request HTTP từ client/browser thay đổi provider hoặc consent. Bất kỳ request HTTP nào gửi tới router consent phải bị 404 (không mount route đột biến).
5. **Cơ chế sẵn sàng xử lý (`processingReady`) fail-closed:** `processingReady === true` chỉ được thiết lập khi thỏa mãn đồng thời 6 tiêu chí chính sách.
6. **Lưu vết sự kiện bền vững:** Mọi thao tác grant, revoke, update provider đều ghi nhận 1 bản ghi vào `slack_policy_events` trong cùng transaction DB.
7. **Ranh giới module:** Chỉ sửa đổi `apps/chat-api/`, `db/v3/0016_slack_processing_consents.sql`, operator documentation, test fixtures và task handoff. Tuyệt đối không can thiệp frontend (`apps/chat-web`), schemas (`packages/tool-schemas`), executor hay planner.

---

## File Structure & Module Ownership

| File | Module Ownership | Trách Nhiệm Kỹ Thuật |
|---|---|---|
| `db/v3/0016_slack_processing_consents.sql` | Backend | Migration tạo bảng `slack_trusted_providers`, `slack_processing_consents`, `slack_policy_events` |
| `apps/chat-api/src/db/repositories/slack-consent-repo.ts` | Backend | Repository quản lý consent, trusted providers, CAS atomic updates và policy events |
| `apps/chat-api/src/config/slack-policy-runtime.ts` | Backend | Tính toán configuration fingerprint của runtime provider từ biến môi trường máy chủ |
| `apps/chat-api/src/cli/slack-consent.ts` | Backend | Operator CLI cho thao tác chứng thực provider, cấp/thu hồi consent, và kiểm tra trạng thái |
| `apps/chat-api/src/services/slack/policy-service.ts` | Backend | Service thẩm định chính sách runtime fail-closed (`resolveSlackModelPolicy`) |
| `apps/chat-api/src/db/repositories/slack-connection-repo.ts` | Backend (Modify) | Tích hợp tính toán dynamic `consentStatus` và `processingReady` |
| `apps/chat-api/src/routes/connections/slack.ts` | Backend (Modify) | Cung cấp danh sách kết nối chuẩn 02A (`SlackConnectionPublicInfo`) kèm safe legacy aliases |
| `apps/chat-api/tests/db/slack-consent-repo.test.ts` | Backend | Test repository consent trên PostgreSQL thật (CAS, retention 0, events atomicity, repeat migration) |
| `apps/chat-api/tests/cli/slack-consent-cli.test.ts` | Backend | Test spawn child process CLI thực tế (grant, revoke, validation, CAS conflict) |
| `apps/chat-api/tests/services/slack-policy-service.test.ts` | Backend | Test 6 tiêu chí fail-closed, stale policy revision, fingerprint mismatch, purposes |
| `apps/chat-api/tests/routes/slack-compatibility.test.ts` | Backend | Test API `/api/connections/myslack` trả về envelope chuẩn 02A, bảo toàn legacy aliases |

---

## Detailed Task Breakdown

### Task 1: Database Migration 0016 & Slack Consent Repository

**Files:**
- Create: `db/v3/0016_slack_processing_consents.sql`
- Create: `apps/chat-api/src/db/repositories/slack-consent-repo.ts`
- Create: `apps/chat-api/tests/db/slack-consent-repo.test.ts`

- [ ] **Step 1 (Test RED):** Viết integration test trong `apps/chat-api/tests/db/slack-consent-repo.test.ts` kết nối tới PostgreSQL thật (`createMigratedSchema`):
  - Migration 0016 chạy trơn tru trên DB đã có migration 0001-0015.
  - `attestProvider`: lưu provider với cờ `verified`, `noTraining`, `maxRetentionDays`, fingerprint, monotonic revision, đồng thời ghi 1 record vào `slack_policy_events`.
  - `grantConsent`: cấp consent cho `(workspaceId, providerId)` với `retentionDays >= 0`, danh sách `purposes`, `policyVersion`, `evidenceRef`, `organizationRepresentative`, `recordedBy`, tăng revision, ghi event atomically.
  - CAS conflict: update thất bại và ném lỗi rõ ràng khi `expectedRevision` không khớp revision hiện tại trong DB.
  - `revokeConsent`: cập nhật `status = 'revoked'`, ghi `revoked_at`, tăng revision, ghi event atomically.
  - Xử lý `retentionDays = 0` hợp lệ, không tự thu hồi consent.
- [ ] **Step 2:** Chạy test xác nhận lỗi đỏ:
  ```sh
  npm test -w @wap/chat-api -- tests/db/slack-consent-repo.test.ts
  ```
- [ ] **Step 3 (Implement GREEN):** Cài đặt `0016_slack_processing_consents.sql` và class `SlackConsentRepo`.
- [ ] **Step 4:** Chạy lại test xác nhận xanh:
  ```sh
  npm test -w @wap/chat-api -- tests/db/slack-consent-repo.test.ts
  ```
- [ ] **Step 5 (Commit):**
  ```sh
  git add db/v3/0016_slack_processing_consents.sql apps/chat-api/src/db/repositories/slack-consent-repo.ts apps/chat-api/tests/db/slack-consent-repo.test.ts
  git commit -m "feat(slack): add migration 0016 and slack consent repository with policy events"
  ```

---

### Task 2: Operator CLI (`apps/chat-api/src/cli/slack-consent.ts`)

**Files:**
- Create: `apps/chat-api/src/config/slack-policy-runtime.ts`
- Create: `apps/chat-api/src/cli/slack-consent.ts`
- Create: `apps/chat-api/tests/cli/slack-consent-cli.test.ts`

- [ ] **Step 1 (Test RED):** Viết integration test `apps/chat-api/tests/cli/slack-consent-cli.test.ts` spawn child process `tsx apps/chat-api/src/cli/slack-consent.ts`:
  - `attest-provider`: cung cấp flags `--id`, `--name`, `--verified`, `--no-training`, `--max-retention`, `--fingerprint`, `--evidence-ref`, `--by`. Kiểm tra DB được cập nhật.
  - `grant`: cung cấp `--workspace`, `--provider`, `--policy-version`, `--purposes`, `--retention-days`, `--representative`, `--evidence-ref`, `--by`. Kiểm tra DB được cập nhật.
  - `revoke`: cung cấp `--workspace`, `--provider`, `--reason`, `--by`. Kiểm tra status chuyển thành `revoked`.
  - Thiếu tham số hoặc dữ liệu không hợp lệ -> exit code khác 0, in lỗi ra stderr.
  - CAS conflict `--expected-revision` không khớp -> exit code khác 0.
- [ ] **Step 2:** Chạy test xác nhận lỗi đỏ:
  ```sh
  npm test -w @wap/chat-api -- tests/cli/slack-consent-cli.test.ts
  ```
- [ ] **Step 3 (Implement GREEN):** Cài đặt CLI script với đầy đủ xử lý tham số dòng lệnh, validation nghiêm ngặt và xử lý transaction.
- [ ] **Step 4:** Chạy lại test xác nhận xanh:
  ```sh
  npm test -w @wap/chat-api -- tests/cli/slack-consent-cli.test.ts
  ```
- [ ] **Step 5 (Commit):**
  ```sh
  git add apps/chat-api/src/config/slack-policy-runtime.ts apps/chat-api/src/cli/slack-consent.ts apps/chat-api/tests/cli/slack-consent-cli.test.ts
  git commit -m "feat(slack): add operator CLI for trusted provider and organization consent management"
  ```

---

### Task 3: Fail-Closed Policy Resolution Service (`resolveSlackModelPolicy`)

**Files:**
- Create: `apps/chat-api/src/services/slack/policy-service.ts`
- Create: `apps/chat-api/tests/services/slack-policy-service.test.ts`

- [ ] **Step 1 (Test RED):** Viết test trong `apps/chat-api/tests/services/slack-policy-service.test.ts`:
  - Thỏa mãn đủ 6 tiêu chí: connection active, consent granted, evidence hợp lệ, provider verified & noTraining, purpose được cấp phép, requestedRetention <= maxRetention -> trả về decision `allowed: true` kèm policy reference (không chứa credentials).
  - Không có consent hoặc consent `pending` -> `allowed: false`, reason `consent_not_granted`.
  - Consent bị `revoked` -> `allowed: false`, reason `consent_revoked`.
  - Provider chưa `verified` hoặc `noTraining = false` -> `allowed: false`, reason `provider_untrusted`.
  - Runtime fingerprint không khớp -> `allowed: false`, reason `provider_configuration_mismatch`.
  - Purpose không nằm trong `authorizedPurposes` -> `allowed: false`, reason `purpose_unauthorized`.
  - Requested retention > maxRetention -> `allowed: false`, reason `retention_limit_exceeded`.
  - Binding lệch user/actor/workspace -> `allowed: false`, reason `binding_invalid`.
- [ ] **Step 2:** Chạy test xác nhận lỗi đỏ:
  ```sh
  npm test -w @wap/chat-api -- tests/services/slack-policy-service.test.ts
  ```
- [ ] **Step 3 (Implement GREEN):** Cài đặt `SlackPolicyService` và hàm `resolveSlackModelPolicy`.
- [ ] **Step 4:** Chạy lại test xác nhận xanh:
  ```sh
  npm test -w @wap/chat-api -- tests/services/slack-policy-service.test.ts
  ```
- [ ] **Step 5 (Commit):**
  ```sh
  git add apps/chat-api/src/services/slack/policy-service.ts apps/chat-api/tests/services/slack-policy-service.test.ts
  git commit -m "feat(slack): add fail-closed policy resolution service for model processing"
  ```

---

### Task 4: Dynamic Metadata Readiness & Compatibility Boundary

**Files:**
- Modify: `apps/chat-api/src/db/repositories/slack-connection-repo.ts`
- Modify: `apps/chat-api/src/routes/connections/slack.ts`
- Create: `apps/chat-api/tests/routes/slack-compatibility.test.ts`

- [ ] **Step 1 (Test RED):** Viết test trong `apps/chat-api/tests/routes/slack-compatibility.test.ts`:
  - `GET /api/connections/myslack` trả về envelope `{ connections: SlackConnectionPublicInfo[] }` vượt qua validator `validateSlackConnectionPublicInfo` của `@wap/tool-schemas`.
  - Phản hồi chứa các trường canonical (`slackUserId`, `slackUserLabel`, `consentStatus`, `processingReady`, `scopes`, `identityVersion`).
  - Phản hồi bảo toàn các trường an toàn cho UI hiện hữu (`actorId`, `missingScopes`, `processingStatus: processingReady ? 'ready' : 'pending'`).
  - Kiểm tra không có HTTP route nào cho phép mutate consent hoặc provider (các lệnh POST/PUT đều trả về 404).
  - Kiểm tra không rò rỉ access token, refresh token hay credentials.
- [ ] **Step 2:** Chạy test xác nhận lỗi đỏ:
  ```sh
  npm test -w @wap/chat-api -- tests/routes/slack-compatibility.test.ts
  ```
- [ ] **Step 3 (Implement GREEN):** Cập nhật `SlackConnectionRepo` và router `/api/connections/myslack`.
- [ ] **Step 4:** Chạy lại test xác nhận xanh:
  ```sh
  npm test -w @wap/chat-api -- tests/routes/slack-compatibility.test.ts
  ```
- [ ] **Step 5 (Commit):**
  ```sh
  git add apps/chat-api/src/db/repositories/slack-connection-repo.ts apps/chat-api/src/routes/connections/slack.ts apps/chat-api/tests/routes/slack-compatibility.test.ts
  git commit -m "feat(slack): integrate dynamic processingReady and maintain 02A compatibility boundary"
  ```

---

### Task 5: Verification & Full Suite Sanity Gate

**Files:**
- Modify: `docs/handoff/tasks/SLACK-02B-oauth-backend.md`
- Create: `docs/handoff/log/2026-10-29-slack-02b-consent-backend.md`

- [ ] **Step 1:** Chạy typecheck: `npm run typecheck` (exit code 0).
- [ ] **Step 2:** Chạy targeted tests: `npm test -w @wap/chat-api` (exit code 0).
- [ ] **Step 3:** Chạy existing Slack foundation tests: `npm run test:slack:foundation` (exit code 0).
- [ ] **Step 4:** Cập nhật kết quả vào task card `docs/handoff/tasks/SLACK-02B-oauth-backend.md` và tạo file log `docs/handoff/log/2026-10-29-slack-02b-consent-backend.md`.
- [ ] **Step 5 (Commit):**
  ```sh
  git add docs/handoff/tasks/SLACK-02B-oauth-backend.md docs/handoff/log/2026-10-29-slack-02b-consent-backend.md docs/superpowers/plans/2026-10-29-slack-02b-consent-backend.md
  git commit -m "docs(slack): record completion of SLACK-02B consent backend"
  ```
