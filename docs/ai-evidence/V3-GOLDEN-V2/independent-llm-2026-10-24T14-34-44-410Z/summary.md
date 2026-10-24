# Golden v2: independent, llm — partial

- Source: `2cdaf90a6215ac541bc077d57e4d89a4fcac7fe7`; labels `2cdaf90a6215ac541bc077d57e4d89a4fcac7fe7`, SHA-256 `c4425f512ac037eb82aa24fca8df023c280775e8e487cf0292f5364d879f7959`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 32 selected cases × 3 requested runs; 7/96 attempted; complete: false.
- Started 2026-10-24T14:34:44.410Z; checkpoint/end 2026-10-24T14:35:49.692Z (UTC).
- Clock: 2026-09-29T10:00:00+07:00, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only: clarification, exactly one model call, zero model-opened search rounds (phase search). Platform directory listing (phase prefetch) is allowed under the owner clarification of 08/10.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 83.3% | ≥85% |
| Arguments among correct tools | 100.0% | ≥75% |
| Strict pass | 71.4% | — |
| Response kind | 71.4% | — |
| Latency p50 / p95 / max | 11735 / 60034 / 60034 ms | <15000 ms |

Model calls: 7; transport attempts: 8; timeouts: 2.
Model-opened search rounds (phase search): 0; platform directory calls (phase prefetch): 29. searches excludes directory traces; prefetches records them separately. One search round can contain several parallel tool calls. Regex gather is not a model-opened search round.
Attempts per call (0 means provider does not expose diagnostics): {"1":6,"2":1}. Retry reasons: {"timeout":1}.
Time share: model 99.8%, directory 0.0%, search rounds 0.0%, regex gather 0.0%, other 0.1%.
Under 15 seconds: 5/7 (71.4%).

Read answers: off; catalog 33 tools (trello, slack, github, sheets, calendar, notion, telegram, jira), SHA-256 `8e14ff40f2dd15760798b2050e46af93edd6d4cfc9682957dcdd55ed8b33f0ce`.
Answers: 0; p50 / p95 / max 0 / 0 / 0 ms; model calls per answer mean n/a, max 0, {}; answers without a model-opened lookup (directory only): 0.
Plans: 5; p50 / p95 / max 10145 / 13354 / 13354 ms. Answers are not held to the 15-second planning target.
Action cases (every category except read_only and answer) that got an answer: none.

Per-call timing includes retry backoff; attempts measure each actual transport attempt, including reading the response body. Missing token counts are null, never fabricated. Reasoning may be included in prompt_tokens by the gateway; do not add it to prompt/completion totals.

Service metrics score only that service's preregistered tool/argument labels within each workflow. Immediate read-only clarification has no tool/argument denominator. Clarification/refusal contribute to kind/strict scores. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|
| slack | 2 | 2 | 2 | 100.0% | 100.0% | 5235 / 11735 |
| jira | 1 | 1 | 1 | 100.0% | 100.0% | 13354 / 13354 |
| github | 1 | 1 | 0 | 0.0% | n/a | 60034 / 60034 |
| trello | 3 | 2 | 2 | 100.0% | 100.0% | 10145 / 23736 |
| telegram | 1 | 1 | 1 | 100.0% | 100.0% | 10145 / 10145 |
| calendar | 1 | 1 | 1 | 100.0% | 100.0% | 11735 / 11735 |

Cases not passing every requested run: m1-01 (1/1), m1-02 (1/1), m1-03 (0/1), m1-04 (1/1), m1-05 (1/1), m1-06 (1/1), m1-07 (0/1).


STOPPED: Model request timed out. Unstarted current-run cases: m1-08, m2-01, m2-02, m2-03, m2-04, m2-05, m2-06, m2-07, m2-08, m3-01, m3-02, m3-03, m3-04, m3-05, m3-06, m3-07, m3-08, m4-01, m4-02, m4-03, m4-04, m4-05, m4-06, m4-07, m4-08. Later requested runs were not started.
