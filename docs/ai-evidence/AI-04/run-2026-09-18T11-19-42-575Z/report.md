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
- Timing: 210 offline in-process planning-call samples; p50=0.009699999999838838ms, p95=0.033999999999991815ms.

## Limitations

- Offline synthetic replay validates evaluator wiring only; it is not model-quality evidence.
- No provider, gateway, MCP receiver, database, or external network was called by this report.
- Holdout cases were previously exercised by offline tests and are not claimed as untouched.
- Recovery, paid usage, provider latency, and live semantic quality remain NOT_RUN.
