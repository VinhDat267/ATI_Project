# Golden v2: services, llm — provider observed

- Source: `31166cb4e39095a4780ad0da9fb9ac43fd462939`; labels `795229e24c64a38902e7efdce0680c729f37348a`, SHA-256 `6281f0869a6ca781a1ceb4650578a3cc095397ef28a87339029f0819b0fe9372`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 44 selected cases × 1 requested runs; 44/44 attempted; complete: true.
- Started 2026-10-18T06:14:34.733Z; checkpoint/end 2026-10-18T06:18:08.333Z (UTC).
- Clock: 2026-09-29T10:00:00+07:00, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only: clarification, exactly one model call, zero model-opened search rounds (phase search). Platform directory listing (phase prefetch) is allowed under the owner clarification of 08/10.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 100.0% | ≥85% |
| Arguments among correct tools | 100.0% | ≥75% |
| Strict pass | 84.1% | — |
| Response kind | 84.1% | — |
| Latency p50 / p95 / max | 6181 / 25430 / 50593 ms | <15000 ms |

Model calls: 51; transport attempts: 52; timeouts: 1.
Model-opened search rounds (phase search): 7; platform directory calls (phase prefetch): 140. searches excludes directory traces; prefetches records them separately. One search round can contain several parallel tool calls. Regex gather is not a model-opened search round.
Attempts per call (0 means provider does not expose diagnostics): {"1":50,"2":1}. Retry reasons: {"timeout":1}.
Time share: model 99.9%, directory 0.0%, search rounds 0.0%, regex gather 0.0%, other 0.1%.
Under 15 seconds: 40/44 (90.9%).

Read answers: on; catalog 33 tools (trello, slack, github, sheets, calendar, notion, telegram, jira), SHA-256 `8e14ff40f2dd15760798b2050e46af93edd6d4cfc9682957dcdd55ed8b33f0ce`.
Answers: 6; p50 / p95 / max 13553 / 27251 / 27251 ms; model calls per answer mean 2.00, max 2, {"2":6}; answers without a model-opened lookup (directory only): 0.
Plans: 28; p50 / p95 / max 6181 / 14467 / 17657 ms. Answers are not held to the 15-second planning target.
Action cases (every category except read_only and answer) that got an answer: none.

Per-call timing includes retry backoff; attempts measure each actual transport attempt, including reading the response body. Missing token counts are null, never fabricated. Reasoning may be included in prompt_tokens by the gateway; do not add it to prompt/completion totals.

Service metrics score only that service's preregistered tool/argument labels within each workflow. Immediate read-only clarification has no tool/argument denominator. Clarification/refusal contribute to kind/strict scores. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|
| sheets | 10 | 6 | 6 | 100.0% | 100.0% | 6097 / 27251 |
| jira | 12 | 9 | 9 | 100.0% | 100.0% | 8890 / 25430 |
| calendar | 10 | 7 | 7 | 100.0% | 100.0% | 6763 / 50593 |
| slack | 2 | 2 | 2 | 100.0% | 100.0% | 8326 / 14071 |
| notion | 11 | 8 | 8 | 100.0% | 100.0% | 8651 / 17657 |
| telegram | 12 | 9 | 9 | 100.0% | 100.0% | 5409 / 17657 |
| github | 2 | 2 | 2 | 100.0% | 100.0% | 9493 / 14467 |
| trello | 3 | 3 | 3 | 100.0% | 100.0% | 14071 / 17657 |

Cases not passing every requested run: sh01 (0/1), sh07 (0/1), ca01 (0/1), ca04 (0/1), no01 (0/1), tg01 (0/1), ji01 (0/1).

