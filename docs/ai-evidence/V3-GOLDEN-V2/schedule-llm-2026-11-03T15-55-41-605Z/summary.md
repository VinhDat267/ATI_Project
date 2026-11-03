# Golden v2: schedule, llm — provider observed

- Source: `80621466706541559b4b2dec2878c5fa8c050bd3`; labels `80621466706541559b4b2dec2878c5fa8c050bd3`, SHA-256 `c33ec2ad521d22bd585354228f06d7309c882d6007c536b07608bd3d4ced3d27`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 16 selected cases × 3 requested runs; 48/48 attempted; complete: true.
- Started 2026-11-03T15:55:41.605Z; checkpoint/end 2026-11-03T16:06:10.595Z (UTC).
- Clock: 2026-09-29T10:00:00+07:00, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only: clarification, exactly one model call, zero model-opened search rounds (phase search). Platform directory listing (phase prefetch) is allowed under the owner clarification of 08/10.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 91.7% | ≥85% |
| Arguments among correct tools | 100.0% | ≥75% |
| Strict pass | 93.8% | — |
| Response kind | 93.8% | — |
| Latency p50 / p95 / max | 15928 / 60020 / 60061 ms | <15000 ms |

Model calls: 48; transport attempts: 68; timeouts: 23.
Cases scored as failed because the model call missed the production deadline after its retries: sc_create01 (run 2), sc_plan03 (run 2), sc_clar02 (run 3). Any other provider failure, or 3 such timeouts in a row, stops the campaign.
Model-opened search rounds (phase search): 0; platform directory calls (phase prefetch): 126. searches excludes directory traces; prefetches records them separately. One search round can contain several parallel tool calls. Regex gather is not a model-opened search round.
Attempts per call (0 means provider does not expose diagnostics): {"1":28,"2":20}. Retry reasons: {"timeout":20}.
Time share: model 100.0%, directory 0.0%, search rounds 0.0%, regex gather 0.0%, other 0.0%.
Under 15 seconds: 23/48 (47.9%).

Read answers: off; schedules: on; catalog 33 tools (trello, slack, github, sheets, calendar, notion, telegram, jira), SHA-256 `81931aec7ab39ffdb50f64e9b33978b1dadcd5cc96c3b4d820ec5806477667a0`.
Answers: 0; p50 / p95 / max 0 / 0 / 0 ms; model calls per answer mean n/a, max 0, {}; answers without a model-opened lookup (directory only): 0.
Plans: 11; p50 / p95 / max 8968 / 39923 / 39923 ms. Answers are not held to the 15-second planning target.
Schedules: 26; p50 / p95 / max 16052 / 42191 / 47233 ms.
Action cases (every category except read_only and answer) that got an answer: none.
Non-schedule cases that got a schedule: none.

Per-call timing includes retry backoff; attempts measure each actual transport attempt, including reading the response body. Missing token counts are null, never fabricated. Reasoning may be included in prompt_tokens by the gateway; do not add it to prompt/completion totals.

Service metrics score only that service's preregistered tool/argument labels within each workflow. Immediate read-only clarification has no tool/argument denominator. Clarification/refusal contribute to kind/strict scores. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|
| calendar | 9 | 6 | 6 | 100.0% | 100.0% | 11312 / 44616 |
| slack | 11 | 3 | 3 | 100.0% | 100.0% | 27589 / 60027 |
| trello | 2 | 3 | 2 | 66.7% | 100.0% | 12960 / 60020 |
| sheets | 1 | 0 | 0 | n/a | n/a | 39929 / 40300 |
| jira | 1 | 0 | 0 | n/a | n/a | 12997 / 16052 |
| telegram | 1 | 0 | 0 | n/a | n/a | 12997 / 16052 |
| github | 1 | 0 | 0 | n/a | n/a | 39851 / 47233 |

Cases not passing every requested run: sc_create01 (2/3), sc_plan03 (2/3), sc_clar02 (2/3).

