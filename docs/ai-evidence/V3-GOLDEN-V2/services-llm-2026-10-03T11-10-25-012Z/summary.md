# Golden v2: services, llm — provider observed

- Source: `7ba60efa8a7bc90dc42a309076e846d5af5a1cad`; labels `20fa6f03c8696d769303f759602d1c0748cb9b26`, SHA-256 `369efaea2023344540f731dae7730d33aa4ad9a542b3d222d2aca6d463bf896f`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash.
- 44 selected cases × 3 requested runs; 132/132 attempted; complete: true.
- Clock: 2026-09-29T10:00:00+07:00, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only protocol has no answer response kind: clarification is labelled, and successful read calls are scored separately.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 100.0% | ≥85% |
| Arguments among correct tools | 97.1% | ≥75% |
| Strict pass | 84.1% | — |
| Response kind | 84.1% | — |
| Latency p50 / p95 / max | 6105 / 31097 / 53021 ms | <15000 ms |

Service metrics score only that service's preregistered tool/argument labels within each workflow. Read cases use successful observed gather calls. Clarification/refusal contribute to kind/strict scores, not tool denominators. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|
| sheets | 10 | 24 | 24 | 100.0% | 100.0% | 7037 / 29239 |
| jira | 12 | 30 | 30 | 100.0% | 100.0% | 7325 / 24818 |
| calendar | 10 | 24 | 24 | 100.0% | 87.5% | 7653 / 32040 |
| slack | 2 | 6 | 6 | 100.0% | 100.0% | 6893 / 10921 |
| notion | 11 | 27 | 27 | 100.0% | 100.0% | 7515 / 25306 |
| telegram | 12 | 30 | 30 | 100.0% | 100.0% | 5185 / 33187 |
| github | 2 | 6 | 6 | 100.0% | 100.0% | 7515 / 11714 |
| trello | 3 | 9 | 9 | 100.0% | 100.0% | 7946 / 10921 |

Cases not passing every requested run: sh01 (0/3), sh07 (0/3), ca01 (0/3), ca04 (0/3), no01 (0/3), tg01 (0/3), ji01 (0/3).

