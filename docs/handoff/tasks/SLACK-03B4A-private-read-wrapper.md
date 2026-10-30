# SLACK-03B4A · Private Backend Read Wrapper cho 8 Read Methods

**Trạng thái:** ĐANG THI CÔNG · Backend Implementation Owner.
**Nhánh:** `VinhDat267/feat-slack-03b4a-private` (worktree `feat-slack-03b4a-private-read-wrapper`)
**Nền đối chiếu:** `715193c2` (`integration/slack-personal-20261029`)
**PR Đích:** Draft PR to `integration/slack-personal-20261029`
**Vai trò sở hữu:** Backend (`apps/chat-api/`) + tài liệu handoff
**Hợp đồng đóng băng:** [`docs/handoff/decisions/2026-10-29-slack-source-ingress-contracts.md`](../decisions/2026-10-29-slack-source-ingress-contracts.md) tại `e9088d5e`
**Kế hoạch chi tiết:** [Kế hoạch SLACK-03B4A](../../superpowers/plans/2026-10-30-slack-03b4a-private-read-wrapper.md)
**Phụ thuộc:**
- **SLACK-03C1** — `PersonalSlackReadAdapter` + injected hooks + 8 read tools (đã review, có tại nền `715193c2`).
- **SLACK-03B1** — bảng barrier/invalidation, `checkBarriers`, `stageInTransaction` (đã có tại nền).
- **SLACK-02** — `SlackTokenManager`, `SlackPolicyService`, connection repo (đã có tại nền).

---

## 1. Mục tiêu và Phạm vi

Xây wrapper Backend **riêng, nội bộ, server-owned** nối các dịch vụ thật đã review để thực thi đúng 8 read methods của Slack cá nhân:

```ts
executeRead({
  callerAtiUserId: string,
  binding: SlackBinding,
  tool: string,
  params: Record<string, unknown>,
  purpose: SlackReadPurpose,
  signal?: AbortSignal,
}): Promise<{ tool: string; data: unknown; policyReference: SlackPolicyReference }>
```

Wrapper là điểm vào nội bộ cho một lời gọi đọc; **không phải route công khai**. Nó không đăng ký tool vào `ALL_TOOLS`, không bật routing/planner/executor/UI, không bật `MYSLACK_ENABLED`, không gọi Slack/model thật trong kiểm thử.

### 1.1. Trong phạm vi

- Kiểm tra caller khớp `binding.atiUserId` trước mọi thứ.
- Đối soát đủ 5 trường binding, active user/connection, workspace/actor/identityVersion, F1 provider attestation + consent + retention qua `SlackPolicyService` thật.
- Map policy reference legacy (12 trường) sang canonical đúng 8 trường qua `validateSlackPolicyReference`; không trả alias.
- Pin canonical ref của lần authorize đầu; mọi re-auth phải mang đúng expected ref đó.
- Kiểm tra binding/provisional/epoch/channel/resource barriers trước token, trước transport và sau response.
- Token hook: re-check F1 + barriers trước `SlackTokenManager`; re-check sau khi token trả, dưới owner gate ngắn; không lồng `withOwner` quanh token manager.
- Deadline/signal của wrapper bao trọn factory, hook và adapter; nội dung muộn bị bỏ, không trả.
- Validate provenance từng entity và container trước khi trả DTO; kiểm tra barrier cho mọi resource quan sát được.
- Mã lỗi cố định; không rò rỉ token/cursor/payload/cause/details/log.
- Retention 0; không ghi DB, không gọi model.

### 1.2. Ngoài phạm vi (không làm)

- Không sửa `app.ts`, `server.ts`, `SlackConnectionRepo`, `SlackTokenManager`, `SlackPolicyService`, `SlackInvalidationService`, `SlackInvalidationRunner` (04A đang sở hữu tích hợp active).
- Không sửa `packages/tool-schemas`, `packages/tool-adapters`, `packages/executor`, `packages/planner`, `apps/chat-web`, migrations.
- Không sửa `CURRENT-STATE.md`, `ROADMAP.md`, tài liệu khác ngoài task card/plan/log này.
- Không thêm route, không đăng ký `ALL_TOOLS`, không bật cờ nội dung.
- Không lưu raw/derived Slack content; không tuyên bố F3/source storage đã đóng.
- Không fallback "connection đầu tiên"; không generic method dispatcher; không nhận write tool.
- Không gọi Slack/model thật; kiểm thử chỉ dùng PostgreSQL 55533 + HTTP loopback fixture.

---

## 2. Seam Thực Tế Được Dùng

| Thành phần | Chữ ký thực tế | Ghi chú |
|---|---|---|
| `SlackTokenManager` | `getAccessToken(userId, id, identityVersion): Promise<string>` | Giữ owner advisory lock xuyên refresh; wrapper không lồng `withOwner`. |
| `SlackPolicyService` | `resolveSlackModelPolicy({binding, purpose, requestedRetentionDays, expectedPolicyReference?, env?})` | Trả legacy ref 12 trường; wrapper map canonical. |
| `SlackInvalidationService` | `checkBarriers({binding, channelId?, epoch?, epochHash?, resourceType?, resourceId?, revision?, workspaceId?})` | Phải gọi thêm channel/resource, không chỉ `{binding}`. |
| `SlackConnectionRepo` | `withOwner(userId, action)` | Chỉ dùng sau `getAccessToken` để kiểm tra hậu-refresh. |
| `PersonalSlackReadAdapter` | `execute(toolName, args, context)` | Fixed 8 methods; DTO có provenance entity/container. |
| `validateSlackToolExecutionArgs` | `(definition, args)` → `{binding, params}` | Fail-closed với key lạ. |
| `validateSlackPolicyReference` | `(value)` → đúng 8 trường canonical | Loại alias legacy. |
| `slackPolicyRefToEpoch` / `sameSlackPolicyEpoch` | epoch từ ref | Dùng cho barrier epoch. |

---

## 3. Thiết Kế Cổng Fail-Closed

### 3.1. Thứ tự

1. `MYSLACK_ENABLED === 'on'` từ runtime config inject; thiếu/off/lạ → deny.
2. Request shape: caller, binding object, tool string, params object, purpose thuộc 4 read purposes, signal hợp lệ.
3. Clone + `validateSlackBinding`; `callerAtiUserId.trim() === binding.atiUserId`.
4. Tool phải nằm trong `MYSLACK_CORE_READ_TOOLS` và `sideEffect === 'read'`.
5. `validateSlackToolExecutionArgs` với envelope `{binding, params}`.
6. Deadline + caller signal; aborted → dừng.
7. Adapter factory (mỗi invocation một adapter/hook mới).
8. Policy hook pre-fetch: F1 + barriers; pin canonical ref.
9. Token hook: re-check F1 + barriers → `getAccessToken` → re-check dưới owner gate.
10. Adapter tự re-auth trước mỗi attempt/retry và sau response.
11. Wrapper post-DTO: provenance + barrier từng entity/container; F1 cuối.
12. Trả `{tool, data, policyReference}`.

Bất kỳ bước nào thiếu bằng chứng → deny. Không có nhánh bỏ qua.

### 3.2. Policy hook

- Validate binding exact 5 trường, purpose đúng, retention 0.
- `expectedPolicyReference` phải bằng pinned ref; nếu chưa pin mà có expected, hoặc đã pin mà thiếu expected → `SLACK_READ_EPOCH_CHANGED`.
- Gọi service thật; deny → `SLACK_READ_POLICY_DENIED`.
- Map legacy → canonical 8 trường; pin lần đầu; các lần sau phải cùng ref.
- Barrier: `{binding, epoch}`; channel từ params; resource từ params (bảng §3.4).
- Barrier chặn → `SLACK_READ_BARRIERED`.
- Lỗi bất ngờ → `SLACK_READ_INTERNAL`.

### 3.3. Token hook

- Binding exact + chưa aborted.
- Re-run policy hook với expected pinned **trước** token manager.
- `getAccessToken(binding.atiUserId, binding.connectionId, binding.identityVersion)`.
- Abort sau await → bỏ token, ném lỗi abort.
- `ownerGate.withOwner(binding.atiUserId, ...)` sau khi token trả: kiểm tra lại policy + barriers với expected pinned; nếu deny/abort → bỏ token.
- Lỗi token manager → `SLACK_READ_TOKEN_UNAVAILABLE`; không echo message/cause.
- Không tuyên bố hủy network refresh; chỉ chứng minh không dispatch và không trả credential muộn.

### 3.4. Resource identity

| Method | Channel | Resource trước token | Resource sau DTO |
|---|---|---|---|
| `conversations.list` | — | — | `conversation` từng channel |
| `conversations.info` | `params.channel` | `conversation` | `conversation` |
| `conversations.history` | `params.channel` | `conversation` | `conversation` + `message` từng message |
| `conversations.replies` | `params.channel` | `conversation` + `message` root `ts` | `conversation` + `message` từng message |
| `conversations.members` | `params.channel` | `conversation` | `conversation` + `user` từng member |
| `users.list` | — | — | `user` từng user |
| `users.info` | — | `user` (`params.user`) | `user` |
| `chat.getPermalink` | `params.channel` | `conversation` + `message` `message_ts` | `conversation` + `message` |

- Message resource ID: `JSON.stringify([channelId, messageTs])`; workspace truyền riêng.
- Revision message: `edited.ts ?? ts`, giữ nguyên chuỗi.
- Không dùng `_`, không timestamp-only, không gộp workspace vào resource ID.
- Resource chưa có revision thực tế (root trước fetch) dùng revision đã validate từ params; barrier `minValidRevision` mới hơn → chặn (fail-closed).

### 3.5. Post-DTO provenance

- `result.ok === true`.
- Từng entity: binding đúng 5 trường; `acquisitionPolicyReference` canonical 8 trường bằng pinned; `resourceIdentity` đúng shape/ID/revision; `observedAt` ISO; `observationalDigest` 64 hex; message `nativeRevision === edited.ts ?? ts`.
- Container provenance đúng identity theo method.
- `conversations.members`: member ID là `user` resource; container `members`.
- `users.list`: entity là `user`; container `users`.
- `chat.getPermalink`: `channel === params.channel`; provenance `permalink`.
- Mọi channel/resource quan sát được kiểm tra barrier; bất kỳ bị chặn → `SLACK_READ_BARRIERED`.
- F1/epoch/binding/provisional kiểm tra lần cuối với expected pinned.
- Thiếu bằng chứng → `SLACK_READ_PROVENANCE_INVALID`.

---

## 4. Tệp Thay Đổi

| Thao tác | Tệp |
|---|---|
| Create | `apps/chat-api/src/services/slack/slack-private-read-wrapper.ts` |
| Create | `apps/chat-api/tests/helpers/slack-private-read-fixture.ts` |
| Create | `apps/chat-api/tests/services/slack/slack-private-read-wrapper.test.ts` |
| Create | `apps/chat-api/tests/services/slack/slack-private-read-wrapper-provenance.test.ts` |
| Create | `docs/handoff/tasks/SLACK-03B4A-private-read-wrapper.md` |
| Create | `docs/superpowers/plans/2026-10-30-slack-03b4a-private-read-wrapper.md` |
| Create | `docs/handoff/log/2026-10-30-slack-03b4a-private-read-wrapper.md` |

Không sửa tệp hiện hữu nào khác.

---

## 5. Ma Trận Nghiệm Thu

### 5.1. Cổng không chạm DB/token/transport

1. Flag thiếu/off/lạ → disabled; `process.env` bị bỏ qua.
2. Flag on inject → chạy.
3. Write/unknown/non-read tool → invalid.
4. Purpose `storage`/lạ → invalid.
5. Params thiếu/sai kiểu/thừa key → invalid.
6. Binding thiếu/sai/identityVersion ≤ 0 → invalid.
7. Caller khác `binding.atiUserId` → identity mismatch.
8. Signal sai kiểu → invalid.
9. Base URL ngoài native/loopback → invalid config.
10. Factory/hook/adapter treo → deadline/abort settle, không trả nội dung muộn.

### 5.2. Binding/F1 thật với PostgreSQL

11. Đủ điều kiện → allow.
12. Từng trường binding sai → deny trước token/transport.
13. User disabled / connection `reconnect_required`/`disconnected` → deny.
14. Reconnect thật tăng identityVersion; binding cũ → deny.
15. Consent revoked, provider unverified, fingerprint drift, provider row thiếu → deny.
16. Connection của user khác → deny, không fallback.
17. Mọi deny: `tokenCalls === 0`, `GET requests === 0`.

### 5.3. 8 read methods

18. Mỗi method trả DTO đúng shape, provenance entity/container, canonical 8-field ref, retention 0, binding đúng, không alias, không token.
19. `conversations.replies` root + replies; `chat.getPermalink` đúng channel/ts.
20. `users.list`/`conversations.members` kiểm tra user resource.

### 5.4. Barrier

21. Binding/provisional/epoch/channel/resource pre-token → deny trước token/transport.
22. Epoch khác không chặn.
23. Resource `deleted` và `minValidRevision` chặn root replies/permalink.
24. 429 lần đầu rồi stage channel barrier → retry bị chặn.
25. Barrier stage sau response → wrapper chặn cả trang.
26. Resource barrier workspace A không chặn workspace B cùng channel/ts.
27. Message resource ID exact `JSON.stringify([channel, ts])`; decoy `_`/timestamp-only không chặn.

### 5.5. Provenance và token

28. Sửa binding/ref/identity/nativeRevision/digest entity → provenance invalid.
29. Sửa container provenance → invalid.
30. Regrant thật giữa response và validation, DTO relabel ref mới → invalid.
31. Revoke consent sau response → policy denied, không trả payload.
32. Hai user/workspace thật, cùng channel ID, đọc đồng thời → cô lập token/provenance.
33. Refresh thật khi hết hạn → token mới dùng.
34. Abort khi policy hook treo/refresh treo → reject sớm, không token/GET, không trả muộn.
35. Disconnect trong lúc refresh giữ owner lock → reject sau owner gate, không GET, config NULL, token không rò rỉ.
36. Token/cursor/payload opaque không xuất hiện trong lỗi/log.
37. Sau read: không có raw content mới trong DB; không gọi model.

### 5.6. Lệnh

```powershell
npm test -w @wap/chat-api -- tests/services/slack/slack-private-read-wrapper.test.ts
npm test -w @wap/chat-api -- tests/services/slack/slack-private-read-wrapper-provenance.test.ts
npm test -w @wap/chat-api
npm run typecheck:v3
npm run check
git diff --check
```

---

## 6. Cổng NOT_RUN

- Native Slack/model acceptance: **NOT_RUN**.
- Ingress lifecycle/queue probe 04A (chưa merge nền 04A): **NOT_RUN**; chỉ dùng barrier 03B1 đã chấp nhận.
- F3 derived persistence 03B2/03B3: **NOT_RUN**; wrapper transient retention 0.
- Routing/UI/planner/executor/cờ nội dung: **NOT_RUN**.

---

## 7. Kết quả

Codex trực tiếp tiếp quản mã chưa commit sau khi người dùng dừng gọi CLI. Hai bộ kiểm thử PostgreSQL/HTTP local đạt48/48 sau khi sửa lỗi phân loại DTO thiếu provenance (baseline47PASS/1FAIL). Các annotation/assertion trong test được sửa để giữ kiểu kết quả public là `unknown`. Static guard được bổ sung đúng một ngoại lệ file/literal cho hostname `slack.com` tại cổng credential của wrapper; các nhánh core khác vẫn được kiểm tra. Đây là file kiểm thử bổ sung ngoài danh sách Backend ban đầu để nghiệm thu tích hợp.

Review độc lập xác nhận3P2: trang rỗng hợp lệ bị từ chối; invalidation resource có thể commit trong lúc authorize cuối mà DTO vẫn trả về; decision barrier sai định dạng được bỏ qua. Codex sửa trực tiếp, quan sát10 ca RED trước sửa; sau sửa **59/59 PASS** trong2 suite. Gate cuối giữ owner/advisory/authority row locks qua toàn bộ resource quan sát và policy; kiểm thử2 client quan sát `pg_stat_activity` thật. Binding/reference được đóng băng.

`npm run check` sau fix **exit0,3.449 tests PASS** (`2026-10-30T03:06:36Z`), gồm typecheck/build/security; dùng PG riêng55533. Kiểm tra typecheck và targeted được chạy lại cho điều chỉnh timeout/abort cuối. Bằng chứng và ranh giới review tại [log wrapper](../log/2026-10-30-slack-03b4a-private-wrapper.md). CI đúng head vẫn là cổng riêng; chưa đóng các cổng NOT_RUN ở mục6.

Bổ sung hồi quy pool một connection: RED với INTERNAL; sau khi policy/barrier queries dùng client hiện hữu của owner/snapshot gate, **60/60 targetedPASS** và **3.450 tests fullcheckPASS**, exit0 (`2026-10-30T03:31:28Z`). Policy service và invalidation query interface là hai file Backend bổ sung cần thiết để giữ nguyên giao dịch và tránh nested pool checkout. CI của commitc1aa1c91 không đại diện cho follow-up; chờ CI của head mới trước tích hợp.
