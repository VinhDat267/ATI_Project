# Slack Personal Assistant — SLACK-03B3: Executor Binding & Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khóa binding Slack 5 trường vào đúng snapshot kế hoạch đã duyệt, dựng một envelope thực thi bất biến đã tách rời, và xác minh lại toàn bộ danh tính nguồn + quyền hiện tại trên chính envelope sẽ dispatch; mọi thao tác ghi Slack bị chặn trước transport tới khi SLACK-04C được duyệt.

**Architecture:** Executor sở hữu guard thuần (classification, dựng envelope đóng băng, canonical digest, kiểm tra selector/provenance) chạy trước `getAdapter`; Backend gắn envelope do server dựng vào `PlanConnections.myslack` trước khi băm kế hoạch và cài hook `SlackDispatchGuard` tái xác thực user/connection/F1/F3/barrier trên đúng envelope với `AbortSignal` thật. Không migration, không mở write, không đổi luồng dịch vụ khác.

**Tech Stack:** Node.js `^22.12.0 || >=24.0.0`, TypeScript 5.6+, Vitest, PostgreSQL 16 (`pg` pool), `node:crypto` SHA-256.

**Spec:** [Slack cá nhân và trợ lý công việc trong ATI](../specs/2026-10-28-slack-personal-oauth-design.md) (§4.1, §4.5, §8, §9.2, §10).

**Task Card:** [`docs/handoff/tasks/SLACK-03B3-executor-binding-and-approval.md`](../../handoff/tasks/SLACK-03B3-executor-binding-and-approval.md).

---

## 0. Trạng thái, Anchor & Phạm Vi PLAN_ONLY

- **Base tham chiếu:** integration `612ac427` (= `origin/integration/slack-personal-20261029` sau khi 03B1/03C1 được review và merge). Nhánh tài liệu này tách từ `59f1aafc`; mọi anchor mã dưới đây đọc tại `612ac427`.
- **Đã review/merge:** 03C1 `390b1c54` (PR #199, 8 read adapter) và 03B1 `23544be9` (PR #200, source store/barrier). Đây là anchor đã review, không phải giả định từ cây làm việc dở.
- **Chưa có:** 03B2 chỉ là PLAN (lineage F3); 03B4 wrapper token/policy + routing/UI selection; 04C outbox/write. 04A runtime dùng `apps/db`, nhưng tài liệu 03B3 không chạm runtime đó.
- Tài liệu này **chỉ là kế hoạch**. Mọi lệnh test runtime bên dưới ghi `NOT_RUN`; chỉ kiểm tra tài liệu (link, UTF-8, line budget, `git diff --check`) được chạy thật.
- Không đóng F2/F3/F4, không tuyên bố routing 03B4 hay native Slack API đã nghiệm thu.

## 1. Global Constraints & Trust Boundaries

- Binding đúng 5 trường `atiUserId, connectionId, workspaceId, slackUserId, identityVersion`; `identityVersion` là số nguyên an toàn > 0. Thiếu/sai bất kỳ trường nào => từ chối trước dispatch.
- Binding do server dựng từ connection thuộc ATI user đã đăng nhập; model/client không tạo/ghi đè; không fallback "connection đầu tiên", không fanout ngầm.
- **Nhiều workspace được phép** khi người dùng chọn rõ từng bước -> một `connectionId`; mỗi bước đúng một assignment, không suy diễn, không trùng, không thiếu. UI selection thuộc 03B4 (chưa có) nên hiện fail closed.
- `SlackPolicyReference`/epoch/provenance chỉ là **bằng chứng**, không phải quyền; provenance 03C1 không biến output khôi phục thành quan sát mới. Guard phải kiểm tra quyền hiện tại trên đúng envelope, với `AbortSignal`, ở **mọi** lần thử kể cả retry/resume.
- Không secret/token/scope thô/nội dung nguồn trong context, plan, DTO, log hay thông điệp lỗi. Executor không bao giờ nhận token; token chỉ nằm trong adapter/hook 03B4.
- Mọi write Slack bị chặn trước transport tới 04C. Tên `myslack.*` lạ fail closed; không dùng regex tên để biến write thành read; không mở `ALL_TOOLS`/`SERVICE_REGISTRY`/253 `probe_required`.
- `MYSLACK_ENABLED=off` mặc định; thiếu adapter/registry/hook phải fail trước dispatch. Gmail/MyCalendar/MySheets và dịch vụ khác giữ nguyên hành vi + hash.
- Abort/timeout **trước** transport => `failed` với `requestSent:false`, không `UNKNOWN`. `UNKNOWN` sau transport của write thuộc 04C.

## 2. Hiện Trạng Mã Nguồn (anchors tại `612ac427`, không suy diễn)

| File / symbol | Hành vi thực tế | Khe hở 03B3 xử lý |
|---|---|---|
| `packages/executor/src/runner.ts` `executeStep` | `resolveArgs(step.args, stepOutputs)` -> tách service -> `await getAdapter` -> `adapter.execute(tool, resolvedArgs, {signal})`; không detach `step`/outputs, không kiểm tra abort lại sau `getAdapter` | TOCTOU: caller còn sửa được `step`/outputs trong lúc await; factory await chen giữa authorize và transport |
| `runner.ts` `isWriteTool` | Catalog `ALL_TOOLS+GMAIL+MYCALENDAR+MYSHEETS`; trượt catalog rơi regex `/create|update|add|send|delete|post|put|patch/` | `myslack.*` không có catalog => write/read do regex quyết định (fail-open) |
| `packages/executor/src/resolver.ts` | `$ref` = `stepId.path` (chấm đầu tiên); `$template` thay `\${...}` bằng `String(value)`; object có `$ref`/`$template` được coi là ref **dù có khóa phụ**; chỉ phân giải một lượt, không phân giải lại bên trong output | Có thể chèn `binding` qua ref/template/object lồng; dependency không được dẫn xuất đầy đủ |
| `packages/executor/src/types.ts` | `StepRunnerOptions.getAdapter`; `ExecuteStepOptions.signal` | Chưa có snapshot/hook |
| `packages/tool-schemas/src/types.ts` `PlanConnections` | Chỉ `gmail`, `mycalendar`, `mysheets` | Chưa có `myslack` |
| `packages/tool-schemas/src/myslack-context.ts` | `SlackBinding` 5 trường, `validateSlackBinding`, `sameSlackBinding`, `SlackSourceRef` | Dùng lại, không định nghĩa mới |
| `packages/tool-schemas/src/myslack-tools.ts` | `validateSlackToolExecutionArgs(tool, {binding,params})` dùng schema canonical detached, `additionalProperties:false`, validate params đệ quy, cấm khóa ngoài | Executor phải gọi lại trên params đã phân giải; không tin model |
| `packages/tool-adapters/src/slack/personal-slack-read-adapter.ts` (03C1) | 8 read; provenance **theo từng entity** (conversation/message/user...), `nativeRevision` chỉ có khi Slack trả (message `edited.ts ?? ts`); container provenance cho list | 03B3 phải buộc provenance đúng entity được chọn, không chỉ container |
| `apps/chat-api/src/services/chat-service.ts` `bindConnections` | Chỉ Gmail/MyCalendar/MySheets; early-return nếu không có; hash sau khi gắn `connections` | Chưa có Slack; cần resolver trước `createHash` |
| `apps/chat-api/src/services/execution-service.ts` | `approveAndStart` băm lại `plan_text`, deep-equal `plan_json`, CAS; `buildController` chỉ truyền `getAdapter` | Chưa dựng snapshot/guard Slack |
| `apps/chat-api/src/services/execution-recovery.ts` / `plan-repo.ts` | `verifiedRecoveryPlan` rehash + deep-equal; `approvePlan` CAS `WHERE status='pending' AND plan_hash=$2 AND expires_at>now() AND EXISTS(owner)` | Giữ nguyên; recovery Slack phải verify envelope |
| `apps/chat-api/src/services/slack/slack-invalidation-service.ts` (03B1) | `checkBarriers` chỉ match `binding`/`provisional_auth` khi có `binding`; `channel` cần thêm `channelId`; `resource` cần `resourceType`+`resourceId`+`revision` (thiếu revision => chặn); `epoch` cần `epochHash`/`epoch`; SQL lọc `workspace_id` | Gọi `{binding}` đơn thuần **không** kiểm tra channel/resource/epoch; 03B3 phải truy vấn đầy đủ từng nguồn |
| `apps/chat-api/src/db/repositories/slack-connection-repo.ts` | `withOwner(userId, fn)`, `get(client,userId,id)`; status thật `active/reconnect_required/disconnected`; reconnect/reinstall tăng `identity_version` | Không có `getConnectionMetadataForUser`; resolver dùng `withOwner` + `get` |
| `apps/chat-api/src/services/slack/{policy-service,token-manager}.ts` | `resolveSlackModelPolicy({binding,purpose,requestedRetentionDays,expectedPolicyReference})`; `getAccessToken(userId,id,identityVersion)` chưa nhận `SlackBinding`/signal | 03B4 bọc token; 03B3 chỉ gọi hook interface |

## 3. Thiết Kế

### 3.1 Hợp đồng chia sẻ (Backend + Schema owner đồng ý trước khi code)

`packages/tool-schemas/src/types.ts` (types) + `packages/tool-schemas/src/myslack-plan-bindings.ts` (functions) + `packages/tool-schemas/src/myslack-source.ts` (shared `SlackSourceProvenance`; 03C1 sửa `personal-slack-types.ts` để dùng lại) — envelope **do server dựng**, không phải model:

```ts
// SlackSourceProvenance = shape 03C1 (binding, resourceIdentity, observedAt, acquisitionPolicyReference, nativeRevision?, observationalDigest); executor chỉ import tool-schemas.
export interface SlackDependencySelector {
  refStepId: string;                 // bước nguồn
  path: string;                      // '' = toàn output; còn lại 'a.b' (chỉ dấu chấm)
  service: string;                   // tiền tố tool của bước nguồn, vd 'myslack'
  kind: 'slack' | 'other';           // theo service, không theo nội dung
}
export interface SlackStepBinding {
  connectionId: string;
  tool: string;                      // đúng tên canonical của bước
  dependencies: ReadonlyArray<SlackDependencySelector>; // server dẫn xuất từ args thô, đủ mọi $ref/$template
  policyReference: SlackPolicyReference;                // bằng chứng lúc duyệt, không phải quyền
}
export interface SlackPlanBindings {
  bindings: Record<string, SlackBinding>;  // connectionId -> binding 5 trường
  steps: Record<string, SlackStepBinding>; // PlanStep.id -> bản ghi server
}
// PlanConnections thêm: myslack?: SlackPlanBindings
export function deriveSlackDependencySelectors(rawArgs: unknown, steps: ReadonlyArray<PlanStep>): SlackDependencySelector[];
export function validateSlackPlanBindings(value: unknown, planSteps: ReadonlyArray<PlanStep>): SlackPlanBindings;
```

`validateSlackPlanBindings` (mới, runtime, không chỉ TS interface): từ chối khóa lạ ở mọi cấp; mỗi binding đúng 5 trường qua `validateSlackBinding`; `steps` khớp **chính xác** tập bước `myslack.*` của plan (không thiếu, không thừa, không bản ghi cho bước non-Slack); `connectionId` phải có trong `bindings`; `tool` khớp `PlanStep.tool`; `policyReference` canonical qua `validateSlackPolicyReference` (không null), và `policyReference.binding` khớp binding; `dependencies` phải **bằng đúng** `deriveSlackDependencySelectors(step.args, planSteps)` (model/partial list bị từ chối). Các khóa `gmail/mycalendar/mysheets` giữ nguyên.

`packages/executor/src/slack/types.ts` (mới):

```ts
export type SlackSourceOrigin = 'transient' | 'stored' | 'persisted'; // transient: cùng lượt; stored: raw capture; persisted: output_json/derived
export interface SlackSourceEvidence {
  selector: SlackDependencySelector;
  sourceRef: SlackSourceRef;                          // binding + resourceType/Id + revision nguyên văn
  origin: SlackSourceOrigin;
  provenance: SlackSourceProvenance | null;           // chỉ tin khi transient; stored/persisted chỉ là bằng chứng
  captureId: string | null;                           // UUID khi origin='stored', dùng SlackSourceStore.getSource
  acquisitionPolicyReference: SlackPolicyReference;   // F1 đã dùng khi lấy nguồn (purpose + retention)
  policyEpoch: SlackPolicyEpoch;                      // dựng từ acquisitionPolicyReference
}
export interface SlackDispatchEnvelope {
  v: 'slack-exec-v1';
  planId: string; planHash: string; stepId: string; tool: string;
  binding: SlackBinding;
  params: Readonly<Record<string, unknown>>;          // args đã phân giải + validate canonical
  sources: ReadonlyArray<SlackSourceEvidence>;       // đủ mọi đoạn nguồn Slack được tham chiếu
  policyReference: SlackPolicyReference;
  digest: string;                                     // SHA-256(slackDigestInput(envelope)), không băm chính digest
}
export type SlackDigestInput = Omit<SlackDispatchEnvelope, 'digest'>; // projection đóng, bỏ digest
export function slackDigestInput(envelope: SlackDispatchEnvelope): SlackDigestInput; // Backend dùng cùng hàm
export type SlackGuardDenialCode = 'SLACK_GUARD_MISSING' | 'SLACK_ENVELOPE_MISMATCH' | 'SLACK_BINDING_MISMATCH'
  | 'SLACK_TOOL_MISMATCH' | 'SLACK_WRITE_DISABLED' | 'SLACK_DEPENDENCY_MISMATCH' | 'SLACK_PARAMS_INVALID'
  | 'SLACK_SOURCE_UNVERIFIED' | 'SLACK_AUTH_DENIED' | 'SLACK_ABORTED';
export interface SlackDispatchGuardInput { envelope: SlackDispatchEnvelope; signal: AbortSignal }
export type SlackDispatchDecision = { allowed: true } | { allowed: false; code: SlackGuardDenialCode }; // không có message tự do
export interface SlackDispatchGuard { authorize(input: SlackDispatchGuardInput): Promise<SlackDispatchDecision> }
export interface SlackPlanExecutionSnapshot { planId: string; planHash: string; bindings: Readonly<Record<string, SlackBinding>>; steps: Readonly<Record<string, SlackStepBinding>> }
```

`StepRunnerOptions` thêm `slackSnapshot?: SlackPlanExecutionSnapshot`, `slackDispatchGuard?: SlackDispatchGuard`; `ExecuteStepOptions` thêm `slackOutputOrigins?: ReadonlyMap<string, 'transient' | 'persisted'>` (controller khởi tạo từ `initialStates`, cập nhật `transient` khi bước succeeded trong lượt này). Snapshot do Backend dựng từ `plan_json` đã xác minh hash, `structuredClone` + deep-freeze; không đọc từ request. Runner chỉ dispatch **đúng object envelope đã authorize**, không dựng lại từ `step.args`.

### 3.2 Hash canonical (approval envelope tách khỏi output late-bound)

1. `plan_hash` giữ nguyên `SHA-256(plan_text)`; `connections.myslack` nằm trong `planJson` nên binding/tool/`dependencies`/`policyReference` được băm. Không đổi công thức.
2. `computeSlackExecutionDigest(slackDigestInput(envelope))` = `SHA-256(canonicalJson(input))`; `slackDigestInput` là projection **đóng**, chỉ copy `{v,planId,planHash,stepId,tool,binding,params,sources,policyReference}`, **bỏ `digest`** (không tự tham chiếu), từ chối khóa lạ; guard và Backend dùng **cùng hàm** này. Canonical JSON sắp key theo code unit, từ chối `undefined`/function/symbol/bigint/số không hữu hạn/`-0`/prototype lạ/field lạ.
3. Revision (`consentRevision`, `providerRevision`, `nativeRevision`, `sourceRef.revision`) băm **nguyên văn chuỗi**; cấm `Number()`; `identityVersion` validate safe integer rồi đổi chuỗi thập phân.
4. Approval envelope chỉ chứa selector `$ref` + binding + policy; execution envelope thêm `sources` quan sát thật và `digest`; digest được **tính lại** mỗi lần thử bằng `slackDigestInput` từ plan đã lưu + output đã khôi phục, không tin digest lưu sẵn; output khôi phục giữ `origin:'persisted'`, không tự thành transient.
5. Scheduled run dùng chung `prepareResponse`; chỉ gắn `myslack` khi có selection server đã lưu. Chưa có nơi lưu selection (03B4/SLACK-06) => kế hoạch scheduled có bước Slack bị từ chối tạo (fail closed).

### 3.3 Resolver grammar & dẫn xuất dependency (chống chèn binding qua ref/template)

- Với bước `myslack.*`, ref object phải có **đúng một** khóa: `{"$ref":"<stepId>.<path>"}` hoặc `{"$template":"...${<stepId>.<path>}..."}`. `<stepId>` và mỗi path segment khớp `[A-Za-z0-9_-]+` (path rỗng cho toàn output); **không** bracket, `$`, segment rỗng, khóa phụ. Ref không khớp grammar => `SLACK_DEPENDENCY_MISMATCH` trước resolve. Bước non-Slack giữ nguyên resolver hiện hữu.
- Server dẫn xuất **đầy đủ** selector từ mọi `$ref`/`$template` trong args thô (đệ quy toàn bộ object/array), chuẩn hoá thứ tự theo `(refStepId,path)`, khử trùng; lưu vào `dependencies` lúc tạo plan. Model không được cung cấp danh sách này. Khi execute, dẫn xuất lại từ args đã freeze và so **bằng đúng** với snapshot; thiếu/thừa/khác thứ tự chuẩn hoá => deny.
- `resolveArgs` chạy **một lần** trên args + output đã freeze; không phân giải lại giá trị đã resolve. Sau resolve, quét sâu params: bất kỳ khóa `binding` ở mọi độ sâu => `SLACK_PARAMS_INVALID`; sau đó gọi `validateSlackToolExecutionArgs(tool, { binding, params })` (schema canonical, đệ quy) để từ chối field lạ/kiểu sai.
- **Nguồn Slack:** mỗi selector `kind:'slack'` phải trỏ tới entity; với `transient`, provenance phải có tại đúng path (hoặc entity bao trực tiếp của path), `binding` khớp 5 trường, `resourceIdentity` khớp path, `acquisitionPolicyReference` canonical. Với output hỗn hợp/nhiều segment, **mọi** segment được chọn đều phải có provenance; thiếu một segment hoặc lẫn binding khác => `SLACK_SOURCE_UNVERIFIED`. Không lấy provenance của container thay cho entity con; `stored` lấy `sourceRef` từ record `getSource`, `persisted` chỉ là bằng chứng và bị deny.
- **Lineage nguồn:** runner gán `origin` theo thứ tự ưu tiên: `persisted` nếu `refStepId` có `slackOutputOrigins` = persisted (output_json/resume/derived); nếu không, `stored` khi output có `captureId` UUID của `SlackSourceStore`; còn lại `transient` nếu bước Slack sinh output trong **cùng lượt**. Provenance 03C1 **không** tự nâng persisted thành transient; derived copy cần 03B2 lineage/version guard. `stored` là đường **đề xuất** (03C1/03B4 chưa phát `captureId`); test synthetic/PG, không tuyên bố native.
- **Nguồn non-Slack:** chỉ được dùng làm **param** nếu giá trị đã resolve validate đúng schema canonical của tham số và không chứa object mang `binding`/provenance Slack. Không bao giờ dùng output non-Slack làm binding/danh tính. `$template` luôn cho chuỗi nên không thể tạo object binding.
- `sourceRef`: `transient` dựng từ provenance (`resourceType`/`resourceId` theo `resourceIdentity`, `revision = nativeRevision ?? observationalDigest`, nguyên văn); `stored` lấy từ `SlackSourceEntity.sourceRef` của `getSource`; `persisted` lấy từ output đã lưu nhưng chỉ là bằng chứng. `policyEpoch = slackPolicyRefToEpoch(acquisitionPolicyReference)` (tool-schemas; guard không import app).

### 3.4 Giao thức trước dispatch (TOCTOU-safe, chạy lại mọi lần thử)

1. `classifySlackTool(step.tool)`: chỉ `read` đi tiếp; `write`/`unknown` => `SLACK_WRITE_DISABLED` trước mọi await/adapter.
2. Snapshot phải có `steps[step.id]`, `tool` khớp, `bindings[connectionId]` khớp đủ 5 trường; `validateSlackPlanBindings` cả hai phía.
3. **Detach tại entry, trước await:** `deepFreeze(structuredClone({ id, tool, args }))`; chỉ clone các output được selector tham chiếu (dẫn xuất đồng bộ từ args thô) và deep-freeze. Từ đây không đọc `step`, `stepOutputs`, snapshot hay params của caller nữa.
4. Dẫn xuất lại đầy đủ selector từ args đã freeze; so bằng đúng với `snapshot.steps[step.id].dependencies`; lệch/partial => deny.
5. Resolve **một lần**; quét `binding`; validate canonical; dựng `sources` theo `origin`: `transient` cần provenance per-entity, `stored` cần `captureId` UUID, `persisted` đánh dấu để guard deny; thiếu/mismatch => deny.
6. Dựng envelope, deep-freeze, tính digest. **Cùng object envelope** này được đưa cho guard và adapter; không tạo bản sao thứ hai.
7. `guard.authorize({ envelope, signal })`; race với deadline abort để abort **settle ngay** dù hook chưa trả (Promise.race + bắt rejection muộn, không unhandled). Deny/abort/throw => lỗi cố định theo `code`, `requestSent:false`, `failed`; **không** echo message của hook (có thể chứa provider/DB/source/token), **không** lấy adapter/token.
8. Sau **mọi** await (guard, factory) kiểm tra `signal.aborted`. `getAdapter('myslack')` cũng race với deadline; nếu factory đã await (có thể vượt ranh giới quyền), gọi `guard.authorize` **lần cuối** với đúng envelope trước execute. Abort trong lúc factory chờ => không dispatch khi factory resolve.
9. Dispatch `adapter.execute(envelope.tool, { binding: envelope.binding, params: envelope.params }, { signal })` — dùng đúng envelope đã hash/authorize; không resolve lại, không đọc output caller.
10. Mọi lỗi trước transport trả `failed` (`requestSent:false`), kể cả factory/registry vắng; **không** tạo `UNKNOWN` trước dispatch. Phân biệt factory lookup với transport vật lý.
11. Retry/resume lặp 1–9 từ plan đã lưu + output `succeeded` đã khôi phục; output khôi phục là `persisted` (không phải transient) nên nguồn Slack từ nó bị deny tới 03B2; không cache quyết định cũ, không tin digest lưu sẵn.

### 3.5 Classification tĩnh

`SLACK_READ_TOOLS` = đúng 8 tên 03C1 (`conversations_list/info/history/replies/members`, `users_list/info`, `chat_getPermalink`); `SLACK_WRITE_TOOLS` tường minh (hiện `chat_postMessage`). Mọi `myslack.*` khác => `unknown` => chặn như write. `isWriteTool` rẽ nhánh `myslack.` trước catalog/regex. 03C1 đã merge vào `612ac427` nên test hợp đồng chéo `MYSLACK_CORE_READ_TOOLS` viết được ngay (vẫn `NOT_RUN` trong task docs).

### 3.6 Guard quyền thật (Backend)

- `SlackDispatchGuard.authorize({ envelope, signal })` kiểm tra **trên envelope**, không chỉ digest: `computeSlackExecutionDigest(slackDigestInput(envelope))` và so `envelope.digest` (lệch => deny); user ATI `active`; connection qua `connectionRepo.withOwner(atiUserId, c => get(c, atiUserId, connectionId))`; status thật `active`; `sameSlackBinding` đủ 5 trường; `identityVersion` khớp.
- F1 bước: `resolveSlackModelPolicy({ binding, purpose: envelope.policyReference.purpose, requestedRetentionDays: envelope.policyReference.requestedRetentionDays, expectedPolicyReference: envelope.policyReference })`; thiếu `policyReference`/không canonical/khác biệt => deny. `consentRevision` đổi khi grant/revoke/regrant; `identityVersion` đổi khi reconnect/reinstall — hai loại sai khác phải deny tương ứng.
- Với **từng** `SlackSourceEvidence`: `transient` phải có provenance + gọi `checkBarriers({binding, workspaceId, channelId, epoch, resourceType, resourceId, revision})` đủ trường (bỏ `channelId` chỉ khi resource không thuộc channel, không bỏ workspace/resource/revision/epoch); `stored` phải gọi `SlackSourceStore.getSource({sourceRef, expectedCaptureId: captureId, consumerPurpose: acquisitionPolicyReference.purpose})`, chỉ nhận `status:'ok'`, `entity.sourceRef` khớp; nội dung dùng làm param phải lấy từ `entity`, không tin bản output, không có đường đó => deny; `persisted` => deny `SLACK_SOURCE_UNVERIFIED` cho tới 03B2. `{binding}` trần **không đủ**; blocked/not_found/tombstoned/mismatch => deny.
- F1 nguồn: `resolveSlackModelPolicy({ binding, purpose: evidence.acquisitionPolicyReference.purpose, requestedRetentionDays: evidence.acquisitionPolicyReference.requestedRetentionDays, expectedPolicyReference: evidence.acquisitionPolicyReference })` (exact purpose + retention + revision). F3: lineage dẫn xuất/persisted chưa có guard (03B2 chỉ PLAN) => deny; chỉ `transient`/`stored` raw hợp lệ. Provenance type chỉ import từ tool-schemas, không import tool-adapters.
- Kiểm tra `signal.aborted` sau từng await; deadline abort settle độc lập với hook. Không log/echo token, scope, body, hay `decision` thô.
- `execution-service.buildController/restoreController` dựng snapshot đã verify + truyền guard; không đổi CAS `approvePlan`.

### 3.7 Backend gắn binding & multi-workspace

- `apps/chat-api/src/services/slack/slack-plan-bindings.ts` (mới): `resolvePlanSlackBindings({ atiUserId, steps, selection, connectionRepo, policyService, signal })`, `selection = { assignments: ReadonlyArray<{ stepId, connectionId }> }`.
- Mỗi bước `myslack.*` đúng một assignment; nhiều `connectionId`/nhiều workspace được phép nếu selection chỉ rõ; assignment trùng/thiếu/không map được => từ chối cả plan (không fanout, không mặc định). Server tra `withOwner` + `get`, tự dựng binding từ `user_id/workspace_id/actor_id/identity_version`; không có `getConnectionMetadataForUser`.
- `status !== 'active'` (gồm `reconnect_required`, `disconnected`) => từ chối. Consent `granted` + exact policy ref; consent `pending/revoked` => từ chối. `policyReference` dựng bằng `resolveSlackModelPolicy` với purpose/retention do server quy định (đề xuất `planning` + 0 TTL), model không chọn. Regrant chỉ đổi `consentRevision`; reconnect đổi `identityVersion`.
- `chat-service.bindConnections` gọi resolver trước `sha256(JSON.stringify(response))`; `planScheduledRun` truyền `selection = null` => từ chối nếu có bước Slack. UI chọn connection thuộc 03B4 (chưa có) => hiện fail closed, không tuyên bố native.

### 3.8 Write & 04C

Không thêm adapter write, không đăng ký `myslack` vào `ALL_TOOLS`/`SERVICE_REGISTRY`, không nới `probe_required`. Khi 04C mở write, dispatch chỉ qua seam outbox đã duyệt; 03B3 từ chối mọi write trước transport và giữ `UNKNOWN` hiện hữu cho dịch vụ khác.

## 4. File Structure

| Hành động | File | Trách nhiệm |
|---|---|---|
| Sửa | `packages/tool-schemas/src/types.ts` | `SlackPlanBindings`, `SlackStepBinding`, `SlackDependencySelector`, `PlanConnections.myslack` |
| Sửa | `packages/tool-schemas/src/myslack-source.ts` | `SlackSourceProvenance` + validator; 03C1 dùng lại, executor không import tool-adapters |
| Sửa | `packages/tool-schemas/src/index.ts` | export type + validator/dẫn xuất dependency |
| Tạo | `packages/tool-schemas/src/myslack-plan-bindings.ts` | runtime validator strict + `deriveSlackDependencySelectors` |
| Tạo | `packages/executor/src/slack/types.ts` | envelope/guard/snapshot/denial contract |
| Tạo | `packages/executor/src/slack/classification.ts` | 8 read + write tường minh + unknown fail closed |
| Tạo | `packages/executor/src/slack/canonical.ts` | `canonicalJson`, `computeSlackExecutionDigest` |
| Tạo | `packages/executor/src/slack/guard.ts` | dựng envelope, selector/provenance, gọi hook, TOCTOU |
| Sửa | `packages/executor/src/runner.ts` | route `myslack.*` qua guard; detach/abort; `isWriteTool` fail closed |
| Sửa | `packages/executor/src/types.ts`, `index.ts` | `slackSnapshot`, `slackDispatchGuard`, export |
| Tạo | `apps/chat-api/src/services/slack/slack-plan-bindings.ts` | resolver + selection nhiều workspace + gắn trước hash |
| Tạo | `apps/chat-api/src/services/slack/slack-plan-verify.ts` | verify envelope khi approve/recovery |
| Tạo | `apps/chat-api/src/services/slack/slack-dispatch-guard.ts` | hook thật (user/connection/F1/F3/barrier/abort) |
| Sửa | `apps/chat-api/src/services/chat-service.ts` | gọi resolver trong `bindConnections` |
| Sửa | `apps/chat-api/src/services/execution-service.ts` | dựng snapshot + truyền guard |
| Tạo/Sửa | `packages/executor/tests/slack-*.test.ts`; `apps/chat-api/tests/slack-*.test.ts` | unit `AbortSignal`/counter + PostgreSQL 16 thật |

## 5. Tasks

> Mọi lệnh dưới đây là **đề xuất**, trạng thái `NOT_RUN` (docs-only). Test executor dùng `StepRunner` trực tiếp + adapter/guard giả có counter (biên unit hợp lệ, không DB). Test Backend dùng PostgreSQL 16 thật, không faux-DB boolean. Lệnh đúng: `npm test -w <workspace> -- <filter>`; `npm run test:v3` chỉ dùng cho toàn bộ suite, không phải workspace command.

### Task 1: Shared envelope types + runtime validator
**Files:** Modify `packages/tool-schemas/src/types.ts`, `packages/tool-schemas/src/myslack-source.ts`, `packages/tool-schemas/src/index.ts`; Create `packages/tool-schemas/src/myslack-plan-bindings.ts`; Test `packages/tool-schemas/tests/myslack-plan-bindings.test.ts`, `myslack-source-provenance.test.ts`.
**Interfaces:** Produces types + `SlackSourceProvenance` validator + `validateSlackPlanBindings(value, planSteps)` (runtime, không chỉ TS interface).
**Gate:** Backend + Schema owner + 03C1 Integration đồng ý chữ ký/nơi đặt provenance trong PR trước khi merge.

- [ ] Step 1: Test validator: đủ 5 trường, `identityVersion` > 0; từ chối field lạ ở mọi cấp; `steps` thiếu/thừa/bản ghi cho bước non-Slack; `connectionId` không tồn tại; `tool` lệch; `policyReference` không canonical/lệch binding; `dependencies` model-supplied hoặc partial (khác kết quả dẫn xuất) bị từ chối; provenance 03C1 shape strict, không field lạ; `gmail/mycalendar/mysheets` giữ nguyên.
- [ ] Step 2: Run `npm test -w @wap/tool-schemas -- tests/myslack-plan-bindings.test.ts tests/myslack-source-provenance.test.ts` — `NOT_RUN`; kỳ vọng RED "validateSlackPlanBindings is not exported".
- [ ] Step 3: Thêm types + validator + export; không đổi shape cũ.
- [ ] Step 4: Run lại — `NOT_RUN`; kỳ vọng GREEN. Commit `feat(schemas): add strict Slack plan binding envelope`.
### Task 2: Executor classification + `isWriteTool`
**Files:** Create `packages/executor/src/slack/classification.ts`; Modify `runner.ts`; Test `packages/executor/tests/slack-classification.test.ts`.
**Interfaces:** Produces `classifySlackTool(name)`, `SLACK_READ_TOOLS`, `SLACK_WRITE_TOOLS`.

- [ ] Step 1: Test bảng: 8 read => `read`; `chat_postMessage` => `write`; `reactions_add`, `dnd_endDnd`, `files_upload`, `myslack.foo` => `unknown`; `isWriteTool` true cho write/unknown `myslack.*`, vẫn true cho `trello.create_card`/`gmail.send_message`.
- [ ] Step 2: Run `npm test -w @wap/executor -- tests/slack-classification.test.ts` — `NOT_RUN`; RED.
- [ ] Step 3: Implement map đóng băng + nhánh `myslack.` đầu tiên trong `isWriteTool`.
- [ ] Step 4: Run — `NOT_RUN`; GREEN. Commit `feat(executor): classify Slack tools statically and fail closed`.
### Task 3: Canonical digest
**Files:** Create `packages/executor/src/slack/canonical.ts`; Test `packages/executor/tests/slack-canonical.test.ts`.
**Interfaces:** Produces `canonicalJson(value)`, `slackDigestInput(envelope)` (projection bỏ `digest`), `computeSlackExecutionDigest(input: SlackDigestInput)`.

- [ ] Step 1: Test: `slackDigestInput` không có khóa `digest`; đổi `envelope.digest` không đổi digest tính lại; Backend recompute dùng đúng hàm/projection; hoán vị key cùng digest; đổi 1 field binding đổi digest; `consentRevision:"9007199254740993"` và `nativeRevision:"1712345678.000200"` nguyên văn; `identityVersion: 2**53` bị từ chối; `undefined`/`NaN`/bigint/field lạ bị từ chối; params chứa `binding` bị từ chối.
- [ ] Step 2: Run `npm test -w @wap/executor -- tests/slack-canonical.test.ts` — `NOT_RUN`; RED.
- [ ] Step 3: Implement canonicalizer + `slackDigestInput` + digest `slack-exec-v1`; không băm envelope chứa digest.
- [ ] Step 4: Run — `NOT_RUN`; GREEN. Commit `feat(executor): add canonical Slack execution digest`.
### Task 4: Pre-dispatch envelope, TOCTOU guard + runner wiring
**Files:** Create `packages/executor/src/slack/{types,guard}.ts`; Modify `runner.ts`, `types.ts`, `index.ts`; Test `packages/executor/tests/slack-dispatch-guard.test.ts`, `slack-injection.test.ts`, `slack-source-substitution.test.ts`, `slack-observation-origin.test.ts`, `slack-toctou.test.ts`, `slack-abort.test.ts`, `slack-write-blocked.test.ts`, `slack-redaction.test.ts`.
**Interfaces:** Consumes Task 2–3 + `validateSlackToolExecutionArgs`; Produces `StepRunnerOptions.slackSnapshot`, `.slackDispatchGuard`, `slackOutputOrigins`.

- [ ] Step 1: 8 read hợp lệ với nguồn `transient` cùng lượt: guard nhận **đúng envelope** sẽ dispatch; adapter counter = 1; `args` là `{binding, params}` không có `binding` trong params.
- [ ] Step 2: 5 mismatch từng trường; caller/hook mismatch; thiếu snapshot/step record/guard; tool lệch; `dependencies` forged/partial; adapter counter = 0.
- [ ] Step 3: Injection: `args.binding` literal; `{"$ref":"step_1.output.binding"}`; `{"$template":"${step_1.output.binding}"}`; `$ref` có khóa phụ; object lồng; resolve xong mới lộ `binding` => `SLACK_PARAMS_INVALID` trước adapter.
- [ ] Step 4: **Synthetic source substitution/tamper** (chỉ test, không runtime mới): thay provenance của entity được chọn bằng provenance cùng binding nhưng khác resource/revision; đổi provenance giữa hai entity; output hỗn hợp thiếu provenance một segment; provenance container đặt cho entity con; selector trỏ path không tồn tại => `SLACK_SOURCE_UNVERIFIED`. **Origin:** output `transient` cùng lượt => cho phép; output khôi phục từ `execution_steps.output_json` dù có provenance 03C1 => `origin:'persisted'` và deny; derived copy => deny; `stored` có `captureId` UUID => chỉ cho phép sau `getSource` guard, thiếu/sai captureId => deny.
- [ ] Step 5: Cross-service: `$ref` tới `gmail.*`/`trello.*` hợp lệ làm param canonical => cho phép; object mang `binding` từ output non-Slack => từ chối; không coi mọi ref là Slack same-binding.
- [ ] Step 6: Abort/timeout thật: `AbortController`/`AbortSignal.timeout`, guard/factory treo => abort settle, `failed`, `requestSent:false`, counter = 0; factory resolve sau abort => không dispatch; revoke giữa factory await => authorize lần cuối deny.
- [ ] Step 7: Write block: `chat_postMessage`, `reactions_add`, tên lạ; không `UNKNOWN`; registry/adapter vắng => chặn trước `getAdapter`.
- [ ] Step 8: Redaction: sentinel token/body không có trong `JSON.stringify(result)`; `trello.*`/`gmail.*` giữ nguyên kết quả + hash.
- [ ] Step 9: Run `npm test -w @wap/executor -- tests/slack` — `NOT_RUN`; RED rồi GREEN sau Step 10.
- [ ] Step 10: Implement guard + runner detach/freeze/abort/reauthorize + `slackOutputOrigins`/persisted deny; giữ semantics cũ cho dịch vụ khác. Commit `feat(executor): verify immutable Slack envelope before every dispatch`.
### Task 5: Backend gắn binding + multi-workspace selection
**Files:** Create `apps/chat-api/src/services/slack/slack-plan-bindings.ts`; Modify `chat-service.ts`; Test `apps/chat-api/tests/slack-plan-bindings.test.ts` (PG thật).
**Interfaces:** Produces `resolvePlanSlackBindings(input): Promise<SlackPlanBindings>`; envelope trong `prepared.connections.myslack` trước `createHash`.

- [ ] Step 1: Test: plan có bước Slack + selection hợp lệ => envelope đủ 5 trường; `plan_hash` đổi so với không có `myslack`; plan non-Slack byte-identical.
- [ ] Step 2: Test: không selection, assignment lạ/không sở hữu, `reconnect_required`/`disconnected`, consent `pending`/`revoked`, `policyReference` thiếu, assignment trùng/thiếu, bước write/unknown => ném lỗi, không ghi `plans`.
- [ ] Step 3: Test multi-workspace: hai assignment rõ cho hai workspace => cho phép, mỗi bước đúng binding; một assignment mơ hồ/không map => từ chối; không fanout.
- [ ] Step 4: Test scheduled: `planScheduledRun` bước Slack + không selection => refuse, không ghi `plans`.
- [ ] Step 5: Run `npm test -w @wap/chat-api -- tests/slack-plan-bindings.test.ts` — `NOT_RUN`; RED.
- [ ] Step 6: Implement resolver + tích hợp `bindConnections`; `withoutConnections` không lộ binding vào history model.
- [ ] Step 7: Run — `NOT_RUN`; GREEN. Commit `feat(api): attach server-owned Slack bindings before planning hash`.
### Task 6: Approval, recovery & CAS trên PostgreSQL thật
**Files:** Create `apps/chat-api/src/services/slack/slack-plan-verify.ts`; Modify `execution-service.ts`, `execution-recovery.ts`; Test `apps/chat-api/tests/slack-approval-binding.test.ts`.
**Interfaces:** Produces `verifySlackPlanBindings(planJson)`, `buildSlackSnapshot(planRow)`; controller khởi tạo `slackOutputOrigins` từ `initialStates`.

- [ ] Step 1: Test PG: sửa `plan_json.connections.myslack` sau tạo => `approveAndStart` 409 trước CAS; sửa `plan_text` cũng 409; `dependencies` bị sửa => 409.
- [ ] Step 2: Test PG: hai `approveAndStart` đồng thời (hai pool client) => đúng một thắng nhờ `WHERE status='pending'`; plan hết hạn/non-owner bị từ chối; không boolean giả.
- [ ] Step 3: Test PG recovery (đề xuất): output `succeeded` khôi phục từ `execution_steps.output_json` mang provenance 03C1 được controller đánh dấu `slackOutputOrigins` = `persisted`; bước kế dùng nó làm nguồn Slack bị deny `SLACK_SOURCE_UNVERIFIED` cho tới 03B2; sửa plan sau approval => `recoveryConflict` 409.
- [ ] Step 4: Test: `connections.myslack` thiếu/thừa bước, tool lệch, `identityVersion` sai kiểu, `policyReference` lệch consentRevision => từ chối.
- [ ] Step 5: Run `npm test -w @wap/chat-api -- tests/slack-approval-binding.test.ts` — `NOT_RUN`; RED.
- [ ] Step 6: Implement verify + snapshot; `approveAndStart` verify sau so khớp hash, trước `approvePlan`.
- [ ] Step 7: Run — `NOT_RUN`; GREEN. Commit `feat(api): verify Slack binding in approval and recovery`.
### Task 7: Hook quyền thật + retry/resume reauthorization
**Files:** Create `apps/chat-api/src/services/slack/slack-dispatch-guard.ts`; Modify `execution-service.ts`; Test `apps/chat-api/tests/slack-dispatch-guard.test.ts` (PG thật + fake provider transport).
**Interfaces:** Consumes `SlackDispatchGuard` (Task 4), `SlackPolicyService`, `SlackInvalidationService.checkBarriers` (03B1), `SlackSourceStore.getSource`; Produces guard truyền vào `StepRunner`.

- [ ] Step 1: Test: user inactive, connection `disconnected`/`reconnect_required`, regrant đổi `consentRevision` (identityVersion không đổi), reconnect đổi `identityVersion`, F1 revoke, barrier binding/channel/resource/epoch đang mở => deny, counter = 0; nguồn `transient` cùng lượt hợp lệ => allow.
- [ ] Step 2: Test: 03C1 hook/03B4 wrapper thiếu => deny an toàn, không giả lập token; không lấy adapter/token.
- [ ] Step 3: Test barrier đầy đủ: barrier `channel` chỉ bị bắt khi query có `channelId`; barrier `resource` chỉ bị bắt khi có `resourceType`+`resourceId`+`revision`; query `{binding}` trần bỏ sót => test khẳng định guard dùng query đầy đủ. Nguồn `stored` gọi `getSource` với `captureId`/purpose; `ok` => allow, `not_found`/tombstoned/blocked => deny; persisted/derived => deny dù provenance hợp lệ.
- [ ] Step 4: Test retry: read fail rồi `retryStep` => guard gọi lại (counter = 2); revoke giữa hai lần => lần hai deny; `skipStep` không gọi guard; resume dùng output lưu => `persisted` deny; retry trong cùng lượt => `transient` allow; không cache quyết định.
- [ ] Step 5: Test abort: `stop()` trong khi guard chờ DB => abort settle, không dispatch; deadline abort dù hook unresolved.
- [ ] Step 6: Run `npm test -w @wap/chat-api -- tests/slack-dispatch-guard.test.ts` — `NOT_RUN`; RED.
- [ ] Step 7: Implement guard; mọi await kiểm tra `signal.aborted`; không log/echo token/scope/body.
- [ ] Step 8: Run — `NOT_RUN`; GREEN. Commit `feat(api): reauthorize Slack dispatch with live policy and barriers`.

## 6. Ranh Giới Kiểm Thử

| Nhóm | Nơi chạy | Trạng thái |
|---|---|---|
| Envelope/selector/provenance, origin transient/stored/persisted, injection qua ref/template, substitution/tamper, digest projection, TOCTOU/abort, classification, write block, redaction, mixed service | `packages/executor/tests` (`StepRunner` + fake adapter/guard có counter, `AbortSignal` thật) | `NOT_RUN` |
| Envelope trước hash, selection nhiều workspace, scheduled refuse, approval/recovery tamper (persisted source deny), CAS đồng thời, status/regrant/reconnect, stored `getSource` | `apps/chat-api/tests` + PostgreSQL 16 thật | `NOT_RUN` |
| Guard thật với TokenManager/PolicyService 03B4, native Slack API, routing 03B4, write 04C, 03B2 lineage/version/F3 | Chưa tồn tại | **Không được tuyên bố đạt** |

## 7. Review Focus

1. Guard có nhận **đúng envelope** sẽ dispatch (binding/tool/params/sources/policy), hay chỉ nhận digest? `slackDigestInput` có bỏ `digest` và Backend recompute cùng projection, không tự tham chiếu?
2. Dependency selector có được server dẫn xuất **đầy đủ** từ args thô và so lại khi execute, hay model tự chọn `sourceRefs`/partial list?
3. Nguồn có phân biệt `transient`/`stored`/`persisted`; `getSource` có được gọi cho raw capture; persisted/derived có bị deny tới 03B2; `checkBarriers` có đủ workspace/channel/resource/revision/epoch cho từng segment?
4. Injection `binding` qua `$ref`/`$template`/extra keys/resolved params có bị chặn trước adapter? Non-Slack param có bị coi nhầm là binding không?
5. TOCTOU: step/outputs có bị detach/freeze trước await; abort có recheck sau **mọi** await gồm `getAdapter`; factory await có reauthorize; deadline abort có settle dù hook treo?
6. Revision/consent lớn có bị `Number()`; status `reconnect_required`/`disconnected` và regrant/consentRevision có bị lẫn với identityVersion?
7. Deny/abort trước dispatch có tạo `UNKNOWN` giả, lộ message hook, hoặc lấy token/adapter không? (Không được.)

## 8. Phụ Thuộc & Điều Không Tuyên Bố

- 03B4: wrapper token/policy nhận `SlackBinding`, routing/gather, UI selection, đăng ký adapter `myslack` — **chưa có**; Task 7 chỉ deny an toàn khi thiếu.
- 03B2: lineage/purge F3 — chỉ PLAN; 03B3 không đóng F3, guard từ chối `persisted`/derived khi chưa có lineage version/guard; raw `stored` chỉ qua `getSource`.
- 04C: outbox/UNKNOWN/approval cho write — chưa có; mọi write Slack bị chặn. 04A runtime worker dùng `apps/db`; tài liệu này không sửa runtime đó.
- 03C1 `390b1c54` + 03B1 `23544be9` đã review/merge vào `612ac427`; shared contract vẫn cần Backend + Schema owner đồng ý trước runtime.
- Không thay đổi Gmail/Calendar/Sheets, `ALL_TOOLS`, `SERVICE_REGISTRY`, 253 `probe_required`, hay cờ mặc định.
