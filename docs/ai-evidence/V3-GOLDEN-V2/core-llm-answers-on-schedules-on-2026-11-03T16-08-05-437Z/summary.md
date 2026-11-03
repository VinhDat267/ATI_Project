# Golden v2: core, llm — provider observed

- Source: `80621466706541559b4b2dec2878c5fa8c050bd3`; labels `1ab7f08d88546419048e0466f3214bb018c26592`, SHA-256 `7edeac39d6531cdc8bcc4340b1e64f02684eff61ea3bd1f39ab2f5b5ad00aa5a`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 50 selected cases × 1 requested runs; 50/50 attempted; complete: true.
- Started 2026-11-03T16:08:05.437Z; checkpoint/end 2026-11-03T16:18:17.503Z (UTC).
- Clock: 2026-09-29T03:00:00Z, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only: clarification, exactly one model call, zero model-opened search rounds (phase search). Platform directory listing (phase prefetch) is allowed under the owner clarification of 08/10.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 85.7% | ≥85% |
| Arguments among correct tools | 100.0% | ≥75% |
| Strict pass | 88.0% | — |
| Response kind | 88.0% | — |
| Latency p50 / p95 / max | 10776 / 60015 / 84742 ms | <15000 ms |

Model calls: 57; transport attempts: 73; timeouts: 22.
Cases scored as failed because the model call missed the production deadline after its retries: ss09 (run 1), ms03 (run 1), ms08 (run 1), cs06 (run 1), cs12 (run 1), cl06 (run 1). Any other provider failure, or 3 such timeouts in a row, stops the campaign.
Model-opened search rounds (phase search): 7; platform directory calls (phase prefetch): 289. searches excludes directory traces; prefetches records them separately. One search round can contain several parallel tool calls. Regex gather is not a model-opened search round.
Attempts per call (0 means provider does not expose diagnostics): {"1":41,"2":16}. Retry reasons: {"timeout":16}.
Time share: model 100.0%, directory 0.0%, search rounds 0.0%, regex gather 0.0%, other 0.0%.
Under 15 seconds: 31/50 (62.0%).

Read answers: on; schedules: on; catalog 33 tools (trello, slack, github, sheets, calendar, notion, telegram, jira), SHA-256 `81931aec7ab39ffdb50f64e9b33978b1dadcd5cc96c3b4d820ec5806477667a0`.
Answers: 0; p50 / p95 / max 0 / 0 / 0 ms; model calls per answer mean n/a, max 0, {}; answers without a model-opened lookup (directory only): 0.
Plans: 30; p50 / p95 / max 10723 / 42033 / 43013 ms. Answers are not held to the 15-second planning target.
Schedules: 0; p50 / p95 / max 0 / 0 / 0 ms.
Action cases (every category except read_only and answer) that got an answer: none.
Non-schedule cases that got a schedule: none.

Per-call timing includes retry backoff; attempts measure each actual transport attempt, including reading the response body. Missing token counts are null, never fabricated. Reasoning may be included in prompt_tokens by the gateway; do not add it to prompt/completion totals.

Service metrics score only that service's preregistered tool/argument labels within each workflow. Immediate read-only clarification has no tool/argument denominator. Clarification/refusal contribute to kind/strict scores. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|


Cases not passing every requested run: ss09 (0/1), ms03 (0/1), ms08 (0/1), cs06 (0/1), cs12 (0/1), cl06 (0/1).

Unchanged-label comparison: 49/49 cases, strict 87.8% versus 100% in one historical run. rf06 is excluded and reported separately. One historical run versus three current runs; expanded fixture/catalog context differs; no statistical parity claim.

