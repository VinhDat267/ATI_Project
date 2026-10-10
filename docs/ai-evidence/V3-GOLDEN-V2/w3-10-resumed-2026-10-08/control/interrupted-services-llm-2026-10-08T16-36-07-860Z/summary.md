# Golden v2: services, llm — partial

- Source: `7898aa72c7b4414d8c8d2861e0a7ae166326ce5c`; labels `20fa6f03c8696d769303f759602d1c0748cb9b26`, SHA-256 `369efaea2023344540f731dae7730d33aa4ad9a542b3d222d2aca6d463bf896f`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 44 selected cases × 1 requested runs; 17/44 attempted; complete: false.
- Clock: 2026-09-29T10:00:00+07:00, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only protocol has no answer response kind: clarification is labelled, and successful read calls are scored separately.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 100.0% | ≥85% |
| Arguments among correct tools | 92.3% | ≥75% |
| Strict pass | 70.6% | — |
| Response kind | 70.6% | — |
| Latency p50 / p95 / max | 7312 / 72705 / 72705 ms | <15000 ms |

Service metrics score only that service's preregistered tool/argument labels within each workflow. Read cases use successful observed gather calls. Clarification/refusal contribute to kind/strict scores, not tool denominators. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|
| sheets | 8 | 6 | 6 | 100.0% | 100.0% | 6669 / 72705 |
| jira | 1 | 1 | 1 | 100.0% | 100.0% | 13916 / 13916 |
| calendar | 8 | 6 | 6 | 100.0% | 83.3% | 6851 / 60026 |
| slack | 1 | 1 | 1 | 100.0% | 100.0% | 11316 / 11316 |
| notion | 1 | 1 | 1 | 100.0% | 100.0% | 28994 / 28994 |

Cases not passing every requested run: sh01 (0/1), sh07 (0/1), ca01 (0/1), ca04 (0/1), no01 (0/1).


STOPPED: LLM gateway request timed out after 30000ms. Unstarted current-run cases: no02, no03, no04, no05, no06, no07, no08, tg01, tg02, tg03, tg04, tg05, tg06, tg07, tg08, ji01, ji02, ji03, ji04, ji05, ji06, ji07, ji08, wf01, wf02, wf03, wf04. Later requested runs were not started.
