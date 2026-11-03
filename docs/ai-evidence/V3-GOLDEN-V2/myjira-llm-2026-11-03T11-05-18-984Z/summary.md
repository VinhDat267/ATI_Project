# Golden v2: myjira, llm — partial

- Source: `105cdb7be098f5021f3051598c5759bf873ac392`; labels `105cdb7be098f5021f3051598c5759bf873ac392`, SHA-256 `e0042dfb5cb859e7b88c8709b6dbff2beabd477466c795384b124c45a1f9da66`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 24 selected cases × 3 requested runs; 21/72 attempted; complete: false.
- Started 2026-11-03T11:05:18.984Z; checkpoint/end 2026-11-03T11:10:02.727Z (UTC).
- Clock: 2026-11-02T10:00:00+07:00, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only: clarification, exactly one model call, zero model-opened search rounds (phase search). Platform directory listing (phase prefetch) is allowed under the owner clarification of 08/10.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 83.3% | ≥85% |
| Arguments among correct tools | 100.0% | ≥75% |
| Strict pass | 81.0% | — |
| Response kind | 81.0% | — |
| Latency p50 / p95 / max | 23364 / 60013 / 60051 ms | <15000 ms |

Model calls: 27; transport attempts: 36; timeouts: 11.
Cases scored as failed because the model call missed the production deadline after its retries: mj02 (run 1), mj11 (run 1). Any other provider failure, or 3 such timeouts in a row, stops the campaign.
Model-opened search rounds (phase search): 6; platform directory calls (phase prefetch): 78. searches excludes directory traces; prefetches records them separately. One search round can contain several parallel tool calls. Regex gather is not a model-opened search round.
Attempts per call (0 means provider does not expose diagnostics): {"1":18,"2":9}. Retry reasons: {"timeout":9}.
Time share: model 99.9%, directory 0.0%, search rounds 0.0%, regex gather 0.0%, other 0.1%.
Under 15 seconds: 9/21 (42.9%).

Read answers: off; catalog 34 tools (trello, slack, github, sheets, calendar, notion, telegram, myjira), SHA-256 `814527927b6d7882c3cdbd69f19521d9eb55aac8d7bca6731cb35dc8529478fa`.
Answers: 0; p50 / p95 / max 0 / 0 / 0 ms; model calls per answer mean n/a, max 0, {}; answers without a model-opened lookup (directory only): 0.
Plans: 10; p50 / p95 / max 10815 / 47274 / 47274 ms. Answers are not held to the 15-second planning target.
Action cases (every category except read_only and answer) that got an answer: none.

Per-call timing includes retry backoff; attempts measure each actual transport attempt, including reading the response body. Missing token counts are null, never fabricated. Reasoning may be included in prompt_tokens by the gateway; do not add it to prompt/completion totals.

Service metrics score only that service's preregistered tool/argument labels within each workflow. Immediate read-only clarification has no tool/argument denominator. Clarification/refusal contribute to kind/strict scores. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|
| myjira | 21 | 12 | 10 | 83.3% | 100.0% | 23364 / 60013 |
| slack | 1 | 1 | 1 | 100.0% | 100.0% | 13332 / 13332 |
| trello | 1 | 1 | 1 | 100.0% | 100.0% | 8164 / 8164 |

Cases not passing every requested run: mj01 (1/1), mj02 (0/1), mj03 (1/1), mj04 (1/1), mj05 (1/1), mj06 (1/1), mj07 (1/1), mj08 (1/1), mj09 (1/1), mj10 (1/1), mj11 (0/1), mj12 (1/1), mj13 (1/1), mj14 (1/1), mj15 (1/1), mj16 (1/1), mj17 (1/1), mj18 (1/1), mj19 (0/1), mj20 (1/1), mi01 (0/1).


STOPPED: Request failed (details omitted from public evidence). Unstarted current-run cases: mi02, mi03, mi04. Later requested runs were not started.
