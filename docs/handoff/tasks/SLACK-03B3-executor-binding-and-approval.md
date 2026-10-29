# SLACK-03B3 · Binding bất biến & cổng phê duyệt trong Executor

**Trạng thái:** PLAN_ONLY — kế hoạch đã soạn, chờ review độc lập. Không có mã runtime nào được sửa trong task này.
**Nhánh công việc:** `docs/slack-03b3-executor-binding-plan` · **Nền:** `59f1aafc` (`origin/integration/slack-personal-20261029`).
**Vai trò sở hữu:** Backend Engineer (kế hoạch cho `packages/executor/`, `apps/chat-api/`, `packages/tool-schemas/` với điều kiện đồng ý chung).
**Task cha:** [SLACK-03-tool-catalog-and-source-lifecycle](SLACK-03-tool-catalog-and-source-lifecycle.md).
**Kế hoạch chi tiết:** [`docs/superpowers/plans/2026-10-30-slack-03b3-executor-binding-and-approval.md`](../../superpowers/plans/2026-10-30-slack-03b3-executor-binding-and-approval.md).
**Nhật ký phiên:** [`docs/handoff/log/2026-10-30-slack-03b3-executor-binding-plan.md`](../log/2026-10-30-slack-03b3-executor-binding-plan.md).

**Phụ thuộc đã đọc (read-only):**
- Hợp đồng nguồn `e9088d5e` + SLACK-03A (đã merge trong integration).
- 03C1 adapter đọc tại `390b1c54` (`feat-slack-03c1-read-adapters`) — 8 phương thức đọc cố định, `args.binding`, hook token/policy; **chưa merge**.
- 03B1 tại `a38267d1` (`feat-slack-03b1-source-store`) — `SlackInvalidationService.checkBarriers`; **cây làm việc còn dở, không giả định là head cuối**.
- 03B2 chỉ là PLAN đang review; 03B4 wrapper/routing và 04C outbox chưa tồn tại.

---

## 1. Mục tiêu và Phạm vi

Chốt thiết kế để executor không bao giờ dispatch một bước `myslack.*` khi chưa xác minh:
1. Binding 5 trường (`atiUserId, connectionId, workspaceId, slackUserId, identityVersion`) do server xác nhận và nằm trong snapshot kế hoạch đã băm/phê duyệt.
2. Đúng tool canonical + args đã phân giải + danh tính nguồn (`$ref` cùng binding, revision nguyên văn).
3. Quyền hiện tại (ATI user, connection, F1, barrier nguồn) được tái xác thực bằng hook nội bộ với `AbortSignal` thật trước **mỗi** lần thử, kể cả retry/resume.
4. Mọi write Slack bị chặn trước transport cho tới khi 04C được duyệt.

### Ranh giới nghiêm ngặt

1. **Plan-only:** chỉ tạo 3 tài liệu trong task này; không sửa `packages/`, `apps/`, `db/`, `CURRENT-STATE.md`, `ROADMAP.md`, cờ, inventory hay `main`.
2. **Không migration:** mọi thay đổi runtime đề xuất dùng bảng/cột hiện hữu (`plans`, `execution_steps`, `slack_connections`).
3. **Không mở write:** không thêm adapter write, không đăng ký `myslack` vào `ALL_TOOLS`/`SERVICE_REGISTRY`, không nới 253 `probe_required`.
4. **Không tuyên bố nghiệm thu runtime:** mọi test runtime trong kế hoạch ghi `NOT_RUN`; không có "all tests passed" cho phần chưa chạy.
5. **Hợp đồng chia sẻ cần đồng ý:** `PlanConnections.myslack` trong `packages/tool-schemas` phải được Backend + Integration/Schema chấp thuận trong PR trước khi viết mã; hook `SlackDispatchGuard` nằm trong executor (Backend sở hữu) nhưng chữ ký phải được Backend review.

## 2. Quyết định thiết kế chính

1. **Envelope đã duyệt:** `connections.myslack = { bindings: {connectionId → binding}, steps: {stepId → {connectionId, tool, sourceRefs, policyReference}} }` do Backend gắn trong `bindConnections` **trước** `sha256(JSON.stringify(response))`; nhờ đó binding/tool/source selector/policy nằm trong `plan_hash` hiện hữu, không đổi công thức hash.
2. **Binding không do model/client tạo:** resolver chỉ nhận `connectionId` do người dùng chọn rõ; server tra `getConnectionMetadataForUser(atiUserId, connectionId)` và tự dựng 5 trường. Không selection, selection lạ, không sở hữu, `revoked`/`reconnect_required`, consent chưa `granted`, hai selection khác nhau, bước write/unknown ⇒ từ chối tạo kế hoạch. Không fallback connection đầu tiên, không fanout, không rebind khi regrant (identityVersion lệch).
3. **Digest thực thi tách khỏi approval envelope:** `slack-exec-v1` băm envelope đóng gồm planId/planHash/step/tool/binding/params đã phân giải/observedSources; key sắp xếp canonical; revision và consent giữ **nguyên văn chuỗi**; từ chối `undefined`, số không hữu hạn, bigint, field lạ, `binding` trong params. Approval chỉ băm selector `$ref` + binding + policy; revision quan sát thật vào digest runtime — không có chuyện băm args chưa phân giải rồi tuyên bố args đã phân giải y hệt.
4. **Classification tĩnh:** đúng 8 tên read của 03C1; write tường minh (hiện chỉ `chat_postMessage`); mọi tên `myslack.*` khác là `unknown` ⇒ chặn như write. `isWriteTool` rẽ nhánh `myslack.` trước catalog/regex nên tên lạ không thể "thành read" nhờ regex.
5. **Guard trước adapter:** kiểm tra snapshot/binding/tool/injection/source → digest → `SlackDispatchGuard.authorize` → kiểm tra abort lần cuối → `getAdapter('myslack')` → `adapter.execute(tool, { binding, params }, { signal })`. Thiếu guard/snapshot/step record/adapter đều fail closed, `requestSent: false`, không tạo `UNKNOWN`.
6. **Hook quyền:** `SlackDispatchGuard` do Backend cài đặt, gọi `SlackPolicyService` (F1 hiện tại), `SlackInvalidationService.checkBarriers({ binding })` khi 03B1 merge, connection + ATI user hiện tại, kiểm tra `signal.aborted` sau từng await. `SlackPolicyReference`/epoch chỉ là bằng chứng, không phải quyền. Executor không nhận token.
7. **Retry/resume:** controller chỉ retry bước `failed`; mỗi lần gọi `executeStep` chạy lại toàn bộ xác minh + hook. Digest được tính lại từ `plan_json`/`execution_steps` đã lưu, không tin digest lưu sẵn. Write `UNKNOWN` không bao giờ tự retry (hiện write bị chặn hoàn toàn).
8. **Approval CAS giữ nguyên:** `approvePlan` với `WHERE id=$1 AND plan_hash=$2 AND status='pending' AND expires_at > now() AND EXISTS(owner)`; test đồng thời phải dùng PostgreSQL thật (hai pool client), không dùng boolean giả.

## 3. Bản đồ thay đổi runtime đề xuất (file-by-file)

| File | Thay đổi | Owner |
|---|---|---|
| `packages/tool-schemas/src/types.ts` | `SlackPlanBindings`, `SlackStepBinding`, `SlackSourceBinding`, `PlanConnections.myslack?` | Integration + Backend đồng ý |
| `packages/tool-schemas/src/index.ts` | re-export type | Integration |
| `packages/executor/src/slack/types.ts` | guard/snapshot/denial contract | Backend |
| `packages/executor/src/slack/classification.ts` | 8 read + write tường minh + unknown fail closed | Backend |
| `packages/executor/src/slack/canonical.ts` | `canonicalJson`, `computeSlackExecutionDigest` | Backend |
| `packages/executor/src/slack/guard.ts` | xác minh trước dispatch | Backend |
| `packages/executor/src/runner.ts` | rẽ nhánh `myslack.*`, `isWriteTool` fail closed | Backend |
| `packages/executor/src/types.ts`, `index.ts` | `slackSnapshot`, `slackDispatchGuard` + export | Backend |
| `apps/chat-api/src/services/slack/slack-plan-bindings.ts` | resolver + gắn envelope trước hash | Backend |
| `apps/chat-api/src/services/slack/slack-plan-verify.ts` | verify envelope khi approve/recovery | Backend |
| `apps/chat-api/src/services/slack/slack-dispatch-guard.ts` | hook quyền thật | Backend |
| `apps/chat-api/src/services/chat-service.ts` | gọi resolver trong `bindConnections` | Backend |
| `apps/chat-api/src/services/execution-service.ts` | dựng snapshot, truyền guard, giữ CAS | Backend |

Không đổi: `isWriteTool` cho Gmail/Calendar/Sheets, `AdapterFactory` personal guards, `ALL_TOOLS`, `SERVICE_REGISTRY`, `MYSLACK_ENABLED` mặc định `off`.

## 4. Ma trận TDD bắt buộc

| # | Kịch bản | Nơi test | Bằng chứng yêu cầu | Trạng thái |
|---|---|---|---|---|
| 1 | 8 read hợp lệ đi đúng một lần | `packages/executor` unit | adapter counter = 1, args `{binding, params}`, params không có `binding` | NOT_RUN |
| 2 | Sai từng trường trong 5 trường binding | executor unit | 5 case, adapter counter = 0 | NOT_RUN |
| 3 | Caller/hook mismatch, thiếu guard, thiếu snapshot, tool lệch | executor unit | deny codes, `requestSent:false` | NOT_RUN |
| 4 | Chèn `binding` qua literal/`$ref`/`$template`/object lồng | executor unit | từ chối trước adapter | NOT_RUN |
| 5 | Allowlist tamper, unknown `myslack.*` | executor unit | `SLACK_WRITE_DISABLED`, counter = 0 | NOT_RUN |
| 6 | Hash ổn định + tamper | executor unit | hoán vị key cùng digest; đổi 1 field đổi digest; field lạ ném lỗi | NOT_RUN |
| 7 | Revision/consent chuỗi lớn | executor unit | `"9007199254740993"`, `"1712345678.000200"` nguyên văn; `identityVersion` unsafe bị từ chối | NOT_RUN |
| 8 | Abort/timeout thật | executor unit | `AbortController`/`AbortSignal.timeout`, counter = 0, `failed` không `unknown` | NOT_RUN |
| 9 | Revoke/regrant policy | Backend PG + guard | deny trước adapter; identityVersion mới ⇒ mismatch | NOT_RUN |
| 10 | Thiếu hook 03B4 | Backend unit | deny an toàn, không giả lập token | NOT_RUN |
| 11 | Dịch vụ khác không đổi | executor unit | Trello/Gmail kết quả và hash không đổi | NOT_RUN |
| 12 | Write bị chặn | executor unit | `chat_postMessage` + tên lạ, counter = 0, không UNKNOWN | NOT_RUN |
| 13 | Không lộ token/nội dung nguồn | executor + Backend | quét sentinel trong `JSON.stringify(result)`/log | NOT_RUN |
| 14 | Envelope trước hash, non-Slack byte-identical | Backend PG | `plan_hash` đổi khi có `myslack`; không đổi khi không có | NOT_RUN |
| 15 | Approval tamper, concurrent CAS, hết hạn, non-owner | Backend PG thật | đúng một `UPDATE ... WHERE status='pending'` thắng | NOT_RUN |
| 16 | Recovery dựng lại snapshot + output đã lưu | Backend PG thật | dispatch lại đúng binding; sửa plan ⇒ 409 | NOT_RUN |
| 17 | Scheduled run không selection | Backend PG | từ chối tạo plan Slack | NOT_RUN |
| 18 | Registry/adapter vắng | executor unit | fail trước `getAdapter`, counter = 0 | NOT_RUN |

**Ranh giới:** test 1–8, 11–13, 18 chạy được trong `packages/executor` với `StepRunner` trực tiếp + adapter/guard giả có counter (biên unit hợp lệ). Test 9, 14–17 chạy trong `apps/chat-api` với PostgreSQL 16 thật. Native Slack API, 03B4 routing, 04C write, 03B2 lineage: **chưa tồn tại, không được tuyên bố đạt**.

## 5. Tiêu chí nghiệm thu của task này (docs-only)

- [x] Đủ 3 tài liệu mới, UTF-8, không sửa file ngoài phạm vi.
- [x] Kế hoạch ≤ 300 dòng, có anchor file/symbol hiện hữu và phần phụ thuộc rõ ràng.
- [x] Mọi lệnh runtime ghi `NOT_RUN`; chỉ kiểm tra tài liệu được chạy thật.
- [x] Nêu rõ hợp đồng chia sẻ cần Backend + Integration/Schema đồng ý trước khi code.
- [x] Không có "Generated with …", không có tên công cụ AI, không có secret.

## 6. Phụ thuộc & Cổng chưa đóng

1. **03C1 merge:** 8 tên read canonical + `MYSLACK_CORE_READ_TOOLS` phải vào integration trước khi test hợp đồng chéo classification chạy được.
2. **03B1 merge bản cuối:** `SlackInvalidationService.checkBarriers` dùng ở Task 7; head hiện tại còn cây làm việc dở.
3. **03B4:** wrapper `SlackTokenManager`/`SlackPolicyService` nhận `SlackBinding` + đăng ký adapter `myslack`; chưa có.
4. **03B2:** lineage/purge F3; chưa merge, không đóng bởi 03B3.
5. **04C:** outbox/UNKNOWN/approval cho write; chưa có, mọi write vẫn chặn.

## 7. Kết quả

- Đã tạo 3 tài liệu: task card này, kế hoạch chi tiết, nhật ký phiên.
- Kiểm tra tài liệu thật: xem mục "Kiểm chứng" trong nhật ký (đếm link nội bộ, UTF-8, số dòng kế hoạch, `git diff --check`).
- Runtime: **NOT_RUN toàn bộ** — không có thay đổi mã nguồn trong task này.
- Chưa sửa `CURRENT-STATE.md`/`ROADMAP.md`; reviewer cập nhật sau khi merge.
