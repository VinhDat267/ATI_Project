# Golden set v2 — live run

- Provider: `openai-compatible` · model `ag/gemini-3.8-flash` · served: `gemini-3.8-flash`
- Labels: commit `ddd1304`, sha256 `6284640ebbc1`, 50 cases × 3 runs
- Clock: 2026-09-29T03:00:00Z (Asia/Ho_Chi_Minh). Planning only; search results are fixtures; no plan was executed.

| Metric (mean of 3 runs) | Value | Target |
|---|---|---|
| Tool selection accuracy | 35.2% | ≥ 85% ❌ |
| Argument quality (plans with right tools, all labels match) | 100.0% | ≥ 75% ✅ |
| Argument label match rate | 44.5% | — |
| Response kind accuracy | 54.7% | — |
| Strict pass rate | 54.7% | — |
| Usable plan rate | n/a (needs user acceptance) | ≥ 70% |
| Latency p50 / p95 / max | 7335 / 13367 / 25371 ms | < 15000 ms |

Per run: run 1 tools 40.0%, args 100.0%, strict 58.0%; run 2 tools 34.3%, args 100.0%, strict 54.0%; run 3 tools 31.4%, args 100.0%, strict 52.0%.

| Category | Cases | Strict pass |
|---|---|---|
| single_step | 10 | 3.3% |
| multi_step | 10 | 3.3% |
| cross_service | 15 | 77.8% |
| clarification | 8 | 100.0% |
| refusal | 7 | 100.0% |

Cases not passing every run: ss01 (0/3), ss02 (0/3), ss03 (0/3), ss04 (0/3), ss05 (0/3), ss06 (0/3), ss07 (1/3), ss08 (0/3), ss09 (0/3), ss10 (0/3), ms01 (0/3), ms02 (0/3), ms03 (0/3), ms04 (0/3), ms05 (0/3), ms06 (1/3), ms07 (0/3), ms08 (0/3), ms09 (0/3), ms10 (0/3), cs04 (0/3), cs07 (1/3), cs08 (1/3), cs14 (0/3).
