# Golden v2: myjira, llm — provider observed

- Source: `105cdb7be098f5021f3051598c5759bf873ac392`; labels `105cdb7be098f5021f3051598c5759bf873ac392`, SHA-256 `e0042dfb5cb859e7b88c8709b6dbff2beabd477466c795384b124c45a1f9da66`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 24 selected cases × 3 requested runs; 72/72 attempted; complete: true.
- Started 2026-11-03T11:10:47.697Z; checkpoint/end 2026-11-03T11:52:52.588Z (UTC).
- Clock: 2026-11-02T10:00:00+07:00, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only: clarification, exactly one model call, zero model-opened search rounds (phase search). Platform directory listing (phase prefetch) is allowed under the owner clarification of 08/10.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 100.0% | ≥85% |
| Arguments among correct tools | 100.0% | ≥75% |
| Strict pass | 98.6% | — |
| Response kind | 98.6% | — |
| Latency p50 / p95 / max | 39811 / 71516 / 102595 ms | <15000 ms |

Model calls: 110; transport attempts: 157; timeouts: 48.
Cases scored as failed because the model call missed the production deadline after its retries: mj17 (run 2). Any other provider failure, or 3 such timeouts in a row, stops the campaign.
Model-opened search rounds (phase search): 32; platform directory calls (phase prefetch): 267. searches excludes directory traces; prefetches records them separately. One search round can contain several parallel tool calls. Regex gather is not a model-opened search round.
Attempts per call (0 means provider does not expose diagnostics): {"1":63,"2":47}. Retry reasons: {"timeout":47}.
Time share: model 100.0%, directory 0.0%, search rounds 0.0%, regex gather 0.0%, other 0.0%.
Under 15 seconds: 22/72 (30.6%).

Read answers: off; catalog 34 tools (trello, slack, github, sheets, calendar, notion, telegram, myjira), SHA-256 `814527927b6d7882c3cdbd69f19521d9eb55aac8d7bca6731cb35dc8529478fa`.
Answers: 0; p50 / p95 / max 0 / 0 / 0 ms; model calls per answer mean n/a, max 0, {}; answers without a model-opened lookup (directory only): 0.
Plans: 39; p50 / p95 / max 40575 / 51415 / 51529 ms. Answers are not held to the 15-second planning target.
Action cases (every category except read_only and answer) that got an answer: none.

Per-call timing includes retry backoff; attempts measure each actual transport attempt, including reading the response body. Missing token counts are null, never fabricated. Reasoning may be included in prompt_tokens by the gateway; do not add it to prompt/completion totals.

Service metrics score only that service's preregistered tool/argument labels within each workflow. Immediate read-only clarification has no tool/argument denominator. Clarification/refusal contribute to kind/strict scores. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|
| myjira | 24 | 39 | 39 | 100.0% | 100.0% | 39811 / 71516 |
| slack | 3 | 9 | 9 | 100.0% | 100.0% | 42378 / 49069 |
| trello | 1 | 3 | 3 | 100.0% | 100.0% | 12642 / 40575 |

Cases not passing every requested run: mj17 (2/3).

