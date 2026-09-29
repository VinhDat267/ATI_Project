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

## Legacy golden set (v1)

`runEvaluations({ useMock: true })` over `golden-prompts.json` is an offline
harness diagnostic. It builds responses from each prompt's expected kind and
tools, so its scores are not independent evidence of model quality. Its result
is labelled `evidence: "offline_fixture"` and `qualityGate: "not_run"`. The v1
prompts have expected kinds and tool names but no argument labels, so
`argumentQualityRate` and `usablePlanRate` remain `null`.
