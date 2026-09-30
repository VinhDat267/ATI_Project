# Golden set v2 (core, llm search, subset: cs11, ss09) — live run

- Provider: `openai-compatible` · model `ag/gemini-3.8-flash` · served: `gemini-3.8-flash`
- Labels: `cases.json` commit `ddd1304`, sha256 `6284640ebbc1`, 2 cases × 3 runs
- Clock: 2026-09-29T03:00:00Z (Asia/Ho_Chi_Minh). Planning only; search results are fixtures; no plan was executed.

| Metric (mean of 3 runs) | Value | Target |
|---|---|---|
| Tool selection accuracy | 100.0% | ≥ 85% ✅ |
| Argument quality (plans with right tools, all labels match) | 100.0% | ≥ 75% ✅ |
| Argument label match rate | 100.0% | — |
| Response kind accuracy | 100.0% | — |
| Strict pass rate | 100.0% | — |
| Usable plan rate | n/a (needs user acceptance) | ≥ 70% |
| Latency p50 / p95 / max | 8256 / 21725 / 21725 ms | < 15000 ms |

Per run: run 1 tools 100.0%, args 100.0%, strict 100.0%; run 2 tools 100.0%, args 100.0%, strict 100.0%; run 3 tools 100.0%, args 100.0%, strict 100.0%.

| Category | Cases | Strict pass |
|---|---|---|
| single_step | 1 | 100.0% |
| cross_service | 1 | 100.0% |

Cases not passing every run: none.
