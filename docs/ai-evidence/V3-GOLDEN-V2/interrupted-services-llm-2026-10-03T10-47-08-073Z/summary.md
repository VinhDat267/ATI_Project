# Golden v2: services, llm — partial

- Source: `823cf1fbd698f8f3edf9b4b1a61ba904dd11a82b`; labels `20fa6f03c8696d769303f759602d1c0748cb9b26`, SHA-256 `369efaea2023344540f731dae7730d33aa4ad9a542b3d222d2aca6d463bf896f`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash.
- 44 selected cases × 3 requested runs; 79/132 attempted; complete: false.
- Clock: 2026-09-29T10:00:00+07:00, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only protocol has no answer response kind: clarification is labelled, and successful read calls are scored separately.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 98.1% | ≥85% |
| Arguments among correct tools | 96.6% | ≥75% |
| Strict pass | 80.6% | — |
| Response kind | 80.6% | — |
| Latency p50 / p95 / max | 5195 / 26366 / 36418 ms | <15000 ms |

Service metrics score only that service's preregistered tool/argument labels within each workflow. Read cases use successful observed gather calls. Clarification/refusal contribute to kind/strict scores, not tool denominators. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|
| sheets | 10 | 14 | 14 | 100.0% | 100.0% | 5195 / 36418 |
| jira | 12 | 14 | 13 | 87.5% | 100.0% | 6210 / 27991 |
| calendar | 10 | 14 | 14 | 100.0% | 85.4% | 5389 / 24851 |
| slack | 2 | 3 | 3 | 100.0% | 100.0% | 6870 / 8260 |
| notion | 11 | 15 | 15 | 100.0% | 100.0% | 5534 / 30275 |
| telegram | 12 | 17 | 17 | 100.0% | 100.0% | 5701 / 19476 |
| github | 2 | 3 | 3 | 100.0% | 100.0% | 5761 / 6557 |
| trello | 3 | 4 | 3 | 50.0% | 100.0% | 6246 / 8260 |

Cases not passing every requested run: sh01 (0/2), sh02 (2/2), sh03 (2/2), sh04 (2/2), sh05 (2/2), sh06 (2/2), sh07 (0/2), sh08 (2/2), ca01 (0/2), ca02 (2/2), ca03 (2/2), ca04 (0/2), ca05 (2/2), ca06 (2/2), ca07 (2/2), ca08 (2/2), no01 (0/2), no02 (2/2), no03 (2/2), no04 (2/2), no05 (2/2), no06 (2/2), no07 (2/2), no08 (2/2), tg01 (0/2), tg02 (2/2), tg03 (2/2), tg04 (2/2), tg05 (2/2), tg06 (2/2), tg07 (2/2), tg08 (2/2), ji01 (0/2), ji02 (2/2), ji03 (1/2), ji04 (1/1), ji05 (1/1), ji06 (1/1), ji07 (1/1), ji08 (1/1), wf01 (1/1), wf02 (1/1), wf03 (1/1), wf04 (1/1).


STOPPED: fetch failed. Unstarted current-run cases: ji04, ji05, ji06, ji07, ji08, wf01, wf02, wf03, wf04. Later requested runs were not started.
