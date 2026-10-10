# Golden v2: core, llm — provider observed

- Source: `50761b16ff3f87d7160b533cbc77e387eea3e972`; labels `1ab7f08d88546419048e0466f3214bb018c26592`, SHA-256 `7edeac39d6531cdc8bcc4340b1e64f02684eff61ea3bd1f39ab2f5b5ad00aa5a`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 50 selected cases × 3 requested runs; 150/150 attempted; complete: true.
- Clock: 2026-09-29T03:00:00Z, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only requests are labelled as immediate clarification with no searches under the 05/10 product policy.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 100.0% | ≥85% |
| Arguments among correct tools | 100.0% | ≥75% |
| Strict pass | 100.0% | — |
| Response kind | 100.0% | — |
| Latency p50 / p95 / max | 15067 / 25285 / 50180 ms | <15000 ms |

Model calls: 258; transport attempts: 261; timeouts: 3.
Attempts per call (0 means provider does not expose diagnostics): {"1":255,"2":3}. Retry reasons: {"timeout":3}.
Time share: model 100.0%, directory 0.0%, search rounds 0.0%, other 0.0%.
Under 15 seconds: 73/150 (48.7%).
Per-call timing includes retry backoff; attempts measure each actual transport attempt, including reading the response body. Missing token counts are null, never fabricated. Reasoning may be included in prompt_tokens by the gateway; do not add it to prompt/completion totals.

Service metrics score only that service's preregistered tool/argument labels within each workflow. Immediate read-only clarification has no tool/argument denominator. Clarification/refusal contribute to kind/strict scores. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|


Cases not passing every requested run: none.

Unchanged-label comparison: 49/49 cases, strict 100.0% versus 100% in one historical run. rf06 is excluded and reported separately. One historical run versus three current runs; expanded fixture/catalog context differs; no statistical parity claim.
