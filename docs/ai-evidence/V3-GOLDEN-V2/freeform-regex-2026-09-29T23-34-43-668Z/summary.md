# Golden set v2 (freeform, regex search) — live run

- Provider: `openai-compatible` · model `ag/gemini-3.8-flash` · served: `gemini-3.8-flash`
- Labels: `cases-freeform.json` commit `9e68093`, sha256 `86f5cae07f97`, 12 cases × 3 runs
- Clock: 2026-09-29T03:00:00Z (Asia/Ho_Chi_Minh). Planning only; search results are fixtures; no plan was executed.

| Metric (mean of 3 runs) | Value | Target |
|---|---|---|
| Tool selection accuracy | 4.2% | ≥ 85% ❌ |
| Argument quality (plans with right tools, all labels match) | 0.0% | ≥ 75% ❌ |
| Argument label match rate | 4.0% | — |
| Response kind accuracy | 36.1% | — |
| Strict pass rate | 33.3% | — |
| Usable plan rate | n/a (needs user acceptance) | ≥ 70% |
| Latency p50 / p95 / max | 8 / 30024 / 30062 ms | < 15000 ms |

Per run: run 1 tools 0.0%, args n/a, strict 33.3%; run 2 tools 0.0%, args n/a, strict 33.3%; run 3 tools 12.5%, args 0.0%, strict 33.3%.

| Category | Cases | Strict pass |
|---|---|---|
| free_form | 12 | 33.3% |

Cases not passing every run: ff01 (0/3), ff02 (0/3), ff03 (0/3), ff04 (0/3), ff05 (0/3), ff06 (0/3), ff07 (0/3), ff08 (0/3).
