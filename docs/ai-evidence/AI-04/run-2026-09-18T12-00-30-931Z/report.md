# AI-04 Offline Evaluation

- Harness verdict: `OFFLINE_HARNESS_PASS`
- Live AI evaluation: `AI_EVALUATION_NOT_RUN`
- Evidence kind: `OFFLINE_SYNTHETIC_REPLAY_NOT_MODEL_QUALITY` (not model-quality evidence)
- Unique cases: 6; observations: 126; repetitions are not independent tasks.
- Dev: 6 cases / 126 observations; holdout: 0 / 0.
- Kind correctness: 66.7% (84/126)
- Plan validity: 50.0% (42/84)
- Fixture-task correctness: 50.0% (42/84)
- Retrieval macro recall: 59.5% across 84 applicable observations.
- Planning calls: 210; planner errors: 42.
- Timing: 210 offline in-process planning-call samples; p50=0.009900000000016007ms, p95=0.03589999999996962ms.

## Split × retrieval cell

- dev / all_tools@10: 6 cases, 18 observations, task=100.0% (12/12), recall=100.0% (12), calls=18, planner errors=0.
- dev / semantic_qe@10: 6 cases, 18 observations, task=100.0% (12/12), recall=100.0% (12), calls=18, planner errors=0.
- dev / semantic_qe@3: 6 cases, 18 observations, task=0.0% (0/12), recall=16.7% (12), calls=42, planner errors=12.
- dev / semantic_qe@5: 6 cases, 18 observations, task=25.0% (3/12), recall=41.7% (12), calls=36, planner errors=9.
- dev / semantic@10: 6 cases, 18 observations, task=100.0% (12/12), recall=100.0% (12), calls=18, planner errors=0.
- dev / semantic@3: 6 cases, 18 observations, task=0.0% (0/12), recall=16.7% (12), calls=42, planner errors=12.
- dev / semantic@5: 6 cases, 18 observations, task=25.0% (3/12), recall=41.7% (12), calls=36, planner errors=9.

## Limitations

- Offline synthetic replay validates evaluator wiring only; it is not model-quality evidence.
- No provider, gateway, MCP receiver, database, or external network was called by this report.
- Holdout cases were previously exercised by offline tests and are not claimed as untouched.
- Recovery, paid usage, provider latency, and live semantic quality remain NOT_RUN.
