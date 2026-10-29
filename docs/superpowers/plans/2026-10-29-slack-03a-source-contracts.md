# SLACK-03A Implementation Plan — Source Lineage, ACL & Tool Metadata Contracts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây dựng hệ thống hợp đồng TypeScript thuần và các hàm kiểm thực runtime (validation) chuẩn tắc cho vòng đời dữ liệu nguồn (F3), kiểm soát truy cập ACL/tombstone/purge, liên kết định danh bất biến không chứa chứng chỉ (F2), tham chiếu chính sách xử lý F1 (policy reference) và siêu dữ liệu công cụ theo từng phương thức (per-method tool metadata) trên nền kiểm kê 354 methods (PR 185) trong `@wap/tool-schemas`, trước khi bất kỳ module tiêu thụ nào (Backend 03B, Adapter 03C) được thi công.

**Architecture:** Áp dụng Domain-Driven Design (DDD) và Deep Modules để thiết lập ranh giới giao tiếp bất biến giữa các module. Tầng hợp đồng schema thuần (`packages/tool-schemas`) sở hữu toàn bộ types, DTOs, và runtime validators trả về đối tượng đã được whitelist/tách rời (detached copies). Không import cơ sở dữ liệu nội bộ hay token mã hóa; phân định tuyệt đối giữa hợp đồng (schemas are contracts) và quyền thực thi (not authority grants); cô lập danh mục công cụ cá nhân khỏi `ALL_TOOLS` toàn cục.

**Tech Stack:** TypeScript 5.6+, Node.js `^22.12.0 || >=24.0.0`, Vitest 4.1.11, `@wap/tool-schemas`.

**Spec:** [Slack cá nhân và trợ lý công việc trong ATI](../specs/2026-10-28-slack-personal-oauth-design.md), bản duyệt `d479b098` (Mục 2, 4.4, 4.5, 8, 9.1).

---

## Global Constraints

- “OAuth bằng tài khoản Slack của người dùng; thao tác dưới danh nghĩa người đó.”
- “Hỗ trợ Free và Pro; hướng tới toàn bộ khả năng API phù hợp với hai gói và quyền thực tế của người kết nối.”
- “Bao phủ mọi kênh công khai, kênh riêng, DM và nhóm DM mà người kết nối được quyền truy cập; không yêu cầu chọn một danh sách kênh cho phép.”
- “Một tài khoản ATI kết nối đồng thời nhiều workspace Slack.”
- “Mọi gather/search/lookup mang binding do server xác nhận gồm ATI user, connectionId, workspaceId, Slack user, identityVersion.”
- “Tuyệt đối không có công cụ gọi tùy ý method + args; không có blanket all-API dispatcher.”
- “Trước thu thập/lưu nội dung nguồn phải có quyền xử lý phù hợp (F1); retentionDays = 0 nghiêm cấm lưu trữ lâu dài.”
- “Mọi derived copy / memory / history / plan args / schedule / audit / summary phải lưu vết sourceRefs và cho phép purge trong tương lai (F3).”
- “Purge là công việc bền vững có retry và trạng thái, vẫn chạy khi feature/automation tắt (F3/F4).”
- “Schemas là contracts, không phải authority grants; có schema không đồng nghĩa được quyền gọi nếu thiếu chính sách server xác nhận.”
- “`MYSLACK_ENABLED=off` và `MYSLACK_AUTOMATION_ENABLED=off` mặc định; `myslack` nằm ngoài `ALL_TOOLS` và `SERVICE_REGISTRY`.”
- “Dòng chứng chỉ mã hóa nội bộ (`tokenEncrypted`, secrets) TUYỆT ĐỐI KHÔNG BAO GIỜ xuất hiện trong tool-schemas hoặc public DTOs.”
- “Bảo toàn 101 method excluded và 253 method probe_required từ snapshot PR 185 head `811f5dc9`; không làm biến mất bất kỳ family nào.”

---

## Review Focus

1. **Cross-Workspace Composite Identity Isolation (F2):** Hai workspace khác nhau có kênh trùng ID (ví dụ `C123`) hoặc user trùng ID (`U123`) tuyệt đối không được coi là tương đương. Khoá tài nguyên phức hợp bắt buộc định dạng `${workspaceId}:${resourceType}:${resourceId}`, và khoá nguồn bắt buộc mang đầy đủ `@${revision}#v${identityVersion}`.
2. **F1 Data Retention 0 & Stale Policy Ref Rejection:** Khi `retentionDays === 0`, hợp đồng kiểm soát lưu trữ nguồn (`decideSlackSourceStore`) bắt buộc từ chối lưu trữ bền vững. Khi quyền chấp thuận bị thu hồi rồi cấp lại (cùng nhãn người dùng "Gemini 2.5 Flash"), `consentRevision` tăng lên khiến `SlackPolicyReference` cũ bị từ chối ngay lập tức.
3. **Data Lifecycle & Full Cascade Purge Lineage (F3):** Hợp đồng xoá nguồn (`SlackPurgeTarget`) bắt buộc bao phủ đầy đủ 7 loại đích phái sinh (`chat_history_message`, `working_memory_entity`, `plan_step_arg`, `proposal_excerpt`, `daily_digest_entry`, `scheduled_workflow_arg`, `audit_log_entry`) để bảo đảm Backend 03B xoá sạch mọi bản sao.
4. **Credential Isolation & Whitelist Detachment:** Các hàm validator (`validateSlackSourceEntity`, `validateSlackPolicyReference`, `validateSlackToolExecutionArgs`) bắt buộc trả về object mới đã lọc thuộc tính (detached whitelisted copy), loại bỏ mọi thuộc tính thừa, ngăn chặn prototype pollution và nghiêm cấm mang theo token/secret.
5. **Contract vs Authority Grant Distinction:** Có schema định nghĩa phương thức trong `packages/tool-schemas` KHÔNG cấp quyền tự động gọi Slack API; executor và backend bắt buộc phải kiểm tra policy, binding và consent hợp lệ trước khi thực hiện.

---

## Cổng Phụ Thuộc Hợp Đồng & Đối Chiếu 02B (Prerequisite Requirements Gate)

### 1. Hiện trạng nhánh & Bối cảnh tích hợp:
- **02A (Connection Contracts):** Đã hoàn tất và được chấp thuận tại commit `6871087`.
- **02R (Callback Isolation Fix):** Đã hoàn tất và được chấp thuận tại PR #190 (`0015_slack_callback_order.sql`).
- **02B (Backend Consent & OAuth):** PR #192 (`19e4e39c`) đang trong quá trình blocking review (đang hoàn thiện các điểm hở về `returnTo` và policy revision / config matching). UI #193 cũng đang review song song.
- **Quy tắc thi công 03A:** 03A thuộc tầng hợp đồng thuần (`packages/tool-schemas`). 03A **TIẾN HÀNH ĐỘC LẬP** về mặt schema sau khi Leader duyệt kế hoạch này; các module tiêu thụ backend (03B) và adapter (03C) **BẮT BUỘC ĐỢI 02B ĐƯỢC ACCEPT VÀ MERGE** trước khi code.

### 2. Danh sách Yêu cầu Giao diện Tiêu thụ (Consumer Interface Requirements):
Tầng schema 03A xuất xưởng các hợp đồng sau để Backend và Adapter tuân thủ:
```ts
// 1. Tham chiếu chính sách xử lý đã thỏa thuận với Backend (Thực thi F1)
export interface SlackPolicyReference {
  binding: SlackBinding;
  purpose: string; // mục đích cụ thể: 'triage' | 'summarize' | 'search_lookup'
  requestedRetentionDays: number; // 0 = no retention
  providerProfileId: string; // định danh cấu hình provider
  configFingerprint: string; // mã băm cấu hình server
  policyVersion: string; // phiên bản chính sách văn bản
  consentRevision: string; // số thứ tự tăng dần dạng chuỗi thập phân chuẩn tắc (JSON-safe)
  providerRevision: string; // số thứ tự provider dạng chuỗi thập phân chuẩn tắc
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

Toàn bộ 354 phương thức từ snapshot PR 185 (head `811f5dc9`, staged tại commit `81a27b78`) được phân bổ và đóng băng trạng thái kiểm kê:
- **Tổng số phương thức:** 354 canonical methods.
- **Phương thức loại trừ (`excluded`):** 101 methods (92 Enterprise-only trong `admin.*`, 2 Enterprise trong `team.*`, 2 app-level token `apps.connections.open` & `apps.event.authorizations.list`, 1 `conversations.externalInvitePermissions.set`, 1 deprecated `files.upload`, 1 retired `rtm.start`, 1 `users.discoverableContacts.lookup`, 1 deprecated `users.setActive`).
- **Phương thức cần probe (`probe_required`):** 253 methods (Bao gồm 7 methods `slackbot.skills.*`, 27 `conversations.*`, 13 `chat.*`, 11 `users.*`, 3 `search.*`, 14 `files.*`, 24 tương tác bổ trợ, 154 methods nhóm hợp tác và quản trị nâng cao).
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
│   ├── myslack-context.ts      # Modify: Mở rộng tương thích SlackResourceType, validateSlackSourceRef, composite keys
│   ├── myslack-source.ts       # Create: Hợp đồng SlackSourceEntity, Lineage, DerivedCopy, Tombstone, Purge, PolicyRef
│   ├── myslack-tools.ts        # Create: Hợp đồng SlackToolDefinition, Metadata, Family, validateSlackToolExecutionArgs
│   └── index.ts                # Modify: Re-export contracts (bảo đảm không thêm vào ALL_TOOLS/SERVICE_REGISTRY)
└── tests/
    ├── myslack-context.test.ts # Modify: Bổ sung test resourceType mở rộng, sourceRef validation, composite key
    ├── myslack-source.test.ts  # Create: Test toàn diện F1 retention 0, F2 composite isolation, F3 cascade purge
    └── myslack-tools.test.ts   # Create: Test typed tool metadata, risk/sideEffect, execution args whitelisting
```

---

## Task Decomposition

### Task 1: Mở rộng Tương thích Định danh & Tham chiếu Nguồn (`myslack-context.ts`)

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
  - `formatSlackCompositeResourceKey(workspaceId: string, resourceType: SlackResourceType, resourceId: string): string`: Trả về `${workspaceId}:${resourceType}:${resourceId}`.
  - `formatSlackSourceKey(ref: SlackSourceRef): string`: Trả về `${ref.binding.workspaceId}:${ref.resourceType}:${ref.resourceId}@${ref.revision}#v${ref.binding.identityVersion}`.

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

it('formats stable composite keys preventing cross-workspace collision', () => {
  const key1 = formatSlackCompositeResourceKey('T_WORKSPACE_1', 'conversation', 'C_SHARED_ID');
  const key2 = formatSlackCompositeResourceKey('T_WORKSPACE_2', 'conversation', 'C_SHARED_ID');
  expect(key1).toBe('T_WORKSPACE_1:conversation:C_SHARED_ID');
  expect(key2).toBe('T_WORKSPACE_2:conversation:C_SHARED_ID');
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
Run: `npm test -w @wap/tool-schemas -- tests/myslack-context.test.ts`
Expected: FAIL với lỗi "validateSlackSourceRef is not defined".

- [ ] **Step 3: Triển khai mở rộng trong `packages/tool-schemas/src/myslack-context.ts`**
Thêm `SlackResourceType`, cập nhật `SlackSourceRef`, triển khai `validateSlackSourceRef`, `formatSlackCompositeResourceKey`, `formatSlackSourceKey`. Sử dụng `Object.hasOwn` và kiểm tra kiểu nghiêm ngặt.

- [ ] **Step 4: Chạy lại test để xác nhận PASS**
Run: `npm test -w @wap/tool-schemas -- tests/myslack-context.test.ts`
Expected: PASS 100%.

- [ ] **Step 5: Commit**
```bash
git add packages/tool-schemas/src/myslack-context.ts packages/tool-schemas/tests/myslack-context.test.ts
git commit -m "feat(slack): extend source ref types and composite key formatting"
```

---

### Task 2: Hợp đồng Vòng đời Nguồn, Purge Cascade & Tham Chiếu Chính Sách (`myslack-source.ts`)

**Files:**
- Create: `packages/tool-schemas/src/myslack-source.ts`
- Create: `packages/tool-schemas/tests/myslack-source.test.ts`

**Interfaces:**
- Consumes: `SlackBinding`, `SlackSourceRef`, `SlackResourceType`, `validateSlackBinding`, `validateSlackSourceRef` từ `./myslack-context.js`.
- Produces:
  - `SlackSourceEntity`: DTO nguồn nguyên bản không chứa credential:
    `{ id: string; sourceRef: SlackSourceRef; contentText: string; metadata: Record<string, unknown>; observedRevision: string; retentionDays: number; capturedAt: string; expiresAt: string; tombstonedAt: string | null; purgedAt: string | null }`.
  - `validateSlackSourceEntity(input: unknown): SlackSourceEntity`.
  - `SlackDerivedTargetKind`:
    `'chat_history_message' | 'working_memory_entity' | 'plan_step_arg' | 'proposal_excerpt' | 'daily_digest_entry' | 'scheduled_workflow_arg' | 'audit_log_entry'`.
  - `SlackDerivedCopyRef`:
    `{ targetKind: SlackDerivedTargetKind; targetId: string; sourceRefs: SlackSourceRef[]; createdAt: string }`.
  - `validateSlackDerivedCopyRef(input: unknown): SlackDerivedCopyRef`.
  - `SlackSourceLineage`:
    `{ sourceKey: string; origin: SlackSourceRef; derivedCopies: SlackDerivedCopyRef[] }`.
  - `validateSlackSourceLineage(input: unknown): SlackSourceLineage`.
  - `SlackTombstoneReason`:
    `'source_deleted' | 'source_edited' | 'channel_membership_lost' | 'connection_disconnected' | 'app_reinstalled' | 'consent_revoked' | 'retention_expired'`.
  - `SlackTombstoneRecord`:
    `{ sourceRef: SlackSourceRef; reason: SlackTombstoneReason; tombstonedAt: string; purgedAt: string | null }`.
  - `validateSlackTombstoneRecord(input: unknown): SlackTombstoneRecord`.
  - `SlackPurgeTarget`:
    `{ connectionId: string; workspaceId: string; resourceType: SlackResourceType; resourceId: string; revision?: string; identityVersion?: number; cascadeTargetKinds: SlackDerivedTargetKind[]; tombstoneReason: SlackTombstoneReason }`.
  - `validateSlackPurgeTarget(input: unknown): SlackPurgeTarget`.
  - `SlackPolicyReference`: Hợp đồng tham chiếu chính sách theo phản hồi từ Coordinator:
    `{ binding: SlackBinding; purpose: string; requestedRetentionDays: number; providerProfileId: string; configFingerprint: string; policyVersion: string; consentRevision: string; providerRevision: string }`.
  - `validateSlackPolicyReference(input: unknown): SlackPolicyReference`: Kiểm tra canonical decimal string (`/^\d+$/`) cho `consentRevision` và `providerRevision`.
  - `SlackSourceStorePolicy` & `decideSlackSourceStore(policy: SlackSourceStorePolicy)`:
    - Nếu `consent.status !== 'granted'` -> cấm lưu (`consent_missing`).
    - Nếu `policy.consent.policyVersion !== policy.activePolicyVersion` -> cấm lưu (`policy_changed`).
    - Nếu `policy.consent.retentionDays <= 0` -> cấm lưu trữ lâu dài (`zero_retention_required`).
    - Hợp lệ -> `{ allowed: true, maxRetentionDays: number }`.

- [ ] **Step 1: Viết test failing trong `packages/tool-schemas/tests/myslack-source.test.ts`**
Bao gồm các ca kiểm thử:
- Kiểm tra `validateSlackSourceEntity` với input hợp lệ trả về detached copy; input thiếu binding, ngày ISO không hợp lệ ném `TypeError`.
- Kiểm tra `decideSlackSourceStore` với `retentionDays: 0` trả về `{ allowed: false, reason: 'zero_retention_required' }`.
- Kiểm tra `validateSlackPolicyReference` từ chối `consentRevision: "rev-abc"` (không phải canonical decimal string); chấp nhận `"15"`.
- Kiểm tra `validateSlackPurgeTarget` bắt buộc có `cascadeTargetKinds` không rỗng và chứa các phần tử hợp lệ trong 7 loại đích phái sinh.
- Kiểm tra từ chối prototype pollution (`__proto__`, `constructor`) trên tất cả validator.

- [ ] **Step 2: Chạy test để xác nhận FAIL**
Run: `npm test -w @wap/tool-schemas -- tests/myslack-source.test.ts`
Expected: FAIL với lỗi "Cannot find module '../src/myslack-source.js'".

- [ ] **Step 3: Triển khai mã nguồn trong `packages/tool-schemas/src/myslack-source.ts`**
Viết mã triển khai đầy đủ types, interfaces và validator functions chuẩn mực.

- [ ] **Step 4: Chạy lại test để xác nhận PASS**
Run: `npm test -w @wap/tool-schemas -- tests/myslack-source.test.ts`
Expected: PASS 100%.

- [ ] **Step 5: Commit**
```bash
git add packages/tool-schemas/src/myslack-source.ts packages/tool-schemas/tests/myslack-source.test.ts
git commit -m "feat(slack): add source lineage, acl, purge and policy reference contracts"
```

---

### Task 3: Hợp đồng Siêu Dữ Liệu Công Cụ Theo Phương Thức & Kiểm Thực Tham Số (`myslack-tools.ts`)

**Files:**
- Create: `packages/tool-schemas/src/myslack-tools.ts`
- Create: `packages/tool-schemas/tests/myslack-tools.test.ts`

**Interfaces:**
- Consumes: `SlackBinding`, `validateSlackBinding` từ `./myslack-context.js`, `JSONSchema` từ `./types.js`.
- Produces:
  - `SlackMethodFamily`: Union 36 families từ kiểm kê 354 method:
    `'conversations' | 'chat' | 'users' | 'search' | 'files' | 'pins' | 'reactions' | 'bookmarks' | 'reminders' | 'stars' | 'dnd' | 'canvases' | 'slackLists' | 'skills' | 'team' | 'usergroups' | 'admin' | 'apps' | 'assistant' | 'agents' | 'calls' | 'functions' | 'workflows' | 'views' | 'misc' ...`
  - `SlackSideEffect`: `'read' | 'write'`
  - `SlackRiskLevel`: `'low' | 'medium' | 'high'`
  - `SlackPlanTier`: `'free' | 'pro' | 'any'`
  - `SlackToolMetadata`:
    `{ method: string; family: SlackMethodFamily; sideEffect: SlackSideEffect; riskLevel: SlackRiskLevel; requiredScopes: string[]; planTier: SlackPlanTier; isProbeRequired: boolean; discovers?: string; listable?: boolean; requiresBinding: true }`
  - `SlackToolDefinition`:
    `SlackToolMetadata & { name: string; service: 'myslack'; description: string; inputSchema: JSONSchema; outputSchema: JSONSchema }`
  - `validateSlackToolDefinition(input: unknown): SlackToolDefinition`
  - `validateSlackToolExecutionArgs(tool: SlackToolMetadata, args: unknown): { binding: SlackBinding; params: Record<string, unknown> }`:
    - Yêu cầu bắt buộc trường `binding` thuộc own property.
    - Validate binding qua `validateSlackBinding`.
    - Lọc bỏ triệt để các trường nhạy cảm như `token`, `accessToken`, `client_secret`, `authHeader`.
    - Trả về object tách rời `{ binding, params }`.
  - Khai báo metadata mẫu cho nhóm phương thức cốt lõi 03C (`conversations.list`, `conversations.history`, `chat.postMessage`, `users.info`) để làm chuẩn cho Adapter 03C.

- [ ] **Step 1: Viết test failing trong `packages/tool-schemas/tests/myslack-tools.test.ts`**
Bao gồm các ca kiểm thử:
- Kiểm tra `validateSlackToolDefinition` ném lỗi khi `sideEffect` không phải `'read' | 'write'`.
- Kiểm tra `validateSlackToolExecutionArgs` ném `TypeError` khi thiếu `binding`.
- Kiểm tra `validateSlackToolExecutionArgs` tự động tước bỏ `token: "xoxp-..."` nếu xuất hiện trong input args.
- Kiểm tra metadata nhóm cốt lõi: `chat.postMessage` có `sideEffect: 'write'`, `riskLevel: 'high'`, `requiredScopes: ['chat:write']`.
- Invariant: Khẳng định sự tồn tại của `SlackToolDefinition` không cấp quyền tự động cho runtime nếu thiếu policy validation.

- [ ] **Step 2: Chạy test để xác nhận FAIL**
Run: `npm test -w @wap/tool-schemas -- tests/myslack-tools.test.ts`
Expected: FAIL với lỗi "Cannot find module '../src/myslack-tools.js'".

- [ ] **Step 3: Triển khai mã nguồn trong `packages/tool-schemas/src/myslack-tools.ts`**
Xây dựng types, validation và tool definitions mẫu.

- [ ] **Step 4: Chạy lại test để xác nhận PASS**
Run: `npm test -w @wap/tool-schemas -- tests/myslack-tools.test.ts`
Expected: PASS 100%.

- [ ] **Step 5: Commit**
```bash
git add packages/tool-schemas/src/myslack-tools.ts packages/tool-schemas/tests/myslack-tools.test.ts
git commit -m "feat(slack): add typed per-method tool metadata and execution argument validation"
```

---

### Task 4: Tích Hợp Re-export & Bảo Vệ Cách Ly Danh Mục Toàn Cục (`index.ts`)

**Files:**
- Modify: `packages/tool-schemas/src/index.ts:20-40`
- Modify: `packages/tool-schemas/tests/registry-invariants.test.ts`

**Interfaces:**
- Consumes: `./myslack-source.js`, `./myslack-tools.js`.
- Produces: Re-export toàn bộ hợp đồng ra entrypoint của package.
- Invariant:
  - `ALL_TOOLS.some(t => t.service === 'myslack') === false`.
  - `SERVICE_REGISTRY.some(s => s.id === 'myslack') === false`.

- [ ] **Step 1: Cập nhật test kiểm tra invariant trong `tests/registry-invariants.test.ts`**
Thêm assertion kiểm tra không có bất kỳ tool hay service `myslack` nào xuất hiện trong registry mặc định.

- [ ] **Step 2: Cập nhật `packages/tool-schemas/src/index.ts`**
Thêm:
```ts
export * from './myslack-source.js';
export * from './myslack-tools.js';
```
Bảo đảm không thêm vào mảng `ALL_TOOLS`.

- [ ] **Step 3: Chạy toàn bộ test suite của `@wap/tool-schemas` và typecheck**
Run:
```bash
npm test -w @wap/tool-schemas
npm run typecheck
```
Expected: Toàn bộ 14 test files của `@wap/tool-schemas` PASS, `typecheck` exit 0.

- [ ] **Step 4: Commit**
```bash
git add packages/tool-schemas/src/index.ts packages/tool-schemas/tests/registry-invariants.test.ts
git commit -m "feat(slack): export source and tool contracts while preserving catalog isolation"
```

---

### Task 5: Lập Bảng Yêu Cầu Giao Diện Tiêu Thụ & Cổng Review Cho Backend 03B và Adapter 03C

**Mục tiêu:** Cung cấp tài liệu giao ước chi tiết cho các kỹ sư Backend (03B) và Integration (03C) trước khi họ bắt đầu thi công code.

1. **Yêu cầu đối với Backend 03B (`SlackSourceStore`, `SlackPurgeRunner`):**
   - Migration `db/v3/[proposed: NNNN_slack_source_store.sql]`: Tạo bảng `slack_sources` với primary key `id`, index trên composite `(user_id, connection_id, identity_version)`, cột `tombstone_at`, `expires_at`.
   - `SlackSourceStore.saveSource(entity: SlackSourceEntity)`: Lưu trữ nội dung nguyên bản sau khi đã xác thực `decideSlackSourceStore`. Nếu `retentionDays === 0` -> từ chối lưu.
   - `SlackPurgeRunner.purgeTarget(target: SlackPurgeTarget)`: Thực hiện xoá cascade trên 7 loại đích phái sinh:
     - Ghi nhận `tombstonedAt = NOW()` trên `slack_sources`.
     - Quét và che/xoá text trong chat history messages mang `sourceRef` tương ứng.
     - Xoá working memory snapshot.
     - Vô hiệu hoá plan step args và đề xuất chưa duyệt.
   - Invariant: Purge runner hoạt động ngay cả khi `MYSLACK_AUTOMATION_ENABLED=off` (F4).

2. **Yêu cầu đối với Adapter 03C (`PersonalSlackAdapter`):**
   - Bắt buộc kiểm tra `validateSlackToolExecutionArgs` trước khi gọi Slack Web API.
   - Chỉ giải mã `tokenEncrypted` trong phạm vi nội bộ adapter tại thời điểm dispatch, không trả token ra ngoài.
   - Áp dụng timeout `AbortSignal` thật.
   - Nếu gặp timeout mạng sau khi HTTP request đã dispatch -> trả trạng thái `UNKNOWN`, cấm retry write tự động (Execution Safety).

3. **Cổng Phê Duyệt Trước Khi Code 03B/03C:**
   - 02B PR 192 (`19e4e39c`) đã khắc phục triệt để các điểm review và được merge vào base branch.
   - Leader phê duyệt hoàn tất kế hoạch 03A này.
   - Không tự ý sinh code backend/adapter trước khi có sự đồng thuận interface.

---

## Self-Review Checklist

1. **Spec Coverage:** Bao phủ toàn diện F1 (Data Retention 0 & Stale Policy Ref), F2 (Cross-Workspace Composite Identity Isolation), F3 (Full Cascade Purge Lineage), F4 (Lifecycle Independent of Automation Flag).
2. **Step Granularity:** Mỗi task gồm 5 bước TDD Red-Green-Refactor rõ ràng, có lệnh kiểm thử cụ thể và expected outcome xác định.
3. **Type Consistency:** Đồng bộ hoàn hảo giữa `SlackBinding`, `SlackSourceRef`, `SlackResourceType`, `SlackSourceEntity`, `SlackPolicyReference` và `SlackToolDefinition`.
4. **Proportion:** Kế hoạch tập trung sâu vào hợp đồng interface và ranh giới module, không viết trước hàng nghìn dòng code triển khai của backend.
5. **Ledger Integrity:** Toàn bộ 354 phương thức từ snapshot PR 185 (head `811f5dc9`) được kiểm kê đầy đủ, không thiếu sót bất kỳ family nào.
