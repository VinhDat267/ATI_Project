# SLACK-03B3 · Binding bất biến & cổng phê duyệt trong Executor

**Trạng thái:** PLAN_ONLY — kế hoạch đã hiệu chỉnh sau review độc lập; không có mã runtime nào được sửa trong task này.
**Nhánh công việc:** `docs/slack-03b3-executor-binding-plan` · **Nền tham chiếu:** integration `612ac427` (`origin/integration/slack-personal-20261029`); nhánh tài liệu tách từ `59f1aafc` trước khi 03B1/03C1 merge.
**Vai trò sở hữu:** Backend Engineer (kế hoạch cho `packages/executor/`, `apps/chat-api/`, `packages/tool-schemas/` với điều kiện đồng ý chung).
**Task cha:** [SLACK-03-tool-catalog-and-source-lifecycle](SLACK-03-tool-catalog-and-source-lifecycle.md).
**Kế hoạch chi tiết:** [`docs/superpowers/plans/2026-10-30-slack-03b3-executor-binding-and-approval.md`](../../superpowers/plans/2026-10-30-slack-03b3-executor-binding-and-approval.md).
**Nhật ký phiên:** [`docs/handoff/log/2026-10-30-slack-03b3-executor-binding-plan.md`](../log/2026-10-30-slack-03b3-executor-binding-plan.md).

**Phụ thuộc đã đọc (read-only, đã review/merge vào integration `612ac427`):**
- Hợp đồng nguồn `e9088d5e` + SLACK-03A.
- 03C1 `390b1c54` (PR #199) — 8 phương thức đọc cố định, `args.binding`, hook token/policy, provenance theo từng entity.
- 03B1 `23544be9` (PR #200) — `SlackInvalidationService.checkBarriers`, source store/barrier; anchor đã review, không phải cây làm việc dở.
- 03B2 chỉ là PLAN; 03B4 wrapper/routing/UI selection và 04C outbox chưa tồn tại. 04A runtime dùng `apps/db`; tài liệu này không sửa runtime đó.

---

## 1. Mục tiêu và Phạm vi

Chốt thiết kế để executor không bao giờ dispatch một bước `myslack.*` khi chưa xác minh:
1. Binding 5 trường (`atiUserId, connectionId, workspaceId, slackUserId, identityVersion`) do server xác nhận và nằm trong snapshot kế hoạch đã băm/phê duyệt.
2. Một **envelope thực thi bất biến, đã tách rời** chứa binding, tool canonical, params đã phân giải, **toàn bộ** danh tính nguồn + provenance/policy ref/epoch cần cho guard; guard phải xác minh **đúng envelope sẽ dispatch**, không chỉ một digest mờ.
3. Quyền hiện tại (ATI user, connection, F1 bước + F1 nguồn, F3 lineage, barrier đầy đủ workspace/channel/resource/revision/epoch) được tái xác thực bằng hook nội bộ với `AbortSignal` thật trước **mỗi** lần thử, kể cả retry/resume.
4. Mọi write Slack bị chặn trước transport cho tới khi 04C được duyệt.

### Ranh giới nghiêm ngặt

1. **Plan-only:** chỉ sửa 3 tài liệu 03B3; không sửa `packages/`, `apps/`, `db/`, `CURRENT-STATE.md`, `ROADMAP.md`, cờ, inventory hay `main`.
2. **Không migration:** mọi thay đổi runtime đề xuất dùng bảng/cột hiện hữu (`plans`, `execution_steps`, `slack_connections`, `slack_invalidation_barriers`, `slack_sources`).
3. **Không mở write:** không thêm adapter write, không đăng ký `myslack` vào `ALL_TOOLS`/`SERVICE_REGISTRY`, không nới 253 `probe_required`.
4. **Không tuyên bố nghiệm thu runtime:** mọi test runtime trong kế hoạch ghi `NOT_RUN`; không có "all tests passed" cho phần chưa chạy; F2/F3/native giữ `NOT_RUN`.
5. **Hợp đồng chia sẻ cần đồng ý:** `PlanConnections.myslack` và runtime validator trong `packages/tool-schemas` phải được Backend + Schema owner chấp thuận trong PR trước khi viết mã; chữ ký `SlackDispatchGuard` trong executor phải được Backend review.

## 2. Quyết định thiết kế chính

1. **Approval envelope:** `connections.myslack = { bindings: {connectionId → binding}, steps: {stepId → {connectionId, tool, dependencies, policyReference}} }`, do Backend gắn trong `bindConnections` **trước** `sha256(JSON.stringify(response))`; binding/tool/dependency selector/policy nằm trong `plan_hash` hiện hữu, không đổi công thức hash. `dependencies` do **server dẫn xuất đầy đủ** từ args thô, không do model cung cấp.
2. **Binding không do model/client tạo:** resolver chỉ nhận `selection.assignments` do người dùng chọn rõ (`stepId → connectionId`); server tra `SlackConnectionRepo.withOwner(atiUserId, c => get(c, atiUserId, connectionId))` và tự dựng 5 trường từ `user_id/workspace_id/actor_id/identity_version`; `policyReference` dựng bằng `resolveSlackModelPolicy` với purpose/retention server quy định (đề xuất `planning` + 0 TTL). Không selection, assignment lạ/không sở hữu/trùng/thiếu, status thật `reconnect_required`/`disconnected`, consent chưa `granted`, bước write/unknown ⇒ từ chối tạo kế hoạch. Không fallback connection đầu tiên, không fanout ngầm, không rebind khi regrant.
3. **Nhiều workspace được phép có kiểm soát:** nhiều bước có thể bind nhiều `connectionId`/workspace nếu selection chỉ rõ từng bước; mỗi bước đúng một assignment, không mơ hồ. UI selection thuộc 03B4 (chưa có) nên hiện fail closed; không tuyên bố native.
4. **Envelope thực thi tách khỏi approval:** `slack-exec-v1` gồm `{v, planId, planHash, stepId, tool, binding, params, sources, policyReference, digest}`. `sources` có **từng segment** được tham chiếu: `selector`, `sourceRef`, `origin` (`transient|stored|persisted`), `provenance` per-entity, `captureId` (UUID khi stored), `acquisitionPolicyReference`, `policyEpoch`. Guard nhận **cùng object envelope đã freeze** sẽ dispatch; digest chỉ ràng buộc, không thay quyền.
5. **Digest canonical:** `slackDigestInput(envelope)` là projection **đóng** chỉ gồm các trường trên trừ `digest`; `computeSlackExecutionDigest(input)` = SHA-256(canonicalJson(input)); guard và Backend dùng **cùng hàm/projection**, nên `digest` không tự tham chiếu. Key sắp xếp code unit; revision/consent/provenance giữ **nguyên văn chuỗi**; từ chối `undefined`, số không hữu hạn, bigint, field lạ, `binding` trong params; `identityVersion` safe integer. Digest được tính lại mỗi lần thử từ `plan_json`/output đã khôi phục, không tin digest lưu sẵn.
6. **Resolver grammar chặt:** `$ref` đúng dạng `stepId.path` (chấm, segment `[A-Za-z0-9_-]+`, không bracket/khóa phụ); `$template` chỉ chứa token `${stepId.path}`; phân giải một lượt, không phân giải lại bên trong output. Dependency selector dẫn xuất đệ quy từ **mọi** ref/template, chuẩn hoá + khử trùng, lưu lúc tạo plan, so lại bằng đúng khi execute.
7. **Chống chèn binding:** quét sâu params đã phân giải (mọi độ sâu) và gọi `validateSlackToolExecutionArgs(tool, {binding, params})` canonical đệ quy. Nguồn Slack `transient` phải có provenance đúng entity được chọn — không lấy container thay entity con; output hỗn hợp phải có provenance cho **mọi** segment, thiếu/lẫn binding khác ⇒ deny; `stored` chỉ qua `getSource`, `persisted` bị deny. Nguồn non-Slack chỉ được làm param canonical, không chứa binding/provenance Slack, không bao giờ làm danh tính.
8. **Guard quyền đầy đủ:** `SlackDispatchGuard.authorize({envelope, signal})` tự tính lại digest bằng `slackDigestInput`, kiểm tra ATI user, connection, F1 bước exact `policyReference`; với từng source: `transient` phải có provenance + `checkBarriers({binding, workspaceId, channelId, epoch, resourceType, resourceId, revision})` — đủ trường (bỏ `channelId` chỉ khi resource không thuộc channel), vì `{binding}` trần **không** kiểm tra channel/resource/epoch; `stored` phải qua `SlackSourceStore.getSource({sourceRef, expectedCaptureId, consumerPurpose})`, chỉ nhận `status:'ok'`, `entity.sourceRef` khớp và nội dung param lấy từ `entity` (không tin output); `persisted`/derived bị deny `SLACK_SOURCE_UNVERIFIED` cho tới 03B2 lineage/version guard; F1 nguồn exact `acquisitionPolicyReference`. Thiếu guard/query ⇒ deny.
9. **TOCTOU:** detach + deep-freeze `{id,tool,args}` và các output được tham chiếu **tại entry, trước await**; resolve một lần; hash + authorize + dispatch **cùng envelope**; kiểm tra abort sau **mọi** await gồm `getAdapter`; factory await vượt ranh giới quyền phải `authorize` lần cuối trước execute; deadline abort phải settle dù hook/factory chưa trả; lỗi cố định theo code, không echo message hook; deny/abort không lấy adapter/token; không tạo `UNKNOWN` trước transport.
10. **Classification tĩnh:** đúng 8 read của 03C1; write tường minh (hiện `chat_postMessage`); mọi `myslack.*` khác `unknown` ⇒ chặn như write; `isWriteTool` rẽ nhánh `myslack.` trước catalog/regex.
11. **Retry/resume:** controller chỉ retry bước `failed`; mỗi lần `executeStep` chạy lại toàn bộ xác minh + guard + full barrier/epoch; không tái sử dụng quyết định cũ; write `UNKNOWN` không tự retry (hiện write bị chặn).
12. **Approval CAS giữ nguyên:** `approvePlan` với `WHERE id=$1 AND plan_hash=$2 AND status='pending' AND expires_at > now() AND EXISTS(owner)`; test đồng thời dùng PostgreSQL thật (hai pool client), không boolean giả.
13. **Validator runtime Task 1:** không chỉ thêm TS interface; đề xuất `validateSlackPlanBindings(value, planSteps)` từ chối khóa lạ mọi cấp, binding đủ 5 trường, `steps` khớp chính xác bước Slack, `connectionId` tồn tại, `tool` khớp, `policyReference` canonical, `dependencies` bằng kết quả dẫn xuất; giữ nguyên `gmail/mycalendar/mysheets`.
14. **Lineage nguồn:** `persisted` ưu tiên khi bước nguồn có `slackOutputOrigins` = persisted (output_json/resume/derived), provenance chỉ là bằng chứng và bị deny tới 03B2; nếu không, `stored` = raw capture UUID chỉ đọc qua `SlackSourceStore.getSource`; còn lại `transient` = output do bước Slack sinh trong **cùng lượt**, provenance 03C1 đáng tin. Controller truyền `slackOutputOrigins`; output khôi phục không thể tự nhận là transient. `stored` là đường **đề xuất** (03C1/03B4 chưa phát `captureId`), test synthetic/PG, không tuyên bố native. Shared `SlackSourceProvenance` đặt tại `packages/tool-schemas/src/myslack-source.ts` (Schema + Backend + 03C1 đồng ý), executor không import `tool-adapters` để lấy type.

## 3. Bản đồ thay đổi runtime đề xuất (file-by-file)

| File | Thay đổi | Owner |
|---|---|---|
| `packages/tool-schemas/src/types.ts` | `SlackPlanBindings`, `SlackStepBinding`, `SlackDependencySelector`, `PlanConnections.myslack?` | Integration + Backend đồng ý |
| `packages/tool-schemas/src/myslack-source.ts`; `packages/tool-adapters/src/slack/personal-slack-types.ts` | `SlackSourceProvenance` + validator; 03C1 alias/dùng lại (03C1 owner), executor chỉ import tool-schemas | Integration + Backend + 03C1 đồng ý |
| `packages/tool-schemas/src/myslack-plan-bindings.ts` (mới) | `validateSlackPlanBindings`, `deriveSlackDependencySelectors` | Integration + Backend đồng ý |
| `packages/tool-schemas/src/index.ts` | re-export type + validator | Integration |
| `packages/executor/src/slack/types.ts` | envelope/guard/snapshot/denial contract | Backend |
| `packages/executor/src/slack/classification.ts` | 8 read + write tường minh + unknown fail closed | Backend |
| `packages/executor/src/slack/canonical.ts` | `canonicalJson`, `slackDigestInput` (bỏ `digest`), `computeSlackExecutionDigest(input)` | Backend |
| `packages/executor/src/slack/guard.ts` | dựng envelope, selector/provenance/origin, gọi hook, TOCTOU | Backend |
| `packages/executor/src/runner.ts` | detach/freeze/abort, route `myslack.*` qua guard, `isWriteTool` fail closed, persist origin | Backend |
| `packages/executor/src/types.ts`, `index.ts` | `slackSnapshot`, `slackDispatchGuard`, `slackOutputOrigins` + export | Backend |
| `apps/chat-api/src/services/slack/slack-plan-bindings.ts` | resolver + multi-workspace selection + gắn envelope trước hash | Backend |
| `apps/chat-api/src/services/slack/slack-plan-verify.ts` | verify envelope khi approve/recovery | Backend |
| `apps/chat-api/src/services/slack/slack-dispatch-guard.ts` | hook quyền thật (user/connection/F1/F3/barrier/abort) | Backend |
| `apps/chat-api/src/services/chat-service.ts` | gọi resolver trong `bindConnections` | Backend |
| `apps/chat-api/src/services/execution-service.ts` | dựng snapshot, truyền guard, giữ CAS | Backend |

Không đổi: `isWriteTool` cho Gmail/Calendar/Sheets, `AdapterFactory` personal guards, `ALL_TOOLS`, `SERVICE_REGISTRY`, `MYSLACK_ENABLED` mặc định `off`, 04A runtime.

## 4. Ma trận TDD bắt buộc

| # | Kịch bản | Nơi test | Bằng chứng yêu cầu | Trạng thái |
|---|---|---|---|---|
| 1 | 8 read hợp lệ đi đúng một lần | `packages/executor` unit | guard nhận đúng envelope; adapter counter = 1; args `{binding, params}`, params không có `binding` | NOT_RUN |
| 2 | Sai từng trường trong 5 trường binding | executor unit | 5 case, adapter counter = 0 | NOT_RUN |
| 3 | Caller/hook mismatch, thiếu guard, thiếu snapshot/step record, tool lệch | executor unit | deny codes, `requestSent:false` | NOT_RUN |
| 4 | Chèn `binding` qua literal/`$ref`/`$template`/khóa phụ/object lồng/resolved-late | executor unit | từ chối trước adapter, `SLACK_PARAMS_INVALID`/`SLACK_DEPENDENCY_MISMATCH` | NOT_RUN |
| 5 | Allowlist tamper, unknown `myslack.*` | executor unit | `SLACK_WRITE_DISABLED`, counter = 0 | NOT_RUN |
| 6 | Hash ổn định + tamper + digest projection | executor unit | `slackDigestInput` không có `digest`; đổi `envelope.digest` không đổi digest tính lại; hoán vị key cùng digest; đổi 1 field đổi digest; field lạ ném lỗi | NOT_RUN |
| 7 | Revision/consent chuỗi lớn | executor unit | `"9007199254740993"`, `"1712345678.000200"` nguyên văn; `identityVersion` unsafe bị từ chối | NOT_RUN |
| 8 | Abort/timeout thật | executor unit | `AbortController`/`AbortSignal.timeout`, deadline abort khi hook/factory treo, counter = 0, `failed` không `unknown` | NOT_RUN |
| 9 | Revoke/regrant/reconnect | Backend PG + guard | revoke/regrant đổi `consentRevision`; reconnect đổi `identityVersion`; deny trước adapter | NOT_RUN |
| 10 | Thiếu hook 03B4 | Backend unit | deny an toàn, không giả lập token | NOT_RUN |
| 11 | Dịch vụ khác không đổi | executor unit | Trello/Gmail kết quả và hash không đổi | NOT_RUN |
| 12 | Write bị chặn | executor unit | `chat_postMessage` + tên lạ, counter = 0, không UNKNOWN | NOT_RUN |
| 13 | Không lộ token/nội dung nguồn | executor + Backend | quét sentinel trong `JSON.stringify(result)`/log; không echo message hook | NOT_RUN |
| 14 | Envelope trước hash, non-Slack byte-identical | Backend PG | `plan_hash` đổi khi có `myslack`; không đổi khi không có | NOT_RUN |
| 15 | Approval tamper, concurrent CAS, hết hạn, non-owner | Backend PG thật | đúng một `UPDATE ... WHERE status='pending'` thắng | NOT_RUN |
| 16 | Recovery dựng lại snapshot + output đã lưu | Backend PG thật (đề xuất) | controller đánh dấu `slackOutputOrigins` = `persisted`, bước kế dùng output làm nguồn Slack bị deny `SLACK_SOURCE_UNVERIFIED` tới 03B2; sửa plan ⇒ 409 | NOT_RUN |
| 17 | Scheduled run không selection | Backend PG | từ chối tạo plan Slack | NOT_RUN |
| 18 | Registry/adapter vắng | executor unit | fail trước `getAdapter`, counter = 0 | NOT_RUN |
| 19 | Synthetic source substitution: provenance cùng binding nhưng khác resource/revision | executor unit | `SLACK_SOURCE_UNVERIFIED`, counter = 0 | NOT_RUN |
| 20 | Đổi provenance giữa hai entity; container thay entity con; output hỗn hợp thiếu segment | executor unit | mọi segment phải có provenance đúng; deny khi thiếu/lẫn | NOT_RUN |
| 21 | `dependencies` forged/partial; `$ref` khóa phụ/grammar sai | executor unit | so bằng đúng với dẫn xuất server; deny trước resolve | NOT_RUN |
| 22 | Cross-service param hợp lệ; object binding-shaped từ non-Slack | executor unit | param canonical được phép; binding/provenance Slack bị từ chối | NOT_RUN |
| 23 | Guard nhận envelope khác digest/params so với dispatch | executor unit | deny `SLACK_ENVELOPE_MISMATCH`, counter = 0 | NOT_RUN |
| 24 | Guard deadline abort khi hook unresolved | executor unit | abort settle, không unhandled rejection, `failed`/`requestSent:false` | NOT_RUN |
| 25 | Factory await vượt revoke; factory resolve sau abort | executor unit | `authorize` lần cuối deny; không dispatch | NOT_RUN |
| 26 | Multi-workspace explicit; assignment thiếu/trùng/mơ hồ | Backend PG | hai workspace rõ ⇒ cho phép; mơ hồ ⇒ từ chối plan | NOT_RUN |
| 27 | Validator Task 1 strict | `packages/tool-schemas` unit | khóa lạ, step thiếu/thừa, connection lạ, policy lệch, dependencies forged bị từ chối | NOT_RUN |
| 28 | Barrier đầy đủ channel/resource/epoch | Backend PG + guard | query `{binding}` trần bỏ sót; query đủ trường bắt barrier và deny | NOT_RUN |
| 29 | Origin transient vs persisted vs stored | executor unit + Backend PG | transient cùng lượt allow; restored output có provenance 03C1 vẫn `persisted` deny; stored `captureId` chỉ allow sau `getSource` `status:'ok'`, sourceRef khớp, content lấy từ entity; thiếu/sai captureId hoặc không có đường lấy entity => deny | NOT_RUN |
| 30 | Backend recompute digest cùng projection | Backend PG/unit | Backend dùng `slackDigestInput` + `computeSlackExecutionDigest`, không băm envelope chứa `digest`; sửa `digest` không qua guard | NOT_RUN |
| 31 | Shared provenance type home | tool-schemas unit + import check | `SlackSourceProvenance` validator strict; executor import từ `@wap/tool-schemas`, không import `@wap/tool-adapters` cho type | NOT_RUN |

**Ranh giới:** test 1–8, 11–13, 18–25, 27–29, 31 chạy được trong `packages/executor`/`packages/tool-schemas` với `StepRunner` trực tiếp + adapter/guard giả có counter (biên unit hợp lệ); 27/31 là unit tool-schemas. Test 9, 14–17, 26, 28–30 (phần PG) chạy trong `apps/chat-api` với PostgreSQL 16 thật. Native Slack API, 03B4 routing/UI, 04C write, 03B2 lineage: **chưa tồn tại, không được tuyên bố đạt**; persisted source bị deny.

## 5. Tiêu chí nghiệm thu của task này (docs-only)

- [x] Đủ 3 tài liệu 03B3, UTF-8, không sửa file ngoài phạm vi.
- [x] Kế hoạch ≤ 300 dòng, anchor file/symbol hiện hữu tại `612ac427`, phụ thuộc rõ ràng.
- [x] Mọi lệnh runtime ghi `NOT_RUN`; chỉ kiểm tra tài liệu được chạy thật.
- [x] Nêu rõ hợp đồng chia sẻ cần Backend + Schema owner đồng ý trước khi code.
- [x] Không có "Generated with …", không có tên công cụ AI, không có secret.

## 6. Phụ thuộc & Cổng chưa đóng

1. **03C1:** đã review/merge tại `390b1c54`; 8 tên read canonical + `MYSLACK_CORE_READ_TOOLS` dùng cho test hợp đồng chéo.
2. **03B1:** đã review/merge tại `23544be9`; `checkBarriers` dùng ở Task 7 với query đầy đủ, không phải `{binding}` trần.
3. **03B4:** wrapper `SlackTokenManager`/`SlackPolicyService` nhận `SlackBinding`, routing/gather, UI selection, đăng ký adapter `myslack`; chưa có.
4. **03B2:** lineage/purge F3; chỉ PLAN, không đóng bởi 03B3; guard từ chối `persisted`/derived tới khi có lineage version/guard; raw `stored` chỉ qua `getSource` 03B1.
5. **04C:** outbox/UNKNOWN/approval cho write; chưa có, mọi write vẫn chặn.
6. **Hợp đồng chia sẻ:** Backend + Schema owner + 03C1 phải đồng ý `PlanConnections.myslack`, validator runtime và nơi đặt `SlackSourceProvenance` trước khi code.

## 7. Kết quả

- Đã hiệu chỉnh 3 tài liệu 03B3 theo 6 khe hở review: envelope đầy đủ thay digest; dependency selector server-derived + resolver grammar + provenance per-entity; TOCTOU detach/freeze/abort/reauthorize; validator runtime Task 1 + lệnh test đúng; multi-workspace explicit; anchor `612ac427`/`390b1c54`/`23544be9`.
- Hiệu chỉnh cuối: digest chỉ băm `slackDigestInput` (bỏ `digest`, Backend dùng cùng projection); phân biệt `transient`/`stored`/`persisted`, persisted/derived bị deny tới 03B2, stored qua `getSource`; provenance type đặt tại tool-schemas, executor không import tool-adapters.
- Kiểm tra tài liệu thật: xem mục "Kiểm chứng" trong nhật ký (đếm link nội bộ, UTF-8, số dòng kế hoạch, `git diff --check`).
- Runtime: **NOT_RUN toàn bộ** — không có thay đổi mã nguồn trong task này; F2/F3/native `NOT_RUN`.
- Chưa sửa `CURRENT-STATE.md`/`ROADMAP.md`; reviewer cập nhật sau khi merge.
