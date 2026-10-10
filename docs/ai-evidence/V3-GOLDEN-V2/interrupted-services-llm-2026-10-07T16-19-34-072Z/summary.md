# Golden v2: services, llm — partial

- Source: `845701cc153055b395170d871f08f349215320d2`; labels `795229e24c64a38902e7efdce0680c729f37348a`, SHA-256 `6281f0869a6ca781a1ceb4650578a3cc095397ef28a87339029f0819b0fe9372`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 44 selected cases × 3 requested runs; 35/132 attempted; complete: false.
- Clock: 2026-09-29T10:00:00+07:00, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only requests are labelled as immediate clarification with no searches under the 05/10 product policy.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 90.5% | ≥85% |
| Arguments among correct tools | 100.0% | ≥75% |
| Strict pass | 91.4% | — |
| Response kind | 91.4% | — |
| Latency p50 / p95 / max | 13702 / 24972 / 57340 ms | <15000 ms |

Model calls: 59; transport attempts: 60; timeouts: 1.
Attempts per call (0 means provider does not expose diagnostics): {"1":58,"2":1}. Retry reasons: {"timeout":1}.
Time share: model 99.9%, directory 0.0%, search rounds 0.0%, other 0.0%.
Under 15 seconds: 22/35 (62.9%).
Per-call timing includes retry backoff; attempts measure each actual transport attempt, including reading the response body. Missing token counts are null, never fabricated. Reasoning may be included in prompt_tokens by the gateway; do not add it to prompt/completion totals.

Service metrics score only that service's preregistered tool/argument labels within each workflow. Immediate read-only clarification has no tool/argument denominator. Clarification/refusal contribute to kind/strict scores. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|
| sheets | 8 | 4 | 4 | 100.0% | 100.0% | 14194 / 24972 |
| jira | 4 | 3 | 1 | 33.3% | 100.0% | 9969 / 24972 |
| calendar | 8 | 5 | 5 | 100.0% | 100.0% | 14413 / 57340 |
| slack | 1 | 1 | 1 | 100.0% | 100.0% | 15977 / 15977 |
| notion | 8 | 5 | 5 | 100.0% | 100.0% | 12109 / 17551 |
| telegram | 9 | 6 | 6 | 100.0% | 100.0% | 10534 / 17188 |
| github | 1 | 1 | 1 | 100.0% | 100.0% | 16264 / 16264 |
| trello | 1 | 1 | 0 | 0.0% | n/a | 9969 / 9969 |

Cases not passing every requested run: sh01 (1/1), sh02 (1/1), sh03 (1/1), sh04 (1/1), sh05 (1/1), sh06 (1/1), sh07 (1/1), sh08 (1/1), ca01 (1/1), ca02 (1/1), ca03 (1/1), ca04 (0/1), ca05 (1/1), ca06 (1/1), ca07 (1/1), ca08 (1/1), no01 (1/1), no02 (1/1), no03 (1/1), no04 (1/1), no05 (1/1), no06 (1/1), no07 (1/1), no08 (1/1), tg01 (1/1), tg02 (1/1), tg03 (1/1), tg04 (1/1), tg05 (1/1), tg06 (1/1), tg07 (1/1), tg08 (1/1), ji01 (1/1), ji02 (0/1), ji03 (0/1).


STOPPED: Evaluation stopped after provider failure. Unstarted current-run cases: ji04, ji05, ji06, ji07, ji08, wf01, wf02, wf03, wf04. Later requested runs were not started.
