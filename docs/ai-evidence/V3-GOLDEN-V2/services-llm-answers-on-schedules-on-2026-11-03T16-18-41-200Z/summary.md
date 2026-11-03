# Golden v2: services, llm — provider observed

- Source: `80621466706541559b4b2dec2878c5fa8c050bd3`; labels `795229e24c64a38902e7efdce0680c729f37348a`, SHA-256 `6281f0869a6ca781a1ceb4650578a3cc095397ef28a87339029f0819b0fe9372`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 44 selected cases × 1 requested runs; 44/44 attempted; complete: true.
- Started 2026-11-03T16:18:41.200Z; checkpoint/end 2026-11-03T16:28:31.352Z (UTC).
- Clock: 2026-09-29T10:00:00+07:00, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only: clarification, exactly one model call, zero model-opened search rounds (phase search). Platform directory listing (phase prefetch) is allowed under the owner clarification of 08/10.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 89.3% | ≥85% |
| Arguments among correct tools | 100.0% | ≥75% |
| Strict pass | 77.3% | — |
| Response kind | 77.3% | — |
| Latency p50 / p95 / max | 13881 / 60009 / 63450 ms | <15000 ms |

Model calls: 48; transport attempts: 66; timeouts: 24.
Cases scored as failed because the model call missed the production deadline after its retries: sh03 (run 1), sh07 (run 1), ca04 (run 1), no03 (run 1), no07 (run 1), ji01 (run 1). Any other provider failure, or 3 such timeouts in a row, stops the campaign.
Model-opened search rounds (phase search): 4; platform directory calls (phase prefetch): 140. searches excludes directory traces; prefetches records them separately. One search round can contain several parallel tool calls. Regex gather is not a model-opened search round.
Attempts per call (0 means provider does not expose diagnostics): {"1":30,"2":18}. Retry reasons: {"timeout":18}.
Time share: model 100.0%, directory 0.0%, search rounds 0.0%, regex gather 0.0%, other 0.0%.
Under 15 seconds: 23/44 (52.3%).

Read answers: on; schedules: on; catalog 33 tools (trello, slack, github, sheets, calendar, notion, telegram, jira), SHA-256 `81931aec7ab39ffdb50f64e9b33978b1dadcd5cc96c3b4d820ec5806477667a0`.
Answers: 4; p50 / p95 / max 20250 / 63450 / 63450 ms; model calls per answer mean 2.00, max 2, {"2":4}; answers without a model-opened lookup (directory only): 0.
Plans: 25; p50 / p95 / max 9568 / 48009 / 56919 ms. Answers are not held to the 15-second planning target.
Schedules: 0; p50 / p95 / max 0 / 0 / 0 ms.
Action cases (every category except read_only and answer) that got an answer: none.
Non-schedule cases that got a schedule: none.

Per-call timing includes retry backoff; attempts measure each actual transport attempt, including reading the response body. Missing token counts are null, never fabricated. Reasoning may be included in prompt_tokens by the gateway; do not add it to prompt/completion totals.

Service metrics score only that service's preregistered tool/argument labels within each workflow. Immediate read-only clarification has no tool/argument denominator. Clarification/refusal contribute to kind/strict scores. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|
| sheets | 10 | 6 | 5 | 83.3% | 100.0% | 14598 / 60050 |
| jira | 12 | 9 | 8 | 88.9% | 100.0% | 15760 / 60050 |
| calendar | 10 | 7 | 7 | 100.0% | 100.0% | 20250 / 60009 |
| slack | 2 | 2 | 2 | 100.0% | 100.0% | 42682 / 56919 |
| notion | 11 | 8 | 6 | 75.0% | 100.0% | 15760 / 60006 |
| telegram | 12 | 9 | 8 | 88.9% | 100.0% | 17841 / 63450 |
| github | 2 | 2 | 2 | 100.0% | 100.0% | 15760 / 40010 |
| trello | 3 | 3 | 3 | 100.0% | 100.0% | 17841 / 56919 |

Cases not passing every requested run: sh01 (0/1), sh03 (0/1), sh07 (0/1), ca01 (0/1), ca04 (0/1), no01 (0/1), no03 (0/1), no07 (0/1), tg01 (0/1), ji01 (0/1).

