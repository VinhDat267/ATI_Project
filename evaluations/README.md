# Planner evaluation evidence

## Golden set v2 (labelled)

`golden-v2/cases.json` holds 50 planner cases across the spec's five
categories: 10 single-step, 10 multi-step, 15 cross-service, 9 clarification
and 6 refusal, in Vietnamese and English, twelve of them using GitHub.
W3-06 changes only `rf06` to the user-approved clarification label; historical
reports below retain their original labels. See the
[label audit](golden-v2/label-audit-w3-06.md).

- **Labels.** Each expected step labels its arguments: exact resource IDs,
  deadline dates relative to the fixed clock in the file (Tuesday 2026-09-29,
  Asia/Ho_Chi_Minh), title keywords and cross-step references. `anyOf` lists
  alternative correct plans, for example assigning a member on the new card or
  with `add_member`. The matchers are documented in `golden-v2/scorer.ts`.
- **Fixtures.** Resources come from the fixed workspace in
  `golden-v2/fixtures.ts`; its search filters by name like the real adapters.
- **Consistency.** `golden-v2/cases.test.ts` checks the composition, that labels
  name schema arguments and fixture IDs, and that every plan case reaches the
  model with its labelled resources resolved. Scores therefore measure planning,
  not the regex gather rules.
- **Pre-registration.** Labels were committed before any live run. Each report
  records the commit and SHA-256 of `cases.json` it was scored against; change
  labels only in a separate commit, never to fit a run.

Metrics: tool selection accuracy (target ≥ 85%), argument quality among plans
with the right tools (target ≥ 75%), argument label match rate, response kind
accuracy, strict pass rate per category, latency and per-case stability across
runs. Usable plan rate stays `null`: it requires users to accept previews, so
the spec quality gate remains `incomplete` even when both measured targets pass.

```bash
npm run test:eval:v3
```

```bash
LIVE_EVAL=1 EVAL_RUNS=3 node --env-file=.env --import tsx evaluations/golden-v2/run.ts
```

`EVAL_DRY_RUN=1` replaces the provider with a mock to check the wiring without
LLM calls. Evidence is written to `docs/ai-evidence/V3-GOLDEN-V2/`. Plans are
never executed, so a pass says nothing about live Trello/Slack/GitHub behaviour.

### W3-06: eight-service catalog

`golden-v2/cases-services.json` preregisters 44 cases: eight for each new
service and four workflows spanning at least four services (at least two new).
Thirteen cases exercise ambiguous vocabulary or names shared between services.
Fixtures expose the real adapter output shapes for spreadsheets/tabs, calendars,
Notion databases/pages, Telegram chats and Jira projects/issues. Only synthetic
fixture data is read; no service adapter executes a plan.

- User-approved `rf06` label: commit `1ab7f08`, before provider calls.
- New-service labels: commit `20fa6f0`, before provider calls.
- The other 49 core cases and all 18 freeform cases retain their prompts,
  categories, memory and expectations. Compare those 67 cases separately to
  the 2026-10-01 single-run baseline; report `rf06` separately.
- The bounded legacy routing exception for unavailable Calendar remains
  attached only to that exact `rf06` request. The other 67 legacy requests
  cannot become unavailable-service refusals. All 44 new requests fail closed
  with only the three old services configured; the full-catalog routes are
  preregistered in each case.

```bash
LIVE_EVAL=1 EVAL_SET=services PLANNER_SEARCH_MODE=llm EVAL_RUNS=3 EVAL_CONCURRENCY=2 node --env-file=.env --import tsx evaluations/golden-v2/run.ts
```

Run the same command with `EVAL_SET=core` and `EVAL_SET=freeform`.
`PLANNER_SEARCH_MODE` and `EVAL_SEARCH_MODE` are aliases; conflicting values
are rejected. Live runs reject uncommitted labels or evaluation source.
Reports record label commits/hashes, source commit/trees, fixture/catalog
fingerprints, served models, successful/failed read traces, completed attempts
and latency. A provider failure cancels in-flight requests and stops scheduling;
the incomplete campaign is kept separate. Restart measurement only after a
fresh probe following a relevant gateway/provider state change.

Per-service tool/argument scores use only that service's labelled steps within
each workflow, with explicit denominators. Read requests require actual
successful gather calls with labelled arguments; returning a clarification
alone is insufficient. Clarification/refusal cases contribute to kind and
strict-pass scores, not the tool denominator. Argument quality is conditional
on correct tools; latency is the entire request involving the service.

At the W3-06 measurement, the planner protocol had no read-answer response kind. The prompt
instructed write-only plan steps, but the production validator did not enforce
that side-effect restriction: it accepted three read-only plans in this run.
Read-only cases preregister a clarification plus successful read calls;
read-tool scores and response-kind failures are reported separately. These
results do not establish usable answers to read-only requests. The 05/10 policy
and W3-10 changes below supersede those labels; historical reports are preserved.
Text matchers check selected keywords/references rather than complete semantic
correctness. Quoted A1 ranges and other unlabelled equivalent representations
may conservatively miss an exact matcher. Calendar timestamps use equivalent
explicit-offset instants; new row matchers inspect nested text/references.
Usable-plan acceptance remains unmeasured, and the product quality gate stays
incomplete even if the two numeric targets pass. Changing prompt/planner to
improve scores requires a separate task and a fresh full measurement.

#### W3-06 measured results — 2026-10-03

Source `7ba60ef`, 33 tools/eight services, model `ag/gemini-3.8-flash` through
the existing local gateway; every successful completion reported
`gemini-3.8-flash`. All three complete campaigns used `llm` search, concurrency
two, three runs per case, and the same source/fixture/catalog fingerprints.

| Set | Strict pass | Tool selection | Arguments | p50 / p95 |
|---|---|---|---|---|
| [Core 50](../docs/ai-evidence/V3-GOLDEN-V2/core-llm-2026-10-03T10-59-01-095Z/summary.md) | 150/150 | 100% | 100% | 5.454 / 13.105 s |
| [Freeform 18](../docs/ai-evidence/V3-GOLDEN-V2/freeform-llm-2026-10-03T11-07-19-521Z/summary.md) | 51/54 | 92.3% | 100% | 5.942 / 13.092 s |
| [Services 44](../docs/ai-evidence/V3-GOLDEN-V2/services-llm-2026-10-03T11-10-25-012Z/summary.md) | 111/132 | 100% | 97.1% | 6.105 / 31.097 s |

The new-service scores below meet the 85% tool/75% argument thresholds. They
do **not** establish usable-plan acceptance or correct read-only answers.

| Service | Distinct cases | Tool attempts | Correct-tool argument attempts | Tools | Arguments | p50 / p95 |
|---|---|---|---|---|---|---|
| Sheets | 10 | 24 | 24 | 100% | 100% | 7.037 / 29.239 s |
| Calendar | 10 | 24 | 24 | 100% | 87.5% | 7.653 / 32.040 s |
| Notion | 11 | 27 | 27 | 100% | 100% | 7.515 / 25.306 s |
| Telegram | 12 | 30 | 30 | 100% | 100% | 5.185 / 33.187 s |
| Jira | 12 | 30 | 30 | 100% | 100% | 7.325 / 24.818 s |

Per-service case totals overlap because the same workflow can involve several
services. The numeric scores isolate each service's labelled arguments; strict
pass remains the complete request score. All four large workflows passed all
three runs (12/12).

**Unchanged-label comparison.** The baseline reports from
[core on 01/10](../docs/ai-evidence/V3-GOLDEN-V2/core-llm-2026-10-01T03-27-51-184Z/summary.md)
and [freeform on 01/10](../docs/ai-evidence/V3-GOLDEN-V2/freeform-llm-2026-10-01T03-24-59-750Z/summary.md)
record label commits `5fccffd` and `695ad87`. A semantic comparison confirms
that only `rf06` changed. The other 49 core cases passed 147/147, versus 49/49
in the historical run. Changed-label `rf06` passed 3/3 separately.
Freeform fell from 18/18 to 51/54; `ff15` was 0/3. Its unchanged prompt,
“case ff15 (see its preregistered label)”, expects Slack. The expanded
workspace has both Slack `#frontend` and Telegram `frontend`; the model asks
which service to use in all three runs. The spec requires clarification for
ambiguity. This is an observed score decline under the old oracle and expanded
context, not proof that a safer clarification is a semantic regression.
No label was changed to fit the result, and the no-decline criterion is unmet.

**Other failures.** `sh01`, `sh07`, `ca01`, `no01`, `tg01`, `ji01` were 0/3:
the required read calls succeeded, but the 18 final responses were
**15 refusals / 3 plans / 0 clarifications**. The production validator accepted
`sh07` runs 1 and 3 with `sheets.read_range` and `ca01` run 1 with
`calendar.list_events`; the other 15 attempts refused. All 18 failed the
preregistered clarification kind. `ca01` also used an upper date boundary
that missed the exact next-midnight matcher. `ca04` was 0/3: the model refused
explicit invitations, which Calendar cannot support, instead of asking about
an event without invitations. These response-kind labels expose a policy/oracle
question; the refusals are not evidence of an unsafe write. Protocol/label
decisions belong in a separate follow-up, rather than forcing a plan or
changing these registered labels after observation.

An independent schema audit also found 531 legacy `trello.search_members`
trace outputs missing required `fullName` while supplying `name`. This fixture
behavior is unchanged at the base commit; new-service input/output traces had
zero schema mismatches. Correcting the legacy fixture changes measurement
context and needs a separately documented rerun.

The service-set p95 exceeds the 15 s preview target; its maximum was 53.021 s.
The longest cases are read-only requests with several model calls. Real service
HTTP latency and end-user acceptance were not measured. The overall product
quality gate remains incomplete.

**Interrupted measurement.** A prior
[services campaign](../docs/ai-evidence/V3-GOLDEN-V2/interrupted-services-llm-2026-10-03T10-47-08-073Z/summary.md)
stopped after 79/132 attempts when the gateway process changed. It retains one
complete run and 35 attempts of the second, at source `823cf1f`. Its categorical
case-count field was an average per attempted run; `7ba60ef` corrected partial
counts to unique cases. Its historical files are preserved, and its scores are
excluded from the complete campaigns above. A fresh probe after the process
change succeeded before the full rerun. No account, model or label was switched.

Local verification: `npm run check` exit 0 (874 v3 + 151 evaluation tests),
`npx tsc -p evaluations/golden-v2/tsconfig.json` exit 0; real local HTTP abort
test passed. Browser/live-service runs were not repeated for this evaluation
change. See the [verification record](../docs/ai-evidence/V3-GOLDEN-V2/W3-06-VERIFICATION.md).

### W3-10 — instrumentation and read-only policy (measurement pending)

On 07/10, GET `http://localhost:20128/v1/models` failed with `ECONNREFUSED`
on IPv4 and IPv6. Measurement stopped before any model call. The gateway was
not started or reconfigured. No complete or partial W3-10 model campaign exists;
all after-measurement cells below are **NOT_RUN**, not zeros or estimated results.
See [the verification record](../docs/ai-evidence/V3-GOLDEN-V2/W3-10-VERIFICATION.md).

The 05/10 product policy requires immediate clarification for a read-only request,
without searching first. The prompt asks for suitable write actions among the
routed services. Directory prefetch now waits for the model's first search request;
clarification, refusal and grounded plans skip directory I/O. A write request
with missing resources can consequently need an additional model turn compared
with eager prefetch; its latency and strict-pass impact remain unmeasured.
Validator rejects plans containing no write step before grounding and the planner
returns a fixed Vietnamese clarification without a repair call. Mixed read/write
plans retain existing validation: individual read steps are allowed so this change
does not break their existing contract. The prompt still prefers writes in plans.
Immediate no-search handling is the `llm` protocol; legacy regex gather ordering
is unchanged, while the no-write validator fallback applies in both modes.

Label commit `795229e` removes search requirements only from sh01, sh07, ca01,
no01, tg01 and ji01; all prompts, categories and other labels are unchanged.
Their clarification contributes to kind/strict scores, without tool/argument
scores. For three runs, per-service labelled tool denominators change as follows
(argument denominators additionally depend on observed correct tools):

| Service | W3-06 tool attempts | W3-10 labelled tool attempts |
|---|---|---|
| Sheets | 24 | 18 |
| Calendar | 24 | 21 |
| Notion | 27 | 24 |
| Telegram | 30 | 27 |
| Jira | 30 | 27 |

| Services group | W3-06 runs | Before p50 / p95 | Before under 15 s | W3-10 p50 / p95 / under 15 s |
|---|---|---|---|---|
| read_only | 18 | 25.4 / 53.0 s | 0/18 (0%) | NOT_RUN |
| single_step | 57 | 4.6 / 20.2 s | 53/57 (93.0%) | NOT_RUN |
| clarification | 15 | 7.2 / 41.1 s | 13/15 (86.7%) | NOT_RUN |
| refusal | 15 | 4.6 / 18.1 s | 14/15 (93.3%) | NOT_RUN |
| cross_service | 27 | 7.7 / 10.9 s | 27/27 (100%) | NOT_RUN |
| All services | 132 | 6.105 / 31.097 s | 107/132 (81.1%) | NOT_RUN |

Core parity baseline remains 150/150; freeform remains 51/54. W3-10 parity,
18/18 immediate read-only responses and services p95 <15 s are **not verified**.

`report.json` now includes each `modelCalls` entry's start offset from the turn,
duration including retries/backoff, final served model, nullable prompt/completion/
reasoning tokens, and each actual transport attempt's start offset from the call,
duration, outcome, HTTP status and retry reason. OpenAI-compatible provider exposes
these through `lastCallMetrics`; `generatePlan` still returns `Promise<string>`.
Providers without this optional side channel have an empty attempts list and null
usage, rather than invented counts. `phases` measures directory prefetch and each
parallel search round (wall time, not the sum of individual lookups); legacy gather
has its own phase. Summary records attempts-per-call distribution, retry reasons,
timeouts and the shares of model, directory, search and remaining turn time.
No prompt, API key or header is stored in diagnostics; public errors are classified
instead of copying potentially sensitive provider error bodies.

| Time component | Before (W3-06) | After (W3-10) |
|---|---|---|
| Model / retries / timeout | Call count only; individual attempt duration and tokens absent | NOT_RUN; instrumentation tested offline |
| Directory / search rounds | Not recorded separately | NOT_RUN; phase timing tested offline |
| Remaining time / under 15 s | Whole-turn latency available | NOT_RUN |

Resume only after a successful fresh GET `/v1/models`, using the user's original
`.env` through `node --env-file`, never copying it. Run core 50, freeform 18 and
services 44, each three times with `PLANNER_SEARCH_MODE=llm`, `EVAL_CONCURRENCY=2`,
`LLM_PROVIDER=openai-compatible`, `LLM_MODEL=ag/gemini-3.8-flash` and
`LLM_BASE_URL=http://localhost:20128/v1`. Keep interrupted campaigns separately.
Optional services concurrency-one run can examine gateway contention. Transport
deadline/retry settings remain unchanged pending measured evidence; no tail-latency
cause or improvement is claimed. Earlier request hedging and thinking variants
showed no reliable benefit (see Planning latency); they are not reintroduced.

### Results (labels `ddd1304`, 9router `ag/gemini-3.8-flash`, 3 runs)

| Run | Tool selection | Argument quality | Strict pass | Latency p50 / p95 / max |
|---|---|---|---|---|
| [Baseline](../docs/ai-evidence/V3-GOLDEN-V2/2026-09-29T23-13-58-727Z/summary.md) | 35.2% | 100% | 54.7% | 7.3 / 13.4 / 25.4 s |
| [After step-format fix](../docs/ai-evidence/V3-GOLDEN-V2/2026-09-29T23-23-32-372Z/summary.md) | 100% | 100% | 100% (150/150) | 5.1 / 9.6 / 19.7 s |

The baseline failed single- and multi-step requests on schema: the plan step
format was only shown in the cross-service example, so the model wrote
`arguments` instead of `args`. The fix states the format in every prompt; the
labels did not change between the two runs.

Read the 100% with its limits:

- Prompts are phrased so the regex gather resolves their resources ("board X,
  list Y"). The score measures planning once context is resolved, not how well
  free-form phrasing ("for the frontend team") is understood.
- Three clarification cases (cl02–cl04) are answered by gather before any
  model call.
- Free-text labels only require a keyword, and the same author wrote prompts
  and labels.
- Two of three runs of cs02 exceeded the 15 s preview target (18.7 s, 19.7 s).
- Usable plan rate is unmeasured and no plan was executed.

### Free-form cases and model-driven search

`golden-v2/cases-freeform.json` holds 18 cases where resources are named the
way people talk ("the frontend team", "the backend backlog", "repo web"), with
no "board X, list Y" phrasing and no pre-resolved memory. Twelve were committed
before the first run (`9e68093`); six held-out cases were committed after that
run but before the prompt changed in response (`695ad87`).

```bash
LIVE_EVAL=1 EVAL_SET=freeform EVAL_SEARCH_MODE=llm node --env-file=.env --import tsx evaluations/golden-v2/run.ts
```

`EVAL_SEARCH_MODE=regex|llm` selects how names become IDs; `EVAL_ONLY=cs11,ss09`
reruns named cases and marks the report as a subset.

| Set, search mode (3 runs each) | Strict pass | Tools | Latency p50 / p95 |
|---|---|---|---|
| [Free-form 12, regex](../docs/ai-evidence/V3-GOLDEN-V2/freeform-regex-2026-09-29T23-34-43-668Z/summary.md) | 33.3% | 4.2% | — |
| [Free-form 12, model search](../docs/ai-evidence/V3-GOLDEN-V2/freeform-llm-2026-09-29T23-37-59-335Z/summary.md) | 86.1% | 87.5% | 10.3 / 15.4 s |
| [Free-form 18, after scoping rules](../docs/ai-evidence/V3-GOLDEN-V2/freeform-llm-2026-09-29T23-45-06-561Z/summary.md) | 96.3% (held-out 100%) | 100% | 9.5 / 17.8 s |
| [Free-form 18, member search scoped to a board](../docs/ai-evidence/V3-GOLDEN-V2/freeform-llm-2026-09-29T23-52-34-909Z/summary.md) | 100% (54/54) | 100% | 10.3 / 15.6 s |
| [Core 50, model search](../docs/ai-evidence/V3-GOLDEN-V2/core-llm-2026-09-30T00-04-24-686Z/summary.md) | 98.0% (147/150) | 97.1% | 9.2 / 17.6 s |
| [Core cs11 + ss09 only, after issue fixtures](../docs/ai-evidence/V3-GOLDEN-V2/core-llm-subset-2026-09-30T05-10-15-166Z/summary.md) | 6/6 | 100% | 8.3 / 21.7 s |

What the runs found, beyond the scores:

- The third run assigned a person from another board: the schema called
  `boardId` optional for member search although the Trello adapter requires it,
  and the fixture was more permissive than the adapter. The schema now requires
  it and the fixture mirrors the adapter.
- cs11 failed in model-search mode because the model looked issue 42 up and the
  fixture workspace had no issues. Issues were added to the fixtures; the full
  core set was not rerun afterwards, only cs11 and ss09.
- Model-driven search costs two to three model calls per request. Latency p95 is
  15–18 s, above the 15 s preview target that the regex mode met (9.6 s).
- Eighteen free-form cases by one author are a small sample, and the search
  results are fixtures.

### Planning latency

A live three-service request took 31–37 s: three model calls made up 92% of
it, and the real Trello, Slack and GitHub searches 2.5 s. Time per call follows
the tokens the model generates, reasoning included (about 140 tokens/s through
the gateway). The gateway reports reasoning tokens inside `prompt_tokens`, so
subtract them to get the real prompt size.

| Change | Effect |
|---|---|
| List the workspace before the first model call (parallel, capped, 2.5 s budget) | One model call instead of three for 83–94% of case-runs |
| Minified JSON, 15-word `thinking`, 8-word step descriptions | Output 580 → 288 tokens; plan call 9.3–11.6 s → 6.0–7.1 s |
| Search first for an existing item whose details are needed; no read tools in plans | cs11: 41–63 s → 13–27 s in isolation; no timeouts in the next full run |
| Assign members on a new card with `idMembers` (tool descriptions) | Removes the separate `add_member` step that went with long reasoning |
| Thinking variants of the model (`-low`, `reasoning_effort`) | No reliable difference; not used |
| Request hedging | No benefit (more case-runs over 15 s); removed |
| Compact tool listing (`compactTools`, off) | 41% fewer prompt characters, no effect on the slow case; left as an option |

| Measurement (model search, 3 runs per set) | Before | After (`40ba374`) |
|---|---|---|
| Live three-service plan | 31.0 s, 37.2 s | 8.1, 9.2, 10.4 s |
| [Core 50](../docs/ai-evidence/V3-GOLDEN-V2/core-llm-2026-09-30T11-53-33-168Z/summary.md): p50 / p95 | 9.2 / 17.6 s | 6.0 / 13.9 s |
| [Free-form 18](../docs/ai-evidence/V3-GOLDEN-V2/freeform-llm-2026-09-30T11-56-36-156Z/summary.md): p50 / p95 | 10.3 / 15.6 s | 6.1 / 10.8 s |
| Case-runs over 15 s | — | 7 of 150 core, 0 of 54 free-form |
| Timeouts | cs11 and cs02 in every earlier run | none |

Both sets are under the 15 s target at the 95th percentile in this run. It is
one run of each set; between earlier runs of near-identical code the core p95
moved between 14.6 s and 20.1 s, so treat a single p95 as approximate. The
case-runs still over 15 s are mostly clarifications that take two or three
model calls (cl02, cl03).

**Where the tail came from.** Not the gateway and not the prompt size, as
earlier versions of this section claimed. cs11 ("create a card for issue 42 of
repo …") made the model reason for 10–19k tokens in one call; the same request
without the issue reference took under 2.4k, and cs12, with the same 16 tools
and three services, about 1k. The model was weighing two valid shapes: search
for the issue, or chain a `get_issue` step into the plan with `$ref` values.
Telling it to search first removed the deliberation. cs11's prompt is 7.1k
tokens, not 15.8k as stated before.

**Quality.** Free-form 54/54. Core 148/150: both failures are cs11, whose plans
are correct (card titled with the looked-up issue title, issue link in the
description, member assigned, Slack notified) but miss a label that requires
"42" in the title or a `$ref` to a `get_issue` plan step, the shape the new rule
removes. No plan in this run contains a read-only step.

**Label revision (cs11).** After that run, and in its own commit, the cs11 label
was changed: the card title may be the looked-up issue title as well as contain
"42" or reference a `get_issue` step, and the card description must now link the
issue (`issues/42` or a reference to the looked-up issue), which the old label
did not require. The reports above keep the scores they were recorded with;
each report names the labels' commit and SHA-256 it was scored against.
Re-scoring all 17 stored cs11 plans with the revised label changes only the two
plans above, from fail to pass.

## Controlled live execution

`live-execution/run.ts` runs the real planner, executor and adapters against
real Trello, Slack and GitHub. It is the only evaluation path that writes to an
external service, so each mode is gated:

| Mode | Effect |
|---|---|
| `discover` | Lists the boards and channels the tokens can see, to choose test targets. Read-only. |
| `check` | Verifies each enabled service within its allowlist. Read-only. |
| `plan "<request>"` | Real model and real read-only searches; saves `plan.json` with the plan's hash. Writes nothing to the services. |
| `execute <plan.json> --confirm <hash>` | Runs that saved plan's write steps, only when the hash matches the file. |

A service is enabled only with its token and an allowlist of test resources
(`LIVE_TRELLO_BOARD_IDS`, `LIVE_SLACK_CHANNELS`, `LIVE_GITHUB_REPOS`); the
adapters refuse anything outside it. Use a throwaway board, channel and
repository. External writes cannot be rolled back. Evidence is written to
`docs/ai-evidence/V3-LIVE-EXECUTION/`.

```bash
node --env-file=.env --import tsx evaluations/live-execution/run.ts check
```

### W3-07 live runs (04/10/2026)

Each new service ran against a real test resource. Every write followed a plan
whose hash the project owner approved:

- **Telegram:** message to a test group.
- **Notion:** page in a test database.
- **Jira:** issue `ATIT-4`.
- **Google Calendar:** event on a dedicated calendar.
- **Google Sheets:** appended row.
- **Four services:** GitHub issue → Notion page (Link = issue URL) → Telegram → Slack.

Results were read back with the read tools. Each service also had a real
authentication failure, and every one was classified `AUTH_ERROR`, except Jira
project reads (see W3-09). The live runs found three product issues that
fixture tests missed:

- Notion URLs on `app.notion.com` (fixed in #49);
- Jira text search misses hyphenated terms (W3-09);
- an invalid Jira token yields `NOT_FOUND` on project reads (W3-09).

Evidence stays in `docs/ai-evidence/V3-LIVE-EXECUTION/` (not committed);
hashes and IDs are in `docs/handoff/tasks/W3-07-new-services-live.md`.

### Through the app

`live-app/` takes one request through the product itself: web UI, chat-api in
live mode, PostgreSQL, the real model and the real services.

1. Start the server with `RUNTIME_MODE=live npm run up`. It needs `JWT_SECRET`,
   `ENCRYPTION_KEY`, a provisioned `CHAT_ADMIN_*` user and that user's id in
   `SERVICE_ADMIN_USER_IDS`. In live mode the API listens on `0.0.0.0`.
2. Store the service tokens and allowlists through the server's configuration
   API (run this yourself; it prints service names and status only):

   ```bash
   node --env-file=.env --import tsx evaluations/live-app/setup-credentials.ts
   ```

3. Run the browser scenario. It sends `LIVE_APP_PROMPT`, stops at the preview
   and saves `plan.json` with the plan's hash. It clicks "Duyệt kế hoạch" only
   after that hash is written to `confirm.txt` in the run directory; otherwise
   it cancels the plan.

   ```bash
   LIVE_APP=1 LIVE_APP_PROMPT="<request>" node --env-file=.env node_modules/playwright/cli.js test --config evaluations/live-app/playwright.config.ts
   ```

One run so far (2026-09-30): a three-service request reached the preview in
17.3 s, above the 15 s target, and after approval created a GitHub issue, a
Trello card linking it and a Slack message; plan and steps ended `completed` /
`succeeded` in PostgreSQL, and the issue and card were read back from the
services. The Slack message was not read back. The run showed that the preview
rendered `$template` arguments as `[object Object]`, so the reviewer could not
read the text that would be sent, and that a sent message stayed marked
"Đang gửi…"; both were fixed afterwards and confirmed in a second live run
that stopped at the preview and cancelled (8.6 s to the preview, nothing
executed).

### AUTH-06: real email and Google authentication

Keep credentials in the ignored root `.env`. Set `RUNTIME_MODE=live`,
`AUTH_SIGNUP_ENABLED=true`, `APP_BASE_URL=http://localhost:5174` and
`V3_WEB_PORT=5174`. Live startup also needs the existing `DATABASE_URL`,
private `JWT_SECRET` and `ENCRYPTION_KEY`, and LLM provider configuration;
authentication acceptance does not need a model call.

- Gmail: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER`,
  `SMTP_PASSWORD` (an App Password for that same Gmail), and `MAIL_FROM`.
  The account owner enables two-step verification and creates the App
  Password; agents never retrieve or print it. See
  [Google's App Password instructions](https://support.google.com/accounts/answer/185833).
- Google: create a **Web application** OAuth client and set
  `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` and
  `GOOGLE_OAUTH_REDIRECT_URI=http://localhost:5174/auth/google/callback`.
  Register that exact redirect URI on the same client in Google Cloud.
  Use only `openid email profile`. External/Testing has a basic-identity
  scope exception: these scopes do not restrict login to the test-user
  allowlist. ATI still requires administrator approval. See
  [Google's publishing-status rules](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview).

On PowerShell, put `RUNTIME_MODE=live` in `.env`, then run:

```powershell
npm ci --no-audit --no-fund
npm run db:migrate:v3
# If there is no active administrator, the owner sets CHAT_ADMIN_EMAIL,
# CHAT_ADMIN_PASSWORD and CHAT_ADMIN_NAME before provisioning:
npm run admin:provision:v3
npm run up
```

Provisioning an existing administrator replaces its password and revokes
its sessions; run it only when that change is intended. Use the project's
existing PostgreSQL endpoint. On the team lead's Windows machine this is
port `15433`; do not reset its volume to fix a port conflict. Open
`http://localhost:5174` consistently for signup, received links and OAuth.

Use a consenting recipient and record these separate checks:

1. Signup → actual verification email → click received link → pending
   approval → administrator approves → actual approval email → login.
2. Forgot password → actual reset email → the owner sets a new password →
   login with it. Reuse each consumed verification/reset link and confirm
   it fails. Check the received links' origin and Vietnamese subject/body.
3. A fresh Google identity → pending → administrator approves → Google
   login. From an existing verified password account, link Google on
   `/account`, then sign out and log in through Google.
   If Google reuses the current identity, first add the second owned Gmail
   to the browser's Google session, sign out of ATI and choose that second
   account in Google's account chooser.
4. With a deliberately incorrect SMTP password in an isolated process,
   signup still returns the generic message and the server logs only
   `[auth-email] Không gửi được email.`. Separately test an unregistered
   redirect URI against Google; restore the correct configuration afterwards.
   Google rejects an invalid redirect on its own error page; it does not
   redirect to the application's callback in that case. Record the provider
   error separately from callback errors handled by ATI.

`535 / EAUTH` means Gmail refused SMTP authentication. The account owner
checks `SMTP_USER` and replaces `SMTP_PASSWORD` with a current App Password,
without spaces between its displayed groups. Restart the app after editing
`.env`. If the first signup could not send email, use **Gửi lại email xác
minh** once sending works: the pending account already exists.

Google `401 invalid_client` / “The OAuth client was not found” is distinct
from `redirect_uri_mismatch`: check the Web client ID and its matching
secret first, then the exact registered redirect URI. A locally valid
configuration or a visible Google button does not prove provider acceptance.
Replace template values such as `CLIENT_ID.apps.googleusercontent.com`
with the client ID copied from Google Cloud.

Before storing private evidence, verify
`git check-ignore docs/ai-evidence/AUTH-LIVE/probe.json`. Keep received
links, emails and captures in that ignored directory, redact email/token
from screenshots, and commit only aggregate results. SMTP accepting a send
does not prove inbox receipt; record `PASS`, `FAIL`, `NOT_RUN` or `UNKNOWN`
for each step without treating fixture browser tests as real-provider proof.

## Legacy golden set (v1)

`runEvaluations({ useMock: true })` over `golden-prompts.json` is an offline
harness diagnostic. It builds responses from each prompt's expected kind and
tools, so its scores are not independent evidence of model quality. Its result
is labelled `evidence: "offline_fixture"` and `qualityGate: "not_run"`. The v1
prompts have expected kinds and tool names but no argument labels, so
`argumentQualityRate` and `usablePlanRate` remain `null`.
