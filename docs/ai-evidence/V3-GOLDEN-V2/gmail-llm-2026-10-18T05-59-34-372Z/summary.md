# Golden v2: gmail, llm — provider observed

- Source: `31166cb4e39095a4780ad0da9fb9ac43fd462939`; labels `a9d7a5bdf956cde39f2d240e5d5694400f8a5c87`, SHA-256 `8525c0bd1cb1a72ea7ba6ed25bdd1ddc7be406c9e40397ccddafb0fa1f7541eb`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 20 selected cases × 3 requested runs; 60/60 attempted; complete: true.
- Started 2026-10-18T05:59:34.372Z; checkpoint/end 2026-10-18T06:05:38.085Z (UTC).
- Clock: 2026-10-15T10:00:00+07:00, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only: clarification, exactly one model call, zero model-opened search rounds (phase search). Platform directory listing (phase prefetch) is allowed under the owner clarification of 08/10.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 100.0% | ≥85% |
| Arguments among correct tools | 98.1% | ≥75% |
| Strict pass | 98.3% | — |
| Response kind | 100.0% | — |
| Latency p50 / p95 / max | 10850 / 20168 / 29435 ms | <15000 ms |

Model calls: 104; transport attempts: 104; timeouts: 0.
Model-opened search rounds (phase search): 44; platform directory calls (phase prefetch): 72. searches excludes directory traces; prefetches records them separately. One search round can contain several parallel tool calls. Regex gather is not a model-opened search round.
Attempts per call (0 means provider does not expose diagnostics): {"1":104}. Retry reasons: {}.
Time share: model 99.9%, directory 0.0%, search rounds 0.0%, regex gather 0.0%, other 0.0%.
Under 15 seconds: 51/60 (85.0%).

Read answers: off; catalog 43 tools (trello, slack, github, sheets, calendar, notion, telegram, jira, gmail), SHA-256 `db91cca1c5774ac7393a67cbd8f002401c220061fd097867b4d79545b0b5578f`.
Answers: 0; p50 / p95 / max 0 / 0 / 0 ms; model calls per answer mean n/a, max 0, {}; answers without a model-opened lookup (directory only): 0.
Plans: 54; p50 / p95 / max 10850 / 18137 / 20250 ms. Answers are not held to the 15-second planning target.
Action cases (every category except read_only and answer) that got an answer: none.
Prompt characters per model call in Gmail cases: p50 / p95 / max 17120 / 19869 / 22633 over 104 calls (system prompt, working memory and history, as sent).

Per-call timing includes retry backoff; attempts measure each actual transport attempt, including reading the response body. Missing token counts are null, never fabricated. Reasoning may be included in prompt_tokens by the gateway; do not add it to prompt/completion totals.

Service metrics score only that service's preregistered tool/argument labels within each workflow. Immediate read-only clarification has no tool/argument denominator. Clarification/refusal contribute to kind/strict scores. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|
| gmail | 20 | 54 | 54 | 100.0% | 98.1% | 10850 / 20168 |
| jira | 1 | 3 | 3 | 100.0% | 100.0% | 9217 / 12807 |
| slack | 1 | 3 | 3 | 100.0% | 100.0% | 18137 / 20250 |

Cases not passing every requested run: gm04 (2/3).

