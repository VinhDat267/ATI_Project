# W3-06 verification — 2026-10-03

PR [#35](https://github.com/VinhDat267/ATI_Project/pull/35), base `aaa345d`.
Runtime evaluator source `7ba60efa8a7bc90dc42a309076e846d5af5a1cad`.
Production source is unchanged from Jira merge `dc80de4`.

## Registered labels and reproducibility

- `rf06`: direct user approval for clarification, commit `1ab7f08d88546419048e0466f3214bb018c26592`, before provider calls.
- 44 new-service cases: commit `20fa6f03c8696d769303f759602d1c0748cb9b26`, before provider calls.
- Baseline core labels `5fccffd7109cdcb5b47068bd12c1c691141df797`; freeform `695ad8758d9d658bd3606d15d679845dce30f7e4`. Semantic comparison against those recorded commits: only rf06 differs; 67 other rows unchanged.
- Complete reports record source trees, catalog/fixture SHA-256, label commit/file SHA-256, served models, each case response/read trace and metrics. No labels were changed after observing model outcomes.

## Commands and witnessed outputs

| Command / boundary | Result |
|---|---|
| Label core/freeform/routing tests | RED two failures; GREEN 61/61, exit 0 |
| New-service fixture/output-schema tests plus legacy cases | RED 14 failures; GREEN 60/60, exit 0 |
| Service case structure/reachability tests | Missing-file/schema RED; GREEN 30/30, exit 0 |
| Scorer tests | New scorer RED five failures; combined GREEN 15/15, exit 0 |
| Runner/scorer tests | Runner RED four failures; combined GREEN 19/19, exit 0 |
| Partial category case count | RED 0.5 instead of 1; corrected to unique case count |
| Concurrent provider-fault cancellation | Real HTTP 503 sibling; in-flight response closed via actual AbortSignal; no third request dispatched |
| `npm run test:eval:v3` at runtime source | 14 files, 151 tests PASS, exit 0 |
| `npx tsc -p evaluations/golden-v2/tsconfig.json` | Exit 0 |
| `npm run check` at runtime source | Exit 0: v3 47+301+167+25+173+161=874; eval151; typecheck/build, security build check, launcher1 and local-env3 PASS |

The full check used a dedicated PostgreSQL16 tmpfs container. User database
and private workspace files were preserved. Browser tests were not repeated
because no UI/product source changed; previous Jira browser14 evidence is
historical rather than a W3-06 run.

## Provider observations

Existing local gateway/model only; three runs per case, concurrency2,
`PLANNER_SEARCH_MODE=llm`. Requested `ag/gemini-3.8-flash`; successful responses
reported `gemini-3.8-flash`. No executable plan dispatched to an adapter.

| Complete report | Attempts | Strict pass | p50 / p95 / max ms |
|---|---|---|---|
| [core](core-llm-2026-10-03T10-59-01-095Z/summary.md) | 150/150 | 150/150 | 5454 / 13105 / 19163 |
| [freeform](freeform-llm-2026-10-03T11-07-19-521Z/summary.md) | 54/54 | 51/54 | 5942 / 13092 / 18425 |
| [services](services-llm-2026-10-03T11-10-25-012Z/summary.md) | 132/132 | 111/132 | 6105 / 31097 / 53021 |

Five new services meet measured tools/arguments thresholds. Freeform parity is
unmet at ff15, which clarifies Slack versus Telegram under the expanded
frontend fixtures. Six read-only cases and explicit-invitation ca04 fail the
registered kind oracle; ca01 also misses its exact end-of-day argument label.
These are reported without changing labels or production code. Usable-plan
rate is null, live-service acceptance NOT_RUN, product quality gate incomplete.

Read-only outcomes across the 18 attempts are **15 refusals / 3 plans / 0 clarifications**:

| Case | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| sh07 | plan: sheets.read_range | refusal | plan: sheets.read_range |
| ca01 | plan: calendar.list_events | refusal | refusal |
| sh01, no01, tg01, ji01 | refusal | refusal | refusal |

The production `validatePlan` accepts all three read-only plans. The prompt
instructs write-only plans, but the validator does not enforce that side-effect
restriction. All 18 outcomes still fail the preregistered clarification kind;
no score changes follow from this correction. Read-answer policy and prompt-rule
enforcement need a separately scoped product decision.

The independent audit found 531 legacy `trello.search_members` output-schema
mismatches: required `fullName` is absent and `name` is supplied. The fixture
behavior is identical at base `aaa345d`; no new-service trace has an input/output
schema mismatch. Repairing the legacy fixture changes evaluation context and
requires a separate documented rerun.

The [interrupted report](interrupted-services-llm-2026-10-03T10-47-08-073Z/summary.md)
is 79/132 attempts, source823cf1f, and is excluded from complete results. A new
gateway process was observed and a fresh one-case probe passed before rerun.
Its historical category-count average is preserved; runtime source7ba60ef
corrects interrupted category counts to unique cases.

## Review and CI

- Initial code CI37119054180 SUCCESS at exact `7ba60ef`.
- [Reviewed-head CI37119761968](https://github.com/VinhDat267/ATI_Project/actions/runs/37119761968) SUCCESS at exact `49dfc61`.
- Fresh independent whole-branch review of `aaa345d..49dfc61`: C0/I1/M0, with one required documentation fix. Reviewer reran eval151, strict typecheck and full check874+151, all exit0; audited all four reports, 415 attempts, 1921 read traces and 276 plans.
- I1 corrected by the author in one pass: an external audit derives the 18 outcomes from the committed report, verifies the exact three plans through production `validatePlan`, checks the four summaries and confirms historical report files are unchanged. RED before correction; GREEN after. No second independent review and no new provider campaign.
- Author verification after I1: audit exit0; strict evaluation typecheck exit0; `npm run check` exit0 with 874 v3 + 151 evaluation tests and typecheck/build/security/launcher/local-env checks. Only the four documentation summaries changed in this fix.
- Final exact-head CI after this documentation fix is verified on PR #35 before Ready; the PR records that head and run URL.

## Decisions and limits

These are the six implementation rulings followed by the eight review-boundary
rulings, in decision order. No Minor findings were deferred.

| Decision | Reason / cost if wrong |
|---|---|
| Manual task-card RED/GREEN ledger | Card has numbered items rather than script Task headings; less automated bookkeeping |
| Preserve the exact rf06 unavailable-Calendar legacy exception | Existing scoped authority; literal all-68 legacy routing criterion remains excepted for this case |
| Freeze 33 tools/eight services for this measurement | All five service PRs merged; retain 20/10 catalog deadline and remeasure if catalog changes |
| Preserve ji06 GitHub+Jira route | Existing issue keyword and no production changes; extra tools can increase latency or misselection |
| Preregister read-only clarification and successful read traces | Protocol has no read-answer kind; policy oracle may need redesign. Earlier claim of runtime prohibition is corrected below |
| Preserve ff15 label and disclose the ambiguity | Old Slack label meets expanded Slack/Telegram context; parity cannot be claimed and score decline alone does not prove semantic regression |
| Disclose accepted read plans; defer production enforcement | Prompt instruction is not a validator invariant; read plans can still be proposed until a separately scoped fix |
| Preserve read/invitation kinds pending a product decision | No score fitting; useful responses may fail this conservative oracle |
| Disclose unchanged legacy Trello schema mismatch | Correcting context needs a documented rerun; legacy incompatibility can affect model behavior/comparisons |
| Limit semantic claims to the declared matchers | Phrase/field/order/duplicate-write equivalence is not exhaustive; wrong plans can pass limited matchers |
| Leave live-service acceptance to W3-07 | Fixtures do not certify permissions, search, pagination or HTTP writes; provider/account incompatibility may remain |
| Use served-model metadata and executor recovery observations | No independent billing/account check or zero-cost claim; backend identity/cost and past recovery are not independently certified |
| Retain historical RED logs; bound checkpoints to per-run writes | Fresh suite/cancellation passed, historical RED commits were not recreated; a crash can lose the current run |
| Keep overall product acceptance incomplete | Usable-plan rate null, freeform parity unmet and services p95 misses target; frontend/auth/recovery/SSE/replica remain outside this task |
