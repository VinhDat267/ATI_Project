# Golden v2: answers, llm — provider observed

- Source: `31166cb4e39095a4780ad0da9fb9ac43fd462939`; labels `a9d7a5bdf956cde39f2d240e5d5694400f8a5c87`, SHA-256 `8e2627727bc3326c31aafcd964a004318c3721f38044ba77af17842dc4085950`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 10 selected cases × 3 requested runs; 30/30 attempted; complete: true.
- Started 2026-10-18T06:05:38.950Z; checkpoint/end 2026-10-18T06:09:18.416Z (UTC).
- Clock: 2026-09-29T10:00:00+07:00, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only: clarification, exactly one model call, zero model-opened search rounds (phase search). Platform directory listing (phase prefetch) is allowed under the owner clarification of 08/10.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 100.0% | ≥85% |
| Arguments among correct tools | 90.0% | ≥75% |
| Strict pass | 90.0% | — |
| Response kind | 100.0% | — |
| Latency p50 / p95 / max | 13250 / 20702 / 30806 ms | <15000 ms |

Model calls: 69; transport attempts: 69; timeouts: 0.
Model-opened search rounds (phase search): 39; platform directory calls (phase prefetch): 45. searches excludes directory traces; prefetches records them separately. One search round can contain several parallel tool calls. Regex gather is not a model-opened search round.
Attempts per call (0 means provider does not expose diagnostics): {"1":69}. Retry reasons: {}.
Time share: model 99.9%, directory 0.0%, search rounds 0.0%, regex gather 0.0%, other 0.1%.
Under 15 seconds: 23/30 (76.7%).

Read answers: on; catalog 43 tools (trello, slack, github, sheets, calendar, notion, telegram, jira, gmail), SHA-256 `db91cca1c5774ac7393a67cbd8f002401c220061fd097867b4d79545b0b5578f`.
Answers: 30; p50 / p95 / max 13250 / 20702 / 30806 ms; model calls per answer mean 2.30, max 3, {"2":21,"3":9}; answers without a model-opened lookup (directory only): 0.
Plans: 0; p50 / p95 / max 0 / 0 / 0 ms. Answers are not held to the 15-second planning target.
Action cases (every category except read_only and answer) that got an answer: none.
Prompt characters per model call in Gmail cases: p50 / p95 / max 16889 / 22416 / 22418 over 33 calls (system prompt, working memory and history, as sent).

Per-call timing includes retry backoff; attempts measure each actual transport attempt, including reading the response body. Missing token counts are null, never fabricated. Reasoning may be included in prompt_tokens by the gateway; do not add it to prompt/completion totals.

Service metrics score only that service's preregistered tool/argument labels within each workflow. Immediate read-only clarification has no tool/argument denominator. Clarification/refusal contribute to kind/strict scores. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|
| sheets | 2 | 6 | 6 | 100.0% | 100.0% | 11943 / 15249 |
| calendar | 1 | 3 | 3 | 100.0% | 0.0% | 13158 / 16840 |
| notion | 1 | 3 | 3 | 100.0% | 100.0% | 10337 / 11234 |
| telegram | 1 | 3 | 3 | 100.0% | 100.0% | 10554 / 13947 |
| jira | 1 | 3 | 3 | 100.0% | 100.0% | 13159 / 30806 |
| gmail | 4 | 12 | 12 | 100.0% | 100.0% | 14765 / 20702 |

Cases not passing every requested run: an_ca01 (0/3).

