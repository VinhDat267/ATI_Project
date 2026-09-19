# AI-03 Lease/Currentness Gate Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task, directly in the current checkout, following the user's execution preference. Steps use checkbox syntax. Independent Code Reviewer review is required after implementation by AGENTS.md; it does not delegate implementation.

**Goal:** Chặn replan result/preview đến muộn khi worker mất lease, run đã đổi owner/status/version, hoặc reviewed gateway không còn current.

**Architecture:** Giữ PostgreSQL advisory lock và sequential worker hiện có. Bổ sung guard cho DB state đã khóa và checkpoint gateway trước khi nhận candidate/publish preview; mọi nhánh kết thúc và error cleanup phải tuân cùng ownership guard. Không giữ transaction qua lời gọi LLM hoặc MCP.

**Tech Stack:** TypeScript, PostgreSQL 16, postgres.js, Vitest, MCP gateway hiện có.

**Spec:** `docs/BASELINE.md`, `docs/EXECUTION-CONTRACT.md`, `docs/superpowers/specs/2026-09-17-ai-backend-design.md` §2.7 và §4. Đây là phần hardening của AI-03 trong `docs/superpowers/plans/2026-09-17-ai-backend.md`.

**Status:** `IMPLEMENTED_MAIN_VERIFIED` (2026-09-18) — implemented directly in the current checkout. The planned helper remains private in `replan.ts` and the race cases extend the existing AI-03 integration suite; no public API or new module was needed.

## Global Constraints

- “Một worker, thực thi tuần tự theo thứ tự topo; retry giới hạn và side-effect gate. Không tự resume run sau crash”.
- “Chỉ bước chưa hoàn tất, kết quả lần gọi chắc chắn không gây side-effect; validation lại và approval mới trước write”.
- “Giới hạn local replan 2. Partial/full replan không thuộc B.”
- “Duyệt đúng snapshot, TTL 10 phút.” PostgreSQL quyết định expiry.
- Unknown write không gọi replan, không đổi operation ID để replay; giữ reconciliation semantics.
- Giữ local-scope guard, secret guard, completed-step preservation và immutable approval snapshot đã có.
- Làm trực tiếp trong thư mục/nhánh hiện tại; bảo toàn dirty changes. Plan không tự cấp quyền commit/push.
- Không đổi API wire format, provider/model, queue, migration hoặc frontend.

## Bằng chứng code và quyết định thiết kế

Đã đọc `replan.ts`, `store.ts`, `execute.ts`, `prepare.ts`, `attempts.ts`, `recovery.ts`, gateway và integration tests:

1. `Store.assertWorker()` kiểm connection giữ advisory lock bằng `pg_locks`; `withWorker()` đánh dấu lease lost và đóng gateway. Lease logic nằm trong `store.ts`.
2. Replan mới gọi `assertWorker` ở entry và transaction tạo version. Các nhánh refusal/clarification/error và transaction preview cuối chưa có guard tương đương; entry chưa ràng buộc claimed owner/status/version.
3. Replan chưa gọi `gateway.assertCurrent()`. `gateway.tools` là snapshot trong bộ nhớ, không thay được việc kiểm artifact/policy hiện tại.
4. `cancel()` có thể kết thúc run ngay khi planner đang chờ. `recoverOrphans()` lấy lease mới và kết thúc orphan; callback cũ không được ghi đè kết quả này.
5. `callStep()` có dispatch lease checks nhưng transaction lưu outcome/retry event chưa kiểm version/owner. Vì replan dry-run gọi helper này, test cần bao phủ cả callback read đến muộn.
6. AI backend plan cũ đã tick mục currentness và race tests. Những tick đó chưa đủ để chứng minh gate này; khi triển khai phải bổ sung evidence, không coi gate đã đóng.

**Chọn:** guard nhỏ, riêng cho replan; dùng token `{workflowVersionId, replanCount, phase}` cùng `store.workerId`. Sau transaction tạo version, thay token sang version mới/phase `dry_running`. Không thêm distributed lock, heartbeat timeout, lease renewal hoặc auto recovery.

**Semantics:**

| Điều kiện                                              | Hành vi                                                                                                  |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Lease mất hoặc owner/status/version/count không khớp   | Dừng callback cũ, không emit/cleanup/transition từ callback đó; trả detail hiện hành nếu DB còn đọc được |
| Run đã terminal, kể cả cancel/recovery                 | Giữ nguyên state và event tail                                                                           |
| Cancel requested, token vẫn hiện hành và lease còn giữ | Kết thúc theo cancel/unknown-write contract; không gọi bước kế tiếp                                      |
| Gateway drift, worker vẫn sở hữu phase hiện hành       | Fail closed với thông báo cố định; không tạo preview/operation mới                                       |
| Gateway drift nhưng token/lease đã mất                 | Không ghi failure từ worker cũ                                                                           |
| Chỉ còn read, không có actions                         | `succeeded` cũng cần gate cuối, không bỏ qua vì thiếu write                                              |
| Approval cũ hết hạn trong lúc replan hợp lệ            | Không tái dùng approval cũ; approval mới có TTL 10 phút từ lúc persist, vẫn phải được duyệt              |

Gateway currentness là checkpoint, không phải khóa nguyên tử xuyên filesystem và PostgreSQL. Gate này không hứa ngăn artifact thay đổi sau lần check cuối. Decision/execute và mỗi dispatch vẫn phải giữ các currentness/approval checks hiện có. Tương tự, kiểm lease trên connection riêng không tạo atomic fence với COMMIT; row lock và recheck chặn stale state đã quan sát và serialize với cancel/recovery. Không mô tả patch này như distributed fencing tuyệt đối.

## File map

| File                                                                    | Trách nhiệm dự kiến                                                                                  |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `packages/engine/src/replan-guard.ts` (mới)                             | Token và guard DB cho phase replan                                                                   |
| `packages/engine/src/replan.ts`                                         | Entry/result/version/preview/error checkpoints                                                       |
| `packages/engine/src/attempts.ts`                                       | Optional guard callback cho các mutation của replan read attempts                                    |
| `packages/engine/src/execute.ts`, `prepare.ts`                          | Chỉ sửa nếu outer catch đang biến stale error thành mutation; không refactor luồng planning đầu tiên |
| `packages/engine/tests/ai-replan-currentness.integration.test.ts` (mới) | Race matrix, isolated DB/MCP                                                                         |
| `packages/engine/tests/ai-replan.integration.test.ts`                   | Giữ positive và scope/secret regressions hiện có                                                     |
| `docs/AI-STATUS-2026-09-17.md`, AI backend plan, engine README          | Evidence và giới hạn sau khi test                                                                    |

## Kết quả triển khai (2026-09-18)

- `replan.ts` now captures a `{workflowVersionId, replanCount, phase}` token and verifies lease, owner, version, count, and phase before a late callback can settle a replan result, apply a version, or publish a preview. The entry boundary returns the current detail for `LEASE_LOST`/`STALE_REPLAN`, so `prepare`/`execute` cannot terminally settle a stale callback.
- `attempts.ts` accepts an optional internal mutation guard. Replan dry-run passes its token guard to every attempt mutation, including a late read reply.
- Gateway currentness is checked before accepting a replacement candidate and immediately before preview publication. Gateway drift fails closed only while the same worker still owns the current token.
- `ai-replan.integration.test.ts` contains deterministic PostgreSQL/MCP barriers [AI-03-11] through [AI-03-18] for late refusal/plan, lease loss before initialization or after a read reply, owner change before or after initialization, and gateway drift before apply or preview. These are local fixture tests, not live-model evidence.
- Verification after the final source change: `npm run check:backend` exit 0 (DSL 43; engine unit 162 passed + 1 skipped; API unit 36; web unit 38; MCP task-hub integration 64; engine integration 83; API integration 34). Independent Code Reviewer re-review found no remaining concrete blocker.

**Implementation note:** The v1 checklist below records the original, deliberately broader design exploration. The implemented gate uses the existing integration file and `Gateway.assertCurrent()` contract rather than creating the proposed separate files or mutating a real preset/artifact. The stated distributed-fencing limitation remains in force.

## Task 1 — Guard ownership và kết quả AI đến muộn

**Interfaces:** Tạo internal helper trong `replan-guard.ts`; không public export qua index.

```ts
import type { Store, Tx, RunRow } from "./store.js";
import { EngineError } from "./snapshot.js";

export type ReplanToken = Readonly<{
  workflowVersionId: string;
  replanCount: number;
  phase: "replanning" | "dry_running";
}>;

export async function assertReplanCurrent(
  store: Store,
  tx: Tx,
  runId: string,
  token: ReplanToken,
): Promise<RunRow> {
  const run = await store.run(tx, runId, true);
  await store.assertWorker(tx);
  if (
    run.claimed_by !== store.workerId ||
    run.workflow_version_id !== token.workflowVersionId ||
    run.replan_count !== token.replanCount ||
    run.status !== token.phase
  ) {
    throw new EngineError("STALE_REPLAN", "Replan state is no longer current");
  }
  return run;
}
```

- [ ] Viết parameterized tests chặn `LocalReplanPort.replan()` bằng deferred Promise, rồi cancel hoặc đổi owner/version trong DB test trước khi trả `plan`, `refusal`, `clarification`, hoặc throw. Chụp DB sau tác động cạnh tranh, trước khi giải phóng callback.
- [ ] Assert sau callback: không thêm version/approval/operation/event; terminal status không đổi; error từ callback không ghi đè error của cancel/recovery. Owner/version mismatch chưa terminal cũng không được bị callback chuyển failed.
- [ ] Chạy red: `npm run test:integration -w @wap/engine -- ai-replan-currentness.integration.test.ts`.
- [ ] Implement helper trên. Entry phải lock run, assert lease, yêu cầu claimed owner hiện tại và status `running` hoặc `dry_running` trước khi tăng count. Unknown certainty branch cũng phải kiểm ownership trước khi ghi reconciliation; tuyệt đối không gọi model.
- [ ] Capture token sau entry; áp guard cho tất cả result branches, validation/secret failure, version apply và cleanup. Check terminal/stale trước cancellation transition để không transition terminal lần hai. Refusal/clarification không cần gateway currentness vì không tạo executable artifacts, nhưng vẫn cần DB/lease guard.
- [ ] Catch `LEASE_LOST`/`STALE_REPLAN` ở boundary replan và chỉ đọc detail; nếu DB không đọc được thì propagate lỗi. Không gọi failure cleanup với stale token. Không nuốt lỗi DB khác như stale.
- [ ] Rerun targeted test và existing `ai-replan.integration.test.ts`. Positive flow vẫn tạo đúng một version mới và count tăng đúng một.

## Task 2 — Gateway và publication gate

**Consumes:** `ReplanToken`, `assertReplanCurrent()` từ Task 1.
**Produces:** Replan version/preview chỉ được persist sau currentness checkpoint và guarded DB transaction.

- [ ] Viết red cases gateway drift khi model trả plan và khi dry-run kết thúc. Dùng gateway wrapper kế thừa các method thật, override `assertCurrent` để throw sau barrier; thêm một case drift artifact/preset thật trong fixture cô lập và restore bằng `finally`.
- [ ] Case drift trước apply: delta version/approval/operation bằng 0. Case drift sau apply: có thể giữ version audit và read attempts đã lưu; delta approval/operation bằng 0, không có `dryrun.ready`, run failed nếu còn sở hữu.
- [ ] Test cả write preview và read-only completion; test cancel/owner change trong lúc checkpoint đang chờ để chứng minh checkpoint gateway không thay guard DB.
- [ ] Bổ sung thứ tự sau khi model trả candidate và trước apply:

```ts
await store.db.client.begin((tx) =>
  assertReplanCurrent(store, tx, runId, token),
);
await gateway.assertCurrent();
// Validate candidate with the reviewed catalog; secret/local-scope checks stay.
await store.db.client.begin(async (tx) => {
  const run = await assertReplanCurrent(store, tx, runId, token);
  // Handle current cancellation, then existing version/apply writes.
  // Recheck lease before returning from the transaction callback.
  await store.assertWorker(tx);
});
```

- [ ] Sau apply commit, đổi token sang version mới và `dry_running`. Giữ một bản catalog clone/hash cho validation và snapshot; reject nếu canonical catalog thay đổi trước publication. Không refresh catalog rồi âm thầm accept payload cũ.
- [ ] Trước publication gọi `gateway.assertCurrent()` ngoài transaction; bên trong transaction lock run rồi assert token, xử lý cancel, insert operations + approval + status + ready event nguyên tử. Recheck lease trước callback return. Áp cùng gate cho nhánh `succeeded` không có actions.
- [ ] Gateway failure dùng error message cố định, ví dụ `Reviewed gateway changed during replan`; failure transaction chỉ chạy khi token và lease vẫn hợp lệ. Không nối raw error vào event có thể chứa secret.
- [ ] Rerun currentness tests và existing replan tests; assert preview mới vẫn immutable và TTL tính từ DB lúc persist.

## Task 3 — Lease loss và late read result xuyên suốt dry-run

**Files:** `attempts.ts`, `replan.ts`, currentness integration tests; outer callers chỉ khi cần.
**Interfaces:** Thêm optional argument cuối vào `callStep` để giữ compatibility với callers hiện có:

```ts
type AttemptGuard = (tx: import("./store.js").Tx) => Promise<void>;
// callStep(...existingArguments, beforeMutation?: AttemptGuard)
// In each transaction that mutates attempt/step/retry events:
await beforeMutation?.(tx);
// Replan read caller passes:
const beforeMutation: AttemptGuard = async (tx) => {
  await assertReplanCurrent(store, tx, runId, token);
};
```

- [ ] Viết real PostgreSQL lease-loss tests: tìm pid advisory lock `638019814` chỉ trong database fixture; `pg_terminate_backend(pid)` ở barrier khi model chờ hoặc khi read result đã về nhưng chưa lưu. Dùng gateway riêng cho từng test vì lease loss đóng connection.
- [ ] Lấy lease bằng worker thứ hai, gọi `recoverOrphans()`, snapshot durable rows/events rồi giải phóng worker cũ. Assert worker cũ không thêm event sau `run.finished`, không sửa outcome đã recovery, không tạo preview/write.
- [ ] Thêm case mất lease trước final preview transaction, không chạy recovery ngay: không publish approval; run có thể còn claimed để recovery thủ công. Gọi recovery sau và xác nhận failed hoặc reconciliation theo operation evidence.
- [ ] Implement optional attempt guard trước mọi mutation transaction khi được truyền: tạo attempt, finalize outcome, retry event. Check lại trước dispatch và sau backoff bằng luồng hiện có; replan loop kiểm token trước condition/skipped mutation và recursion.
- [ ] Error từ stale guard phải thoát retry/replan logic, không bị convert thành lỗi tool retryable. Audit outer catches trong `execute.ts` và `prepare.ts`; nếu chúng ghi vào stale run khi replan trả lỗi, thêm guard cùng nguyên tắc, với regression test chứng minh.
- [ ] Assert không gọi write MCP trong dry-run; operation/receipt/write count không tăng sau barrier. Giữ unknown-write case và completed-write preservation xanh.

**Deterministic barrier dùng trong test:**

```ts
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
// Model wrapper signals entered.resolve(undefined), awaits release.promise.
// Test awaits entered.promise, mutates ONLY isolated fixture, then releases.
```

Không dùng sleep để tạo race. Bọc release/connection cleanup trong `finally`; attach rejection handler ngay khi bắt đầu execution Promise để không gây unhandled rejection. Assert DB deltas theo run ID, không dùng count toàn suite. Chạy shared DB suites tuần tự.

## Task 4 — Gate, review và evidence

- [ ] Chạy targeted suites sau code cuối:

```powershell
npm run test:integration -w @wap/engine -- ai-replan-currentness.integration.test.ts ai-replan.integration.test.ts controller.integration.test.ts
```

- [ ] Chạy `npm run check:backend` một lần sau khi targeted tests xanh; ghi actual totals, skips và exit code. Test local fixture không được ghi là live model evaluation.
- [ ] Independent Code Reviewer đọc guard coverage, transaction boundaries, outer catch và race tests; main xử lý finding có bằng chứng. Implementation vẫn do main thực hiện theo yêu cầu người dùng.
- [ ] Cập nhật AI status và AI-03 checkbox/evidence link: chỉ đánh dấu gate PASS sau tests; giữ live provider/API replan/evaluation ở trạng thái đã xác minh thực tế. README giải thích lease loss cần recovery, không tự resume.
- [ ] `git diff --check`; review diff và new files; không stage chung dirty worktree. Commit chỉ thực hiện khi người dùng yêu cầu.

## Acceptance matrix

| Scenario                                         | Evidence bắt buộc                                                |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| Normal replan write                              | New version + pending approval; 0 automatic writes               |
| Normal read-only replan                          | Succeeded sau final gate                                         |
| Late plan/refusal/clarification/error sau cancel | Terminal state/event tail bất biến                               |
| Owner/version/count mismatch                     | Không mutation từ callback cũ                                    |
| Lease lost khi chờ model                         | Không candidate apply; recovery có thể lấy lease                 |
| Lease lost trước preview                         | Không approval/operation/ready event mới                         |
| Recovery hoàn tất trước late read result         | Không ghi đè attempt hoặc thêm event                             |
| Gateway drift trước version apply                | Không version/approval/operation mới                             |
| Gateway drift sau dry-run                        | Không preview; failure chỉ từ current worker                     |
| Completed write / unknown write                  | Không replay; unknown không gọi replan                           |
| Secret / scope violation                         | Giữ regression tests hiện có xanh                                |
| Old approval / new TTL                           | Old approval superseded; approval mới bắt buộc và TTL DB 10 phút |

**Điều kiện đóng gate:** tất cả matrix có test/evidence, backend gate xanh, không còn finding blocking. Không tuyên bố hoàn tất toàn AI-03/API/live AI từ slice này.
