# Golden v2: services, llm, subset — provider observed

- Source: `5afc0a7f7a0168abb3776400394ea6edcedd2b3a`; labels `795229e24c64a38902e7efdce0680c729f37348a`, SHA-256 `6281f0869a6ca781a1ceb4650578a3cc095397ef28a87339029f0819b0fe9372`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 1 selected cases × 1 requested runs; 1/1 attempted; complete: true.
- Started 2026-10-08T16:40:05.029Z; checkpoint/end 2026-10-08T16:40:21.534Z (UTC).
- Clock: 2026-09-29T10:00:00+07:00, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only: clarification, exactly one model call, zero model-opened search rounds (phase search). Platform directory listing (phase prefetch) is allowed under the owner clarification of 08/10.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | n/a | ≥85% |
| Arguments among correct tools | n/a | ≥75% |
| Strict pass | 0.0% | — |
| Response kind | 0.0% | — |
| Latency p50 / p95 / max | 16500 / 16500 / 16500 ms | <15000 ms |

Model calls: 1; transport attempts: 1; timeouts: 0.
Model-opened search rounds (phase search): 0; platform directory calls (phase prefetch): 1. searches excludes directory traces; prefetches records them separately. One search round can contain several parallel tool calls. Regex gather is not a model-opened search round.
Attempts per call (0 means provider does not expose diagnostics): {"1":1}. Retry reasons: {}.
Time share: model 99.8%, directory 0.0%, search rounds 0.0%, regex gather 0.0%, other 0.2%.
Under 15 seconds: 0/1 (0.0%).
Per-call timing includes retry backoff; attempts measure each actual transport attempt, including reading the response body. Missing token counts are null, never fabricated. Reasoning may be included in prompt_tokens by the gateway; do not add it to prompt/completion totals.

Service metrics score only that service's preregistered tool/argument labels within each workflow. Immediate read-only clarification has no tool/argument denominator. Clarification/refusal contribute to kind/strict scores. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|
| calendar | 1 | 0 | 0 | n/a | n/a | 16500 / 16500 |

Cases not passing every requested run: ca04 (0/1).
