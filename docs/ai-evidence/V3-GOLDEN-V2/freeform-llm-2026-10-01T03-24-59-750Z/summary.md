# Golden set v2 (freeform, llm search) — live run

- Provider: `openai-compatible` · model `ag/gemini-3.8-flash` · served: `gemini-3.8-flash`
- Labels: `cases-freeform.json` commit `695ad87`, sha256 `79812f905a3d`, 18 cases × 1 runs
- Clock: 2026-09-29T03:00:00Z (Asia/Ho_Chi_Minh). Planning only; search results are fixtures; no plan was executed.

| Metric (mean of 1 runs) | Value | Target |
|---|---|---|
| Tool selection accuracy | 100.0% | ≥ 85% ✅ |
| Argument quality (plans with right tools, all labels match) | 100.0% | ≥ 75% ✅ |
| Argument label match rate | 100.0% | — |
| Response kind accuracy | 100.0% | — |
| Strict pass rate | 100.0% | — |
| Usable plan rate | n/a (needs user acceptance) | ≥ 70% |
| Latency p50 / p95 / max | 7802 / 12110 / 12110 ms | < 15000 ms |

Per run: run 1 tools 100.0%, args 100.0%, strict 100.0%.

| Category | Cases | Strict pass |
|---|---|---|
| free_form | 12 | 100.0% |
| free_form_heldout | 6 | 100.0% |

Cases not passing every run: none.
