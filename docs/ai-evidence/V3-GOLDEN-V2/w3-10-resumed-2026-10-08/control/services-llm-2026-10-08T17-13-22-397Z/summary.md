# Golden v2: services, llm — provider observed

- Source: `7898aa72c7b4414d8c8d2861e0a7ae166326ce5c`; labels `20fa6f03c8696d769303f759602d1c0748cb9b26`, SHA-256 `369efaea2023344540f731dae7730d33aa4ad9a542b3d222d2aca6d463bf896f`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 44 selected cases × 1 requested runs; 44/44 attempted; complete: true.
- Clock: 2026-09-29T10:00:00+07:00, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only protocol has no answer response kind: clarification is labelled, and successful read calls are scored separately.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 100.0% | ≥85% |
| Arguments among correct tools | 97.1% | ≥75% |
| Strict pass | 84.1% | — |
| Response kind | 84.1% | — |
| Latency p50 / p95 / max | 7600 / 44465 / 69262 ms | <15000 ms |

Service metrics score only that service's preregistered tool/argument labels within each workflow. Read cases use successful observed gather calls. Clarification/refusal contribute to kind/strict scores, not tool denominators. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|
| sheets | 10 | 8 | 8 | 100.0% | 100.0% | 12212 / 69262 |
| jira | 12 | 10 | 10 | 100.0% | 100.0% | 12212 / 44594 |
| calendar | 10 | 8 | 8 | 100.0% | 87.5% | 10153 / 44465 |
| slack | 2 | 2 | 2 | 100.0% | 100.0% | 14559 / 18170 |
| notion | 11 | 9 | 9 | 100.0% | 100.0% | 9939 / 33433 |
| telegram | 12 | 10 | 10 | 100.0% | 100.0% | 7600 / 37973 |
| github | 2 | 2 | 2 | 100.0% | 100.0% | 6059 / 12391 |
| trello | 3 | 3 | 3 | 100.0% | 100.0% | 15514 / 18170 |

Cases not passing every requested run: sh01 (0/1), sh07 (0/1), ca01 (0/1), ca04 (0/1), no01 (0/1), tg01 (0/1), ji01 (0/1).
