# Golden v2: services, llm — provider observed

- Source: `58d4fcdec284767c35f69e5d5c581046fb12f9ae`; labels `795229e24c64a38902e7efdce0680c729f37348a`, SHA-256 `6281f0869a6ca781a1ceb4650578a3cc095397ef28a87339029f0819b0fe9372`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 44 selected cases × 3 requested runs; 132/132 attempted; complete: true.
- Started 2026-10-08T17:00:53.683Z; checkpoint/end 2026-10-08T17:12:19.263Z (UTC).
- Clock: 2026-09-29T10:00:00+07:00, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only: clarification, exactly one model call, zero model-opened search rounds (phase search). Platform directory listing (phase prefetch) is allowed under the owner clarification of 08/10.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 100.0% | ≥85% |
| Arguments among correct tools | 100.0% | ≥75% |
| Strict pass | 97.7% | — |
| Response kind | 97.7% | — |
| Latency p50 / p95 / max | 8242 / 20138 / 45991 ms | <15000 ms |

Model calls: 135; transport attempts: 137; timeouts: 2.
Model-opened search rounds (phase search): 3; platform directory calls (phase prefetch): 420. searches excludes directory traces; prefetches records them separately. One search round can contain several parallel tool calls. Regex gather is not a model-opened search round.
Attempts per call (0 means provider does not expose diagnostics): {"1":133,"2":2}. Retry reasons: {"timeout":2}.
Time share: model 100.0%, directory 0.0%, search rounds 0.0%, regex gather 0.0%, other 0.0%.
Under 15 seconds: 117/132 (88.6%).
Per-call timing includes retry backoff; attempts measure each actual transport attempt, including reading the response body. Missing token counts are null, never fabricated. Reasoning may be included in prompt_tokens by the gateway; do not add it to prompt/completion totals.

Service metrics score only that service's preregistered tool/argument labels within each workflow. Immediate read-only clarification has no tool/argument denominator. Clarification/refusal contribute to kind/strict scores. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|
| sheets | 10 | 18 | 18 | 100.0% | 100.0% | 10569 / 20322 |
| jira | 12 | 27 | 27 | 100.0% | 100.0% | 10036 / 18308 |
| calendar | 10 | 21 | 21 | 100.0% | 100.0% | 9460 / 22627 |
| slack | 2 | 6 | 6 | 100.0% | 100.0% | 11129 / 19579 |
| notion | 11 | 24 | 24 | 100.0% | 100.0% | 9523 / 20138 |
| telegram | 12 | 27 | 27 | 100.0% | 100.0% | 7085 / 18308 |
| github | 2 | 6 | 6 | 100.0% | 100.0% | 11448 / 13694 |
| trello | 3 | 9 | 9 | 100.0% | 100.0% | 14952 / 45991 |

Cases not passing every requested run: ca04 (0/3).
