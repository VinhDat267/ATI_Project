# Golden v2: core, llm — provider observed

- Source: `31166cb4e39095a4780ad0da9fb9ac43fd462939`; labels `1ab7f08d88546419048e0466f3214bb018c26592`, SHA-256 `7edeac39d6531cdc8bcc4340b1e64f02684eff61ea3bd1f39ab2f5b5ad00aa5a`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 50 selected cases × 1 requested runs; 50/50 attempted; complete: true.
- Started 2026-10-18T06:11:05.760Z; checkpoint/end 2026-10-18T06:14:33.475Z (UTC).
- Clock: 2026-09-29T03:00:00Z, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only: clarification, exactly one model call, zero model-opened search rounds (phase search). Platform directory listing (phase prefetch) is allowed under the owner clarification of 08/10.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 100.0% | ≥85% |
| Arguments among correct tools | 100.0% | ≥75% |
| Strict pass | 100.0% | — |
| Response kind | 100.0% | — |
| Latency p50 / p95 / max | 6833 / 17369 / 22943 ms | <15000 ms |

Model calls: 59; transport attempts: 59; timeouts: 0.
Model-opened search rounds (phase search): 9; platform directory calls (phase prefetch): 289. searches excludes directory traces; prefetches records them separately. One search round can contain several parallel tool calls. Regex gather is not a model-opened search round.
Attempts per call (0 means provider does not expose diagnostics): {"1":59}. Retry reasons: {}.
Time share: model 99.9%, directory 0.0%, search rounds 0.0%, regex gather 0.0%, other 0.1%.
Under 15 seconds: 46/50 (92.0%).

Read answers: on; catalog 33 tools (trello, slack, github, sheets, calendar, notion, telegram, jira), SHA-256 `8e14ff40f2dd15760798b2050e46af93edd6d4cfc9682957dcdd55ed8b33f0ce`.
Answers: 0; p50 / p95 / max 0 / 0 / 0 ms; model calls per answer mean n/a, max 0, {}; answers without a model-opened lookup (directory only): 0.
Plans: 35; p50 / p95 / max 6833 / 11163 / 16092 ms. Answers are not held to the 15-second planning target.
Action cases (every category except read_only and answer) that got an answer: none.

Per-call timing includes retry backoff; attempts measure each actual transport attempt, including reading the response body. Missing token counts are null, never fabricated. Reasoning may be included in prompt_tokens by the gateway; do not add it to prompt/completion totals.

Service metrics score only that service's preregistered tool/argument labels within each workflow. Immediate read-only clarification has no tool/argument denominator. Clarification/refusal contribute to kind/strict scores. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|


Cases not passing every requested run: none.

Unchanged-label comparison: 49/49 cases, strict 100.0% versus 100% in one historical run. rf06 is excluded and reported separately. One historical run versus three current runs; expanded fixture/catalog context differs; no statistical parity claim.

