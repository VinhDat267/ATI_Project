# AI-04 Offline Evaluation

- Harness verdict: `OFFLINE_HARNESS_PASS`
- Live AI evaluation: `AI_EVALUATION_NOT_RUN`
- Evidence kind: `OFFLINE_SYNTHETIC_REPLAY_NOT_MODEL_QUALITY` (not model-quality evidence)
- Unique cases: 4; observations: 84; repetitions are not independent tasks.
- Dev: 0 cases / 0 observations; holdout: 4 / 84.
- Kind correctness: 100.0% (72/72)
- Plan validity: 100.0% (30/30)
- Fixture-task correctness: 100.0% (30/30)
- Retrieval macro recall: 90.5% across 42 applicable observations.
- Timing: 108 offline in-process planning-call samples; p50=0.011200000000030741ms, p95=0.04570000000001073ms.

## Limitations

- Offline synthetic replay validates evaluator wiring only; it is not model-quality evidence.
- No provider, gateway, MCP receiver, database, or external network was called by this report.
- Holdout cases were previously exercised by offline tests and are not claimed as untouched.
- Recovery, paid usage, provider latency, and live semantic quality remain NOT_RUN.
