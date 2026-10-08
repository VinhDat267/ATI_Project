# Golden v2: services, llm — provider observed

- Source: `50761b16ff3f87d7160b533cbc77e387eea3e972`; labels `795229e24c64a38902e7efdce0680c729f37348a`, SHA-256 `6281f0869a6ca781a1ceb4650578a3cc095397ef28a87339029f0819b0fe9372`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 44 selected cases × 1 requested runs; 44/44 attempted; complete: true.
- Clock: 2026-09-29T10:00:00+07:00, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only requests are labelled as immediate clarification with no searches under the 05/10 product policy.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 100.0% | ≥85% |
| Arguments among correct tools | 100.0% | ≥75% |
| Strict pass | 97.7% | — |
| Response kind | 97.7% | — |
| Latency p50 / p95 / max | 13312 / 29845 / 47490 ms | <15000 ms |

Model calls: 75; transport attempts: 76; timeouts: 1.
Attempts per call (0 means provider does not expose diagnostics): {"1":74,"2":1}. Retry reasons: {"timeout":1}.
Time share: model 100.0%, directory 0.0%, search rounds 0.0%, other 0.0%.
Under 15 seconds: 29/44 (65.9%).
Per-call timing includes retry backoff; attempts measure each actual transport attempt, including reading the response body. Missing token counts are null, never fabricated. Reasoning may be included in prompt_tokens by the gateway; do not add it to prompt/completion totals.

Service metrics score only that service's preregistered tool/argument labels within each workflow. Immediate read-only clarification has no tool/argument denominator. Clarification/refusal contribute to kind/strict scores. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|
| sheets | 10 | 6 | 6 | 100.0% | 100.0% | 13867 / 31228 |
| jira | 12 | 9 | 9 | 100.0% | 100.0% | 17974 / 31228 |
| calendar | 10 | 7 | 7 | 100.0% | 100.0% | 16991 / 47490 |
| slack | 2 | 2 | 2 | 100.0% | 100.0% | 28693 / 47490 |
| notion | 11 | 8 | 8 | 100.0% | 100.0% | 13641 / 31228 |
| telegram | 12 | 9 | 9 | 100.0% | 100.0% | 9365 / 31228 |
| github | 2 | 2 | 2 | 100.0% | 100.0% | 17974 / 20272 |
| trello | 3 | 3 | 3 | 100.0% | 100.0% | 22111 / 28693 |

Cases not passing every requested run: ca04 (0/1).
