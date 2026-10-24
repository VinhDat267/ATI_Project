# Golden v2: independent, regex — provider observed

- Source: `91cd5c1b8a99c689ea00a696e1195c0230b244a0`; labels `2cdaf90a6215ac541bc077d57e4d89a4fcac7fe7`, SHA-256 `c4425f512ac037eb82aa24fca8df023c280775e8e487cf0292f5364d879f7959`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 32 selected cases × 3 requested runs; 96/96 attempted; complete: true.
- Started 2026-10-24T15:00:51.409Z; checkpoint/end 2026-10-24T15:13:34.464Z (UTC).
- Clock: 2026-09-29T10:00:00+07:00, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only: clarification, exactly one model call, zero model-opened search rounds (phase search). Platform directory listing (phase prefetch) is allowed under the owner clarification of 08/10.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 27.0% | ≥85% |
| Arguments among correct tools | 76.7% | ≥75% |
| Strict pass | 38.5% | — |
| Response kind | 42.7% | — |
| Latency p50 / p95 / max | 6669 / 60032 / 60045 ms | <15000 ms |

Model calls: 66; transport attempts: 83; timeouts: 32.
Cases scored as failed because the model call missed the production deadline after its retries: m1-05 (run 1), m3-02 (run 1), m3-03 (run 1), m4-01 (run 1), m1-05 (run 2), m2-02 (run 2), m2-05 (run 2), m3-02 (run 2), m3-03 (run 2), m3-05 (run 2), m4-01 (run 2), m1-05 (run 3), m2-05 (run 3), m3-02 (run 3), m4-01 (run 3). Any other provider failure, or 3 such timeouts in a row, stops the campaign.
Model-opened search rounds (phase search): 0; platform directory calls (phase prefetch): 0. searches excludes directory traces; prefetches records them separately. One search round can contain several parallel tool calls. Regex gather is not a model-opened search round.
Attempts per call (0 means provider does not expose diagnostics): {"1":49,"2":17}. Retry reasons: {"timeout":17}.
Time share: model 100.0%, directory 0.0%, search rounds 0.0%, regex gather 0.0%, other 0.0%.
Under 15 seconds: 70/96 (72.9%).

Read answers: off; catalog 33 tools (trello, slack, github, sheets, calendar, notion, telegram, jira), SHA-256 `8e14ff40f2dd15760798b2050e46af93edd6d4cfc9682957dcdd55ed8b33f0ce`.
Answers: 0; p50 / p95 / max 0 / 0 / 0 ms; model calls per answer mean n/a, max 0, {}; answers without a model-opened lookup (directory only): 0.
Plans: 17; p50 / p95 / max 7035 / 45492 / 45492 ms. Answers are not held to the 15-second planning target.
Action cases (every category except read_only and answer) that got an answer: none.

Per-call timing includes retry backoff; attempts measure each actual transport attempt, including reading the response body. Missing token counts are null, never fabricated. Reasoning may be included in prompt_tokens by the gateway; do not add it to prompt/completion totals.

Service metrics score only that service's preregistered tool/argument labels within each workflow. Immediate read-only clarification has no tool/argument denominator. Clarification/refusal contribute to kind/strict scores. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|
| slack | 6 | 15 | 9 | 60.0% | 66.7% | 6518 / 60014 |
| jira | 4 | 9 | 4 | 44.4% | 100.0% | 7314 / 60022 |
| github | 4 | 9 | 7 | 77.8% | 100.0% | 7035 / 60019 |
| trello | 9 | 18 | 0 | 0.0% | n/a | 0 / 60043 |
| telegram | 4 | 12 | 0 | 0.0% | n/a | 22362 / 60043 |
| calendar | 4 | 6 | 3 | 50.0% | 0.0% | 12542 / 60038 |
| notion | 2 | 6 | 0 | 0.0% | n/a | 45427 / 60027 |
| sheets | 5 | 9 | 1 | 11.1% | 0.0% | 6669 / 60045 |

Cases not passing every requested run: m1-04 (0/3), m1-05 (0/3), m1-06 (0/3), m2-01 (0/3), m2-02 (0/3), m2-03 (0/3), m2-04 (0/3), m2-05 (0/3), m3-01 (0/3), m3-02 (0/3), m3-03 (1/3), m3-05 (0/3), m3-07 (0/3), m3-08 (0/3), m4-01 (0/3), m4-02 (0/3), m4-03 (0/3), m4-04 (0/3), m4-05 (0/3), m4-07 (0/3).

