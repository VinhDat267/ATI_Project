# Golden v2: core, llm — provider observed

- Source: `58d4fcdec284767c35f69e5d5c581046fb12f9ae`; labels `1ab7f08d88546419048e0466f3214bb018c26592`, SHA-256 `7edeac39d6531cdc8bcc4340b1e64f02684eff61ea3bd1f39ab2f5b5ad00aa5a`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 50 selected cases × 3 requested runs; 150/150 attempted; complete: true.
- Started 2026-10-08T16:44:42.359Z; checkpoint/end 2026-10-08T16:55:18.245Z (UTC).
- Clock: 2026-09-29T03:00:00Z, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only: clarification, exactly one model call, zero model-opened search rounds (phase search). Platform directory listing (phase prefetch) is allowed under the owner clarification of 08/10.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 100.0% | ≥85% |
| Arguments among correct tools | 100.0% | ≥75% |
| Strict pass | 100.0% | — |
| Response kind | 100.0% | — |
| Latency p50 / p95 / max | 7229 / 18021 / 25085 ms | <15000 ms |

Model calls: 168; transport attempts: 168; timeouts: 0.
Model-opened search rounds (phase search): 18; platform directory calls (phase prefetch): 867. searches excludes directory traces; prefetches records them separately. One search round can contain several parallel tool calls. Regex gather is not a model-opened search round.
Attempts per call (0 means provider does not expose diagnostics): {"1":168}. Retry reasons: {}.
Time share: model 100.0%, directory 0.0%, search rounds 0.0%, regex gather 0.0%, other 0.0%.
Under 15 seconds: 136/150 (90.7%).
Per-call timing includes retry backoff; attempts measure each actual transport attempt, including reading the response body. Missing token counts are null, never fabricated. Reasoning may be included in prompt_tokens by the gateway; do not add it to prompt/completion totals.

Service metrics score only that service's preregistered tool/argument labels within each workflow. Immediate read-only clarification has no tool/argument denominator. Clarification/refusal contribute to kind/strict scores. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|


Cases not passing every requested run: none.

Unchanged-label comparison: 49/49 cases, strict 100.0% versus 100% in one historical run. rf06 is excluded and reported separately. One historical run versus three current runs; expanded fixture/catalog context differs; no statistical parity claim.
