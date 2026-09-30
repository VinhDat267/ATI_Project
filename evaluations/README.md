# Planner evaluation evidence

## Golden set v2 (labelled)

`golden-v2/cases.json` holds 50 planner cases across the spec's five
categories: 10 single-step, 10 multi-step, 15 cross-service, 8 clarification
and 7 refusal, in Vietnamese and English, twelve of them using GitHub.

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
"Đang gửi…"; both were fixed afterwards and have not been re-checked in a live
run.

## Legacy golden set (v1)

`runEvaluations({ useMock: true })` over `golden-prompts.json` is an offline
harness diagnostic. It builds responses from each prompt's expected kind and
tools, so its scores are not independent evidence of model quality. Its result
is labelled `evidence: "offline_fixture"` and `qualityGate: "not_run"`. The v1
prompts have expected kinds and tool names but no argument labels, so
`argumentQualityRate` and `usablePlanRate` remain `null`.
