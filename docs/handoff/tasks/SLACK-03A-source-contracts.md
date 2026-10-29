# SLACK-03A · Hợp đồng Interface Nguồn, ACL, Vòng đời & Siêu Dữ Liệu Công Cụ (@wap/tool-schemas)

**Trạng thái:** HOÀN THÀNH (Đã kiểm thử 100% tests PASS; Chờ Reviewer & Nhóm trưởng nghiệm thu).
**Nhánh công việc:** `VinhDat267/docs-slack-03a-source` · **Nền:** `b757ae0` (từ `integration/slack-personal-20261029`).
**Vai trò sở hữu:** Integration / AI Engineer (chỉ sở hữu thư mục `packages/tool-schemas/`).
**Phụ thuộc:**
- **SLACK-01** (`myslack-context.ts`, `myslack-policy.ts`, fixture HTTP, probe offline) — ĐÃ HOÀN TẤT.
- **SLACK-02A** (`myslack-connection.ts` tại `6871087`) — ĐÃ HOÀN TẤT.
- **SLACK-02R** (Sửa cô lập callback tại PR #190) — ĐÃ CHẤP THUẬN.
- **Cổng Phụ thuộc Backend 02B (Prerequisite Review Gate):** PR #192 (`19e4e39c`) đang được blocking review (hoàn thiện `returnTo` và policy revision matching). Tầng schema 03A tiến hành độc lập để chuẩn hóa giao ước; các tầng tiêu thụ Backend (03B) và Adapter (03C) **bắt buộc có giao diện 02B được chấp thuận (accepted interfaces) và staging base đã được review** (cho phép xếp chồng nhánh đã review, không ép buộc phải merge main ngay).
**Task cha:** [SLACK-03-tool-catalog-and-source-lifecycle](SLACK-03-tool-catalog-and-source-lifecycle.md).
**Kế hoạch chi tiết:** [`docs/superpowers/plans/2026-10-29-slack-03a-source-contracts.md`](../../superpowers/plans/2026-10-29-slack-03a-source-contracts.md).
**Sổ cái kiểm kê 354 methods:** [`docs/superpowers/plans/slack-354-method-ledger.json`](../../superpowers/plans/slack-354-method-ledger.json).

---

## 1. Mục tiêu và Phạm vi Nghiệp vụ

Xây dựng hệ thống hợp đồng giao diện TypeScript và các hàm kiểm thực runtime (validation) chuẩn tắc cho vòng đời dữ liệu nguồn (F3), kiểm soát truy cập ACL/tombstone/purge có phân định 5 tagged scopes tường minh, liên kết định danh phức hợp bất biến không chứa chứng chỉ (F2), tham chiếu chính sách xử lý F1 (`SlackPolicyReference`) với mục đích chuẩn tắc và số thứ tự tăng dần chuẩn tắc, siêu dữ liệu nguồn bounded whitelisted, và siêu dữ liệu công cụ theo phương thức có schema fail-closed trên nền kiểm kê 354 methods (PR 185) trong `@wap/tool-schemas`, trước khi bất kỳ module tiêu thụ nào (Backend 03B, Adapter 03C) được thi công.

### Ranh giới nghiêm ngặt:
1. **Module Ownership:** Chỉ tạo và chỉnh sửa file trong `packages/tool-schemas/`. Tuyệt đối không sửa đổi `apps/`, `packages/tool-adapters/`, `packages/executor/`, `packages/planner/` hoặc `db/v3/`.
2. **Không có Generic Dispatcher:** Nghiêm cấm công cụ gọi tuỳ ý `myslack.call(method, args)` hoặc blanket all-API dispatcher. Mọi tool đều phải có typed schema tham số cố định kiểm tra fail-closed, rủi ro, sideEffect và user scopes cụ thể đối chiếu từ inventory.
3. **Bề mặt công cụ đợt đầu giới hạn (Bounded Core Surface):** 03A chỉ định nghĩa hợp đồng metadata và schema; bề mặt công cụ thi công thực tế đầu tiên sẽ nằm ở 03C (nhóm cốt lõi `conversations`, `chat`, `users`), không đưa toàn bộ 253 method vào một PR.
4. **Cô lập Danh mục Toàn cục:** Tuyệt đối không đăng ký `myslack.*` vào `ALL_TOOLS`, `TOOL_MAP` hay `SERVICE_REGISTRY` trong 03A.
5. **Cách ly Chứng chỉ Tuyệt đối:** Không import cơ sở dữ liệu nội bộ hay token mã hóa; các hàm validator luôn trả về đối tượng tách rời (detached whitelisted copy).
6. **Schemas are Contracts, Not Authority Grants:** Có schema công cụ không đồng nghĩa với quyền thực thi; mọi hành động đều phải qua cổng kiểm tra chính sách và consent của server.

---

## 2. Chi Tiết File và Interface Cần Tạo & Chỉnh Sửa

### 2.1. File Chỉnh Sửa: `packages/tool-schemas/src/myslack-context.ts`
Kế thừa và mở rộng tương thích các hợp đồng nền móng từ SLACK-01 (không tạo shadow duplicate):
1. `type SlackResourceType = 'conversation' | 'message' | 'file' | 'canvas' | 'list' | 'list_item' | 'bookmark' | 'reminder' | 'user' | 'usergroup' | 'subteam';`
2. Cập nhật `SlackSourceRef` sử dụng `SlackResourceType`.
3. `validateSlackSourceRef(input: unknown): SlackSourceRef`: Kiểm thực own property, không rỗng, trả về detached copy, tước bỏ thuộc tính thừa.
4. `formatSlackGlobalResourceKey(workspaceId: string, resourceType: SlackResourceType, resourceId: string): string`: Trả về chuỗi JSON tuple `[workspaceId, resourceType, resourceId]` định danh tài nguyên vật lý chung, ngăn delimiter ambiguity.
5. `formatSlackOwnerSourceKey(ref: SlackSourceRef): string`: Trả về chuỗi JSON tuple mang đầy đủ binding và tài nguyên:
   `[ref.binding.atiUserId, ref.binding.connectionId, ref.binding.workspaceId, ref.binding.slackUserId, ref.binding.identityVersion, ref.resourceType, ref.resourceId, ref.revision]`.
   Bảo đảm 2 người dùng ATI khác nhau cùng xem một tin nhắn trong cùng một workspace có 2 khoá nguồn riêng biệt!

### 2.2. File Chỉnh Sửa: `packages/tool-schemas/src/myslack-policy.ts`
Tái sử dụng và mở rộng trực tiếp policy engine hiện hữu thay vì tạo engine song song:
1. `type SlackPolicyPurpose = 'manual_lookup' | 'triage' | 'planning' | 'digest' | 'storage';` (5 mục đích chuẩn tắc đã thống nhất với Backend 02B).
2. `interface SlackPolicyReference`: Tham chiếu chính sách xử lý bền vững (thỏa thuận với Backend):
   - `binding: SlackBinding;`
   - `purpose: SlackPolicyPurpose;`
   - `requestedRetentionDays: number;`
   - `providerProfileId: string;`
   - `configFingerprint: string;`
   - `policyVersion: string;`
   - `consentRevision: string;` (chuỗi số thập phân dương chuẩn tắc `/^[1-9][0-9]*$/`, e.g. "12")
   - `providerRevision: string;` (chuỗi số thập phân dương chuẩn tắc `/^[1-9][0-9]*$/`)
3. `validateSlackPolicyReference(input: unknown): SlackPolicyReference`: Bác bỏ number, bigint, số 0, số có số 0 ở đầu ("0", "01"), chữ hoặc chuỗi rỗng.
4. `interface SlackSourceStorageRequest`:
   - `binding: SlackBinding;`
   - `policyRef: SlackPolicyReference;`
   - `requestedRetentionDays: number;`
5. `decideSlackSourceStorage(policy: SlackModelPolicy, request: SlackSourceStorageRequest)`:
   - Ủy quyền (delegate/reuse) trực tiếp cho `decideSlackModelUse` để tái sử dụng toàn bộ baseline authorization gates.
   - Kiểm tra `sameSlackBinding(request.binding, request.policyRef.binding)`.
   - Kiểm tra khớp `providerProfileId` và `policyVersion` giữa `policyRef` và `policy`.
   - Kiểm tra `request.policyRef.purpose === 'storage'`.
   - Nếu `request.requestedRetentionDays <= 0` hoặc `policy.consent.retentionDays <= 0` hoặc `request.policyRef.requestedRetentionDays <= 0` -> `{ allowed: false, reason: 'retention_zero_denied' }`.
   - Kiểm tra `request.requestedRetentionDays` là positive safe integer, bị chặn bởi `request.policyRef.requestedRetentionDays`, `policy.consent.retentionDays`, và `policy.provider.maxRetentionDays`.
   - Hợp lệ -> `{ allowed: true, maxRetentionDays: number }`.
   - Lưu ý: Backend runtime bắt buộc revalidate persisted consent/provider revisions và current connection/ACL tại mỗi lần sử dụng; schemas thuần không tự chứng minh được DB freshness.

### 2.3. File Tạo Mới: `packages/tool-schemas/src/myslack-source.ts`
Chứa các định nghĩa và hàm xác thực vòng đời dữ liệu nguồn (F1, F2, F3):
1. `interface SlackSourceMetadata`: Bounded whitelisted metadata:
   - `channelId?: string;`
   - `channelName?: string;`
   - `threadTs?: string;`
   - `authorSlackUserId?: string;`
   - `authorName?: string;`
   - `fileName?: string;`
   - `fileMimeType?: string;`
   - `fileSizeBytes?: number;`
   - `isBotMessage?: boolean;`
2. `validateSlackSourceMetadata(input: unknown): SlackSourceMetadata`: Lọc sạch mọi trường ngoài danh sách whitelist.
3. `interface SlackSourceEntity`: Bắt buộc retain `policyRef: SlackPolicyReference`:
   - `id: string;`
   - `sourceRef: SlackSourceRef;`
   - `policyRef: SlackPolicyReference;`
   - `untrustedContent: string;` (nội dung ngoại vi không đáng tin cậy)
   - `metadata: SlackSourceMetadata;`
   - `observedRevision: string;`
   - `retentionDays: number;`
   - `capturedAt: string;` (ISO 8601 UTC)
   - `expiresAt: string;` (ISO 8601 UTC)
   - `tombstonedAt: string | null;`
   - `purgedAt: string | null;`
4. `validateSlackSourceEntity(input: unknown): SlackSourceEntity`: Xác thực `sameSlackBinding(sourceRef.binding, policyRef.binding)`, `sourceRef.revision === observedRevision`, `retentionDays > 0`.
5. `type SlackDerivedTargetKind = 'chat_history_message' | 'working_memory_entity' | 'plan_step_arg' | 'proposal_excerpt' | 'daily_digest_entry' | 'scheduled_workflow_arg' | 'audit_log_entry';`
6. `interface SlackDerivedCopyRef`: Bắt buộc retain `policyRef: SlackPolicyReference` để phục vụ đối soát purge:
   - `targetKind: SlackDerivedTargetKind;`
   - `targetId: string;`
   - `sourceRefs: SlackSourceRef[];`
   - `policyRef: SlackPolicyReference;`
   - `createdAt: string;`
7. `validateSlackDerivedCopyRef(input: unknown): SlackDerivedCopyRef`
8. `interface SlackSourceLineage`:
   - `ownerSourceKey: string;`
   - `origin: SlackSourceRef;`
   - `policyRef: SlackPolicyReference;`
   - `derivedCopies: SlackDerivedCopyRef[];`
9. `validateSlackSourceLineage(input: unknown): SlackSourceLineage`
10. `type SlackTombstoneReason = 'source_deleted' | 'source_edited' | 'channel_membership_lost' | 'connection_disconnected' | 'app_reinstalled' | 'consent_revoked' | 'retention_expired';`
11. `interface SlackTombstoneRecord`:
    - `sourceRef: SlackSourceRef;`
    - `reason: SlackTombstoneReason;`
    - `tombstonedAt: string;`
    - `purgedAt: string | null;`
12. `validateSlackTombstoneRecord(input: unknown): SlackTombstoneRecord`
13. `type SlackPurgeTarget`: Discriminated union với 5 tagged scopes phân định rành mạch thẩm quyền, triệt tiêu nguy cơ phá dữ liệu chéo người dùng:
    - `{ scope: 'owner_retention'; binding: SlackBinding; resourceType: SlackResourceType; resourceId: string; revision?: string; policyRef: SlackPolicyReference; cascadeTargetKinds: SlackDerivedTargetKind[]; tombstoneReason: 'retention_expired' }` (Hết hạn retention theo đúng chủ sở hữu và chính sách đã cấp, không ảnh hưởng người khác).
    - `{ scope: 'channel_membership_lost'; binding: SlackBinding; channelId: string; cascadeTargetKinds: SlackDerivedTargetKind[]; tombstoneReason: 'channel_membership_lost' }` (Chỉ xoá bản sao của kênh bị mất quyền, giữ nguyên các kênh khác).
    - `{ scope: 'authorization_disconnect'; binding: SlackBinding; cascadeTargetKinds: SlackDerivedTargetKind[]; tombstoneReason: 'connection_disconnected' | 'app_reinstalled' }` (Chỉ xoá bản sao của riêng người ngắt kết nối; bảo toàn người dùng B trong cùng workspace).
    - `{ scope: 'resource_lifecycle'; workspaceId: string; resourceType: SlackResourceType; resourceId: string; revision?: string; cascadeTargetKinds: SlackDerivedTargetKind[]; tombstoneReason: 'source_deleted' | 'source_edited' }` (Xoá bản ghi khi tin/file bị sửa hoặc xoá ở Slack).
    - `{ scope: 'workspace_consent_revocation'; workspaceId: string; policyVersion: string; providerProfileId: string; consentRevision: string; cascadeTargetKinds: SlackDerivedTargetKind[]; tombstoneReason: 'consent_revoked' }` (Xoá toàn bộ nội dung của workspace thuộc đúng policyVersion, providerProfileId và consentRevision; bảo vệ các bản sao được cấp lại dưới revision mới).
14. `validateSlackPurgeTarget(input: unknown): SlackPurgeTarget`

### 2.4. File Tạo Mới: `packages/tool-schemas/src/myslack-tools.ts`
Chứa các định nghĩa siêu dữ liệu công cụ theo từng phương thức với 36 snapshot families chính xác:
1. `type SlackMethodFamily = 'admin' | 'agents' | 'api' | 'apps' | 'assistant' | 'auth' | 'blocks' | 'bookmarks' | 'bots' | 'calls' | 'canvases' | 'chat' | 'conversations' | 'dialog' | 'dnd' | 'emoji' | 'entity' | 'files' | 'functions' | 'migration' | 'oauth' | 'openid' | 'pins' | 'reactions' | 'reminders' | 'rtm' | 'search' | 'slackLists' | 'slackbot' | 'stars' | 'team' | 'tooling' | 'usergroups' | 'users' | 'views' | 'workflows';` (Chính xác 36 string literals, không có ellipsis, không có skills/misc).
2. `type SlackSideEffect = 'read' | 'write';`
3. `type SlackRiskLevel = 'low' | 'medium' | 'high';`
4. `type SlackPlanTier = 'free' | 'pro' | 'any';`
5. `interface SlackToolMetadata`:
   - `method: string;`
   - `family: SlackMethodFamily;`
   - `sideEffect: SlackSideEffect;`
   - `riskLevel: SlackRiskLevel;`
   - `userScopes: string[] | null;` (Phân định riêng biệt: string[] cho scopes đã xác định; null cho 89 phương thức probe_required chưa rõ token eligibility)
   - `hasUnknownScopes: boolean;`
   - `planTier: SlackPlanTier;`
   - `isProbeRequired: boolean;`
   - `discovers?: string;`
   - `listable?: boolean;`
   - `requiresBinding: true;`
6. `interface SlackToolDefinition extends SlackToolMetadata`:
   - `name: string;` (e.g. `'myslack.conversations_history'`)
   - `service: 'myslack';`
   - `description: string;`
   - `inputSchema: JSONSchema;` (Schema tham số cố định, `additionalProperties: false`)
   - `outputSchema: JSONSchema;`
7. `validateSlackToolDefinition(input: unknown): SlackToolDefinition`
8. `validateSlackToolExecutionArgs<TParams = Record<string, unknown>>(tool: SlackToolDefinition, args: unknown): { binding: SlackBinding; params: TParams }`:
   - Bắt buộc có trường `binding` hợp lệ.
   - Bắt buộc `params` chỉ chứa các thuộc tính được khai báo trong `tool.inputSchema.properties`. Nếu có thuộc tính lạ không thuộc schema -> ném `TypeError` (fail-closed!).
   - Trả về detached whitelisted copy `{ binding, params }`.
9. Định nghĩa 4 core tools mẫu chuẩn mực cho 03C:
   - `myslack.conversations_history`: `userScopes: ['channels:history', 'groups:history', 'im:history', 'mpim:history']`, `sideEffect: 'read'`, `riskLevel: 'low'`.
   - `myslack.conversations_list`: `userScopes: ['channels:read', 'groups:read', 'im:read', 'mpim:read']`, `sideEffect: 'read'`, `riskLevel: 'low'`.
   - `myslack.chat_postMessage`: `userScopes: ['chat:write']`, `sideEffect: 'write'`, `riskLevel: 'high'`.
   - `myslack.users_info`: `userScopes: ['users:read']`, `sideEffect: 'read'`, `riskLevel: 'low'`.

### 2.5. File Cập Nhật: `packages/tool-schemas/src/index.ts`
Re-export toàn bộ hợp đồng từ `./myslack-context.js`, `./myslack-policy.js`, `./myslack-source.js` và `./myslack-tools.js`. Giữ nguyên `ALL_TOOLS`, `TOOL_MAP`, `SERVICE_REGISTRY` không chứa `myslack`.

---

## 3. Danh Sách Yêu Cầu Giao Diện Tiêu Thụ (Consumer Requirements)

Trước khi Backend (03B) và Adapter (03C) thi công mã nguồn, các module này phải đáp ứng các yêu cầu hợp đồng sau:

| Module Tiêu Thụ | Yêu Cầu Hợp Đồng Cần Tuân Thủ | Ghi Chú |
|---|---|---|
| **Backend 03B (Source Store)** | Sử dụng `SlackSourceEntity` bắt buộc lưu `policyRef: SlackPolicyReference`. Gọi `decideSlackSourceStorage` trước khi lưu vào DB. Khi `retentionDays === 0`, tuyệt đối không ghi bản ghi nội dung vào đĩa. Lưu `metadata` theo `SlackSourceMetadata`. | Bảo vệ F1 |
| **Backend 03B (Purge Runner)** | Nhận `SlackPurgeTarget` với 5 tagged scopes cụ thể: `owner_retention`, `channel_membership_lost`, `authorization_disconnect`, `resource_lifecycle`, `workspace_consent_revocation`. Xoá theo matching rules chính xác, không xoá nhầm bản sao cấp lại dưới `consentRevision` mới. Hoạt động cả khi cờ automation tắt. | Bảo vệ F3 & F4 |
| **Backend 03B / 02B (Policy Revalidation)** | Tiếp nhận `SlackPolicyReference`, kiểm tra khớp cả 8 trường, kiểm tra `purpose` thuộc 5 giá trị chuẩn tắc, ném lỗi khi `consentRevision` cũ hơn phiên bản hiện hành trong DB (chống stale policy ref sau revoke/regrant). | Bảo vệ F1 |
| **Integration 03C (Adapters)** | Sử dụng `validateSlackToolExecutionArgs` tại entrypoint của mỗi tool adapter, fail-closed với tham số lạ. Tách biệt token decryption bên trong adapter, không trả token ra ngoài. | Bảo mật Credential |
| **Executor / Controller** | Kiểm tra `sameSlackBinding` và `SlackPolicyReference` trước khi gọi `executeStep`. Gặp timeout/abort -> gán trạng thái `UNKNOWN`, cấm retry write tự động. | Execution Safety |

---

## 4. Bảng Đối Soát 354 Methods (PR 185 Snapshot SHA 811f5dc9)

| Nhóm Phân Loại | Số Lượng | Phương Thức Đại Diện / Đặc Điểm | Giai Đoạn Dự Kiến |
|---|---|---|---|
| **Core Read & Write** | 51 probe_required | `conversations` (27), `chat` (13), `users` (11) | **03C (PR 3)** |
| **Content & Search** | 3 probe_required | `search.all`, `search.files`, `search.messages` (scope `search:read` + điều kiện bổ sung chưa xác định) | **03D (PR 4)** |
| **Content & Files** | 14 probe_required | 13 method file hợp lệ + luồng upload 3 bước ngoài (`getUploadURLExternal` -> binary -> `completeUploadExternal`) | **03D (PR 4)** |
| **Content & Interaction** | 24 probe_required | `pins` (3), `reactions` (4), `bookmarks` (4), `reminders` (5), `stars` (3), `dnd` (5) | **03D (PR 4)** |
| **Advanced Collab & Skills** | 33 probe_required | `canvases` (7), `slackLists` (12), `slackbot.skills` (7), `team` (7) | **03E (PR 5)** |
| **Governance & Automation** | 128 probe_required | `admin` (36), `apps` (21), `agents` (11), `assistant` (5), `calls` (6), `functions` (8), `workflows` (8), `views` (4), khác (19) | **03E (PR 5) / 04** |
| **Excluded (Enterprise)** | 92 excluded | Toàn bộ trong `admin.*` (yêu cầu Enterprise Grid org-install / org-admin) | **Excluded** |
| **Excluded (Deprecated / Retired)** | 3 excluded | `files.upload` (thay bằng external upload), `rtm.start` (thay bằng Events API), `users.setActive` | **Excluded** |
| **Excluded (App-Level Ingress)** | 2 excluded | `apps.connections.open` (Socket mode), `apps.event.authorizations.list` (App token ingress SLACK-04) | **Excluded / 04** |
| **Excluded (Misc / Permissions)** | 4 excluded | `team.externalTeams.*` (2), `users.discoverableContacts.lookup` (1), `conversations.externalInvitePermissions.set` (1) | **Excluded** |
| **TỔNG CỘNG** | **354 methods** | **253 probe_required · 101 excluded** (265 with_scopes, 89 unknown_scopes) | **Bảo toàn 100%** |

---

## 5. Lộ Trình TDD Red-Green-Refactor Chuẩn Tắc

1. **RED:** Tạo các file kiểm thử:
   - `packages/tool-schemas/tests/myslack-context.test.ts` (mở rộng test suite với structured owner keys và 2 users cùng workspace)
   - `packages/tool-schemas/tests/myslack-policy.test.ts` (mở rộng với `decideSlackSourceStorage`, retention 0 block, binding consistency)
   - `packages/tool-schemas/tests/myslack-source.test.ts` (tạo mới với 5 tagged purge scopes, whitelisted metadata, policyRef retention)
   - `packages/tool-schemas/tests/myslack-tools.test.ts` (tạo mới với 36 families, fail-closed args validation)
   Chạy lệnh kiểm thử:
   ```bash
   npx vitest run packages/tool-schemas/tests/myslack-source.test.ts packages/tool-schemas/tests/myslack-tools.test.ts
   ```
   *Kỳ vọng:* Thất bại do chưa tồn tại module.
2. **GREEN:**
   - Cập nhật `myslack-context.ts` với `SlackResourceType`, `validateSlackSourceRef`, formatters cấu trúc tuple JSON.
   - Cập nhật `myslack-policy.ts` với `SlackPolicyPurpose`, `SlackPolicyReference`, `decideSlackSourceStorage`.
   - Tạo `myslack-source.ts` với `SlackSourceMetadata`, `SlackSourceEntity`, 5 tagged `SlackPurgeTarget`.
   - Tạo `myslack-tools.ts` với 36 exact families, metadata và fail-closed argument validator.
   - Cập nhật `packages/tool-schemas/src/index.ts`.
3. **VERIFY:** Chạy lại toàn bộ test suite và typecheck:
   ```bash
   npx vitest run packages/tool-schemas/tests/myslack-context.test.ts packages/tool-schemas/tests/myslack-policy.test.ts packages/tool-schemas/tests/myslack-connection.test.ts packages/tool-schemas/tests/myslack-source.test.ts packages/tool-schemas/tests/myslack-tools.test.ts packages/tool-schemas/tests/registry-invariants.test.ts
   npm run typecheck
   ```
   *Kỳ vọng:* 100% tests PASS, exit code 0.
4. **COMMIT:** Chỉ commit các file trong `packages/tool-schemas/`:
   ```bash
   git add packages/tool-schemas/src/ packages/tool-schemas/tests/
   git commit -m "feat(slack): implement source lifecycle, 5 tagged purge contracts and fail-closed tool metadata"
   ```

---

## 6. Tiêu Chí Nghiệm Thu (Acceptance Criteria)

- [x] Toàn bộ interface và hàm validator xuất phát từ `packages/tool-schemas/`.
- [x] Không có thay đổi nào trong `apps/`, `packages/tool-adapters/` hay `packages/executor/`.
- [x] Kế thừa `SlackBinding` và `SlackSourceRef` nguyên bản, không tạo bản sao trùng lặp.
- [x] `formatSlackOwnerSourceKey` mã hoá cấu trúc tuple JSON đầy đủ binding + tài nguyên; 2 người dùng ATI khác nhau cùng workspace có khoá nguồn riêng biệt.
- [x] `validateSlackPolicyReference` kiểm tra định dạng positive canonical decimal string (`/^[1-9][0-9]*$/`) cho cả `consentRevision` và `providerRevision`; từ chối số 0 hoặc số có số 0 ở đầu; kiểm tra `purpose` thuộc 5 giá trị chuẩn tắc.
- [x] `decideSlackSourceStorage` mở rộng trực tiếp `myslack-policy.ts` và ủy quyền `decideSlackModelUse`, chặn đứng việc lưu trữ bền vững khi `retentionDays === 0`.
- [x] Hợp đồng xoá nguồn `SlackPurgeTarget` phân biệt rõ 5 tagged scopes: `owner_retention`, `channel_membership_lost`, `authorization_disconnect`, `resource_lifecycle`, `workspace_consent_revocation`.
- [x] `validateSlackToolExecutionArgs` kiểm tra fail-closed theo schema tham số cố định, từ chối tham số lạ.
- [x] `SlackMethodFamily` chứa đúng 36 tên snapshot family từ inventory; `userScopes` phân biệt rõ `null` (unknown) với `[]` (empty).
- [x] `ALL_TOOLS` và `SERVICE_REGISTRY` tuyệt đối không chứa `myslack`.
- [x] Sổ cái 354 phương thức khớp 100% snapshot PR 185: `sourceCommit 811f5dc9121d372f232efb63d9880d9574648e3a`, `inventoryFileSha256 e55bc180eb43c71c1131dbded5968c1e240d3424fe1314bf604139055c074f09` (253 probe_required, 101 excluded, 265 with_scopes, 89 unknown_scopes).

---

## 7. Kết Quả Thực Thi (Execution Results)

| Tiêu chuẩn kiểm tra | Lệnh thực hiện | Kết quả thực tế |
|---|---|---|
| Kiểm tra toàn bộ test suite package `@wap/tool-schemas` | `npm test -w @wap/tool-schemas` | **15 test files PASS, 261 tests PASS**, exit code 0 |
| Kiểm tra bộ test Slack đầy đủ | `npx vitest run packages/tool-schemas/tests/myslack-*.test.ts` | **5 test files PASS, 193 tests PASS** (context 47, connection 67, policy 32, source 27, tools 20), exit code 0 |
| Kiểm tra bộ tái hiện đánh giá độc lập | `npx tsx .superpowers/review194/review.mts` | **11/11 boundary tests PASS**, exit code 0 |
| Kiểm tra static types toàn workspace v3 | `npm run typecheck:v3` | **PASS**, exit code 0 (`apps/chat-api` và `apps/chat-web` typecheck sạch sẽ) |
| Kiểm tra đối soát cơ học 354 entries | Node.js assertion script | **100% 354 methods PASS**, 101 excluded khớp chính xác lý do từ `method.reason`, 253 probe_required, hash khớp `e55bc180eb43c71c1131dbded5968c1e240d3424fe1314bf604139055c074f09` |
| Kiểm tra cú pháp Whitespace từ base tới HEAD | `git diff --check b757ae0..HEAD` | Sạch sẽ, exit code 0, không có trailing whitespace |
| Ranh giới Module Ownership | Kiểm tra git status | Chỉ sửa đổi `packages/tool-schemas/` và tài liệu kế hoạch/handoff của SLACK-03A |

### Ranh giới rõ ràng (Explicit Boundaries):
- **NOT_RUN:** Không thực hiện bất kỳ lệnh gọi API Slack thực tế nào (`offline contracts only`).
- **NOT_RUN:** Không thực hiện gọi mô hình LLM trên dữ liệu Slack.
- **NOT_RUN:** Không thi công mã nguồn của Backend (03B) hay Tool Adapters (03C); các module này sẽ được triển khai ở các dispatch tiếp theo sau khi 02B được nghiệm thu.
- **Bảo toàn:** Toàn bộ công việc của các agent khác được giữ nguyên; không chỉnh sửa `CURRENT-STATE.md`, `ROADMAP.md` hay 02 cards.
