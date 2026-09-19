# AI-04 Offline Evaluation

- Harness verdict: `OFFLINE_HARNESS_PASS`
- Live AI evaluation: `AI_EVALUATION_NOT_RUN`
- Evidence kind: `OFFLINE_SYNTHETIC_REPLAY_NOT_MODEL_QUALITY` (not model-quality evidence)
- Fixture scenario: `oracle_replay` (synthetic expected-result replay).
- Unique cases: 4; observations: 84; repetitions are not independent tasks.
- Dev: 0 cases / 0 observations; holdout: 4 / 84.
- Kind correctness: 85.7% (72/84)
- Plan validity: 71.4% (30/42)
- Fixture-task correctness: 71.4% (30/42)
- Retrieval macro recall: 90.5% across 42 applicable observations.
- Planning calls: 108; planner errors: 12.
- Timing: 108 offline in-process planning-call samples; p50=0.010999999999967258ms, p95=0.06510000000002947ms.

## Split × retrieval cell

- holdout / all_tools@10: 4 cases, 12 observations, task=100.0% (6/6), recall=100.0% (6), calls=12, planner errors=0.
- holdout / semantic_qe@10: 4 cases, 12 observations, task=100.0% (6/6), recall=100.0% (6), calls=12, planner errors=0.
- holdout / semantic_qe@3: 4 cases, 12 observations, task=50.0% (3/6), recall=83.3% (6), calls=18, planner errors=3.
- holdout / semantic_qe@5: 4 cases, 12 observations, task=50.0% (3/6), recall=83.3% (6), calls=18, planner errors=3.
- holdout / semantic@10: 4 cases, 12 observations, task=100.0% (6/6), recall=100.0% (6), calls=12, planner errors=0.
- holdout / semantic@3: 4 cases, 12 observations, task=50.0% (3/6), recall=83.3% (6), calls=18, planner errors=3.
- holdout / semantic@5: 4 cases, 12 observations, task=50.0% (3/6), recall=83.3% (6), calls=18, planner errors=3.

## Limitations

- Offline synthetic replay validates evaluator wiring only; it is not model-quality evidence.
- No provider, gateway, MCP receiver, database, or external network was called by this report.
- Holdout cases were previously exercised by offline tests and are not claimed as untouched.
- Recovery, paid usage, provider latency, and live semantic quality remain NOT_RUN.
