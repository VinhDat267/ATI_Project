# Slack Personal Connection Backend: Organization Consent (F1) & Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện tầng backend cho SLACK-02B tập trung vào thiết lập ranh giới chính sách chấp thuận của tổ chức (F1 Organization Consent), lưu trữ và kiểm định nhà cung cấp mô hình tin cậy (Trusted Providers), tính toán metadata sẵn sàng xử lý (`processingReady`), cung cấp giao diện vòng đời (lifecycle/purge event) cho Phase 3, và hợp nhất tương thích với nền tảng OAuth hiện hữu từ PR #184 và bản sửa lỗi cô lập callback 02R.

**Architecture:**
- Kế thừa và tái sử dụng bảng `slack_connections` và `slack_oauth_states` từ PR #184 (`ac448dd`) kết hợp bản sửa lỗi cô lập callback 02R (`0015_slack_callback_order.sql`). Không tạo migration 0014 trùng lặp.
- Bổ sung migration đề xuất `0016_slack_processing_consents.sql` tạo 2 bảng `slack_processing_consents` (lưu vết bằng chứng đại diện tổ chức, `policy_version`, thời hạn lưu trữ `retention_days`) và `slack_trusted_providers` (cấu hình nhà cung cấp tin cậy, cờ `verified`, `no_training`, trần lưu trữ `max_retention_days`).
- Phân tầng bảo mật nghiêm ngặt: Thành viên thường và request body từ client không thể tự tạo lòng tin hoặc tự nhận `noTraining`. Chỉ Quản trị viên/Operator tin cậy (kiểm tra `users.role = 'admin'` và `auth_sessions` hợp lệ trực tiếp từ DB) mới được phép thiết lập hoặc thu hồi chấp thuận tổ chức và cấu hình nhà cung cấp tin cậy qua Admin API (`/api/admin/connections/myslack/...`) hoặc Operator CLI (`apps/chat-api/src/cli/slack-consent.ts`).
- Cung cấp lớp ánh xạ tương thích (compatibility boundary) giữa các trường hiện tại (`actor_id`, `status='disconnected'`) sang hợp đồng chuẩn 02A (`slackUserId`, `status='revoked'`) và xuất capability qua `GET /api/services` (`personalOAuth: ['myslack']`).

**Tech Stack:** Node.js `^22.12.0 || >=24.0.0`, TypeScript 5.8, Express 5.2.1, PostgreSQL 16 (`pg.Pool`), Vitest 4.
**Spec:** [Slack cá nhân và trợ lý công việc trong ATI](../specs/2026-10-28-slack-personal-oauth-design.md) (mục 4, 8, 9, 10).
**Hợp đồng chuẩn tắc:** [`packages/tool-schemas/src/myslack-connection.ts`](../../packages/tool-schemas/src/myslack-connection.ts) (SLACK-02A).

---

## Global Constraints

1. **Bắt buộc `policyVersion`:** `policyVersion` là chuỗi ký tự non-blank bắt buộc trên mọi bản ghi consent. Không có `policyVersion`, cơ chế phát hiện thay đổi chính sách F1 sẽ không hoạt động.
2. **Cho phép `retentionDays >= 0`:** Giá trị `retentionDays = 0` là hoàn toàn hợp lệ (đại diện cho chính sách không lưu trữ dữ liệu sau xử lý). Từ chối số âm, số thập phân, NaN và Infinity.
3. **Phân biệt điều kiện theo trạng thái:** Trạng thái `pending` không yêu cầu evidence (`evidenceRef`, `authorizedBy`, `grantedAt`); trạng thái `granted` bắt buộc có đầy đủ cả 3 trường và định dạng ngày ISO-8601 UTC hợp lệ. Nếu trường tùy chọn được cung cấp sai kiểu/blank, bắt buộc ném lỗi `TypeError` thay vì bỏ qua âm thầm.
4. **Kiểm tra quyền quản trị trực tiếp từ Database:** Quản trị viên thực hiện thao tác ủy quyền tổ chức bắt buộc phải được re-validate trực tiếp trong DB (`SELECT id FROM users WHERE id=$1 AND role='admin' AND status='active'`) và kiểm tra phiên hoạt động không bị thu hồi trong `auth_sessions`.
5. **Cơ chế sẵn sàng xử lý (`processingReady`) fail-closed:** `processingReady === true` chỉ được thiết lập khi thỏa mãn đồng thời 6 tiêu chí: (1) kết nối `active`, (2) consent `granted`, (3) có đủ bằng chứng ủy quyền hợp lệ, (4) provider ID khớp, (5) provider có `verified === true` và `noTraining === true`, (6) `retentionDays <= maxRetentionDays`. Bất kỳ vi phạm nào đều đưa về `false`.
6. **Không cấp quyền runtime qua việc chọn model builder:** Lựa chọn builder model trong chat UI không tự cấp quyền cho dữ liệu Slack tới bất kỳ runtime provider nào. Dữ liệu Slack chỉ được đưa vào model khi có chấp thuận tổ chức hợp lệ tại thời điểm thực thi.
7. **Ranh giới module:** SLACK-02B chỉ sở hữu `apps/chat-api/`, `db/v3/` và scripts/fixtures liên quan. Tuyệt đối không can thiệp frontend (`apps/chat-web`) hay sửa đổi schema contracts (`packages/tool-schemas`).

---

## Review Focus

1. **Attempt tự cấp quyền từ thành viên thường:** Một user có `role = 'member'` gửi request API hoặc chèn cờ `noTraining: true` vào request body. *Kỳ vọng:* Hệ thống từ chối bằng 403 `ADMIN_REQUIRED`, không có thay đổi nào trong bảng consent hoặc trusted providers.
2. **Xung đột phiên bản chính sách F1 (Stale Policy Version):** Khi tổ chức cập nhật thỏa thuận mới (`policyVersion` từ `'v1'` lên `'v2'`), các luồng cũ sử dụng `'v1'` phải bị từ chối truy cập dữ liệu cho model (`policy_changed`).
3. **Xoay hoặc thu hồi chấp thuận (Consent Revocation):** Khi Admin thu hồi chấp thuận của workspace, `processingReady` lập tức chuyển về `false`, và phát ra sự kiện vòng đời để Phase 3 biết xóa cache / bộ nhớ đệm tin nhắn.
4. **Tương thích ngược dữ liệu (Compatibility Boundary):** Các bản ghi kết nối hiện hữu có `actor_id` và `status = 'disconnected'` trong database phải được API ánh xạ chính xác sang `slackUserId` và `status = 'revoked'` cho consumers chuẩn 02A, đồng thời vẫn bảo toàn trường cũ cho client hiện tại.
5. **An toàn bảo mật & Che giấu bí mật:** Mọi log audit, API response và exception message tuyệt đối không chứa access token, refresh token hay credentials của Slack.

---

## File Structure & Module Ownership

| File | Module Ownership | Trách Nhiệm Kỹ Thuật |
|---|---|---|
| `db/v3/0016_slack_processing_consents.sql` | Backend | Migration tạo bảng `slack_processing_consents` và `slack_trusted_providers` |
| `apps/chat-api/src/db/repositories/slack-consent-repo.ts` | Backend | Repository quản lý consent tổ chức, tra cứu trusted providers và kiểm tra CAS |
| `apps/chat-api/src/config/slack-policy-env.ts` | Backend | Đọc cấu hình danh sách provider tin cậy mặc định từ môi trường máy chủ |
| `apps/chat-api/src/cli/slack-consent.ts` | Backend | CLI cho Operator thiết lập bằng chứng chấp thuận tổ chức trong môi trường vận hành |
| `apps/chat-api/src/routes/connections/slack-admin.ts` | Backend | Router Express 5.2.1 cho các thao tác quản trị consent với DB session revalidation |
| `apps/chat-api/src/services/slack/consent-lifecycle.ts` | Backend | Interface sự kiện vòng đời (lifecycle / purge event) sẵn sàng cho Phase 3 |
| `apps/chat-api/src/routes/connections/slack.ts` | Backend (Modify) | Tích hợp tính toán dynamic `processingReady` và compatibility mapping vào endpoint danh sách |
| `apps/chat-api/tests/db/slack-consent-repo.test.ts` | Backend | Test repository consent trên PostgreSQL thật (grant, revoke, stale version, zero retention) |
| `apps/chat-api/tests/routes/slack-admin-consent.test.ts` | Backend | Test phân quyền Admin routes, CSRF, từ chối member thường, audit logging |
| `apps/chat-api/tests/cli/slack-consent-cli.test.ts` | Backend | Test lệnh CLI operator cấp và thu hồi chấp thuận |
| `apps/chat-api/tests/routes/slack-compatibility.test.ts` | Backend | Test lớp ánh xạ tương thích giữa schema DB (`actor_id`) và canonical DTO (`slackUserId`) |

---

## Detailed Task Breakdown

### Task 1: Database Migration 0016 & Consent Repository (PostgreSQL)

**Files:**
- Create: `db/v3/0016_slack_processing_consents.sql`
- Create: `apps/chat-api/src/db/repositories/slack-consent-repo.ts`
- Create: `apps/chat-api/tests/db/slack-consent-repo.test.ts`

**Database Schema (`0016_slack_processing_consents.sql`):**
```sql
-- Migration 0016: F1 Organization Consent and Trusted Providers for Slack
CREATE TABLE IF NOT EXISTS slack_trusted_providers (
  id text PRIMARY KEY,
  name text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  no_training boolean NOT NULL DEFAULT false,
  max_retention_days integer NOT NULL DEFAULT 0 CHECK (max_retention_days >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS slack_processing_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id text NOT NULL,
  provider_id text NOT NULL REFERENCES slack_trusted_providers(id) ON DELETE RESTRICT,
  policy_version text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'granted', 'revoked')),
  retention_days integer NOT NULL DEFAULT 0 CHECK (retention_days >= 0),
  evidence_ref text,
  authorized_by text,
  granted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, provider_id),
  CHECK (status <> 'granted' OR (evidence_ref IS NOT NULL AND authorized_by IS NOT NULL AND granted_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_slack_processing_consents_lookup
  ON slack_processing_consents(workspace_id, provider_id);
```

**Repository Interface (`slack-consent-repo.ts`):**
```ts
export interface GrantConsentInput {
  workspaceId: string;
  providerId: string;
  policyVersion: string;
  retentionDays: number;
  evidenceRef: string;
  authorizedBy: string;
}

export interface RevokeConsentInput {
  workspaceId: string;
  providerId: string;
  revokedBy: string;
  reason?: string;
}

export class SlackConsentRepo {
  constructor(private readonly pool: pg.Pool) {}
  async getConsent(workspaceId: string, providerId: string): Promise<SlackProcessingConsentInfo | null>;
  async listConsentsForWorkspace(workspaceId: string): Promise<SlackProcessingConsentInfo[]>;
  async grantConsent(input: GrantConsentInput): Promise<SlackProcessingConsentInfo>;
  async revokeConsent(input: RevokeConsentInput): Promise<SlackProcessingConsentInfo | null>;
  async getTrustedProvider(providerId: string): Promise<TrustedProviderInfo | null>;
  async upsertTrustedProvider(provider: TrustedProviderInfo): Promise<void>;
}
```

- [ ] **Step 1 (Test RED):** Viết unit & integration tests trong `apps/chat-api/tests/db/slack-consent-repo.test.ts` trên in-memory/real PostgreSQL:
  - Cấp chấp thuận hợp lệ với `retentionDays = 0` và lưu vết đầy đủ evidence.
  - Từ chối cấp chấp thuận nếu `policyVersion` rỗng hoặc provider chưa được đăng ký.
  - Thu hồi chấp thuận: cập nhật `status = 'revoked'` và ghi nhận `revoked_at`.
- [ ] **Step 2:** Chạy test xác nhận lỗi đỏ:
  ```sh
  npm test -w @wap/chat-api -- tests/db/slack-consent-repo.test.ts
  ```
- [ ] **Step 3 (Implement GREEN):** Cài đặt migration `0016_slack_processing_consents.sql` và class `SlackConsentRepo`.
- [ ] **Step 4:** Chạy lại test xác nhận xanh:
  ```sh
  npm test -w @wap/chat-api -- tests/db/slack-consent-repo.test.ts
  ```
- [ ] **Step 5 (Commit):**
  ```sh
  git add db/v3/0016_slack_processing_consents.sql apps/chat-api/src/db/repositories/slack-consent-repo.ts apps/chat-api/tests/db/slack-consent-repo.test.ts
  git commit -m "feat(slack): add organization consent repository and migration 0016"
  ```

---

### Task 2: Trusted Provider Policy Configuration & Operator CLI

**Files:**
- Create: `apps/chat-api/src/config/slack-policy-env.ts`
- Create: `apps/chat-api/src/cli/slack-consent.ts`
- Create: `apps/chat-api/tests/cli/slack-consent-cli.test.ts`

**Nội dung Kỹ thuật:**
- `slack-policy-env.ts`: Đọc danh sách provider mặc định từ biến môi trường máy chủ (ví dụ `SLACK_TRUSTED_PROVIDERS_JSON` hoặc defaults server-side). Không cho phép client qua HTTP sửa cấu hình provider mà không có quyền vận hành.
- `slack-consent.ts` (CLI):
  - Lệnh: `node --env-file=.env --import tsx apps/chat-api/src/cli/slack-consent.ts grant --workspace <T...> --provider <id> --policy <ver> --retention <days> --evidence <ref> --by <operator>`
  - Lệnh: `node --env-file=.env --import tsx apps/chat-api/src/cli/slack-consent.ts revoke --workspace <T...> --provider <id> --by <operator>`
  - Lệnh: `node --env-file=.env --import tsx apps/chat-api/src/cli/slack-consent.ts list --workspace <T...>`
  - Xác thực đầu vào chặt chẽ qua validator `validateSlackProcessingConsentInfo` từ `@wap/tool-schemas`.

- [ ] **Step 1 (Test RED):** Viết test cho CLI trong `apps/chat-api/tests/cli/slack-consent-cli.test.ts`:
  - Thực thi CLI với tham số hợp lệ -> bản ghi DB được tạo/cập nhật.
  - Thực thi thiếu tham số bắt buộc hoặc sai định dạng date/version -> CLI exit code 1 và in thông báo lỗi rõ ràng.
- [ ] **Step 2:** Chạy test xác nhận lỗi đỏ:
  ```sh
  npm test -w @wap/chat-api -- tests/cli/slack-consent-cli.test.ts
  ```
- [ ] **Step 3 (Implement GREEN):** Cài đặt CLI script và cấu hình policy env.
- [ ] **Step 4:** Chạy lại test xác nhận xanh:
  ```sh
  npm test -w @wap/chat-api -- tests/cli/slack-consent-cli.test.ts
  ```
- [ ] **Step 5 (Commit):**
  ```sh
  git add apps/chat-api/src/config/slack-policy-env.ts apps/chat-api/src/cli/slack-consent.ts apps/chat-api/tests/cli/slack-consent-cli.test.ts
  git commit -m "feat(slack): add operator CLI and server policy configuration"
  ```

---

### Task 3: Admin Consent API Routes với Revalidation Quyền từ Database

**Files:**
- Create: `apps/chat-api/src/routes/connections/slack-admin.ts`
- Modify: `apps/chat-api/src/app.ts` (mount admin routes khi cờ `MYSLACK_ENABLED` bật)
- Create: `apps/chat-api/tests/routes/slack-admin-consent.test.ts`

**Endpoints:**
1. `GET /api/admin/connections/myslack/:workspaceId/consents`:
   - Yêu cầu xác thực phiên và kiểm tra `isAdmin(req.user, options.adminUserIds)` cùng revalidation trực tiếp từ bảng `users`.
   - Trả về danh sách consents của workspace.
2. `POST /api/admin/connections/myslack/:workspaceId/consent`:
   - Body: `{ providerId: string, policyVersion: string, retentionDays: number, evidenceRef: string }`.
   - Revalidate DB: `SELECT id FROM users WHERE id=$1 AND role='admin' AND status='active'`. Nếu không phải -> 403 `ADMIN_REQUIRED`.
   - Validate body với `@wap/tool-schemas`.
   - Ghi nhận `authorizedBy = req.user.email`.
   - Ghi audit log qua console/logger: `{ event: 'slack_consent_granted', workspaceId, providerId, policyVersion, actorId }`.
3. `POST /api/admin/connections/myslack/:workspaceId/consent/revoke`:
   - Body: `{ providerId: string, reason?: string }`.
   - Revalidate DB admin session.
   - Ghi audit log: `{ event: 'slack_consent_revoked', workspaceId, providerId, actorId }`.

- [ ] **Step 1 (Test RED):** Viết integration test HTTP trong `apps/chat-api/tests/routes/slack-admin-consent.test.ts`:
  - Request không có session hoặc token hết hạn -> 401 Unauthorized.
  - User có role `'member'` cố gắng gọi POST consent -> 403 `ADMIN_REQUIRED`.
  - User có role `'admin'` trong token nhưng đã bị vô hiệu hóa trong DB (`status = 'disabled'`) -> 403 `ADMIN_REQUIRED`.
  - Admin hợp lệ cấp và thu hồi consent thành công.
- [ ] **Step 2:** Chạy test xác nhận lỗi đỏ:
  ```sh
  npm test -w @wap/chat-api -- tests/routes/slack-admin-consent.test.ts
  ```
- [ ] **Step 3 (Implement GREEN):** Cài đặt `slack-admin.ts` và gắn vào `app.ts`.
- [ ] **Step 4:** Chạy lại test xác nhận xanh:
  ```sh
  npm test -w @wap/chat-api -- tests/routes/slack-admin-consent.test.ts
  ```
- [ ] **Step 5 (Commit):**
  ```sh
  git add apps/chat-api/src/routes/connections/slack-admin.ts apps/chat-api/src/app.ts apps/chat-api/tests/routes/slack-admin-consent.test.ts
  git commit -m "feat(slack): add admin consent routes with database role revalidation"
  ```

---

### Task 4: Dynamic Metadata Readiness (`processingReady`) & Compatibility Mapping

**Files:**
- Modify: `apps/chat-api/src/db/repositories/slack-connection-repo.ts`
- Modify: `apps/chat-api/src/routes/connections/slack.ts`
- Create: `apps/chat-api/tests/routes/slack-compatibility.test.ts`

**Quy tắc Tính toán `processingReady`:**
Khi API `GET /api/connections/myslack` (hoặc legacy `GET /api/connections/slack`) trả về danh sách kết nối:
1. Đọc danh sách kết nối từ `slack_connections` của user.
2. Với mỗi kết nối, tra cứu consent tương ứng trong `slack_processing_consents` (dựa trên `workspace_id`).
3. Nếu tìm thấy consent có `status = 'granted'`:
   - Tra cứu cấu hình provider trong `slack_trusted_providers`.
   - Kiểm tra đồng thời:
     - `connection.status === 'active'`
     - `consent.status === 'granted'`
     - `consent.evidence_ref` và `consent.authorized_by` non-blank, `granted_at` hợp lệ
     - `provider.verified === true` AND `provider.no_training === true`
     - `consent.retention_days <= provider.max_retention_days`
   - Nếu thỏa mãn toàn bộ -> `processingReady = true`. Ngược lại -> `processingReady = false`.
4. Nếu không có consent hoặc consent ở trạng thái `'pending'` / `'revoked'` -> `consentStatus = consent?.status ?? 'pending'`, `processingReady = false`.

**Lớp Ánh xạ Tương thích (Compatibility Mapping Boundary):**
Để bảo đảm mã nguồn UI và test hiện có từ PR #184 tiếp tục hoạt động mà không bị gãy trước khi 02C cập nhật:
- Đối tượng trả về của từng connection chứa cả 2 trường:
  - Canonical (cho 02A/02C):
    - `slackUserId`: giá trị của `actor_id`
    - `status`: nếu DB là `'disconnected'` thì chuyển thành `'revoked'`, còn lại giữ nguyên
    - `consentStatus`: trạng thái consent tính toán được
    - `processingReady`: boolean tính toán được
  - Legacy (tương thích tạm thời):
    - `actorId`: giá trị của `actor_id`
    - `status`: giữ nguyên giá trị gốc trong DB nếu consumer cũ đọc

- [ ] **Step 1 (Test RED):** Viết test trong `apps/chat-api/tests/routes/slack-compatibility.test.ts`:
  - Kiểm tra `GET /api/connections/myslack` trả về envelope chuẩn `{ connections: SlackConnectionPublicInfo[] }` thỏa mãn validator 02A.
  - Kết nối active nhưng chưa có consent -> `processingReady: false`, `consentStatus: 'pending'`.
  - Kết nối active có consent granted nhưng provider có `verified: false` -> `processingReady: false`, `consentStatus: 'granted'`.
  - Kết nối active có consent granted và provider verified -> `processingReady: true`.
  - Kết nối revoked/disconnected -> `processingReady: false`.
  - Kiểm tra các trường legacy (`actorId`) vẫn hiện diện để không làm hỏng tests hiện hữu.
- [ ] **Step 2:** Chạy test xác nhận lỗi đỏ:
  ```sh
  npm test -w @wap/chat-api -- tests/routes/slack-compatibility.test.ts
  ```
- [ ] **Step 3 (Implement GREEN):** Cập nhật repo và router với logic tính toán readiness và ánh xạ tương thích.
- [ ] **Step 4:** Chạy lại test xác nhận xanh:
  ```sh
  npm test -w @wap/chat-api -- tests/routes/slack-compatibility.test.ts
  ```
- [ ] **Step 5 (Commit):**
  ```sh
  git add apps/chat-api/src/db/repositories/slack-connection-repo.ts apps/chat-api/src/routes/connections/slack.ts apps/chat-api/tests/routes/slack-compatibility.test.ts
  git commit -m "feat(slack): calculate dynamic processingReady and maintain compatibility boundary"
  ```

---

### Task 5: Lifecycle & Purge Event Interface cho Phase 3

**Files:**
- Create: `apps/chat-api/src/services/slack/consent-lifecycle.ts`
- Create: `apps/chat-api/tests/services/slack-consent-lifecycle.test.ts`

**Nội dung Kỹ thuật:**
- Cung cấp event bus / listener interface nội bộ để khi một chấp thuận bị thu hồi hoặc hết hạn thời gian lưu trữ (`retentionDays` timeout):
  ```ts
  export interface SlackConsentChangeEvent {
    workspaceId: string;
    providerId: string;
    policyVersion: string;
    previousStatus: SlackConsentStatus;
    newStatus: SlackConsentStatus;
    changedAt: string;
    reason: 'admin_revocation' | 'retention_expired' | 'connection_revoked';
  }

  export type SlackPurgeListener = (event: SlackConsentChangeEvent) => Promise<void>;

  export class SlackConsentLifecycleService {
    subscribe(listener: SlackPurgeListener): () => void;
    async emitConsentChange(event: SlackConsentChangeEvent): Promise<void>;
  }
  ```
- Đây là Seam chuẩn giao tiếp giữa 02B và 03: Phase 3 sẽ đăng ký listener để xóa bộ nhớ đệm tin nhắn (purge cached sources) khi nhận được event thu hồi, bảo đảm không rò rỉ dữ liệu ngoài ranh giới cho phép.

- [ ] **Step 1 (Test RED):** Viết unit test trong `apps/chat-api/tests/services/slack-consent-lifecycle.test.ts`:
  - Listener nhận đúng payload khi consent bị thu hồi.
  - Lỗi phát sinh trong listener không làm sập transaction của repo chính.
- [ ] **Step 2:** Chạy test xác nhận lỗi đỏ:
  ```sh
  npm test -w @wap/chat-api -- tests/services/slack-consent-lifecycle.test.ts
  ```
- [ ] **Step 3 (Implement GREEN):** Cài đặt `consent-lifecycle.ts`.
- [ ] **Step 4:** Chạy lại test xác nhận xanh:
  ```sh
  npm test -w @wap/chat-api -- tests/services/slack-consent-lifecycle.test.ts
  ```
- [ ] **Step 5 (Commit):**
  ```sh
  git add apps/chat-api/src/services/slack/consent-lifecycle.ts apps/chat-api/tests/services/slack-consent-lifecycle.test.ts
  git commit -m "feat(slack): define consent lifecycle and purge event interface for Phase 3"
  ```

---

### Task 6: Kiểm Thử Toàn Diện & Verification Operational Gates

**Mục tiêu:** Thẩm định toàn diện hệ thống backend sau khi tích hợp:
1. **Kiểm tra Concurrency & PostgreSQL CAS:** Chạy các bài test PostgreSQL thật kiểm chứng không race condition khi 2 admin thao tác consent đồng thời.
2. **Kiểm tra AbortSignal & Network Timeout:** Đảm bảo mọi request gọi ra ngoài đều có finite timeout `AbortSignal`.
3. **Kiểm tra Che Giấu Secret (Secret Redaction):** Quét toàn bộ log xuất ra từ API và repo, xác nhận không có chuỗi nào khớp pattern `xoxp-`, `xoxr-` hoặc client secret.
4. **Kiểm tra Hồi Quy Toàn Bộ Hệ Thống:**
   - Chạy lệnh kiểm tra type chuẩn: `npm run typecheck` (exit code 0).
   - Chạy toàn bộ test foundation: `npm run test:slack:foundation` (exit code 0).
   - Chạy test suites backend: `npm test -w @wap/chat-api` (exit code 0).
5. **Kiểm tra Định dạng & Whitespace:**
   - `git diff --check docs/slack-02b-consent` đạt 0 lỗi trailing whitespace.

---

## Unresolved Interface Choices & Leader Decisions

1. **Vị trí Lưu Trữ Cấu Hình Provider Tin Cậy (Database Table vs Env File):**
   - *Đề xuất:* Lưu trong bảng `slack_trusted_providers` (với migration 0016) và nạp seed mặc định từ cấu hình máy chủ lúc khởi động. Điều này giúp kiểm soát trần retention và cờ `noTraining` nhất quán qua SQL query, tránh phụ thuộc vào việc parse JSON string trong biến môi trường.
2. **Xử lý Tương thích Trường `status` Trong Database:**
   - Database `slack_connections` hiện hữu dùng `'disconnected'`, trong khi hợp đồng 02A dùng `'revoked'`.
   - *Đề xuất:* Giữ nguyên schema database hiện tại để tránh can thiệp phá vỡ PR #184, xử lý chuyển đổi `'disconnected'` -> `'revoked'` ngay tại tầng Repository và Router khi trả ra API công khai.
3. **Phân Quyền CLI Operator:**
   - *Đề xuất:* Script `apps/chat-api/src/cli/slack-consent.ts` chạy trực tiếp qua `node --env-file=.env --import tsx ...` với quyền truy cập trực tiếp PostgreSQL connection string, đại diện cho vai trò Root Operator trong hạ tầng triển khai.
