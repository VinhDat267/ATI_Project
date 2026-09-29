# Golden set v2 — live run

- Provider: `openai-compatible` · model `ag/gemini-3.8-flash` · served: n/a
- Labels: commit `ddd1304`, sha256 `6284640ebbc1`, 50 cases × 3 runs
- Clock: 2026-09-29T03:00:00Z (Asia/Ho_Chi_Minh). Planning only; search results are fixtures; no plan was executed.

| Metric (mean of 3 runs) | Value | Target |
|---|---|---|
| Tool selection accuracy | 0.0% | ≥ 85% ❌ |
| Argument quality (plans with right tools, all labels match) | n/a | ≥ 75% ❌ |
| Argument label match rate | 0.0% | — |
| Response kind accuracy | 6.0% | — |
| Strict pass rate | 6.0% | — |
| Usable plan rate | n/a (needs user acceptance) | ≥ 70% |
| Latency p50 / p95 / max | 2 / 5 / 99 ms | < 15000 ms |

Per run: run 1 tools 0.0%, args n/a, strict 6.0%; run 2 tools 0.0%, args n/a, strict 6.0%; run 3 tools 0.0%, args n/a, strict 6.0%.

| Category | Cases | Strict pass |
|---|---|---|
| single_step | 10 | 0.0% |
| multi_step | 10 | 0.0% |
| cross_service | 15 | 0.0% |
| clarification | 8 | 37.5% |
| refusal | 7 | 0.0% |

Cases not passing every run: ss01 (0/3), ss02 (0/3), ss03 (0/3), ss04 (0/3), ss05 (0/3), ss06 (0/3), ss07 (0/3), ss08 (0/3), ss09 (0/3), ss10 (0/3), ms01 (0/3), ms02 (0/3), ms03 (0/3), ms04 (0/3), ms05 (0/3), ms06 (0/3), ms07 (0/3), ms08 (0/3), ms09 (0/3), ms10 (0/3), cs01 (0/3), cs02 (0/3), cs03 (0/3), cs04 (0/3), cs05 (0/3), cs06 (0/3), cs07 (0/3), cs08 (0/3), cs09 (0/3), cs10 (0/3), cs11 (0/3), cs12 (0/3), cs13 (0/3), cs14 (0/3), cs15 (0/3), cl01 (0/3), cl05 (0/3), cl06 (0/3), cl07 (0/3), cl08 (0/3), rf01 (0/3), rf02 (0/3), rf03 (0/3), rf04 (0/3), rf05 (0/3), rf06 (0/3), rf07 (0/3).
