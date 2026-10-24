# Golden v2: independent, llm — provider observed

- Source: `91cd5c1b8a99c689ea00a696e1195c0230b244a0`; labels `2cdaf90a6215ac541bc077d57e4d89a4fcac7fe7`, SHA-256 `c4425f512ac037eb82aa24fca8df023c280775e8e487cf0292f5364d879f7959`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 32 selected cases × 3 requested runs; 96/96 attempted; complete: true.
- Started 2026-10-24T14:47:07.129Z; checkpoint/end 2026-10-24T15:00:49.751Z (UTC).
- Clock: 2026-09-29T10:00:00+07:00, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only: clarification, exactly one model call, zero model-opened search rounds (phase search). Platform directory listing (phase prefetch) is allowed under the owner clarification of 08/10.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 93.7% | ≥85% |
| Arguments among correct tools | 100.0% | ≥75% |
| Strict pass | 92.7% | — |
| Response kind | 92.7% | — |
| Latency p50 / p95 / max | 10761 / 60010 / 76641 ms | <15000 ms |

Model calls: 111; transport attempts: 124; timeouts: 17.
Cases scored as failed because the model call missed the production deadline after its retries: m3-03 (run 1), m1-03 (run 3), m3-03 (run 3), m4-03 (run 3). Any other provider failure, or 3 such timeouts in a row, stops the campaign.
Model-opened search rounds (phase search): 14; platform directory calls (phase prefetch): 381. searches excludes directory traces; prefetches records them separately. One search round can contain several parallel tool calls. Regex gather is not a model-opened search round.
Attempts per call (0 means provider does not expose diagnostics): {"1":98,"2":13}. Retry reasons: {"timeout":13}.
Time share: model 100.0%, directory 0.0%, search rounds 0.0%, regex gather 0.0%, other 0.0%.
Under 15 seconds: 71/96 (74.0%).

Read answers: off; catalog 33 tools (trello, slack, github, sheets, calendar, notion, telegram, jira), SHA-256 `8e14ff40f2dd15760798b2050e46af93edd6d4cfc9682957dcdd55ed8b33f0ce`.
Answers: 0; p50 / p95 / max 0 / 0 / 0 ms; model calls per answer mean n/a, max 0, {}; answers without a model-opened lookup (directory only): 0.
Plans: 59; p50 / p95 / max 10834 / 44770 / 76641 ms. Answers are not held to the 15-second planning target.
Action cases (every category except read_only and answer) that got an answer: none.

Per-call timing includes retry backoff; attempts measure each actual transport attempt, including reading the response body. Missing token counts are null, never fabricated. Reasoning may be included in prompt_tokens by the gateway; do not add it to prompt/completion totals.

Service metrics score only that service's preregistered tool/argument labels within each workflow. Immediate read-only clarification has no tool/argument denominator. Clarification/refusal contribute to kind/strict scores. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|
| slack | 6 | 15 | 15 | 100.0% | 100.0% | 8611 / 39102 |
| jira | 4 | 9 | 9 | 100.0% | 100.0% | 13969 / 52419 |
| github | 4 | 9 | 6 | 66.7% | 100.0% | 14201 / 76641 |
| trello | 9 | 18 | 17 | 94.4% | 100.0% | 8016 / 29466 |
| telegram | 4 | 12 | 12 | 100.0% | 100.0% | 7630 / 36234 |
| calendar | 4 | 6 | 6 | 100.0% | 100.0% | 8537 / 12285 |
| notion | 2 | 6 | 6 | 100.0% | 100.0% | 16972 / 31436 |
| sheets | 5 | 9 | 9 | 100.0% | 100.0% | 10356 / 41447 |

Cases not passing every requested run: m1-03 (2/3), m3-03 (1/3), m4-03 (2/3), m4-07 (0/3).

