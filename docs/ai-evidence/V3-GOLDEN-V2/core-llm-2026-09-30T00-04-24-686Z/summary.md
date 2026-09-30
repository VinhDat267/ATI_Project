# Golden set v2 (core, llm search) — live run

- Provider: `openai-compatible` · model `ag/gemini-3.8-flash` · served: `gemini-3.8-flash`
- Labels: `cases.json` commit `ddd1304`, sha256 `6284640ebbc1`, 50 cases × 3 runs
- Clock: 2026-09-29T03:00:00Z (Asia/Ho_Chi_Minh). Planning only; search results are fixtures; no plan was executed.

| Metric (mean of 3 runs) | Value | Target |
|---|---|---|
| Tool selection accuracy | 97.1% | ≥ 85% ✅ |
| Argument quality (plans with right tools, all labels match) | 100.0% | ≥ 75% ✅ |
| Argument label match rate | 97.1% | — |
| Response kind accuracy | 98.0% | — |
| Strict pass rate | 98.0% | — |
| Usable plan rate | n/a (needs user acceptance) | ≥ 70% |
| Latency p50 / p95 / max | 9157 / 17637 / 19306 ms | < 15000 ms |

Per run: run 1 tools 97.1%, args 100.0%, strict 98.0%; run 2 tools 97.1%, args 100.0%, strict 98.0%; run 3 tools 97.1%, args 100.0%, strict 98.0%.

| Category | Cases | Strict pass |
|---|---|---|
| single_step | 10 | 100.0% |
| multi_step | 10 | 100.0% |
| cross_service | 15 | 93.3% |
| clarification | 8 | 100.0% |
| refusal | 7 | 100.0% |

Cases not passing every run: cs11 (0/3).
