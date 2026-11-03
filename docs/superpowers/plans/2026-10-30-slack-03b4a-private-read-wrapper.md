# Kế hoạch SLACK-03B4A · Private Backend Read Wrapper

**Ngày:** 30/10/2026 (Asia/Saigon)
**Task card:** [SLACK-03B4A-private-read-wrapper](../../handoff/tasks/SLACK-03B4A-private-read-wrapper.md)
**Nhánh:** `VinhDat267/feat-slack-03b4a-private` (worktree `feat-slack-03b4a-private-read-wrapper`)
**Nền:** `715193c2` (`integration/slack-personal-20261029`)
**Vai trò sở hữu:** Backend (`apps/chat-api/`)
**Hợp đồng đóng băng:** `docs/handoff/decisions/2026-10-29-slack-source-ingress-contracts.md` tại `e9088d5e`

---

## 1. Mục tiêu và phạm vi

Xây một wrapper Backend **riêng, nội bộ** nối các dịch vụ thật đã được review:

- `SlackTokenManager.getAccessToken(userId, connectionId, identityVersion)`
- `SlackPolicyService.resolveSlackModelPolicy(...)`
- `SlackInvalidationService.checkBarriers(...)`
- `PersonalSlackReadAdapter` (8 read methods đã chấp nhận tại SLACK-03C1)

Wrapper cung cấp một điểm vào duy nhất cho lời gọi đọc nội bộ:

```ts
executeRead({
  callerAtiUserId: string,       // danh tính từ phiên Backend đã xác thực, không từ model
  binding: SlackBinding,         // đủ 5 trường
  tool: string,                  // đúng 8 read tools
  params: Record<string, unknown>,
  purpose: SlackReadPurpose,     // manual_lookup | triage | planning | digest
  signal?: AbortSignal,
}): Promise<{ tool: string; data: unknown; policyReference: SlackPolicyReference }>
```

### Trong phạm vi

- Chuyển đổi policy reference legacy (12 trường, có alias) sang canonical đúng 8 trường qua `validateSlackPolicyReference`.
- Kiểm tra 5 trường binding, active user/connection, F1 hiện hành, provisional/binding/channel/resource/epoch barriers trước token và trước transport.
- Kiểm tra lại sau khi token manager trả credential, sau response và trước khi trả DTO.
- Áp dụng deadline của wrapper và `AbortSignal` của caller; không trả nội dung muộn.
- Kiểm tra provenance từng quan sát và từng resource trước khi trả trang.
- Mã lỗi cố định, không rò rỉ token/cursor/payload/cause/details/log.
- Chỉ dùng PostgreSQL 55533 và HTTP loopback fixture trong kiểm thử; không gọi Slack/model thật.

### Ngoài phạm vi (tuyệt đối không làm trong slice này)

- Không sửa `app.ts`, `server.ts`, `SlackConnectionRepo`, `SlackTokenManager`, `SlackPolicyService`, `SlackInvalidationService`, `SlackInvalidationRunner`.
- Không sửa `packages/tool-schemas`, `packages/tool-adapters`, `packages/executor`, `packages/planner`, `apps/chat-web`.
- Không sửa migration, `CURRENT-STATE.md`, `ROADMAP.md`, tài liệu khác.
- Không thêm route công khai, không đăng ký `ALL_TOOLS`, không bật `MYSLACK_ENABLED`, không routing/planner/UI.
- Không lưu raw/derived Slack content, không gọi model, không tuyên bố F3 đã đóng.
- Không dùng fallback "connection đầu tiên"; không nhận generic method dispatcher.

---

## 2. Hợp đồng thực tế đã đọc

### 2.1. Token manager

`apps/chat-api/src/services/slack/token-manager.ts`

```ts
getAccessToken(userId: string, id: string, identityVersion: number): Promise<string>
```

- Giữ advisory lock `ati-slack-owner` trong suốt refresh mạng.
- Tự kiểm tra active/identityVersion/`refresh_in_flight`/config/expiry.
- Refresh dùng `AbortSignal.timeout(timeoutMs)` riêng; không nhận signal của caller.

**Hệ quả:** wrapper không bọc `getAccessToken` trong `withOwner` (tránh tự khóa chéo). Wrapper chỉ `await` token manager, sau đó mở lại owner gate ngắn để kiểm tra hậu-refresh; đây là lock acquisition sau khi token manager đã trả, không phải lồng lock.

### 2.2. Policy service

`apps/chat-api/src/services/slack/policy-service.ts`

```ts
resolveSlackModelPolicy({
  binding, purpose, requestedRetentionDays,
  expectedPolicyReference?, env?
}): Promise<
  | { allowed: true; policyReference: LegacySlackPolicyReference }
  | { allowed: false; reason: SlackPolicyBlockReason }
>
```

- `LegacySlackPolicyReference` có 12 trường, gồm alias `providerId`, `configurationFingerprint`, `retentionDays`, `workspaceId`.
- Với `expectedPolicyReference`, service kiểm tra đủ canonical fields, binding, purpose, retention, provider/profile, policy version, consent revision, provider revision.
- Service kiểm tra active user/connection, workspace, actor, identityVersion, provider attestation thật trong DB, consent thật trong DB.

**Hệ quả:** wrapper map sang canonical 8 trường bằng `validateSlackPolicyReference`; không trả alias; pin epoch đầu tiên và dùng lại làm expected cho mọi lần re-auth.

### 2.3. Invalidation service

`apps/chat-api/src/services/slack/slack-invalidation-service.ts`

```ts
checkBarriers(query: {
  binding?, channelId?, epoch?, epochHash?,
  resourceType?, resourceId?, revision?, workspaceId?
}): Promise<{blocked: boolean; barrierType?; reason?; barrierId?}>
```

- Binding/provisional: khớp đúng 5 trường.
- Channel: khớp binding + channelId.
- Epoch: khớp hash của đúng epoch.
- Resource: khớp workspace + resourceType + resourceId; `deleted` chặn; `minValidRevision` chặn nếu revision thiếu hoặc nhỏ hơn.

**Hệ quả:** `checkBarriers({binding})` một mình không đủ. Wrapper kiểm tra thêm channel và resource cụ thể của request, rồi resource của từng quan sát sau response.

### 2.4. Read adapter

`packages/tool-adapters/src/slack/personal-slack-read-adapter.ts`

- Fixed switch đúng 8 read methods; từ chối write/unknown.
- `verifyPolicy` pre-fetch, trước mỗi attempt/retry, sau response.
- Token hook nhận binding frozen; adapter bọc hook trong `awaitWithAbort`.
- DTO có provenance cấp entity và cấp container:
  - `binding` đủ 5 trường
  - `resourceIdentity`
  - `observedAt` ISO
  - `acquisitionPolicyReference` canonical 8 trường
  - `nativeRevision` (message: `edited.ts ?? ts`; method khác: undefined)
  - `observationalDigest` SHA-256 hex
- Message identity trong provenance: `{type:'message', channelId, messageTs}`.
- Container identity:
  - `conversations.list`: `{type:'conversation'}`
  - `conversations.info`: `{type:'conversation', channelId}`
  - `conversations.history`: `{type:'message', channelId}`
  - `conversations.replies`: `{type:'message', channelId, messageTs: rootTs}`
  - `conversations.members`: `{type:'members', channelId}`
  - `users.list`: `{type:'users'}`
  - `users.info`: `{type:'user', userId}`
  - `chat.getPermalink`: `{type:'permalink', channelId, messageTs}`

---

## 3. Kiến trúc wrapper

Tệp mới duy nhất: `apps/chat-api/src/services/slack/slack-private-read-wrapper.ts`

### 3.1. Dependency injection

```ts
export interface SlackPrivateReadWrapperDeps {
  policyService: Pick<SlackPolicyService, 'resolveSlackModelPolicy'>;
  tokenManager: Pick<SlackTokenManager, 'getAccessToken'>;
  invalidationService: Pick<SlackInvalidationService, 'checkBarriers'>;
  ownerGate: Pick<SlackConnectionRepo, 'withOwner'>;
  runtimeConfig?: { env?: Record<string, string | undefined> };
  apiBaseUrl?: string;
  fetchFn?: typeof fetch;
  requestTimeoutMs?: number;
  deadlineMs?: number;
  createAdapter?: (config: PersonalSlackReadAdapterConfig) =>
    SlackReadAdapterLike | Promise<SlackReadAdapterLike>;
}
```

- `runtimeConfig.env` là nguồn duy nhất cho `MYSLACK_ENABLED`; không đọc `process.env` và không đọc `.env`.
- `ownerGate` chỉ dùng **sau** `getAccessToken` để kiểm tra hậu-refresh dưới cùng owner lock. Không bọc token manager.
- `createAdapter` mặc định tạo `new PersonalSlackReadAdapter(config)`; test có thể bọc adapter thật để mô phỏng thay đổi DB giữa response và validation.

### 3.2. Trình tự `executeRead`

1. **Flag:** `runtimeConfig.env?.MYSLACK_ENABLED === 'on'`; nếu thiếu/off/giá trị lạ → `SLACK_READ_DISABLED`. Không có fallback.
2. **Request shape:** `callerAtiUserId` non-blank; `binding` plain object; `tool` string; `params` plain object; `purpose` thuộc 4 read purposes; `signal` hợp lệ hoặc undefined.
3. **Detach + validate:** `structuredClone` params/binding; `validateSlackBinding`; `callerAtiUserId.trim() === binding.atiUserId` (nếu không → `SLACK_READ_IDENTITY_MISMATCH`).
4. **Tool allowlist:** `MYSLACK_CORE_READ_TOOLS.find(name === tool && sideEffect === 'read')`; nếu không → `SLACK_READ_INVALID_REQUEST`. Không có write/unknown/generic dispatcher.
5. **Canonical params:** `validateSlackToolExecutionArgs(toolDef, {binding, params})`; dùng `cleanParams` đã validate, không dùng raw params.
6. **Deadline/signal:** `AbortSignal.timeout(deadlineMs)` + `AbortSignal.any([caller, deadline])`; kiểm tra aborted trước khi tạo adapter.
7. **Per-invocation state:** `pinnedRef`, `denialCode`, `failureCode`, `binding`, `purpose`, `params`, `signal`, `deadlineSignal`, `callerSignal`.
8. **Adapter:** factory được gọi với config chỉ gồm hooks, `apiBaseUrl` đã normalize, `fetchFn`, `requestTimeoutMs`. Factory/hook/execute đều nằm trong race với signal.
9. **Hooks:** mỗi invocation có policy hook và token hook riêng; không có state dùng chung giữa hai lời gọi đồng thời.
10. **Post-DTO:** validate toàn bộ provenance; kiểm tra channel/resource barriers của mọi quan sát; kiểm tra F1/epoch/binding/provisional lần cuối với `expected = pinnedRef`.
11. **Trả:** `{tool, data, policyReference: pinnedRef}`; retention 0; không lưu DB, không gọi model.

### 3.3. Policy hook

`authorizeRead(input)`:

- Validate input là plain object; `binding` exact 5 trường; `purpose` đúng purpose của invocation; `requestedRetentionDays === 0`.
- Nếu `expectedPolicyReference` có: validate canonical 8 trường và phải bằng `pinnedRef`; nếu chưa pin hoặc khác → deny `SLACK_READ_EPOCH_CHANGED`.
- Nếu đã pin mà lần gọi sau không có expected → deny (không cho regrant ngầm).
- Gọi `resolveSlackModelPolicy({binding, purpose, requestedRetentionDays: 0, expectedPolicyReference: pinned?, env})`.
- Deny của service → `{allowed:false, reason}` + ghi `denialCode = SLACK_READ_POLICY_DENIED`.
- Map legacy ref sang canonical 8 trường; kiểm tra binding/purpose/retention; pin lần đầu; các lần sau phải cùng ref.
- Kiểm tra barriers:
  - `{binding, epoch: slackPolicyRefToEpoch(pinned)}` cho binding/provisional/epoch.
  - `{binding, channelId}` cho từng channel đã biết từ params.
  - `{binding, resourceType, resourceId, revision?}` cho từng resource đã biết từ params.
- Barrier chặn → `denialCode = SLACK_READ_BARRIERED`, reason an toàn `policy_changed` hoặc `policy_epoch_invalidated`.
- Lỗi DB/hook bất ngờ → deny `SLACK_READ_INTERNAL` (fail-closed), không ném chi tiết ra ngoài.
- Trả `{allowed:true, policyReference: frozen canonical}`.

### 3.4. Token hook

`getAccessToken(binding)`:

1. Validate binding exact 5 trường và không aborted.
2. Gọi lại policy hook với `expectedPolicyReference = pinnedRef` (F1 + barriers) **trước** token manager.
3. Nếu deny → ghi `failureCode` và ném lỗi nội bộ an toàn, không gọi token manager.
4. `await tokenManager.getAccessToken(binding.atiUserId, binding.connectionId, binding.identityVersion)`.
5. Nếu aborted sau await → ném `SLACK_READ_ABORTED`/`SLACK_READ_DEADLINE_EXCEEDED`; token bị bỏ, không trả adapter.
6. Mở `ownerGate.withOwner(binding.atiUserId, ...)` **sau khi token manager đã trả**, kiểm tra lại policy/barriers với expected pinned. Điều này xếp hàng sau disconnect đang chờ owner lock; nếu disconnect đã commit, policy deny và token bị bỏ.
7. Nếu aborted trong/sau gate → ném lỗi abort; token bị bỏ.
8. Trả token cho adapter.
9. Mọi lỗi token manager → `SLACK_READ_TOKEN_UNAVAILABLE`; không echo message/cause.

### 3.5. Deadline và nội dung muộn

- `raceWithSignal(promise, invocation)` thắng theo abort; khi abort thắng, gắn `promise.catch(() => {})` để không unhandled rejection và không bao giờ trả value muộn.
- Áp dụng cho factory, hook, adapter execute.
- Adapter tự có `requestTimeoutMs` và `AbortSignal.any`; wrapper deadline là lớp ngoài.
- Token manager có thể hoàn tất refresh dưới owner lock sau khi caller abort; wrapper không tuyên bố đã hủy network. Test chứng minh không dispatch và không trả credential muộn.

### 3.6. Post-DTO validation

Trước khi trả, wrapper kiểm tra:

- `result` plain object, `ok === true`.
- Với từng entity:
  - `provenance.binding` đủ 5 trường và bằng binding invocation.
  - `provenance.acquisitionPolicyReference` canonical 8 trường và bằng `pinnedRef` (kể cả purpose + retention 0).
  - `provenance.resourceIdentity` đúng type/ID/revision với entity.
  - `provenance.observedAt` ISO canonical.
  - `provenance.observationalDigest` SHA-256 hex.
  - Message: `ts`/`edited.ts` đúng `^\d{10}\.\d{6}$`; `nativeRevision === edited.ts ?? ts`.
- Container provenance đúng identity của method (bảng §2.4).
- `conversations.members`: từng member ID là user resource; container provenance đúng.
- `users.list`: từng user entity có provenance user; container đúng.
- `chat.getPermalink`: `channel === params.channel`; provenance permalink đúng channel + message_ts.
- Kiểm tra channel/resource barriers cho **tất cả** quan sát; nếu bất kỳ resource bị chặn → `SLACK_READ_BARRIERED`, không trả trang.
- Kiểm tra F1/epoch/binding/provisional lần cuối với expected pinned; nếu deny → lỗi tương ứng.
- Thiếu provenance/không đủ bằng chứng resource → `SLACK_READ_PROVENANCE_INVALID` (fail-closed).

### 3.7. Resource identity dùng cho barrier

| Method | Channel barrier | Resource kiểm tra trước token | Resource kiểm tra sau DTO |
|---|---|---|---|
| `conversations.list` | — | — | `conversation` cho từng channel |
| `conversations.info` | `params.channel` | `conversation` | `conversation` |
| `conversations.history` | `params.channel` | `conversation` | `conversation` + `message` từng message |
| `conversations.replies` | `params.channel` | `conversation` + `message` root (`ts`) | `conversation` + `message` từng message |
| `conversations.members` | `params.channel` | `conversation` | `conversation` + `user` từng member |
| `users.list` | — | — | `user` từng user |
| `users.info` | — | `user` (`params.user`) | `user` |
| `chat.getPermalink` | `params.channel` | `conversation` + `message` (`message_ts`) | `conversation` + `message` |

- Message resource ID: `JSON.stringify([channelId, messageTs])`; **không** dùng `_`, không chỉ timestamp, không gộp workspace vào resource ID.
- `workspaceId` truyền riêng qua `binding.workspaceId`.
- Revision của message: `edited.ts ?? ts` (chuỗi chính xác).
- Revision của root replies/permalink: `ts`/`message_ts` đã validate; barrier `minValidRevision` mới hơn sẽ chặn trước transport (fail-closed, vì chưa có revision quan sát thực tế).
- Dedupe resource theo `type + id + revision` để giảm truy vấn; mỗi resource vẫn được kiểm tra.

---

## 4. Thứ tự cổng fail-closed

1. Flag off → deny.
2. Request shape/signal/purpose/tool/params sai → deny, không chạm DB/token/transport.
3. Caller ≠ binding.atiUserId → deny.
4. Binding 5 trường sai/thiếu → deny.
5. Policy F1 (active user/connection, workspace/actor/identityVersion, provider attestation, consent, retention) → deny trước token.
6. Barrier binding/provisional/epoch/channel/resource đã biết → deny trước token.
7. Token hook re-check F1 + barriers trước token manager; token manager kiểm tra lần nữa.
8. Token hook re-check sau token manager, dưới owner gate.
9. Adapter re-auth trước mỗi attempt/retry và sau response.
10. Wrapper validate provenance + barrier từng entity.
11. F1/epoch/binding/provisional lần cuối.
12. Trả DTO.

Bất kỳ bước nào không có đủ bằng chứng → deny. Không có nhánh "bỏ qua kiểm tra".

---

## 5. Mã lỗi an toàn

`SlackPrivateReadError` chỉ có `code` (message = code), không có `cause/details`:

| Code | Ý nghĩa |
|---|---|
| `SLACK_READ_DISABLED` | `MYSLACK_ENABLED` không phải `on` |
| `SLACK_READ_INVALID_REQUEST` | Request/tool/params/purpose/signal sai |
| `SLACK_READ_INVALID_CONFIG` | Base URL/timeout/dependency wiring sai |
| `SLACK_READ_IDENTITY_MISMATCH` | Caller/binding/actor/workspace/version sai |
| `SLACK_READ_POLICY_DENIED` | F1/connection/consent/provider/retention deny |
| `SLACK_READ_BARRIERED` | Binding/provisional/channel/resource/epoch barrier |
| `SLACK_READ_EPOCH_CHANGED` | Expected ref/epoch không còn khớp |
| `SLACK_READ_TOKEN_UNAVAILABLE` | Token manager không trả credential |
| `SLACK_READ_AUTHORIZATION_FAILED` | Provider trả lỗi auth |
| `SLACK_READ_NOT_FOUND` | Provider trả not found |
| `SLACK_READ_RATE_LIMITED` | Hết budget 429 |
| `SLACK_READ_PROVIDER_ERROR` | Lỗi transport/provider khác |
| `SLACK_READ_PROVENANCE_INVALID` | DTO/provenance/resource proof không hợp lệ |
| `SLACK_READ_ABORTED` | Caller hủy |
| `SLACK_READ_DEADLINE_EXCEEDED` | Deadline wrapper |
| `SLACK_READ_INTERNAL` | Lỗi nội bộ không xác định |

Không có message/cause/details chứa token, refresh token, cursor, payload Slack, URL có credential, hay nội dung lỗi provider.

---

## 6. Tệp thay đổi

| Thao tác | Tệp | Mục đích |
|---|---|---|
| Create | `apps/chat-api/src/services/slack/slack-private-read-wrapper.ts` | Wrapper + hooks + validation |
| Create | `apps/chat-api/tests/helpers/slack-private-read-fixture.ts` | HTTP fixture loopback + seed/stage helpers |
| Create | `apps/chat-api/tests/services/slack/slack-private-read-wrapper.test.ts` | Flag, request, binding/F1, 8 methods, token/deadline/disconnect |
| Create | `apps/chat-api/tests/services/slack/slack-private-read-wrapper-provenance.test.ts` | Barrier pre/post, provenance, isolation, exact resource keys |
| Create | `docs/handoff/tasks/SLACK-03B4A-private-read-wrapper.md` | Task card |
| Create | `docs/superpowers/plans/2026-10-30-slack-03b4a-private-read-wrapper.md` | Kế hoạch này |
| Create | `docs/handoff/log/2026-10-30-slack-03b4a-private-read-wrapper.md` | Log bàn giao duy nhất |

Không sửa tệp hiện hữu nào khác.

---

## 7. Ma trận kiểm thử

### 7.1. Cổng request/flag (không chạm DB/token/transport)

1. Flag thiếu/off/giá trị lạ → disabled; `process.env` bị bỏ qua.
2. Flag on từ env inject → chạy.
3. Write tool, unknown tool, tool non-read → invalid request.
4. Purpose `storage`/lạ → invalid request.
5. Params thiếu/sai kiểu/thừa key → invalid request.
6. Binding thiếu trường/identityVersion ≤ 0 → invalid request.
7. Caller ≠ binding.atiUserId → identity mismatch.
8. Signal sai kiểu → invalid request.
9. Base URL ngoài native/loopback → invalid config.
10. Factory/hook/execute treo → deadline/abort settle, không trả nội dung muộn.

### 7.2. Binding/F1 thật với PostgreSQL

11. Đủ 5 trường + active user/connection + provider attestation + consent → allow.
12. Từng trường binding sai (workspace, connection, slackUserId, identityVersion) → deny trước token/transport.
13. User `disabled` → deny.
14. Connection `reconnect_required`/`disconnected` → deny.
15. Reconnect thật làm identityVersion tăng; binding cũ → deny.
16. Consent revoked → deny.
17. Provider `verified=false` → deny.
18. Config fingerprint drift → deny.
19. Provider row thiếu (env provider khác) → deny.
20. Connection của user khác (không sở hữu) → deny, không fallback.
21. Không có provider/consent row → deny.

Tất cả case deny dùng **counting token manager thật** và fixture HTTP để chứng minh `tokenCalls === 0`, `GET requests === 0`.

### 7.3. 8 read methods

22. Mỗi method trả DTO đúng shape, provenance entity/container, canonical policy ref 8 trường, retention 0, binding đúng; không có alias legacy; không có token trong DTO.
23. `conversations.replies` trả root + replies; `chat.getPermalink` đúng channel/ts.
24. `users.list`/`conversations.members` resource user được kiểm tra.

### 7.4. Barrier pre-token

25. Binding barrier.
26. Provisional barrier.
27. Exact epoch barrier (hash đúng) chặn; epoch khác không chặn.
28. Channel barrier đúng binding/channel chặn trước token.
29. Resource barrier `deleted` cho message root replies/permalink chặn trước token.
30. Resource barrier `minValidRevision` mới hơn requested ts chặn trước token (fail-closed).
31. 429 lần đầu staged channel barrier; retry bị chặn trước transport lần hai.

### 7.5. Barrier post-response / provenance

32. Channel barrier staged sau adapter response → wrapper chặn, không trả trang.
33. Resource barrier staged sau adapter response cho một message trong trang → chặn cả trang.
34. Provisional/binding/epoch barrier staged sau adapter response → chặn.
35. Provenance entity bị sửa binding/ref/identity/nativeRevision/digest → provenance invalid.
36. Container provenance bị sửa → provenance invalid.
37. Regrant thật giữa response và validation, DTO bị relabel ref mới → provenance invalid (không nhận quyền mới).
38. Revoke consent thật sau response → policy denied, không trả payload.
39. Message resource ID đúng `JSON.stringify([channel, ts])`; decoy `_`/timestamp-only không chặn.
40. Resource barrier workspace A không chặn workspace B cùng channel/ts.

### 7.6. Đồng thời và token

41. Hai user thật, hai workspace thật, cùng channel ID, hai read đồng thời: mỗi bên chỉ thấy dữ liệu/token/provenance của mình; fixture xác nhận hai Authorization khác nhau.
42. Refresh thật khi token hết hạn: TokenManager gọi OAuth fixture; adapter dùng token mới.
43. Caller abort khi policy hook treo → reject sớm, không token/GET; release sau không trả nội dung.
44. Caller abort khi refresh treo → reject sớm, không GET; refresh có thể hoàn tất sau (không tuyên bố hủy network); fresh token không xuất hiện trong lỗi/DTO.
45. Disconnect trong lúc refresh giữ owner lock → read reject sau owner gate; không GET; config NULL; fresh token không rò rỉ.
46. Token/cursor/payload opaque trong lỗi provider → không xuất hiện trong `message`, `JSON.stringify`, `cause`, `details`, console.
47. Sau read thành công: `slack_sources`/`messages` không có raw content mới; không gọi model.

### 7.7. Bằng chứng lệnh

- `npm test -w @wap/chat-api -- tests/services/slack/slack-private-read-wrapper.test.ts`
- `npm test -w @wap/chat-api -- tests/services/slack/slack-private-read-wrapper-provenance.test.ts`
- `npm test -w @wap/chat-api`
- `npm run typecheck:v3`
- `npm run check`
- `git diff --check`

Lưu raw output vào `.superpowers/slack-03b4a/` (ignored), ghi kết quả thật vào log.

---

## 8. Trình tự TDD

1. Viết helper fixture + 2 test file trước.
2. Chạy targeted test → RED do thiếu module; lưu log.
3. Viết wrapper tối thiểu cho request/flag/hooks.
4. Chạy lại từng nhóm; bổ sung validation/barrier/provenance.
5. GREEN targeted; chạy toàn bộ chat-api.
6. Chạy typecheck, `npm run check`, `git diff --check`.
7. Điền "Kết quả" task card + log; commit; push; draft PR.

---

## 9. Cổng NOT_RUN / còn mở

- Native Slack thật và model acceptance: **NOT_RUN** (không có phép gọi Slack/model thật).
- Ingress runtime/lifecycle probe của 04A (queue invalidator chạy đầu-cuối): **NOT_RUN** vì nền 04A chưa merge vào integration; slice này chỉ dùng barrier 03B1 đã chấp nhận.
- F3 storage/derived persistence (03B2/03B3): **NOT_RUN**; wrapper chỉ transient retention 0, không tuyên bố F3.
- Routing/planner/executor/UI/cờ nội dung: **NOT_RUN**; flag mặc định off.
- Native Slack scope/ACL thực tế: **NOT_RUN**; fixture chỉ chứng minh ranh giới wrapper.

---

## 10. Rủi ro và giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| TokenManager giữ owner lock khi refresh | Không lồng `withOwner`; chỉ mở owner gate sau khi token trả; test disconnect thật |
| PolicyService trả alias legacy | Map qua `validateSlackPolicyReference`, chỉ trả 8 trường; test keys |
| `checkBarriers({binding})` bỏ sót resource | Bảng resource theo method; test từng loại barrier |
| Barrier staged sau response | Factory test bọc adapter thật, stage barrier thật sau execute; wrapper chặn |
| Provenance bị relabel bằng grant mới | So khớp từng provenance với pinned ref đầu tiên; test regrant thật |
| Abort muộn trả nội dung | `raceWithSignal` + `promise.catch`; test adapter/factory/hook treo |
| Token rò rỉ trong lỗi | Error chỉ có code; test opaque token/payload |
| Fallback connection đầu tiên | PolicyService query đúng `(connectionId, userId)`; test connection của user khác |
| Base URL tùy ý | Normalize native/loopback trước factory; test host lạ |
| Hai invocation dùng chung state | Toàn bộ state là local; factory mới mỗi lần; test đồng thời |

## Runtime rulings after independent review — 30/10/2026

The three P2 findings enter one direct fix pass. A valid empty array is allowed when the complete container provenance is valid; zero entities does not mean missing acquisition evidence. A malformed barrier decision is rejected unless its `blocked` value is explicitly boolean. Binding and canonical acquisition references are detached and frozen before being handed to the adapter.

Final result validation collects all observed channels/resources, including entities discovered only in the response. Before releasing the DTO, the wrapper opens a short caller-owner-gated transaction, takes the same globally sorted invalidation advisory keys as stagers/source writers, then locks authority rows `FOR SHARE` in user → connection → provider → consent order. Current policy and every observed barrier are checked under those locks. COMMIT is the read snapshot's ordering point. An invalidation that wins those locks blocks the result; one that loses cannot commit until the read snapshot commits. This does not retract data returned before a later invalidation.

The final gate holds no token refresh/network operation. Its caller abort/deadline is observed; a late dependency completion is never returned. Existing owner-gate acquisition can still settle after caller cancellation, as with the documented TokenManager limitation. SQL statement timeout is bounded by the remaining invocation budget when entering the final transaction. No general deadlock-proof claim is made. Real two-client tests observe the stager's actual `pg_stat_activity` advisory wait and verify the subsequent read is blocked after its commit.

The evaluation static guard adds one anchored exception for `slack.com` in this dedicated provider boundary, documenting its credential destination check; generic routing rules remain enforced.
