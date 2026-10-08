# Golden v2: services, llm — provider observed

- Source: `50761b16ff3f87d7160b533cbc77e387eea3e972`; labels `795229e24c64a38902e7efdce0680c729f37348a`, SHA-256 `6281f0869a6ca781a1ceb4650578a3cc095397ef28a87339029f0819b0fe9372`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 44 selected cases × 3 requested runs; 132/132 attempted; complete: true.
- Clock: 2026-09-29T10:00:00+07:00, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only requests are labelled as immediate clarification with no searches under the 05/10 product policy.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 100.0% | ≥85% |
| Arguments among correct tools | 100.0% | ≥75% |
| Strict pass | 97.7% | — |
| Response kind | 97.7% | — |
| Latency p50 / p95 / max | 13090 / 27042 / 58253 ms | <15000 ms |

Model calls: 225; transport attempts: 228; timeouts: 3.
Attempts per call (0 means provider does not expose diagnostics): {"1":222,"2":3}. Retry reasons: {"timeout":3}.
Time share: model 100.0%, directory 0.0%, search rounds 0.0%, other 0.0%.
Under 15 seconds: 79/132 (59.8%).
Per-call timing includes retry backoff; attempts measure each actual transport attempt, including reading the response body. Missing token counts are null, never fabricated. Reasoning may be included in prompt_tokens by the gateway; do not add it to prompt/completion totals.

Service metrics score only that service's preregistered tool/argument labels within each workflow. Immediate read-only clarification has no tool/argument denominator. Clarification/refusal contribute to kind/strict scores. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|
| sheets | 10 | 18 | 18 | 100.0% | 100.0% | 15204 / 27042 |
| jira | 12 | 27 | 27 | 100.0% | 100.0% | 17786 / 58180 |
| calendar | 10 | 21 | 21 | 100.0% | 100.0% | 15045 / 33204 |
| slack | 2 | 6 | 6 | 100.0% | 100.0% | 24138 / 33204 |
| notion | 11 | 24 | 24 | 100.0% | 100.0% | 13028 / 26978 |
| telegram | 12 | 27 | 27 | 100.0% | 100.0% | 11585 / 26978 |
| github | 2 | 6 | 6 | 100.0% | 100.0% | 17963 / 25251 |
| trello | 3 | 9 | 9 | 100.0% | 100.0% | 21690 / 58253 |

Cases not passing every requested run: ca04 (0/3).
