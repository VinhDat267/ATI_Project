# SLACK-03B2F · Plan and execution artifact lifecycle

Status: DONE - accepted staging PR212 at `835192438cf9852be5209d37ca7fcf5414889a03`. Base `a79bbd47e4664760bea9a31a5b922c953091ef89`, after acceptedPR211. Same one Orca worktree/branch `VinhDat267/slack-m2-core-lifecycle-20261030`; root implements directly. [Parent03B2](SLACK-03B2-derived-lineage-and-purge.md), [deliveryM2](../SLACK-DELIVERY.md), [plan](../../superpowers/plans/2026-10-31-slack-03b2f-plan-execution-runtime.md).

Deliverable: source-bound real chat plan writer→transactional plan/step/audit provenance→guarded preview/approval/recovery/execution snapshots→durable invalidation and physical erasure. Scope covers `plan_step_arg` on plans and execution_steps, and `audit_log_entry` output/error; no detached primitives. Every dispatch from a source-bound plan rechecks the approved snapshot/current authority, including steps that only write other services. No Slack public routing or Slack write dispatch is enabled.

Owner: Backend, `apps/chat-api/`, `db/v3/0022_*`; repository/runtime plan/card and one new implementation log. Preserve accepted source/barrier/lease semantics. Source user/workspace provenance only from server acquisition context. Tests use explicit isolated PostgreSQL16 at loopback55439 with random schemas, fixture HTTP and real AbortSignal. No live .env, flags/main changes or other implementation agents.

Acceptance:

- [x] Actual chat plan+preview/message and plan/step/output writers register in the same transaction; invalidation during model/provider await cannot publish stale source text.
- [x] PlanRepo/StepRepo readers, approval/recovery and each adapter dispatch guard current versions/fingerprints/policy/barriers and owner; SSE never caches source-derived execution content.
- [x] Plan fields/selected labels, step args/output/error physically erased by fenced native consumers with flags off; stale generation/CAS/cutoff fail closed; unrelated user/service label survives.
- [x] Source plan invalidation marks pending superseded/in-flight failed; affected schedule_run references are discarded without retaining source content.
- [x] Real PostgreSQL rollback/concurrency, HTTP fixture dispatch/readback and cancellation regressions; focused tests; freeze then fullcheck and one read-only independent whole-branch review.
- [x] Exact-head CI41101135831 check/browser SUCCESS at published `2395eeb7`; merge `83519243` identical tree, diff exit0.

Schedule artifact lifecycle, full legacy backfill/derived TTL cascade, public read03B3/03B4,04C/modes/Inbox/native/fullF3 remain open. Future proposal/digest kinds stay unsupported.

## Kết quả

Code and internal fixture flow verified at frozen `5c2f7a91a2f762b64d56e80eebf5dfd365f1e304`: fullcheck3681PASS, exit0, typecheck/build/securityPASS. Independent whole-branch audit found twoP2, both fixed with real regressions/omission mutations; final exact-head fix verification PASS,76/76 tests, no actionableP1/P2/P3. Actual ChatService→PlanRepo→approval→HTTP fixture→StepRepo and guarded snapshots work; native bootstrap erases plan/step/audit with flags/config absent. [Evidence, original failures and limits](../log/2026-10-31-slack-03b2f-plan-execution-runtime.md). [Staging accepted](../log/2026-10-31-slack-03b2f-review-integration.md); no native Slack acceptance, fullM2/F3/F4 or public Slack dispatch claim.
