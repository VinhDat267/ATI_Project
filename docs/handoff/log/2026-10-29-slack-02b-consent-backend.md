# 29/10/2026 · SLACK-02B — Backend Chấp thuận Tổ chức (F1), Provider Attestation, Dynamic Readiness & Tương thích 02A

**Tác giả:** Backend Owner (Antigravity gemini-3.8-flash-high).
**Ủy quyền:** Điều phối viên trưởng/Leader ủy quyền theo [Quyết định SLACK-02B ngày 29/10/2026](../decisions/2026-10-29-slack-02b-consent-decisions.md).
**Nhánh công việc:** `feat/slack-02b-consent-backend` (base: `integration/slack-personal-20261029`).
**Task card:** [`docs/handoff/tasks/SLACK-02B-oauth-backend.md`](../tasks/SLACK-02B-oauth-backend.md).
**Implementation Plan:** [`docs/superpowers/plans/2026-10-29-slack-02b-consent-backend.md`](../../superpowers/plans/2026-10-29-slack-02b-consent-backend.md).

---

## 1. Ranh giới Kiến trúc & Quyết định của Leader (Decisions Alignment)

Tuân thủ nghiêm ngặt toàn bộ quyết định của Leader tại `docs/handoff/decisions/2026-10-29-slack-02b-consent-decisions.md`:
1. **Ranh giới ủy quyền tin cậy (Trusted Boundary):** KHÔNG tạo bất kỳ HTTP endpoints nào để thiết lập lòng tin (provider attestation hay organization consent). Trình duyệt của thành viên thường hay request body từ client không thể tự phong `noTraining` hoặc tự cấp quyền. Mọi thao tác ủy quyền được thực hiện qua **Operator CLI** (`apps/chat-api/src/cli/slack-consent.ts`) yêu cầu quyền truy cập DB/hạ tầng trực tiếp. Các request HTTP cố tình mutate consent hoặc provider đều trả về 404 và không làm thay đổi chính sách.
2. **Persistence & Monotonic Revisions:** Bổ sung migration `db/v3/0016_slack_processing_consents.sql` tạo 3 bảng (`slack_trusted_providers`, `slack_processing_consents`, `slack_policy_events`). Áp dụng monotonic revision và CAS (`expectedRevision`) trên toàn bộ các thao tác `attestProvider`, `grantConsent`, `revokeConsent`.
3. **Data Retention TTL:** `retentionDays` kiểm soát thời hạn lưu trữ dữ liệu sau xử lý, KHÔNG phải ngày hết hạn của consent. `retentionDays = 0` hoàn toàn hợp lệ (cho phép xử lý thời gian thực mà không lưu bản sao) và không tự động thu hồi consent.
4. **Sự kiện thay đổi chính sách bền vững (Durable Policy Events):** Mọi thao tác grant, revoke, update provider đều commit atomically 1 bản ghi vào `slack_policy_events` trong cùng transaction DB để phục vụ Phase 3 (SLACK-03) xóa cache/tombstone.
5. **Runtime Policy & Fail-Closed Gate:** `resolveSlackModelPolicy` thẩm định fail-closed 6 tiêu chí dựa trên runtime configuration fingerprint (SHA-256 không chứa bí mật). Bất kỳ thay đổi cấu hình runtime (model/endpoint) nào cũng tự động vô hiệu hóa chứng thực cũ cho đến khi được re-attest.
6. **Tương thích chuẩn tắc 02A:** Endpoint `/api/connections/myslack` trả về envelope chuẩn `{ connections: SlackConnectionPublicInfo[] }` thỏa mãn 100% validator 02A (`validateSlackConnectionPublicInfo`), đồng thời bảo toàn an toàn các alias legacy (`actorId`, `processingStatus`) để UI và tests hiện hữu từ PR #184 và 02R không bị ảnh hưởng.

---

## 2. Mã Nguồn Triển Khai (Source Implementation)

1. **`db/v3/0016_slack_processing_consents.sql`:**
   - `slack_trusted_providers`: lưu cấu hình provider tin cậy, cờ `verified`, `no_training`, trần `max_retention_days`, `configuration_fingerprint`, `revision bigint`, `evidence_ref`, `verified_by`, `verified_at`. CHECK constraint: nếu verified=true thì bắt buộc no_training=true và có đủ bằng chứng.
   - `slack_processing_consents`: keyed theo `(workspace_id, provider_id)`, lưu `policy_version`, `revision bigint`, `status`, `purposes text[]`, `retention_days >= 0`, `organization_representative`, `evidence_ref`, `recorded_by`, `granted_at`, `revoked_at`.
   - `slack_policy_events`: lưu vết sự kiện thay đổi chính sách bền vững (`occurred_at DESC`).
2. **`apps/chat-api/src/db/repositories/slack-consent-repo.ts`:**
   - Cung cấp các phương thức `attestProvider`, `grantConsent`, `revokeConsent`, `getConsent`, `listConsentsForWorkspace`, `getTrustedProvider`, `listTrustedProviders`, `listPolicyEvents`.
   - Thực thi CAS concurrency, kiểm tra expectedRevision, commit transaction atomically với policy event.
3. **`apps/chat-api/src/config/slack-policy-runtime.ts`:**
   - Tính toán runtime configuration fingerprint từ `LLM_PROVIDER`, model và normalized endpoint; tuyệt đối không chứa API keys hay credentials.
4. **`apps/chat-api/src/cli/slack-consent.ts`:**
   - Operator CLI hỗ trợ các lệnh `attest-provider`, `grant`, `revoke`, `list` với validation đầy đủ, exit code chuẩn (0/1).
5. **`apps/chat-api/src/services/slack/policy-service.ts`:**
   - `resolveSlackModelPolicy`: kiểm tra 6 tiêu chí fail-closed (`connection_inactive`, `identity_changed`, `consent_missing`, `policy_changed`, `provider_unverified`, `retention_exceeded`).
   - `checkProcessingReady`: tính toán dynamic readiness cho workspace dựa trên cấu hình runtime provider thực tế.
6. **`apps/chat-api/src/routes/connections/slack.ts`:**
   - Tích hợp `SlackPolicyService.checkProcessingReady()` vào `GET /api/connections/myslack`, callback và check endpoint.
   - Ánh xạ `actor_id` -> `slackUserId`, fallback an toàn `slackUserLabel`, mapping `disconnected` -> `revoked`.
7. **`apps/chat-api/package.json`:**
   - Bổ sung npm script `"admin:slack-consent": "tsx src/cli/slack-consent.ts"`.

---

## 3. Bằng chứng Kiểm thử (RED → GREEN Evidence)

| Bộ kiểm thử | Kết quả thực tế | Ghi chú |
|---|---|---|
| `tests/db/slack-consent-repo.test.ts` | **10/10 PASS** (1.27s) | CAS revisions, validation, retention 0, concurrency race 2 luồng, idempotent migration repeat trên non-empty schema |
| `tests/cli/slack-consent-cli.test.ts` | **6/6 PASS** (5.60s) | Spawn process CLI thật, attest, grant, revoke, flags validation, CAS conflict exit 1 |
| `tests/services/slack-policy-service.test.ts` | **8/8 PASS** (1.19s) | 6 tiêu chí fail-closed, fingerprint mismatch, purpose authorization, retention exceeded, checkProcessingReady |
| `tests/routes/slack-compatibility.test.ts` | **3/3 PASS** (1.30s) | 02A canonical envelope validation, dynamic `processingReady`, legacy aliases, HTTP mutation rejected with 404 |
| `tests/db/slack-connection-repo.test.ts` | **8/8 PASS** (2.84s) | 02R callback ordering và isolation tiếp tục hoạt động hoàn hảo |
| `tests/routes/slack-connections.test.ts` | **6/6 PASS** (2.28s) | Setup OAuth routes hiện hữu pass 100% |
| `tests/services/slack-token-manager.test.ts` | **4/4 PASS** (1.72s) | Token manager pass 100% |
| `npm run test:slack:foundation` | **56 Node + 49 Vitest PASS** (105 tests) | Foundation contract và inventory giữ nguyên 100% |
| `npm run typecheck:v3` | **EXIT 0** | Sạch hoàn toàn lỗi TypeScript trên cả chat-api và chat-web |
| Toàn bộ `apps/chat-api` suite | **105 files PASS, 747 tests PASS** (54.05s) | Tăng từ 720 tests lên 747 tests (+27 tests mới) |
| Fullcheck toàn dự án (`npm run check`) | **EXIT 0**: 2.615 v3 tests + 406 eval + 1 launcher + 66 Node = **3.088 tests PASS** | Đạt 100% chất lượng vận hành |
| Whitespace check (`git diff --check`) | **0 lỗi** | Không có trailing whitespace hay conflict marker |

---

## 4. Nguồn gốc Thực thi & Môi trường (Provenance Details)

- **Thư mục làm việc:** `C:\Users\VinhDat\orca\workspaces\ATI_Project\fix-slack-callback-isolation`.
- **Target DB:** `postgresql://ati_v3:<sanitized>@127.0.0.1:55533/ati_v3` (container `ati-slack-review-184-20261029-postgres-1` của reviewer trên port 55533, cô lập qua test schemas).
- **Ranh giới sở hữu:** Chỉ sửa đổi mã nguồn trong `apps/chat-api/`, `db/v3/0016_slack_processing_consents.sql`, plan/task/log. Hoàn toàn không đụng vào `apps/chat-web/`, `packages/tool-schemas/`, `packages/planner/`, `packages/executor/`.
