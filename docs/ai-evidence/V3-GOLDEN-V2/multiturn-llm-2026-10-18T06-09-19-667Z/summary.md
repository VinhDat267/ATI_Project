# Golden v2: multiturn, llm — provider observed

- Source: `31166cb4e39095a4780ad0da9fb9ac43fd462939`; labels `c864f55a8f87eb86903671c24c67c764ec89d68e`, SHA-256 `5733d15b8f61af4a0df54938c325a0cc73339a7227e70df42c6a777d5e2bd492`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 12 selected cases × 3 requested runs; 36/36 attempted; complete: true.
- Started 2026-10-18T06:09:19.667Z; checkpoint/end 2026-10-18T06:11:05.046Z (UTC).
- Clock: 2026-09-29T10:00:00+07:00, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only: clarification, exactly one model call, zero model-opened search rounds (phase search). Platform directory listing (phase prefetch) is allowed under the owner clarification of 08/10.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 100.0% | ≥85% |
| Arguments among correct tools | 100.0% | ≥75% |
| Strict pass | 100.0% | — |
| Response kind | 100.0% | — |
| Latency p50 / p95 / max | 5465 / 7271 / 7468 ms | <15000 ms |

Model calls: 36; transport attempts: 36; timeouts: 0.
Model-opened search rounds (phase search): 0; platform directory calls (phase prefetch): 216. searches excludes directory traces; prefetches records them separately. One search round can contain several parallel tool calls. Regex gather is not a model-opened search round.
Attempts per call (0 means provider does not expose diagnostics): {"1":36}. Retry reasons: {}.
Time share: model 99.8%, directory 0.0%, search rounds 0.0%, regex gather 0.0%, other 0.1%.
Under 15 seconds: 36/36 (100.0%).

Read answers: off; catalog 33 tools (trello, slack, github, sheets, calendar, notion, telegram, jira), SHA-256 `8e14ff40f2dd15760798b2050e46af93edd6d4cfc9682957dcdd55ed8b33f0ce`.
Answers: 0; p50 / p95 / max 0 / 0 / 0 ms; model calls per answer mean n/a, max 0, {}; answers without a model-opened lookup (directory only): 0.
Plans: 36; p50 / p95 / max 5465 / 7271 / 7468 ms. Answers are not held to the 15-second planning target.
Action cases (every category except read_only and answer) that got an answer: none.

Per-call timing includes retry backoff; attempts measure each actual transport attempt, including reading the response body. Missing token counts are null, never fabricated. Reasoning may be included in prompt_tokens by the gateway; do not add it to prompt/completion totals.

Service metrics score only that service's preregistered tool/argument labels within each workflow. Immediate read-only clarification has no tool/argument denominator. Clarification/refusal contribute to kind/strict scores. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|
| trello | 9 | 27 | 27 | 100.0% | 100.0% | 5578 / 7271 |
| slack | 5 | 15 | 15 | 100.0% | 100.0% | 5631 / 7271 |
| github | 4 | 12 | 12 | 100.0% | 100.0% | 5631 / 7468 |

Cases not passing every requested run: none.

