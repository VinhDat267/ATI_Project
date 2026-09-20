# AI Live Readiness Remediation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for direct implementation in the current checkout. Follow dependency order and obtain independent read-only review before closing readiness.
>
> **Status:** PLAN_ONLY — chưa triển khai. Baseline: `4106868` on `main`, worktree clean before this document. This plan supersedes optimistic completion claims for overlapping requirements, not the original evaluation scope.

**Goal:** Đóng các lỗ hổng T6–T7 bằng regression offline và PostgreSQL cô lập, trước khi xin phép chạy live probe.

**Architecture:** Giữ composition root hiện tại. Campaign sở hữu lock, manifest và budget; journal là nguồn evidence bền vững; mỗi phase có snapshot và quyền thực thi riêng. Report được suy ra từ evidence, không từ flag do caller tự xác nhận.

**Tech Stack:** TypeScript, Node.js, Vitest, PostgreSQL/pgvector, native OpenAI/Google adapters, fake HTTP transport.

**Spec:** `docs/superpowers/plans/2026-09-20-ai-live-t6-t7-closure.md`, `docs/superpowers/plans/2026-09-18-ai-live-evaluation.md`, `docs/BASELINE.md`, `docs/EXECUTION-CONTRACT.md`.

## Global Constraints

- Chỉ lập plan ở lượt này; không sửa source/tests/config, không commit hay paid call.
- Khi được duyệt: làm trực tiếp trong thư mục/nhánh hiện tại, giữ thay đổi ngoài phạm vi.
- Giữ B/local: catalog 8+2, vector 1536 chiều, worker tuần tự, tối đa 3 planning calls và 2 local replans; không auto-resume.
- Giữ API default-deny. Không frontend, SaaS thật, đổi model ngầm, reset DB/volume hoặc push.
- Fake HTTP phải được inject rõ ràng; key có sẵn trong môi trường không được làm test gọi mạng thật.
- Giữ evidence cũ; schema mới có version, legacy thiếu dữ liệu chỉ được đọc với trạng thái incomplete.
- Rubric vẫn `PROPOSED_EXPLORATORY`; không tạo human approval hay fresh holdout giả.
- Không cần key để hoàn thành remediation. Giá thật và model API ID cần được kiểm chứng riêng trước live execution.

## Review Focus

1. Trùng run ID không được xóa evidence đã tồn tại — R1.
2. Hai reservation chờ fsync đồng thời không được cùng tiêu một phần budget — R2.
3. Approval hết hạn giữa hai requests phải chặn request thứ hai trước credential/fetch — R4.
4. Missing journal, truncated reservation hoặc crash không được biến thành budget mới — R1–R2.
5. Replay không được đổi regression thành dev, fake thành live hoặc unknown cost thành zero — R3, R6.

## 1. Evidence và giới hạn khảo sát

Đối chiếu source hiện tại và plan cũ; chưa chạy reproduction/test trong lượt lập plan. CodeGraph đã được hỏi trước khi đọc source nhưng trả nhiều match không liên quan và cảnh báo index stale; không dùng graph để chứng nhận coverage.

| Mức | Quan sát source | Hành động |
|---|---|---|
| P0 | `campaign.ts`: catch sau `mkdir(runDirectory)` gọi recursive remove kể cả khi mkdir lỗi vì directory đã tồn tại | R1 giữ nguyên evidence cũ |
| P0 | `ledger.ts`: check budget rồi await append, sau đó mới cập nhật store | R2 serialize check/reserve/persist/publish |
| P0 | `campaign.ts`: bỏ qua ENOENT của journal run trước; manifest chỉ bind campaign và cap | R1 fail closed và đăng ký run bền vững |
| P1 | `cli.ts`: default runtime tạo trước try; close runtime có thể ngăn campaign.close | R4 đóng tài nguyên trên mọi đường lỗi |
| P1 | `contracts.ts`/`freeze.ts`: execution snapshot optional; CLI chưa cung cấp đầy đủ | R5 phase-aware freeze |
| P1 | `recovery.ts`: exposure hardcode dev; report CLI hardcode fake và có fallback summary | R6 authoritative recovery |
| P1 | `pricing.ts`: entry theo model, thiếu usage fields có thể bị coi là 0 | R3 phân biệt unknown và zero |

Các phần còn lại là nghĩa vụ cần kiểm tra/đóng từ plan trước, không phải khẳng định mọi trường hợp đều đã reproduce. Full backend gate ở commit trước là evidence lịch sử, không thay thế regression cho bản sửa mới.

## 2. Thứ tự và ranh giới file

Thực hiện R1 → R2 → R3 → R4 → R5 → R6 → R7. Mỗi task có red/green tests và review diff riêng. Không rewrite toàn bộ evaluator.

Paths dưới đây tương đối với repo. Prefix `live/` trong mô tả nghĩa là `packages/engine/src/ai/live-evaluation/`, `tests/` nghĩa là `packages/engine/tests/`.

### R1 — P0: Campaign ownership và bảo toàn evidence

**Files:** sửa `live/campaign.ts`, `tests/ai-live-campaign.test.ts`; tạo `tests/ai-live-campaign-process.test.ts` cho tranh chấp giữa hai process.

**Interface:** giữ `openLiveCampaign(options): Promise<LiveCampaign>` và `close(): Promise<void>`. Manifest version mới lưu run registry, immutable scope hash, cap và profile/phase sublimits. Run registry ghi trước reservation; legacy không đủ evidence không authorize dispatch mới.

- [ ] Thêm test trùng run ID: mở/đóng run, đọc bytes journal, mở lại phải reject và bytes vẫn nguyên. Thêm run đã đăng ký nhưng thiếu journal: reject trước credential/fetch.
- [ ] Chạy `npm run test:unit -w @wap/engine -- ai-live-campaign`; xác nhận test fail đúng nguyên nhân.
- [ ] Acquire lock trước manifest mutation. Giữ owner token để release đúng lock. Không xóa run directory trên lỗi; giữ artifact dở dang để kiểm tra, đánh dấu incomplete. Không tự cướp lock theo tuổi/PID đơn thuần.
- [ ] Kiểm tra header campaign/run/profile, duplicate call identity, manifest hash khi replay; corruption/missing evidence chặn spending. Tách explicit operator recovery khỏi open thông thường.
- [ ] Test hai process dùng cùng campaign chỉ một owner; cap không reset khi đổi run/phase; cleanup không unlink lock đã đổi owner; lỗi close vẫn giữ evidence.
- [ ] Green targeted suite, review diff; commit riêng khi có quyền commit cho execution.

```ts
// Add inside existing campaign test, reusing its root() helper.
const options = { outputRoot: await root(), campaignId: "c", runId: "r",
  profileId: "p", phase: "smoke", budgetCapMicros: 100 };
const first = await openLiveCampaign(options);
const journalPath = join(first.runDirectory, "journal.jsonl");
await first.close();
const before = await readFile(journalPath, "utf8"); // add readFile import
await expect(openLiveCampaign(options)).rejects.toThrow();
expect(await readFile(journalPath, "utf8")).toBe(before);
```

**Exit:** Không đường lỗi nào xóa evidence cũ hoặc cho phép thiếu history mà vẫn tiêu tiền.

### R2 — P0: Journal/ledger tuần tự và fail-closed

**Files:** sửa `live/journal.ts`, `live/ledger.ts`, `tests/ai-live-journal.test.ts`, `tests/ai-live-ledger.test.ts`, campaign tests.

**Interface:** giữ reserve/settle/records; thêm internal serialized operation queue và poisoned state. Serialize toàn bộ budget check → durable append → publish store, không chỉ thao tác ghi file. Journal.close drain queue; write/sync failure khiến owner không thể dispatch thêm.

- [ ] Test hai concurrent reserve 60 với cap 100, fsync bị chặn bằng deferred barrier; chỉ một reserve thành công. Test settle giống nhau idempotent, conflicting settlement reject.
- [ ] Chạy `npm run test:unit -w @wap/engine -- ai-live-ledger ai-live-journal`; ghi red evidence.
- [ ] Implement queue với rejection propagation; write đầy đủ bytes và sync trước publish. Sau journal failure, queue bị poison; không silently retry append và không reuse sequence.
- [ ] Test write partial, sync fail, close khi append pending, reserve sau poison, truncated final reservation. Report-only được đọc prefix nhưng campaign spending phải block nếu đuôi có thể che exposure.
- [ ] Replay unknown/ambiguous giữ reservation; không tự gọi lại provider. Chạy green cả campaign/ledger/journal, review diff.

```ts
// Internal queue shape; install separately for journal operations and ledger transitions.
private tail: Promise<void> = Promise.resolve();
private failure: unknown;
private enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = this.tail.then(async () => {
    if (this.failure !== undefined) throw this.failure;
    try { return await operation(); }
    catch (error) { this.failure = error; throw error; }
  });
  this.tail = result.then(() => undefined, () => undefined);
  return result;
}
```

**Exit:** Không overspend do concurrency; journal lỗi luôn chặn dispatch tiếp theo.

### R3 — P1: Usage, pricing và conservative reservation

**Files:** sửa `live/pricing.ts`, `live/cli.ts`, `live/composition.ts`, `packages/engine/src/ai/providers/registry.ts`, `tests/ai-live-pricing.test.ts`, `tests/ai-provider-clients.test.ts`, `tests/ai-provider-accounting.test.ts`.

**Interface:** pricing lookup bind provider + API mode + model + purpose. Price card được schema-validate và hash trước dispatch. Chuẩn hóa vào `ProviderCallUsage`; incomplete billable fields trả null, không suy ra 0. CLI truyền price card đã duyệt tới composition.

- [ ] Red tests cho `{ totalTokens: 20 }`, empty usage, embedding prompt tokens, cached tokens, reasoning tokens, rates thiếu/âm/overflow; thiếu required usage phải null và held.
- [ ] Kiểm tra official schema của từng API mode đang dùng khi implement; lưu synthetic fixtures riêng OpenAI Responses/embeddings và Google generation/embedding. Không dùng fixture Google giả dạng OpenAI để chứng minh codec.
- [ ] Dùng integer micro-USD, rounding lên; chỉ zero khi có usage và rate đủ để chứng minh zero. Validate card trước key lookup.
- [ ] Thay flat estimate bằng bound từ input/output limits và price card; không chứng minh được bound thì từ chối paid dispatch. Chi phí vượt bound thực tế phải giữ nguyên actual evidence, halt campaign và báo overrun, không clamp.
- [ ] Test cùng model name ở hai provider không dùng nhầm giá; parsing/pricing lỗi sau response không mất reservation hoặc settlement; request ID provider tách ledger call ID.
- [ ] Chạy `npm run test:unit -w @wap/engine -- ai-live-pricing ai-provider-clients ai-provider-accounting`; green và review diff.

```ts
// Regression on current function; update invocation when provider-keyed signature lands.
expect(priceProviderCall("planning", "m", { totalTokens: 20 }, {
  version: "synthetic", entries: { m: {
    inputMicrosPerMillion: 1_000_000, outputMicrosPerMillion: 1_000_000,
  } },
})).toBeNull();
```

**Exit:** Cost/budget có evidence đầy đủ hoặc được đánh dấu unknown/held, không có zero giả.

### R4 — P1: Per-call authorization, phase lifecycle và probe

**Files:** sửa `live/cli.ts`, `live/composition.ts`, `live/runtime.ts`, `live/database-identity.ts`; tests CLI/runtime/provider-approval/composition integration.

**Interface:** runtime factory nhận scope đã validate, injected clock/signal, lazy credentials và campaign ledger. Probe không cần DB/index; index chỉ cần embedding role; run semantic cần DB/index pin. Tất cả call purposes đi qua cùng pre-dispatch guard.

- [ ] Red tests: hết hạn giữa hai call; profile/phase mismatch; pre-aborted signal; factory throw; runtime.close throw; pure-provider đọc nhầm key. Assert denied path có zero credential reads/fetch.
- [ ] Bind campaign/profile/phase/provider/model/budget/snapshot tại mỗi call; recheck expiry/currentness sau async preparation ngay trước dispatch. API vẫn deny mặc định.
- [ ] Đưa construction vào try/finally sở hữu campaign; cleanup runtime và campaign độc lập, giữ lỗi gốc kèm cleanup failures. Chỉ close runtime do invocation sở hữu.
- [ ] Validate eval URL, loopback aliases gồm IPv6, effective DB identity/role trước mutation; không dùng DATABASE_URL làm fallback. Database không chứng minh được isolation phải reject. Test bằng DB riêng, không mutate g1.
- [ ] Probe đủ 6 purposes: planning, repair, replan, QE, document embedding, query embedding. Probe không được kích hoạt business tools. Fake transport và live transport do factory xác định provenance.
- [ ] Test cancellation trước dispatch, trong fetch và sau dispatch: không fetch mới; unknown billed result giữ hold. Signal xuyên suốt probe/index/run.
- [ ] Chạy unit CLI/runtime/approval rồi `npm run test:integration -w @wap/engine -- ai-live-composition`; review diff.

```ts
// Required cleanup shape in CLI; collect errors in implementation without masking the primary failure.
try {
  ownedRuntime = await createDefaultLiveRuntime(runtimeOptions);
  await executePhase(ownedRuntime);
} finally {
  try { await ownedRuntime?.close(); }
  finally { await campaign.close(); }
}
// runtimeOptions/executePhase denote existing phase-specific inputs/body, not new public APIs.
```

**Exit:** Từng request đúng quyền tại thời điểm dispatch; mọi phase đóng resource đúng quyền sở hữu.

### R5 — P1: Complete phase snapshots và currentness

**Files:** sửa `live/contracts.ts`, `live/freeze.ts`, `live/cli.ts`, `live/composition.ts`, `tests/ai-live-freeze.test.ts`, `tests/ai-live-cli.test.ts`.

**Interface:** versioned discriminated snapshots cho preparation (probe/index) và execution (run). Full execution bắt buộc role settings, capability/API mode, price hash, manifest/scope hash, source/build/runtime/lock identity, dataset/rubric/catalog, seed/exact schedule và index provenance read-back. Legacy optional execution không authorize new paid run.

- [ ] Red table-driven mutation tests cho từng field; thêm source file mới trong evaluation/provider/retrieval closure cũng phải đổi fingerprint.
- [ ] Xây source manifest deterministic với sorted paths/bytes và documented exclusions; không dựa riêng Git SHA hoặc danh sách file thủ công. Bind build output được execute; dirty changes phải được fingerprint, không bị che bởi HEAD.
- [ ] Populate snapshots trong default CLI; probe không đòi index tồn tại, index ghi resulting index, semantic run pin index đã read-back. Kiểm tra index currentness trước planning/repair/replan.
- [ ] Freeze không resolve provider keys hoặc fetch. Approval renewal giữ scope semantics nhưng không bỏ expiry check; scope thay đổi cần approval mới.
- [ ] Run `npm run test:unit -w @wap/engine -- ai-live-freeze ai-live-cli`; green mutation coverage và review diff.

```ts
// Table-driven assertion to apply to each cloned valid execution snapshot.
// Existing assertLiveFrozen API remains the comparison boundary.
expect(() => assertLiveFrozen(savedFreeze, mutatedFreeze)).toThrow();
```

**Exit:** Có thể chỉ ra chính xác code/config/index/schedule đã chạy; thay đổi ảnh hưởng behavior bị chặn.

### R6 — P1: Recovery và report trung thực

**Files:** sửa `live/journal.ts`, `live/contracts.ts`, `live/runner.ts`, `live/recovery.ts`, `live/report.ts`, `live/cli.ts`; tests journal/recovery/report/runner/CLI.

**Interface:** run header version mới persist phase/schedule/exposure, factory provenance, freeze/rubric/index/price identities. Terminal events giữ usage/latency/call purpose. Summary chỉ là derived output, không là authority.

- [ ] Red tests: xóa/tamper summary rồi replay; regression vẫn legacy_regression; fake vẫn fake; missing header vẫn incomplete; call IDs không trùng across runs.
- [ ] Report dùng ledger.usage (không field tokens không tồn tại); repair count theo purpose, không modelCalls.length-1; thiếu latency là unknown, không dùng total làm planning latency.
- [ ] Tách current-run metrics khỏi campaign-wide committed/held budget. Recovered costs bằng durable ledger; không double-count các phase trước.
- [ ] Report-only không khởi tạo provider/DB/credentials. Truncated tail/incomplete settlement giữ uncertainty, không tự resume và không nâng formal verdict.
- [ ] Redact provider errors/raw payload/secret canaries. Exit code phân biệt execution error với exploratory verdict chưa đủ formal evidence.
- [ ] Chạy `npm run test:unit -w @wap/engine -- ai-live-recovery ai-live-report ai-live-runner ai-live-cli`; green và review diff.

```ts
// Required report equivalence assertions after deleting summary.json.
expect(recoveredReport.evidenceKind).toBe(originalReport.evidenceKind);
expect(recoveredReport.trials.map(t => t.exposure))
  .toEqual(originalReport.trials.map(t => t.exposure));
// Compare costs, usage and purpose counts as well; latency absent in journal stays unknown.
```

**Exit:** Replay từ journal giữ provenance và số liệu; legacy thiếu dữ liệu báo rõ incomplete.

### R7 — P1: Integration, independent review và readiness documentation

**Files:** mở rộng `tests/ai-live-composition.integration.test.ts`, `tests/ai-live-cli.test.ts`, `tests/ai-live-schedule.test.ts`; kiểm tra `tests/ai-replan.integration.test.ts`; sửa root `package.json` nếu entrypoint thiếu dependency build. Docs: AI status, engine README, READINESS-RUNBOOK và closure plan cũ.

- [ ] Test actual composition + durable campaign journal + isolated pgvector, bốn planning/embedding combinations và QE override độc lập. No production business writes; native fixtures đúng API mode; unselected credential reads = 0.
- [ ] Assert inventory: probe 6 purposes; smoke 9 trials; dev 6 cases × 7 cells × 3 repetitions = 126; regression 4 × 7 × 3 = 84. Số trial không phải số paid requests; budget tính cả retries/repair/QE/embedding/index.
- [ ] Chạy clean-build CLI check chứng minh DB package được build trước evaluator import; không xóa workspace build của user để thử, dùng test sandbox.
- [ ] Điều tra lease-lock race đã từng xuất hiện: barrier đợi backend termination/lock release thay vì sleep, fixture cleanup trong finally, không để một failure tạo cascade ACTIVE_RUN. Không gọi flake đã sửa chỉ vì rerun pass.
- [ ] Run targeted engine/API suites và fresh `npm run check:backend`. Ghi command/commit/exit/count/skips. DB unavailable là blocked verification, không pass giả.
- [ ] Independent read-only Code Reviewer kiểm R1–R6 và spec coverage; resolve blocker/high findings, rerun affected checks. Review chưa có thì gate chưa đóng.
- [ ] Sửa docs readiness quá sớm, runbook DB preparation riêng (không migrate g1 cho evaluator), probe inventory, trial arithmetic, legacy/recovery limits, stale lock procedure. Checklist chỉ tick mục có evidence.
- [ ] `git diff --check`; impact/detect-changes theo AGENTS trước commit. Không push; chỉ commit intended paths khi execution có quyền.

**Exit:** Chỉ khi cả code/test/review đủ mới `READY_FOR_LIVE_PROBE`. Live provider compatibility, quality, latency và cost vẫn `NOT_RUN`.

## 3. Verification sequence

```powershell
npm run build
npm run test:unit -w @wap/engine -- ai-live ai-provider
npm run test:unit -w @wap/api -- ai-runtime ai-planner-http
npm run test:integration -w @wap/engine -- ai-live ai-replan
npm run test:integration -w @wap/api -- ai-live-wiring
npm run check:backend
npm run ai:eval:live -- preflight --offline
git diff --check
node .gitnexus/run.cjs detect-changes --scope all
```

Targeted commands chạy theo task; full gate chạy cuối, không chạy lại toàn bộ khi không có thay đổi hoặc nguyên nhân cụ thể. Offline preflight/report phải có canary test xác nhận zero credential/network/DB factory access. Không chạy paid probe để nghiệm thu plan này.

## 4. Handoff và tiêu chí dừng

- R1/R2 thất bại: dừng mọi bước chuẩn bị paid execution, giữ nguyên evidence để điều tra.
- Các fix có thể làm/test ngay mà không cần operator key, actual price card hay human rubric.
- Sau technical readiness mới xin operator chọn provider/API model IDs, official price evidence, isolated DB, synthetic payload scope, budget và expiry cho T8 probe.
- Formal quality evaluation chỉ sau rubric/human approval và holdout governance riêng; không đánh đồng với technical probe readiness.
- Task checklist trong tài liệu này hiện đều pending. Khi user duyệt, bắt đầu R1 trước, implement trực tiếp theo lựa chọn gần nhất; không tự giao Luna.

**Self-review:** R1/R2 cover evidence và concurrency; R3 cost uncertainty; R4 authority/resource/probe; R5 binding; R6 truthful recovery; R7 matrix/currentness/regression/review/docs. Không mở rộng frontend hoặc production live API. Source findings chưa có runtime reproduction được ghi rõ; chỉ tạo plan trong lượt này.
