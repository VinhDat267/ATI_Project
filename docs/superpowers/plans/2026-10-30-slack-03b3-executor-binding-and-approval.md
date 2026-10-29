# Slack Personal Assistant — SLACK-03B3: Executor Binding & Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khóa binding Slack 5 trường bất biến vào đúng một snapshot kế hoạch đã duyệt và xác minh lại trước mọi lần dispatch đọc trong `packages/executor`; mọi thao tác ghi Slack bị chặn trước khi chạm adapter cho tới khi SLACK-04C được duyệt.

**Architecture:** Executor sở hữu một lớp guard thuần (classification tĩnh, kiểm tra binding/tool/args/source, canonical digest) chạy trước `getAdapter`; Backend gắn binding do server xác nhận vào `PlanConnections.myslack` trước khi băm kế hoạch và cung cấp hook `SlackDispatchGuard` để tái xác thực user/connection/F1/barrier với `AbortSignal` thật. Không thêm migration, không mở write, không thay luồng dịch vụ khác.

**Tech Stack:** Node.js `^22.12.0 || >=24.0.0`, TypeScript 5.6+, Vitest, PostgreSQL 16 (`pg` pool), `node:crypto` SHA-256.

**Spec:** [Slack cá nhân và trợ lý công việc trong ATI](../specs/2026-10-28-slack-personal-oauth-design.md) (§4.1, §4.5, §8, §9.2, §10).

**Task Card:** [`docs/handoff/tasks/SLACK-03B3-executor-binding-and-approval.md`](../../handoff/tasks/SLACK-03B3-executor-binding-and-approval.md).

---

## 0. Trạng thái, Anchor & Phạm Vi PLAN_ONLY

- Base integration: `59f1aafc` (= `origin/integration/slack-personal-20261029` lúc lập kế hoạch). Hợp đồng nguồn: quyết định `e9088d5e`; 03A đã merge.
- Anchor đọc-only: 03C1 `390b1c54` (`feat-slack-03c1-read-adapters`, READ ONLY) — 8 phương thức đọc cố định, `args.binding`, hook token/policy; 03B1 `a38267d1` (`feat-slack-03b1-source-store`, READ ONLY, cây làm việc còn dở) — `checkBarriers`; 03B2 chỉ là PLAN đang review.
- Tài liệu này **chỉ là kế hoạch**. Mọi lệnh test runtime bên dưới ghi `NOT_RUN`. Chỉ các kiểm tra tài liệu (link, UTF-8, line budget, `git diff --check`) được chạy thật trong phiên này.
- Không đóng F2/F3/F4, không tuyên bố routing 03B4 hay native Slack API đã nghiệm thu. 03B4 (wrapper/routing) và 03B2 (lineage F3) là phụ thuộc bắt buộc để bật tính năng đầy đủ.

## 1. Global Constraints & Trust Boundaries

- Binding gồm đúng 5 trường `atiUserId, connectionId, workspaceId, slackUserId, identityVersion`; `identityVersion` là số nguyên an toàn > 0. Thiếu/sai bất kỳ trường nào → từ chối trước dispatch.
- Binding do server xác nhận từ connection thuộc ATI user đã đăng nhập. Model và payload client không được tạo/ghi đè binding; không fallback "connection đầu tiên", không fanout ngầm, không rebind khi reconnect/regrant (identityVersion mới ⇒ lệch ⇒ từ chối).
- `SlackPolicyReference`/`SlackPolicyEpoch` chỉ là bằng chứng định danh chính sách, **không phải quyền**. Hook phải kiểm tra quyền hiện tại với `AbortSignal`.
- Không secret (token, scope thô, nội dung nguồn) trong context, plan, DTO, log hay thông điệp lỗi. Executor không bao giờ nhận token; token chỉ nằm trong hook của adapter (03C1/03B4).
- Mọi write Slack bị chặn trước transport cho tới khi 04C duyệt outbox/UNKNOWN/approval. Tên `myslack.*` lạ fail closed; không dùng regex tên để biến write thành read; không mở rộng 253 `probe_required`, không thêm vào `ALL_TOOLS`/`SERVICE_REGISTRY`.
- Cờ `MYSLACK_ENABLED=off` mặc định; thiếu adapter/registry phải fail trước dispatch. Gmail/MyCalendar/MySheets và dịch vụ khác giữ nguyên hành vi và hash.
- Timeout/abort **trước** dispatch ⇒ `failed` với `requestSent: false`, không tạo `UNKNOWN`. `UNKNOWN` sau transport của write thuộc 04C, không thuộc plan này.

## 2. Hiện Trạng Mã Nguồn (anchors, không suy diễn)

| File / symbol hiện hữu | Hành vi thực tế | Khe hở 03B3 xử lý |
|---|---|---|
| `packages/executor/src/runner.ts` `StepRunner.executeStep` | `resolveArgs` → tách service từ `step.tool` → `getAdapter(service)` → `adapter.execute(tool, resolvedArgs, {signal})` | Không có bước xác minh binding/tool/args trước khi lấy adapter |
| `runner.ts` `isWriteTool` | Catalog `ALL_TOOLS + GMAIL + MYCALENDAR + MYSHEETS`; trượt catalog thì regex `/create|update|add|send|delete|put\|post\|patch/` | `myslack.*` không có trong catalog ⇒ write/read do regex quyết định (fail-open) |
| `packages/executor/src/resolver.ts` | `$ref`/`$template` phân giải tự do mọi khóa, không allowlist | Có thể chèn `binding` qua args/output |
| `packages/executor/src/types.ts` | `StepRunnerOptions.getAdapter`, `ExecuteStepOptions.signal` | Không có hook xác thực hay snapshot kế hoạch |
| `packages/tool-schemas/src/types.ts` `PlanConnections` | Chỉ `gmail`, `mycalendar`, `mysheets` | Chưa có `myslack` |
| `packages/tool-schemas/src/myslack-context.ts` | `SlackBinding`, `validateSlackBinding`, `sameSlackBinding` | Dùng lại, không định nghĩa mới |
| `packages/tool-schemas/src/myslack-tools.ts` | `validateSlackToolExecutionArgs` nhận `{binding, params}` hoặc flat, fail-closed unknown key | Executor phải dựng envelope này từ snapshot, không từ model |
| `apps/chat-api/src/services/chat-service.ts` `bindConnections` / `prepareResponse` | Gắn `connections` trước khi `sha256(JSON.stringify(response))`, lưu `plan_text`/`plan_hash` | Chưa gắn `myslack`; snapshot đã duyệt chưa có binding |
| `apps/chat-api/src/services/execution-service.ts` `approveAndStart` / `buildController` / `restoreController` | Băm lại `plan_text`, so khớp `plan_json`, CAS `approvePlan`, chạy `StepRunner` với `AdapterContext` | Chưa dựng snapshot Slack, chưa có guard |
| `apps/chat-api/src/services/execution-recovery.ts` `verifiedRecoveryPlan` / `restoredProgress` | Xác minh hash + deep-equal; khôi phục output đã `succeeded` | Chưa xác minh envelope Slack |
| `apps/chat-api/src/db/repositories/plan-repo.ts` `approvePlan` | `UPDATE ... WHERE id=$1 AND plan_hash=$2 AND status='pending' AND expires_at > now() AND EXISTS(owner)` | Giữ nguyên; test CAS thật bằng PG |
| `apps/chat-api/src/services/adapter-factory.ts` | Gmail/Calendar/Sheets kiểm tra `credentialId` + allowlist ở execution; dịch vụ khác fallback credential chung | Không đổi; Slack không đi qua nhánh này ở 03B3 |
| `apps/chat-api/src/services/slack/token-manager.ts` `getAccessToken(userId, id, identityVersion)`; `policy-service.ts` `resolveSlackModelPolicy` | Chữ ký hiện tại chưa nhận `SlackBinding` | 03B4 bọc thành hook; 03B3 chỉ gọi qua interface guard |

## 3. Thiết Kế

### 3.1 Hợp đồng chia sẻ (cần Backend + Integration/Schema đồng ý trước khi code)

`packages/tool-schemas/src/types.ts`:

```ts
export interface SlackSourceBinding { stepId: string; path: string } // '' hoặc 'a.b'
export interface SlackStepBinding {
  connectionId: string;
  tool: string;                                  // đúng tên canonical của bước
  sourceRefs: ReadonlyArray<SlackSourceBinding>; // $ref bắt buộc cùng binding
  policyReference: SlackPolicyReference | null;  // bằng chứng lúc duyệt, không phải quyền
}
export interface SlackPlanBindings {
  bindings: Record<string, SlackBinding>;  // connectionId -> binding đủ 5 trường
  steps: Record<string, SlackStepBinding>; // PlanStep.id -> bản ghi server
}
// PlanConnections thêm: myslack?: SlackPlanBindings
```

`packages/executor/src/slack/types.ts` (mới, chỉ Backend review):

```ts
export type SlackToolClass = 'read' | 'write' | 'unknown';
export type SlackGuardDenialCode =
  | 'SLACK_GUARD_MISSING' | 'SLACK_BINDING_MISSING' | 'SLACK_BINDING_MISMATCH'
  | 'SLACK_TOOL_MISMATCH' | 'SLACK_WRITE_DISABLED' | 'SLACK_SOURCE_MISMATCH'
  | 'SLACK_AUTH_DENIED' | 'SLACK_ABORTED';
export interface SlackDispatchGuardInput {
  planId: string; planHash: string; stepId: string; tool: string;
  binding: SlackBinding; policyReference: SlackPolicyReference | null;
  digest: string; signal: AbortSignal;
}
export type SlackDispatchDecision = { allowed: true } | { allowed: false; code: SlackGuardDenialCode; message: string };
export interface SlackDispatchGuard { authorize(input: SlackDispatchGuardInput): Promise<SlackDispatchDecision>; }
export interface SlackPlanExecutionSnapshot {
  planId: string; planHash: string;
  bindings: Readonly<Record<string, SlackBinding>>;
  steps: Readonly<Record<string, SlackStepBinding>>;
}
```

`StepRunnerOptions` thêm `slackSnapshot?: SlackPlanExecutionSnapshot` và `slackDispatchGuard?: SlackDispatchGuard`. Snapshot do Backend dựng từ `plan_json` đã xác minh hash, `structuredClone` + deep-freeze; không đọc từ request.

### 3.2 Giao thức hash canonical (tách approval envelope khỏi output late-bound)

1. `plan_hash` hiện hữu giữ nguyên: `SHA-256(plan_text)` với `plan_text = JSON.stringify(planJson)`; `PlanConnections.myslack` nằm trong `planJson` nên binding, tool từng bước, `sourceRefs`, `policyReference` đều được băm. Không đổi công thức này.
2. `computeSlackExecutionDigest` (mới, thuần): `SHA-256(canonicalJson(envelope))`, envelope đóng gồm `{ v: 'slack-exec-v1', planId, planHash, stepId, tool, binding, params, observedSources }`.
   - `canonicalJson`: key sắp xếp theo code unit; từ chối `undefined`, function, symbol, bigint, số không hữu hạn, `-0`, prototype lạ; mảng giữ thứ tự; object lạ field ⇒ ném lỗi (không bỏ qua).
   - `identityVersion` xác thực safe integer rồi đổi sang chuỗi thập phân; `consentRevision`/`providerRevision`/`nativeRevision` băm **nguyên văn chuỗi**, cấm `Number()` (mất chính xác với `"9007199254740993"`).
   - `params` là args **đã phân giải**, không chứa `binding`; `observedSources` là revision/digest quan sát được ở runtime (late-bound), không có ở approval envelope.
3. Approval envelope chỉ băm **selector** của `$ref` (stepId/path) và binding/tool/policy; revision quan sát thật chỉ vào digest thực thi. Vì vậy không có chuyện "băm args chưa phân giải rồi tuyên bố args đã phân giải y hệt".
4. Kế hoạch đã lưu/khôi phục: `verifiedRecoveryPlan` băm lại `plan_text` + deep-equal `plan_json` trước khi dựng snapshot; output `succeeded` khôi phục từ `execution_steps.output_json` được controller nạp lại vào `stepOutputs`, nên digest được **tính lại** mỗi lần thử từ dữ liệu đã lưu, không tin digest lưu sẵn.
5. Scheduled run dùng chung `prepareResponse`; chỉ gắn `myslack` khi có selection server đã lưu. Hiện chưa có nơi lưu selection ⇒ kế hoạch scheduled chứa bước Slack bị từ chối tạo (fail closed), phụ thuộc 03B4/SLACK-06.

### 3.3 Giao thức trước dispatch (chạy lại cho MỌI lần thử, kể cả retry/resume)

1. `classifySlackTool(step.tool)`: chỉ `read` đi tiếp; `write`/`unknown` ⇒ `SLACK_WRITE_DISABLED` trước `getAdapter`.
2. Snapshot phải có `steps[step.id]`; `tool` khớp; `bindings[connectionId]` khớp đủ 5 trường (`sameSlackBinding`); `validateSlackBinding` cả hai phía.
3. Quét sâu args thô: bất kỳ khóa `binding` ở mọi độ sâu ⇒ `SLACK_BINDING_MISMATCH` (chặn `$ref`/`$template` chèn binding).
4. `resolveArgs`; với mỗi `sourceRefs[i].stepId`: output tham chiếu phải có `provenance.binding` cùng 5 trường; `observedSources` ghi `resourceIdentity` + `nativeRevision`/`observationalDigest` nguyên văn. `$ref` tới dịch vụ khác được phép như **param** (hash đã ghim selector), không được dùng làm binding.
5. Tính digest; gọi `slackDispatchGuard.authorize({..., signal: combinedSignal})`. Không có guard ⇒ `SLACK_GUARD_MISSING`. Deny/throw/abort ⇒ lỗi `requestSent:false`, `failed`, adapter counter = 0.
6. Sau `allowed:true`, kiểm tra `combinedSignal.aborted` lần nữa rồi mới `getAdapter('myslack')` và gọi `adapter.execute(tool, { binding, params }, { signal })`. Envelope lồng nhau đúng hợp đồng 03C1.

### 3.4 Classification tĩnh

`SLACK_READ_TOOLS` = đúng 8 tên của 03C1 (`conversations_list/info/history/replies/members`, `users_list/info`, `chat_getPermalink`); `SLACK_WRITE_TOOLS` = danh sách tường minh (hiện chỉ `chat_postMessage`). Mọi tên `myslack.*` khác ⇒ `unknown` ⇒ bị chặn như write. Test hợp đồng chéo (đối chiếu `MYSLACK_CORE_READ_TOOLS`) chỉ thêm được sau khi 03C1 merge vào integration; trước đó reviewer đối chiếu thủ công hai danh sách trong review.

### 3.5 Backend gắn binding & hook

- `apps/chat-api/src/services/slack/slack-plan-bindings.ts` (mới): `resolvePlanSlackBindings({ atiUserId, steps, selection, connectionRepo, policyService, signal })`.
  - Chỉ nhận `selection.connectionId` do người dùng chọn rõ trong UI đã đăng nhập; server tra `getConnectionMetadataForUser(atiUserId, connectionId)` và tự dựng đủ 5 trường. Không selection / selection lạ / không sở hữu / `status != 'active'` / consent chưa `granted` ⇒ ném lỗi, không fallback.
  - Nhiều selection khác nhau trong cùng kế hoạch ⇒ từ chối (không fanout ngầm). Bước write/unknown ⇒ từ chối cả kế hoạch.
- `chat-service.bindConnections` gọi resolver trước khi trả response để `myslack` vào hash. `planScheduledRun` truyền `selection = null` ⇒ từ chối nếu có bước Slack.
- `apps/chat-api/src/services/slack/slack-dispatch-guard.ts` (mới) implements `SlackDispatchGuard`: kiểm tra ATI user đang hoạt động, connection đủ 5 trường + `identityVersion`, F1 hiện tại qua `SlackPolicyService`, barrier qua `SlackInvalidationService.checkBarriers({ binding })` (khi 03B1 merge), và `signal.aborted` sau từng await.
- `execution-service.buildController/restoreController` dựng snapshot từ `plan_json` đã xác minh và truyền guard; không đổi CAS `approvePlan`.

### 3.6 Write & 04C

Không thêm adapter write, không đăng ký `myslack` vào `ALL_TOOLS`/`SERVICE_REGISTRY`, không nới `probe_required`. Khi 04C mở write, dispatch chỉ được đi qua seam outbox đã duyệt; executor 03B3 từ chối mọi write trước transport và giữ nguyên `UNKNOWN` hiện hữu cho dịch vụ khác.

## 4. File Structure

| Hành động | File | Trách nhiệm |
|---|---|---|
| Sửa | `packages/tool-schemas/src/types.ts` | `SlackPlanBindings`, `SlackStepBinding`, `PlanConnections.myslack` |
| Sửa | `packages/tool-schemas/src/index.ts` | re-export type mới |
| Tạo | `packages/executor/src/slack/types.ts` | guard/snapshot/denial contract |
| Tạo | `packages/executor/src/slack/classification.ts` | 8 read + write tường minh, unknown fail closed |
| Tạo | `packages/executor/src/slack/canonical.ts` | `canonicalJson`, `computeSlackExecutionDigest` |
| Tạo | `packages/executor/src/slack/guard.ts` | xác minh binding/tool/injection/source + gọi hook |
| Sửa | `packages/executor/src/runner.ts` | route `myslack.*` qua guard, `isWriteTool` fail closed |
| Sửa | `packages/executor/src/types.ts` | `StepRunnerOptions.slackSnapshot/slackDispatchGuard` |
| Sửa | `packages/executor/src/index.ts` | export guard types |
| Tạo | `apps/chat-api/src/services/slack/slack-plan-bindings.ts` | resolver + gắn envelope trước hash |
| Tạo | `apps/chat-api/src/services/slack/slack-dispatch-guard.ts` | hook thật (user/connection/F1/barrier/abort) |
| Sửa | `apps/chat-api/src/services/chat-service.ts` | gọi resolver trong `bindConnections` |
| Sửa | `apps/chat-api/src/services/execution-service.ts` | dựng snapshot + truyền guard |
| Tạo/Sửa | `packages/executor/tests/slack-*.test.ts` | unit thật với `AbortSignal`, counter |
| Tạo | `apps/chat-api/tests/slack-plan-bindings.test.ts`, `slack-approval-binding.test.ts`, `slack-dispatch-guard.test.ts` | PostgreSQL 16 thật |

## 5. Tasks

> Mọi lệnh dưới đây là **đề xuất**, trạng thái hiện tại `NOT_RUN` (docs-only). Test executor dùng `StepRunner` trực tiếp + adapter/guard giả có counter (biên unit hợp lệ, không DB). Test Backend dùng PG thật, không faux-DB boolean.

### Task 1: Shared envelope types

**Files:** Modify `packages/tool-schemas/src/types.ts`, `packages/tool-schemas/src/index.ts`; Test `packages/tool-schemas/tests/myslack-plan-bindings.test.ts`.
**Interfaces:** Produces `SlackPlanBindings`, `SlackStepBinding`, `SlackSourceBinding`, `PlanConnections.myslack?`.
**Gate:** cần chữ ký đồng ý của Backend + Integration/Schema trong PR trước khi merge.

- [ ] Step 1: Test validate cấu trúc: đủ 5 trường, `identityVersion` > 0, từ chối field lạ, từ chối `binding` giả trong `steps`.
- [ ] Step 2: Run `npx vitest run packages/tool-schemas/tests/myslack-plan-bindings.test.ts` — `NOT_RUN`; kỳ vọng RED "type/export not found".
- [ ] Step 3: Thêm type + re-export; không đổi shape cũ.
- [ ] Step 4: Run lại — `NOT_RUN`; kỳ vọng GREEN. Commit `feat(schemas): add Slack plan binding envelope`.

### Task 2: Executor classification + `isWriteTool`

**Files:** Create `packages/executor/src/slack/classification.ts`; Modify `packages/executor/src/runner.ts`; Test `packages/executor/tests/slack-classification.test.ts`.
**Interfaces:** Produces `classifySlackTool(name): SlackToolClass`, `SLACK_READ_TOOLS`, `SLACK_WRITE_TOOLS`.

- [ ] Step 1: Test bảng: 8 read ⇒ `read`; `myslack.chat_postMessage` ⇒ `write`; `myslack.reactions_add`, `myslack.dnd_endDnd`, `myslack.files_upload`, `myslack.foo` ⇒ `unknown`; `isWriteTool('myslack.dnd_endDnd') === true`; `isWriteTool('trello.create_card') === true`; `isWriteTool('gmail.send_message') === true`.
- [ ] Step 2: Run `npx vitest run packages/executor/tests/slack-classification.test.ts` — `NOT_RUN`; RED.
- [ ] Step 3: Implement map đóng băng + nhánh `myslack.` đầu tiên trong `isWriteTool` (không rơi regex).
- [ ] Step 4: Run — `NOT_RUN`; GREEN. Commit `feat(executor): classify Slack tools statically and fail closed`.

### Task 3: Canonical digest

**Files:** Create `packages/executor/src/slack/canonical.ts`; Test `packages/executor/tests/slack-canonical.test.ts`.
**Interfaces:** Produces `canonicalJson(value): string`, `computeSlackExecutionDigest(input): string`.

- [ ] Step 1: Test: hoán vị key cho cùng digest; đổi 1 field binding đổi digest; `consentRevision:"9007199254740993"` và `nativeRevision:"1712345678.000200"` giữ nguyên chuỗi; `identityVersion: 2**53` bị từ chối; `undefined`/`NaN`/bigint/field lạ bị từ chối; params chứa `binding` bị từ chối.
- [ ] Step 2: Run `npx vitest run packages/executor/tests/slack-canonical.test.ts` — `NOT_RUN`; RED.
- [ ] Step 3: Implement canonicalizer + digest `slack-exec-v1`.
- [ ] Step 4: Run — `NOT_RUN`; GREEN. Commit `feat(executor): add canonical Slack execution digest`.

### Task 4: Pre-dispatch guard + runner wiring

**Files:** Create `packages/executor/src/slack/guard.ts`, `packages/executor/src/slack/types.ts`; Modify `runner.ts`, `types.ts`, `index.ts`; Test `packages/executor/tests/slack-dispatch-guard.test.ts`, `slack-binding-mismatch.test.ts`, `slack-injection.test.ts`, `slack-abort.test.ts`, `slack-write-blocked.test.ts`, `slack-redaction.test.ts`.
**Interfaces:** Consumes Task 2–3 + `SlackBinding`/`sameSlackBinding`/`validateSlackBinding`; Produces `StepRunnerOptions.slackSnapshot`, `.slackDispatchGuard`.

- [ ] Step 1: Test đủ 8 read: guard cho phép, adapter counter = 1, args nhận `{ binding, params }` không chứa `binding` trong params.
- [ ] Step 2: Test 5 mismatch (từng trường), caller mismatch (hook deny), thiếu snapshot/thiếu step record/thiếu guard, tool lệch, allowlist tamper; mỗi case adapter counter = 0.
- [ ] Step 3: Test injection: `args.binding` literal, `{"$ref":"step_1.output.binding"}`, `{"$template":"${step_1.output.binding}"}`, object lồng; từ chối trước adapter.
- [ ] Step 4: Test source: `$ref` tới bước Slack khác binding ⇒ `SLACK_SOURCE_MISMATCH`; cùng binding ⇒ cho phép, digest chứa revision nguyên văn.
- [ ] Step 5: Test abort/timeout thật: guard chờ `signal` abort ⇒ `failed`, `requestSent:false`, không `unknown`; timeout 15s giả lập bằng `AbortSignal.timeout(5)`; abort sau await trong guard cũng chặn adapter.
- [ ] Step 6: Test write block: `chat_postMessage`, `reactions_add`, tên lạ; `UNKNOWN` không xuất hiện; registry/adapter vắng ⇒ chặn trước `getAdapter`.
- [ ] Step 7: Test redaction: sentinel token/body không xuất hiện trong `JSON.stringify(result)`; test mixed service: bước `trello.*`/`gmail.*` giữ nguyên kết quả và không cần snapshot.
- [ ] Step 8: Run `npx vitest run packages/executor/tests/slack-*.test.ts` — `NOT_RUN`; RED rồi GREEN sau Step 9.
- [ ] Step 9: Implement guard + nhánh runner (guard trước `getAdapter`; giữ `isWrite` semantics cũ cho dịch vụ khác).
- [ ] Step 10: Commit `feat(executor): verify Slack binding before every dispatch`.

### Task 5: Backend gắn binding vào envelope đã băm

**Files:** Create `apps/chat-api/src/services/slack/slack-plan-bindings.ts`; Modify `apps/chat-api/src/services/chat-service.ts`; Test `apps/chat-api/tests/slack-plan-bindings.test.ts` (PG thật, `npm run test:v3`).
**Interfaces:** Produces `resolvePlanSlackBindings(input): Promise<SlackPlanBindings>`; envelope nằm trong `prepared.connections.myslack` trước `createHash`.

- [ ] Step 1: Test: kế hoạch có bước Slack + selection hợp lệ ⇒ envelope đủ 5 trường, hash thay đổi so với không có `myslack`; non-Slack plan giữ `JSON.stringify` y hệt (byte-identical).
- [ ] Step 2: Test: không selection, selection lạ, connection người khác, `revoked`/`reconnect_required`, consent chưa `granted`, hai selection khác nhau, bước write/unknown ⇒ ném lỗi, không tạo plan.
- [ ] Step 3: Test scheduled: `planScheduledRun` với bước Slack và không selection ⇒ refuse, không ghi `plans`.
- [ ] Step 4: Run `npm run test:v3 -- workspace @wap/chat-api` — `NOT_RUN`; RED.
- [ ] Step 5: Implement resolver + tích hợp `bindConnections`; giữ `withoutConnections` không lộ binding vào history gửi model.
- [ ] Step 6: Run — `NOT_RUN`; GREEN. Commit `feat(api): attach server-owned Slack bindings before planning hash`.

### Task 6: Approval, recovery & CAS trên PostgreSQL thật

**Files:** Create `apps/chat-api/src/services/slack/slack-plan-verify.ts`; Modify `apps/chat-api/src/services/execution-service.ts`, `execution-recovery.ts`; Test `apps/chat-api/tests/slack-approval-binding.test.ts`.
**Interfaces:** Produces `verifySlackPlanBindings(planJson): SlackPlanBindings`, `buildSlackSnapshot(planRow): SlackPlanExecutionSnapshot`.

- [ ] Step 1: Test PG: sửa `plan_json.connections.myslack.bindings[...]` sau khi tạo ⇒ `approveAndStart` trả 409 trước CAS; sửa `plan_text` cũng 409.
- [ ] Step 2: Test PG: hai `approveAndStart` đồng thời trên cùng plan (hai pool client) ⇒ đúng một thắng nhờ `WHERE status='pending'`; plan hết hạn và non-owner bị từ chối. Không dùng boolean giả.
- [ ] Step 3: Test PG: recovery sau crash khôi phục output `succeeded`, dựng lại snapshot từ `plan_json` rồi dispatch bước kế với đúng binding; plan bị sửa sau approval ⇒ `recoveryConflict` 409.
- [ ] Step 4: Test: `connections.myslack` thiếu bước, thừa bước, tool lệch, `identityVersion` sai kiểu ⇒ từ chối.
- [ ] Step 5: Run `npm run test:v3 -- workspace @wap/chat-api` — `NOT_RUN`; RED.
- [ ] Step 6: Implement verify + snapshot; `approveAndStart` gọi verify sau so khớp hash, trước `approvePlan`.
- [ ] Step 7: Run — `NOT_RUN`; GREEN. Commit `feat(api): verify Slack binding in approval and recovery`.

### Task 7: Hook quyền thật + retry/resume reauthorization

**Files:** Create `apps/chat-api/src/services/slack/slack-dispatch-guard.ts`; Modify `execution-service.ts`; Test `apps/chat-api/tests/slack-dispatch-guard.test.ts` (PG thật + fake provider transport).
**Interfaces:** Consumes `SlackDispatchGuard` (Task 4), `SlackPolicyService`, `SlackInvalidationService.checkBarriers` (03B1); Produces guard được truyền vào `StepRunner`.

- [ ] Step 1: Test: user bị vô hiệu hoá, connection revoke, regrant làm `identityVersion` tăng, F1 revoke, barrier `connection`/`resource` đang mở ⇒ deny, adapter counter = 0.
- [ ] Step 2: Test: 03C1 hook bị thiếu (chưa có 03B4 wrapper) ⇒ guard trả deny an toàn, không giả lập token.
- [ ] Step 3: Test retry: bước read fail rồi `retryStep` ⇒ guard được gọi lại (counter = 2); revoke giữa hai lần ⇒ lần hai deny; `skipStep` không gọi guard.
- [ ] Step 4: Test abort: `stop()` trong khi guard đang chờ DB ⇒ `signal.aborted`, không dispatch.
- [ ] Step 5: Run `npm run test:v3 -- workspace @wap/chat-api` — `NOT_RUN`; RED.
- [ ] Step 6: Implement guard; mọi await kiểm tra `signal.aborted`; không log token/scope/body.
- [ ] Step 7: Run — `NOT_RUN`; GREEN. Commit `feat(api): reauthorize Slack dispatch with live policy and barriers`.

## 6. Ranh Giới Kiểm Thử

| Nhóm | Nơi chạy | Trạng thái |
|---|---|---|
| 8 read hợp lệ, 5 mismatch, injection, classification, digest, abort/timeout unit, missing hook, mixed service, write block, redaction | `packages/executor/tests` (`StepRunner` + fake adapter/guard có counter, `AbortSignal` thật) | `NOT_RUN` |
| Envelope trước hash, scheduled refuse, approval/recovery tamper, CAS đồng thời, revoked/regranted | `apps/chat-api/tests` + PostgreSQL 16 thật | `NOT_RUN` |
| Guard thật với TokenManager/PolicyService 03B4, native Slack API, routing 03B4, write 04C, 03B2 lineage | Chưa tồn tại | **Không được tuyên bố đạt** |

## 7. Review Focus

1. Binding đến từ snapshot đã băm hay từ args/model? Mọi đường khác đều phải dừng trước adapter.
2. Injection `binding` qua `$ref`/`$template`/object lồng có bị chặn ở quét sâu args thô không?
3. `myslack.*` lạ có fail closed (không rơi regex tên) và không bao giờ chạy như read không?
4. Revision/consent dạng chuỗi thập phân lớn có bị `Number()` làm mất chính xác không?
5. Deny/abort trước dispatch có tạo `UNKNOWN` giả hoặc retry write không? (Không được.)

## 8. Phụ Thuộc & Điều Không Tuyên Bố

- 03B4: wrapper token/policy nhận `SlackBinding`, routing/gather và đăng ký adapter `myslack` — **chưa có**; Task 7 chỉ deny an toàn khi thiếu.
- Planner/memory (AI Engineer): sinh bước `myslack.*` và snapshot memory là việc của chủ sở hữu planner; 03B3 không sửa `packages/planner`, chỉ tiêu thụ kế hoạch đã có.
- 03B2: lineage/purge F3 — chưa merge; 03B3 không đóng F3.
- 04C: outbox/UNKNOWN/approval cho write — chưa có; mọi write Slack bị chặn.
- 03B1 (`a38267d1`, cây còn dở): `checkBarriers` dùng ở Task 7 chỉ sau khi merge bản cuối.
- Không thay đổi Gmail/Calendar/Sheets, `ALL_TOOLS`, `SERVICE_REGISTRY`, inventory 253 `probe_required`, hay cờ mặc định.
