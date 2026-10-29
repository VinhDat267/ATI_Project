# SLACK-03A Implementation Plan — Source Lineage, ACL & Tool Metadata Contracts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây dựng hệ thống hợp đồng TypeScript thuần và các hàm kiểm thực runtime (validation) chuẩn tắc cho vòng đời dữ liệu nguồn (F3), kiểm soát truy cập ACL/tombstone/purge có phân định 5 tagged scopes tường minh, liên kết định danh phức hợp bất biến không chứa chứng chỉ (F2), tham chiếu chính sách xử lý F1 (`SlackPolicyReference`) với mục đích chuẩn tắc và số thứ tự tăng dần chuẩn tắc, siêu dữ liệu nguồn bounded whitelisted, và siêu dữ liệu công cụ theo phương thức có schema fail-closed trên nền kiểm kê 354 methods (PR 185) trong `@wap/tool-schemas`, trước khi bất kỳ module tiêu thụ nào (Backend 03B, Adapter 03C) được thi công.

**Architecture:** Áp dụng Domain-Driven Design (DDD) và Deep Modules để thiết lập ranh giới giao tiếp bất biến giữa các module. Tầng hợp đồng schema thuần (`packages/tool-schemas`) sở hữu toàn bộ types, DTOs, và runtime validators trả về đối tượng đã được whitelist/tách rời (detached copies). Không import cơ sở dữ liệu nội bộ hay token mã hóa; phân định tuyệt đối giữa hợp đồng (schemas are contracts) và quyền thực thi (not authority grants); mở rộng và tái sử dụng trực tiếp `myslack-policy.ts` thay vì tạo engine chính sách thứ hai; cô lập danh mục công cụ cá nhân khỏi `ALL_TOOLS` toàn cục.

**Tech Stack:** TypeScript 5.6+, Node.js `^22.12.0 || >=24.0.0`, Vitest 4.1.11, `@wap/tool-schemas`.

**Spec:** [Slack cá nhân và trợ lý công việc trong ATI](../specs/2026-10-28-slack-personal-oauth-design.md), bản duyệt `d479b098` (Mục 2, 4.4, 4.5, 8, 9.1).

---

## Global Constraints

- “OAuth bằng tài khoản Slack của người dùng; thao tác dưới danh nghĩa người đó.”
- “Hỗ trợ Free và Pro; hướng tới toàn bộ khả năng API phù hợp với hai gói và quyền thực tế của người kết nối.”
- “Bao phủ mọi kênh công khai, kênh riêng, DM và nhóm DM mà người kết nối được quyền truy cập; không yêu cầu chọn một danh sách kênh cho phép.”
- “Một tài khoản ATI kết nối đồng thời nhiều workspace Slack.”
- “Mọi gather/search/lookup mang binding do server xác nhận gồm ATI user, connectionId, workspaceId, Slack user, identityVersion.”
- “Tuyệt đối không có công cụ gọi tùy ý method + args; không có blanket all-API dispatcher; schema tham số kiểm tra fail-closed.”
- “Trước thu thập/lưu nội dung nguồn phải có quyền xử lý phù hợp (F1); retentionDays = 0 nghiêm cấm lưu trữ lâu dài.”
- “Mọi derived copy / memory / history / plan args / schedule / audit / summary phải lưu vết sourceRefs và policyRef để cho phép purge trong tương lai (F3).”
- “Purge target bắt buộc phân định 5 tagged scopes rõ ràng: `owner_retention`, `channel_membership_lost`, `authorization_disconnect`, `resource_lifecycle`, `workspace_consent_revocation`; tuyệt đối không dùng quyền mơ hồ làm ảnh hưởng chéo người dùng hoặc xoá nhầm dữ liệu sau regrant.”
- “Purge là công việc bền vững có retry và trạng thái, vẫn chạy khi feature/automation tắt (F3/F4).”
- “Schemas là contracts, không phải authority grants; có schema không đồng nghĩa được quyền gọi nếu thiếu chính sách server xác nhận.”
- “`MYSLACK_ENABLED=off` và `MYSLACK_AUTOMATION_ENABLED=off` mặc định; `myslack` nằm ngoài `ALL_TOOLS` và `SERVICE_REGISTRY`.”
- “Dòng chứng chỉ mã hóa nội bộ (`tokenEncrypted`, secrets) TUYỆT ĐỐI KHÔNG BAO GIỜ xuất hiện trong tool-schemas hoặc public DTOs.”
- “Bảo toàn 101 method excluded và 253 method probe_required từ snapshot PR 185 head `811f5dc9`; không làm biến mất bất kỳ family nào trong 36 families.”

---

## Review Focus

1. **Owner-Specific Expiry & Channel-Targeted Purge (F3):** `retention_expired` không thuộc về `resource_lifecycle` toàn cục của workspace mà thuộc tagged scope `owner_retention` (mang đầy đủ `binding`, `resourceType`, `resourceId`, `revision`, `policyRef`). Sự kiện `channel_membership_lost` bắt buộc nhắm chính xác vào `channelId` bị mất quyền của connection đó, tuyệt đối không purge các kênh khác còn quyền. Sự kiện `authorization_disconnect` mang full `binding` xoá bản sao của riêng connection ngắt kết nối.
2. **Consent Revocation Matching Rules Against Re-grant (F1):** Tagged scope `workspace_consent_revocation` bắt buộc bao gồm `{ workspaceId, policyVersion, providerProfileId, consentRevision }`. Purge runner chỉ xoá các bản ghi khớp chính xác cả 4 tiêu chí; các bản ghi nguồn hoặc bản sao tạo sau này dưới một `consentRevision` mới hơn (khi tổ chức cấp lại consent) tuyệt đối không bị xoá bởi job thu hồi cũ.
3. **Retention of JSON-Safe PolicyRef & Extension of `myslack-policy.ts`:** `SlackSourceEntity` và mỗi bản sao phái sinh (`SlackDerivedCopyRef`) bắt buộc lưu giữ `policyRef: SlackPolicyReference` đã uỷ quyền lưu trữ. Mở rộng và tái sử dụng trực tiếp `myslack-policy.ts` với hàm `decideSlackSourceStorage`, kiểm tra tính nhất quán giữa `sourceRef.binding` và `policyRef.binding`, kiểm tra `purpose === 'storage'` và từ chối khi `retentionDays <= 0` (`retention_zero_denied`).
4. **Fail-Closed Method-Specific Parameter Validation:** `validateSlackToolExecutionArgs` kiểm thực tham số dựa trên schema tham số cố định theo từng phương thức, từ chối mọi thuộc tính không nhận biết (`additionalProperties: false` fail-closed). Tuyệt đối không cho phép công cụ tuỳ ý `method + args`. Bề mặt 03A chỉ định nghĩa hợp đồng mẫu cố định cho 4 core tools (`conversations.history`, `conversations.list`, `chat.postMessage`, `users.info`) với user scopes đối chiếu chính xác từ inventory.
5. **Exact 36 Snapshot Family Names & Scope Representation:** Sử dụng union chính xác 36 string literals (từ `admin` đến `workflows`), không dùng literal ellipsis (`...`) hay các tên không có trong sitemap (`skills`, `misc`). Phân biệt rõ ràng giữa phương thức có scopes (`string[]`), phương thức chưa xác định scopes (`null` cho 89 phương thức probe), và bảo đảm sự tồn tại của schema không bao giờ tự động nâng cấp trạng thái triển khai của inventory.

---

## Cổng Phụ Thuộc Hợp Đồng & Đối Chiếu 02B (Prerequisite Requirements Gate)

### 1. Hiện trạng nhánh & Bối cảnh tích hợp:
- **02A (Connection Contracts):** Đã hoàn tất và được chấp thuận tại commit `6871087`.
- **02R (Callback Isolation Fix):** Đã hoàn tất và được chấp thuận tại PR #190 (`0015_slack_callback_order.sql`).
- **02B (Backend Consent & OAuth):** PR #192 (`19e4e39c`) đang trong quá trình blocking review (hoàn thiện `returnTo` và policy revision / config matching). UI #193 cũng đang review song song.
- **Quy tắc thi công & Tiến độ xếp chồng (Stacked Branches):**
  - Tầng schema 03A thuộc `packages/tool-schemas` được **TIẾN HÀNH ĐỘC LẬP** để chuẩn hóa giao ước chung.
  - Các module tiêu thụ backend (03B) và adapter (03C) **bắt buộc có giao diện 02B được chấp thuận (accepted interfaces)** và một staging base đã được review (cho phép xếp chồng nhánh đã review, không ép buộc phải merge vào main ngay trước khi triển khai consumer). Quyết định merge main thuộc quyền điều phối của chủ dự án và reviewer.

### 2. Danh sách Yêu cầu Giao diện Tiêu thụ (Consumer Interface Requirements):
Tầng schema 03A xuất xưởng các hợp đồng sau để Backend và Adapter tuân thủ:
```ts
// 5 mục đích xử lý chuẩn tắc đã thống nhất với 02B Backend
export type SlackPolicyPurpose =
  | 'manual_lookup'
  | 'triage'
  | 'planning'
  | 'digest'
  | 'storage';

// 1. Tham chiếu chính sách xử lý đã thỏa thuận với Backend (Thực thi F1)
export interface SlackPolicyReference {
  binding: SlackBinding;
  purpose: SlackPolicyPurpose;
  requestedRetentionDays: number; // 0 = no retention
  providerProfileId: string; // định danh cấu hình provider
  configFingerprint: string; // mã băm cấu hình server
  policyVersion: string; // phiên bản chính sách văn bản
  consentRevision: string; // chuỗi số thập phân dương chuẩn tắc: /^[1-9][0-9]*$/ (JSON-safe)
  providerRevision: string; // chuỗi số thập phân dương chuẩn tắc: /^[1-9][0-9]*$/
}

// 2. Yêu cầu giao diện Backend Repository (Consumer Requirements for 03B/02B)
export interface ISlackPolicyConsumerContract {
  // Backend revalidate policy reference mà không làm thay đổi shared schema
  verifyPolicyReference(ref: SlackPolicyReference): Promise<{ valid: boolean; reason?: string }>;
  // Tra cứu metadata kết nối có kiểm tra actor chủ quyền (atiUserId)
  getConnectionMetadataForUser(atiUserId: string, connectionId: string, expectedIdentityVersion?: number): Promise<SlackConnectionMetadata | null>;
}
```

---

## Đối Soát Kiểm Kê 354 Phương Thức Slack (Inventory Reconciliation Ledger)

Toàn bộ 354 phương thức từ snapshot PR 185 (head `811f5dc9`, staged tại commit `81a27b78`) được đối soát cơ học 100%:
- **Tổng số canonical methods:** 354.
- **Phương thức loại trừ (`excluded`):** 101 methods (92 Enterprise-only trong `admin.*`, 2 Enterprise trong `team.*`, 2 app-level token `apps.connections.open` & `apps.event.authorizations.list`, 1 `conversations.externalInvitePermissions.set`, 1 deprecated `files.upload`, 1 retired `rtm.start`, 1 `users.discoverableContacts.lookup`, 1 deprecated `users.setActive`).
- **Phương thức cần probe (`probe_required`):** 253 methods (Bảo toàn trạng thái unknown/probe cho đến khi có bằng chứng native).
- **Phân loại scopes:** 265 methods có user scopes xác định (`with_scopes`); 89 methods có user scopes chưa xác định (`unknown_scopes: null`).
- **Phân bổ theo giai đoạn triển khai (Delivery Phases):**
  - **Phase 03C (Core Tool Surface):** 51 probe_required methods (`conversations` 27, `chat` 13, `users` 11).
  - **Phase 03D (Content & Interaction):** 41 probe_required methods (`search` 3, `files` 14, `pins` 3, `reactions` 4, `bookmarks` 4, `reminders` 5, `stars` 3, `dnd` 5).
  - **Phase 03E / 04 (Advanced Collab, Apps & Governance):** 161 probe_required methods (`canvases` 7, `slackLists` 12, `slackbot` 7, `team` 7, `usergroups` 7, `admin` 36, `apps` 21, `assistant` 5, `agents` 11, `calls` 6, `functions` 8, `workflows` 8, `views` 4, `oauth` 6, `openid` 2, `auth` 3, `api` 1, `blocks` 1, `bots` 1, `dialog` 1, `emoji` 1, `entity` 3, `migration` 1, `rtm` 1, `tooling` 1).
  - **Excluded:** 101 methods bảo toàn lý do kỹ thuật.
- Chi tiết từng phương thức được lưu trữ bền vững tại tệp: `docs/superpowers/plans/slack-354-method-ledger.json`.

---

## File Structure Plan

```
packages/tool-schemas/
├── src/
│   ├── myslack-context.ts      # Modify: Mở rộng SlackResourceType, validateSlackSourceRef, structured composite keys
│   ├── myslack-policy.ts       # Modify: Mở rộng decideSlackSourceStorage (tái sử dụng policy engine hiện hữu)
│   ├── myslack-source.ts       # Create: Hợp đồng SlackSourceEntity, Lineage, DerivedCopy, 5 Tagged PurgeTargets
│   ├── myslack-tools.ts        # Create: 36 exact families, fail-closed per-method schemas, validateSlackToolExecutionArgs
│   └── index.ts                # Modify: Re-export contracts (bảo đảm không thêm vào ALL_TOOLS/SERVICE_REGISTRY)
└── tests/
    ├── myslack-context.test.ts # Modify: Test resourceType mở rộng, sourceRef validation, composite key cấu trúc
    ├── myslack-policy.test.ts  # Modify: Test decideSlackSourceStorage, retention 0 block, binding consistency
    ├── myslack-source.test.ts  # Create: Test toàn diện F1 policyRef retention, F2 isolation, F3 5 tagged purge scopes
    └── myslack-tools.test.ts   # Create: Test 36 families, fail-closed args validation, whitelisted parameter bounds
```

---

## Task Decomposition

### Task 1: Mở rộng Tương thích Định danh, Tham chiếu Nguồn & Khoá Cấu trúc Tuple (`myslack-context.ts`)

**Files:**
- Modify: `packages/tool-schemas/src/myslack-context.ts:1-39`
- Modify: `packages/tool-schemas/tests/myslack-context.test.ts:1-42`

**Interfaces:**
- Consumes: Hiện trạng `SlackBinding`, `SlackSourceRef`, `validateSlackBinding`, `sameSlackBinding`.
- Produces:
  - `SlackResourceType`: Kiểu union mở rộng tương thích:
    `'conversation' | 'message' | 'file' | 'canvas' | 'list' | 'list_item' | 'bookmark' | 'reminder' | 'user' | 'usergroup' | 'subteam'`
  - `SlackSourceRef`: Giữ nguyên cấu trúc nhưng `resourceType` sử dụng `SlackResourceType`.
  - `validateSlackSourceRef(input: unknown): SlackSourceRef`: Trả về detached whitelisted copy; ném `TypeError` nếu thiếu binding, resourceType ngoài danh mục, resourceId rỗng/whitespace, revision rỗng/whitespace.
  - `formatSlackGlobalResourceKey(workspaceId: string, resourceType: SlackResourceType, resourceId: string): string`:
    Định danh tài nguyên vật lý chung: `JSON.stringify([workspaceId, resourceType, resourceId])`. Tránh hoàn toàn lỗi nối chuỗi ký tự phân cách (delimiter ambiguity).
  - `formatSlackOwnerSourceKey(ref: SlackSourceRef): string`:
    Định danh nguồn gắn liền với quyền của người kết nối (authorization-source key):
    `JSON.stringify([ref.binding.atiUserId, ref.binding.connectionId, ref.binding.workspaceId, ref.binding.slackUserId, ref.binding.identityVersion, ref.resourceType, ref.resourceId, ref.revision])`.
    Bảo đảm 2 người dùng ATI khác nhau cùng xem một tin nhắn có 2 khoá nguồn riêng biệt!

- [ ] **Step 1: Viết test failing trong `packages/tool-schemas/tests/myslack-context.test.ts`**

```ts
it('supports extended resource types for Canvas, List, bookmarks, and reminders', () => {
  const extendedTypes: SlackResourceType[] = [
    'conversation', 'message', 'file', 'canvas', 'list', 'list_item',
    'bookmark', 'reminder', 'user', 'usergroup', 'subteam'
  ];
  for (const rt of extendedTypes) {
    const ref: SlackSourceRef = { binding, resourceType: rt, resourceId: 'res-1', revision: 'rev-1' };
    expect(validateSlackSourceRef(ref)).toEqual(ref);
  }
});

it('formats structured owner source keys preventing collision between 2 users in same workspace', () => {
  const bindingUserA = { ...binding, atiUserId: 'user-a', connectionId: 'conn-a', slackUserId: 'U_A' };
  const bindingUserB = { ...binding, atiUserId: 'user-b', connectionId: 'conn-b', slackUserId: 'U_B' };
  const refA: SlackSourceRef = { binding: bindingUserA, resourceType: 'message', resourceId: 'msg-1', revision: '1' };
  const refB: SlackSourceRef = { binding: bindingUserB, resourceType: 'message', resourceId: 'msg-1', revision: '1' };

  const keyA = formatSlackOwnerSourceKey(refA);
  const keyB = formatSlackOwnerSourceKey(refB);
  expect(keyA).not.toBe(keyB);
  expect(JSON.parse(keyA)[0]).toBe('user-a');
  expect(JSON.parse(keyB)[0]).toBe('user-b');
});

it('handles delimiter and special characters in resource IDs safely without collision', () => {
  const key1 = formatSlackGlobalResourceKey('T:1', 'message', 'M:2');
  const key2 = formatSlackGlobalResourceKey('T', 'message', '1:M:2');
  expect(key1).not.toBe(key2);
});

it('strips sensitive and extra properties from SlackSourceRef', () => {
  const dirty = {
    binding: { ...binding, extraSecret: 'secret-token' },
    resourceType: 'message',
    resourceId: 'msg-123',
    revision: '1729000000.000100',
    maliciousPayload: '<script>',
  };
  const clean = validateSlackSourceRef(dirty);
  expect(clean).toEqual({
    binding,
    resourceType: 'message',
    resourceId: 'msg-123',
    revision: '1729000000.000100',
  });
  expect((clean as any).maliciousPayload).toBeUndefined();
  expect((clean.binding as any).extraSecret).toBeUndefined();
});
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**
Run: `npx vitest run packages/tool-schemas/tests/myslack-context.test.ts`
Expected: FAIL với lỗi "validateSlackSourceRef is not defined".

- [ ] **Step 3: Triển khai mở rộng trong `packages/tool-schemas/src/myslack-context.ts`**
Thêm `SlackResourceType`, cập nhật `SlackSourceRef`, triển khai `validateSlackSourceRef`, `formatSlackGlobalResourceKey`, `formatSlackOwnerSourceKey`. Sử dụng `Object.hasOwn` và kiểm tra kiểu nghiêm ngặt.

- [ ] **Step 4: Chạy lại test để xác nhận PASS**
Run: `npx vitest run packages/tool-schemas/tests/myslack-context.test.ts`
Expected: PASS 100%.

- [ ] **Step 5: Commit**
```bash
git add packages/tool-schemas/src/myslack-context.ts packages/tool-schemas/tests/myslack-context.test.ts
git commit -m "feat(slack): extend source ref types and structured composite key formatting"
```

---

### Task 2: Tái Sử Dụng & Mở Rộng Hợp Đồng Chính Sách Lưu Trữ Nguồn (`myslack-policy.ts`)

**Files:**
- Modify: `packages/tool-schemas/src/myslack-policy.ts`
- Modify: `packages/tool-schemas/tests/myslack-policy.test.ts`

**Interfaces:**
- Consumes: Hiện hữu `SlackModelPolicy`, `sameSlackBinding`, `validateSlackBinding` từ `./myslack-context.js`.
- Produces:
  - `SlackPolicyPurpose`: `'manual_lookup' | 'triage' | 'planning' | 'digest' | 'storage'`.
  - `SlackPolicyReference`:
    `{ binding: SlackBinding; purpose: SlackPolicyPurpose; requestedRetentionDays: number; providerProfileId: string; configFingerprint: string; policyVersion: string; consentRevision: string; providerRevision: string; }`.
  - `validateSlackPolicyReference(input: unknown): SlackPolicyReference`: Kiểm thực positive canonical decimal string (`/^[1-9][0-9]*$/`) cho cả `consentRevision` và `providerRevision`, bác bỏ number, bigint, số 0 hoặc số có số 0 ở đầu ("0", "01"), kiểm thực purpose thuộc 5 giá trị chuẩn tắc, không phát sinh trường tương thích bắt buộc thừa.
  - `SlackSourceStorageRequest`:
    `{ binding: SlackBinding; policyRef: SlackPolicyReference; requestedRetentionDays: number; }`.
  - `SlackStorageBlockReason`: `'connection_inactive' | 'identity_changed' | 'consent_missing' | 'policy_changed' | 'provider_unverified' | 'retention_zero_denied' | 'retention_exceeded' | 'purpose_mismatch'`.
  - `decideSlackSourceStorage(policy: SlackModelPolicy, request: SlackSourceStorageRequest): { allowed: true; maxRetentionDays: number } | { allowed: false; reason: SlackStorageBlockReason }`:
    - Ủy quyền (delegate/reuse) trực tiếp cho `decideSlackModelUse` để giải quyết toàn bộ baseline authorization gates (`connection_inactive`, `consent_missing`, `policy_changed`, `provider_unverified`, `retention_exceeded`).
    - Bổ sung quy tắc storage:
      - `sameSlackBinding(request.binding, request.policyRef.binding)` phải true, nếu không -> `identity_changed`.
      - Khớp providerProfileId và policyVersion giữa policyRef và policy: `request.policyRef.providerProfileId === policy.provider.profileId` và `request.policyRef.policyVersion === policy.policyVersion`, nếu không -> `policy_changed`.
      - `request.policyRef.purpose !== 'storage'` -> `purpose_mismatch`.
      - `policy.consent.retentionDays <= 0 || request.requestedRetentionDays <= 0 || request.policyRef.requestedRetentionDays <= 0` -> `retention_zero_denied`.
      - `request.requestedRetentionDays` phải là positive safe integer (`Number.isSafeInteger(n) && n > 0`), bị chặn bởi `request.policyRef.requestedRetentionDays`, `policy.consent.retentionDays`, và `policy.provider.maxRetentionDays`.
      - Nếu vượt quá bất kỳ trần nào -> `retention_exceeded`.
      - Hợp lệ -> `{ allowed: true, maxRetentionDays: Math.min(request.requestedRetentionDays, request.policyRef.requestedRetentionDays, policy.consent.retentionDays, policy.provider.maxRetentionDays) }`.
    - **Yêu cầu đối với Backend Runtime:** Schemas thuần chỉ là pure contracts, không tự chứng minh được tính tươi mới (freshness) của DB grants. Backend runtime bắt buộc revalidate persisted consent/provider revisions và current connection/ACL tại mỗi thời điểm tiêu thụ nguồn hoặc bộ nhớ; schemas không thiết lập liveness. Chạy test trên denied baseline gates và ref mismatches, không dùng toy authorization booleans giả lập DB races.

- [ ] **Step 1: Viết test failing trong `packages/tool-schemas/tests/myslack-policy.test.ts`**
Thêm các ca kiểm thử:
- Chặn lưu trữ bền vững khi `retentionDays === 0` với lý do `retention_zero_denied`.
- Từ chối `SlackPolicyReference` có `purpose: 'summarize'` (không thuộc 5 giá trị chuẩn tắc).
- Từ chối `SlackPolicyReference` có `consentRevision: "0"` hoặc `"01"`.
- Từ chối khi `request.binding` khác `request.policyRef.binding`.

- [ ] **Step 2: Chạy test để xác nhận FAIL**
Run: `npx vitest run packages/tool-schemas/tests/myslack-policy.test.ts`
Expected: FAIL với lỗi "decideSlackSourceStorage is not defined".

- [ ] **Step 3: Triển khai mở rộng trong `packages/tool-schemas/src/myslack-policy.ts`**
Viết hàm `decideSlackSourceStorage` và `validateSlackPolicyReference`.

- [ ] **Step 4: Chạy lại test để xác nhận PASS**
Run: `npx vitest run packages/tool-schemas/tests/myslack-policy.test.ts`
Expected: PASS 100%.

- [ ] **Step 5: Commit**
```bash
git add packages/tool-schemas/src/myslack-policy.ts packages/tool-schemas/tests/myslack-policy.test.ts
git commit -m "feat(slack): extend policy contracts with storage decision and policy reference"
```

---

### Task 3: Hợp đồng Vòng đời Nguồn, 5 Tagged Purge Scopes & Whitelisted Metadata (`myslack-source.ts`)

**Files:**
- Create: `packages/tool-schemas/src/myslack-source.ts`
- Create: `packages/tool-schemas/tests/myslack-source.test.ts`

**Interfaces:**
- Consumes: `SlackBinding`, `SlackSourceRef`, `SlackResourceType` từ `./myslack-context.js`; `SlackPolicyReference` từ `./myslack-policy.js`.
- Produces:
  - `SlackSourceMetadata`: Bounded whitelisted metadata:
    `{ channelId?: string; channelName?: string; threadTs?: string; authorSlackUserId?: string; authorName?: string; fileName?: string; fileMimeType?: string; fileSizeBytes?: number; isBotMessage?: boolean; }`
  - `validateSlackSourceMetadata(input: unknown): SlackSourceMetadata`: Tước bỏ mọi trường lạ, chỉ cho phép các trường được whitelist.
  - `SlackSourceEntity`: DTO đại diện cho nguồn nguyên bản, bắt buộc retain `policyRef: SlackPolicyReference`:
    `{ id: string; sourceRef: SlackSourceRef; policyRef: SlackPolicyReference; untrustedContent: string; metadata: SlackSourceMetadata; observedRevision: string; retentionDays: number; capturedAt: string; expiresAt: string; tombstonedAt: string | null; purgedAt: string | null; }`
  - `validateSlackSourceEntity(input: unknown): SlackSourceEntity`: Xác thực `sameSlackBinding(sourceRef.binding, policyRef.binding)`, `sourceRef.revision === observedRevision`, `retentionDays > 0`, trả về detached nested copies.
  - `SlackDerivedTargetKind`:
    `'chat_history_message' | 'working_memory_entity' | 'plan_step_arg' | 'proposal_excerpt' | 'daily_digest_entry' | 'scheduled_workflow_arg' | 'audit_log_entry'`.
  - `SlackDerivedCopyRef`:
    `{ targetKind: SlackDerivedTargetKind; targetId: string; sourceRefs: SlackSourceRef[]; policyRef: SlackPolicyReference; createdAt: string; }`
  - `validateSlackDerivedCopyRef(input: unknown): SlackDerivedCopyRef`.
  - `SlackSourceLineage`:
    `{ ownerSourceKey: string; origin: SlackSourceRef; policyRef: SlackPolicyReference; derivedCopies: SlackDerivedCopyRef[]; }`
  - `validateSlackSourceLineage(input: unknown): SlackSourceLineage`.
  - `SlackTombstoneReason`:
    `'source_deleted' | 'source_edited' | 'channel_membership_lost' | 'connection_disconnected' | 'app_reinstalled' | 'consent_revoked' | 'retention_expired'`.
  - `SlackTombstoneRecord`:
    `{ sourceRef: SlackSourceRef; reason: SlackTombstoneReason; tombstonedAt: string; purgedAt: string | null; }`
  - `validateSlackTombstoneRecord(input: unknown): SlackTombstoneRecord`.
  - `SlackPurgeTarget`: Discriminated union với 5 tagged scopes tường minh, loại bỏ hoàn toàn thẩm quyền mơ hồ:
    ```ts
    export type SlackPurgeTarget =
      | {
          scope: 'owner_retention';
          binding: SlackBinding; // full binding
          resourceType: SlackResourceType;
          resourceId: string;
          revision?: string;
          policyRef: SlackPolicyReference; // policy reference quy định retention này
          cascadeTargetKinds: SlackDerivedTargetKind[];
          tombstoneReason: 'retention_expired';
        }
      | {
          scope: 'channel_membership_lost';
          binding: SlackBinding; // connection bị ảnh hưởng
          channelId: string; // chỉ kênh bị mất quyền, không purge kênh khác
          cascadeTargetKinds: SlackDerivedTargetKind[];
          tombstoneReason: 'channel_membership_lost';
        }
      | {
          scope: 'authorization_disconnect';
          binding: SlackBinding; // full binding
          cascadeTargetKinds: SlackDerivedTargetKind[];
          tombstoneReason: 'connection_disconnected' | 'app_reinstalled';
        }
      | {
          scope: 'resource_lifecycle';
          workspaceId: string;
          resourceType: SlackResourceType;
          resourceId: string;
          revision?: string;
          cascadeTargetKinds: SlackDerivedTargetKind[];
          tombstoneReason: 'source_deleted' | 'source_edited';
        }
      | {
          scope: 'workspace_consent_revocation';
          workspaceId: string;
          policyVersion: string;
          providerProfileId: string;
          consentRevision: string; // chuỗi số thập phân dương: chống xoá nhầm bản sao cấp lại
          cascadeTargetKinds: SlackDerivedTargetKind[];
          tombstoneReason: 'consent_revoked';
        };
    ```
  - `validateSlackPurgeTarget(input: unknown): SlackPurgeTarget`.

- [ ] **Step 1: Viết test failing trong `packages/tool-schemas/tests/myslack-source.test.ts`**
Bao gồm các ca kiểm thử:
- Kiểm tra `validateSlackSourceEntity` yêu cầu `policyRef` hợp lệ và khớp `binding` với `sourceRef`.
- Kiểm tra `validateSlackPurgeTarget` với `scope: 'owner_retention'` yêu cầu đầy đủ `policyRef` và `binding`.
- Kiểm tra `validateSlackPurgeTarget` với `scope: 'channel_membership_lost'` bắt buộc có `channelId` và `binding`.
- Kiểm tra `validateSlackPurgeTarget` với `scope: 'workspace_consent_revocation'` bắt buộc có cả `providerProfileId` và `consentRevision`.
- Kiểm tra tước bỏ metadata ngoài danh mục whitelist và chống prototype pollution.

- [ ] **Step 2: Chạy test để xác nhận FAIL**
Run: `npx vitest run packages/tool-schemas/tests/myslack-source.test.ts`
Expected: FAIL với lỗi "Cannot find module '../src/myslack-source.js'".

- [ ] **Step 3: Triển khai mã nguồn trong `packages/tool-schemas/src/myslack-source.ts`**
Viết mã triển khai đầy đủ types, interfaces và validator functions chuẩn mực.

- [ ] **Step 4: Chạy lại test để xác nhận PASS**
Run: `npx vitest run packages/tool-schemas/tests/myslack-source.test.ts`
Expected: PASS 100%.

- [ ] **Step 5: Commit**
```bash
git add packages/tool-schemas/src/myslack-source.ts packages/tool-schemas/tests/myslack-source.test.ts
git commit -m "feat(slack): implement source entity with retained policyRef and 5 tagged purge scopes"
```

---

### Task 4: Hợp đồng 36 Nhóm Phương Thức Chuẩn Xác & Kiểm Thực Tham Số Fail-Closed (`myslack-tools.ts`)

**Files:**
- Create: `packages/tool-schemas/src/myslack-tools.ts`
- Create: `packages/tool-schemas/tests/myslack-tools.test.ts`

**Interfaces:**
- Consumes: `SlackBinding`, `validateSlackBinding` từ `./myslack-context.js`, `JSONSchema` từ `./types.js`.
- Produces:
  - `SlackMethodFamily`: Kiểu union chính xác 36 string literals từ inventory:
    `'admin' | 'agents' | 'api' | 'apps' | 'assistant' | 'auth' | 'blocks' | 'bookmarks' | 'bots' | 'calls' | 'canvases' | 'chat' | 'conversations' | 'dialog' | 'dnd' | 'emoji' | 'entity' | 'files' | 'functions' | 'migration' | 'oauth' | 'openid' | 'pins' | 'reactions' | 'reminders' | 'rtm' | 'search' | 'slackLists' | 'slackbot' | 'stars' | 'team' | 'tooling' | 'usergroups' | 'users' | 'views' | 'workflows'`
  - `SlackSideEffect`: `'read' | 'write'`.
  - `SlackRiskLevel`: `'low' | 'medium' | 'high'`.
  - `SlackPlanTier`: `'free' | 'pro' | 'any'`.
  - `SlackToolMetadata`:
    `{ method: string; family: SlackMethodFamily; sideEffect: SlackSideEffect; riskLevel: SlackRiskLevel; userScopes: string[] | null; hasUnknownScopes: boolean; planTier: SlackPlanTier; isProbeRequired: boolean; discovers?: string; listable?: boolean; requiresBinding: true; }`
  - `SlackToolDefinition`:
    `SlackToolMetadata & { name: string; service: 'myslack'; description: string; inputSchema: JSONSchema; outputSchema: JSONSchema; }`
  - `validateSlackToolDefinition(input: unknown): SlackToolDefinition`.
  - Fixed Parameter Schemas cho 4 core 03C tools (Fail-Closed: `additionalProperties: false`):
    - `conversations.history`: params `{ channel: string; cursor?: string; limit?: number; latest?: string; oldest?: string; inclusive?: boolean; }`
    - `conversations.list`: params `{ cursor?: string; limit?: number; types?: string; exclude_archived?: boolean; }`
    - `chat.postMessage`: params `{ channel: string; text: string; thread_ts?: string; }`
    - `users.info`: params `{ user: string; include_locale?: boolean; }`
  - `validateSlackToolExecutionArgs<TParams = Record<string, unknown>>(tool: SlackToolDefinition, args: unknown): { binding: SlackBinding; params: TParams }`:
    - Yêu cầu bắt buộc trường `binding` thuộc own property.
    - Validate binding qua `validateSlackBinding`.
    - Kiểm thực `params` đối chiếu với các trường được định nghĩa trong `tool.inputSchema`: nếu có bất kỳ thuộc tính lạ nào không có trong whitelist schema -> ném `TypeError` (fail-closed!).
    - Trả về detached `{ binding, params }`.

- [ ] **Step 1: Viết test failing trong `packages/tool-schemas/tests/myslack-tools.test.ts`**
Bao gồm các ca kiểm thử:
- Kiểm tra `SlackMethodFamily` chứa đúng 36 tên snapshot family từ inventory; không chấp nhận `skills` hay `misc`.
- Kiểm tra `validateSlackToolExecutionArgs` ném `TypeError` (fail-closed) khi `params` chứa thuộc tính không có trong schema (ví dụ `extraField: 'inject'` hoặc `token: 'secret'`).
- Kiểm tra `hasUnknownScopes === true` khi `userScopes === null` (đại diện riêng biệt cho 89 phương thức chưa xác định scope).
- Invariant: Khẳng định sự tồn tại của `SlackToolDefinition` không cấp quyền tự động cho runtime nếu thiếu policy validation.

- [ ] **Step 2: Chạy test để xác nhận FAIL**
Run: `npx vitest run packages/tool-schemas/tests/myslack-tools.test.ts`
Expected: FAIL với lỗi "Cannot find module '../src/myslack-tools.js'".

- [ ] **Step 3: Triển khai mã nguồn trong `packages/tool-schemas/src/myslack-tools.ts`**
Xây dựng types, validation và 4 tool definitions mẫu fail-closed.

- [ ] **Step 4: Chạy lại test để xác nhận PASS**
Run: `npx vitest run packages/tool-schemas/tests/myslack-tools.test.ts`
Expected: PASS 100%.

- [ ] **Step 5: Commit**
```bash
git add packages/tool-schemas/src/myslack-tools.ts packages/tool-schemas/tests/myslack-tools.test.ts
git commit -m "feat(slack): add exact 36 families, fail-closed tool schemas and execution validation"
```

---

### Task 5: Tích Hợp Re-export, Cổng Tiêu Thụ & Đối Soát Sổ Cái 354 Methods

**Files:**
- Modify: `packages/tool-schemas/src/index.ts:20-40`
- Modify: `packages/tool-schemas/tests/registry-invariants.test.ts`
- Documentation & Ledger: `docs/superpowers/plans/slack-354-method-ledger.json`

**Interfaces:**
- Consumes: `./myslack-context.js`, `./myslack-policy.js`, `./myslack-source.js`, `./myslack-tools.js`.
- Produces: Re-export toàn bộ hợp đồng ra entrypoint của package.
- Invariant:
  - `ALL_TOOLS.some(t => t.service === 'myslack') === false`.
  - `SERVICE_REGISTRY.some(s => s.id === 'myslack') === false`.

1. **Yêu cầu đối với Backend 03B (`SlackSourceStore`, `SlackPurgeRunner`):**
   - Lưu trữ `SlackSourceEntity` bắt buộc kèm `policyRef: SlackPolicyReference`. Nếu `retentionDays === 0` -> từ chối lưu.
   - Xử lý 5 tagged scopes của `SlackPurgeTarget`:
     - `owner_retention`: Xoá bản sao của đúng connection/revision và policyRef khi hết hạn;
     - `channel_membership_lost`: Xoá bản sao của kênh bị mất quyền, giữ nguyên các kênh khác;
     - `authorization_disconnect`: Xoá toàn bộ bản sao của đúng `binding` ngắt kết nối;
     - `resource_lifecycle`: Xoá khi tin/file bị xoá/sửa tại Slack;
     - `workspace_consent_revocation`: So khớp cả 4 trường `{ workspaceId, policyVersion, providerProfileId, consentRevision }`, bảo vệ bản sao cấp lại dưới revision mới.
2. **Cổng Phê Duyệt Trước Khi Code 03B/03C (Review & Staging Gate):**
   - 02B PR 192 (`19e4e39c`) đã được chấp thuận giao diện (accepted interfaces).
   - Cho phép xếp chồng nhánh dựa trên reviewed staging base, không ép buộc phải merge vào main ngay trước khi triển khai consumer.
   - Leader phê duyệt hoàn tất kế hoạch 03A này.

- [ ] **Step 1: Cập nhật test kiểm tra invariant trong `tests/registry-invariants.test.ts`**
Thêm assertion kiểm tra không có bất kỳ tool hay service `myslack` nào xuất hiện trong registry mặc định.

- [ ] **Step 2: Cập nhật `packages/tool-schemas/src/index.ts`**
Export đầy đủ các module mới.

- [ ] **Step 3: Chạy test suites của Slack foundation trong `@wap/tool-schemas`**
Run:
```bash
npx vitest run packages/tool-schemas/tests/myslack-context.test.ts packages/tool-schemas/tests/myslack-policy.test.ts packages/tool-schemas/tests/myslack-connection.test.ts packages/tool-schemas/tests/myslack-source.test.ts packages/tool-schemas/tests/myslack-tools.test.ts packages/tool-schemas/tests/registry-invariants.test.ts
npm run typecheck
```
Expected: 100% tests PASS, `typecheck` exit 0.

- [ ] **Step 4: Commit**
```bash
git add packages/tool-schemas/src/index.ts packages/tool-schemas/tests/registry-invariants.test.ts docs/superpowers/plans/slack-354-method-ledger.json
git commit -m "feat(slack): export source and tool contracts with reconciled 354-method ledger"
```

---

## Self-Review Checklist

1. **Spec Coverage:** Bao phủ toàn diện F1 (Data Retention 0, 5 mục đích chuẩn tắc & Stale Policy Ref), F2 (Multi-User & Cross-Workspace Composite Identity Isolation), F3 (5 Tagged Purge Scopes & Full Cascade Lineage), F4 (Lifecycle Independent of Automation Flag).
2. **Step Granularity:** Mỗi task gồm 5 bước TDD Red-Green-Refactor rõ ràng, có lệnh kiểm thử cụ thể và expected outcome xác định.
3. **Type Consistency:** Đồng bộ hoàn hảo giữa `SlackBinding`, `SlackSourceRef`, `SlackResourceType`, `SlackSourceEntity`, `SlackSourceMetadata`, `SlackPolicyReference`, `SlackPurgeTarget` và `SlackToolDefinition`.
4. **Proportion:** Kế hoạch tập trung sâu vào hợp đồng interface và ranh giới module, không viết trước hàng nghìn dòng code triển khai của backend.
5. **Ledger Integrity:** Toàn bộ 354 phương thức từ snapshot PR 185 (head `811f5dc9`) được kiểm kê đầy đủ qua 36 snapshot families chính xác, không thiếu sót bất kỳ method nào.
