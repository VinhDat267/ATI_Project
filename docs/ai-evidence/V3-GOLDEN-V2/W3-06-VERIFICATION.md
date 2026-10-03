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

The [interrupted report](interrupted-services-llm-2026-10-03T10-47-08-073Z/summary.md)
is 79/132 attempts, source823cf1f, and is excluded from complete results. A new
gateway process was observed and a fresh one-case probe passed before rerun.
Its historical category-count average is preserved; runtime source7ba60ef
corrects interrupted category counts to unique cases.

## Review and CI

- Initial code CI37119054180 SUCCESS at exact `7ba60ef`.
- Final independent review and final exact-head CI are recorded after the complete evidence review; this initial entry does not claim those gates have passed.
