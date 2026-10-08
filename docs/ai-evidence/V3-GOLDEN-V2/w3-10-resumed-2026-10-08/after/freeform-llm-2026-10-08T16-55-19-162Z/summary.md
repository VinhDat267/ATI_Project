# Golden v2: freeform, llm — provider observed

- Source: `58d4fcdec284767c35f69e5d5c581046fb12f9ae`; labels `695ad8758d9d658bd3606d15d679845dce30f7e4`, SHA-256 `79812f905a3d51752d7f245f3f258b6f2f2673b42a9ecadf2404d706293f0f80`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 18 selected cases × 3 requested runs; 54/54 attempted; complete: true.
- Started 2026-10-08T16:55:19.162Z; checkpoint/end 2026-10-08T17:00:52.152Z (UTC).
- Clock: 2026-09-29T03:00:00Z, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only: clarification, exactly one model call, zero model-opened search rounds (phase search). Platform directory listing (phase prefetch) is allowed under the owner clarification of 08/10.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 94.9% | ≥85% |
| Arguments among correct tools | 100.0% | ≥75% |
| Strict pass | 96.3% | — |
| Response kind | 96.3% | — |
| Latency p50 / p95 / max | 10108 / 24738 / 41728 ms | <15000 ms |

Model calls: 63; transport attempts: 64; timeouts: 1.
Model-opened search rounds (phase search): 9; platform directory calls (phase prefetch): 336. searches excludes directory traces; prefetches records them separately. One search round can contain several parallel tool calls. Regex gather is not a model-opened search round.
Attempts per call (0 means provider does not expose diagnostics): {"1":62,"2":1}. Retry reasons: {"timeout":1}.
Time share: model 99.9%, directory 0.0%, search rounds 0.0%, regex gather 0.0%, other 0.0%.
Under 15 seconds: 42/54 (77.8%).
Per-call timing includes retry backoff; attempts measure each actual transport attempt, including reading the response body. Missing token counts are null, never fabricated. Reasoning may be included in prompt_tokens by the gateway; do not add it to prompt/completion totals.

Service metrics score only that service's preregistered tool/argument labels within each workflow. Immediate read-only clarification has no tool/argument denominator. Clarification/refusal contribute to kind/strict scores. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|


Cases not passing every requested run: ff15 (1/3).

Unchanged-label comparison: 18/18 cases, strict 96.3% versus 100% in one historical run. rf06 is excluded and reported separately. One historical run versus three current runs; expanded fixture/catalog context differs; no statistical parity claim.
