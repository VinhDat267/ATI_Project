# Golden set v2 (freeform, llm search) — live run

- Provider: `openai-compatible` · model `ag/gemini-3.8-flash` · served: `gemini-3.8-flash`
- Labels: `cases-freeform.json` commit `9e68093`, sha256 `86f5cae07f97`, 12 cases × 3 runs
- Clock: 2026-09-29T03:00:00Z (Asia/Ho_Chi_Minh). Planning only; search results are fixtures; no plan was executed.

| Metric (mean of 3 runs) | Value | Target |
|---|---|---|
| Tool selection accuracy | 87.5% | ≥ 85% ✅ |
| Argument quality (plans with right tools, all labels match) | 100.0% | ≥ 75% ✅ |
| Argument label match rate | 84.0% | — |
| Response kind accuracy | 86.1% | — |
| Strict pass rate | 86.1% | — |
| Usable plan rate | n/a (needs user acceptance) | ≥ 70% |
| Latency p50 / p95 / max | 10312 / 15388 / 23152 ms | < 15000 ms |

Per run: run 1 tools 87.5%, args 100.0%, strict 83.3%; run 2 tools 87.5%, args 100.0%, strict 83.3%; run 3 tools 87.5%, args 100.0%, strict 91.7%.

| Category | Cases | Strict pass |
|---|---|---|
| free_form | 12 | 86.1% |

Cases not passing every run: ff01 (0/3), ff12 (1/3).
