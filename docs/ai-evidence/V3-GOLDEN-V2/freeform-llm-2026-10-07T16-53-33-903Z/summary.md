# Golden v2: freeform, llm — provider observed

- Source: `50761b16ff3f87d7160b533cbc77e387eea3e972`; labels `695ad8758d9d658bd3606d15d679845dce30f7e4`, SHA-256 `79812f905a3d51752d7f245f3f258b6f2f2673b42a9ecadf2404d706293f0f80`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 18 selected cases × 3 requested runs; 54/54 attempted; complete: true.
- Clock: 2026-09-29T03:00:00Z, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only requests are labelled as immediate clarification with no searches under the 05/10 product policy.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 94.9% | ≥85% |
| Arguments among correct tools | 100.0% | ≥75% |
| Strict pass | 96.3% | — |
| Response kind | 96.3% | — |
| Latency p50 / p95 / max | 15804 / 26668 / 27503 ms | <15000 ms |

Model calls: 111; transport attempts: 111; timeouts: 0.
Attempts per call (0 means provider does not expose diagnostics): {"1":111}. Retry reasons: {}.
Time share: model 100.0%, directory 0.0%, search rounds 0.0%, other 0.0%.
Under 15 seconds: 21/54 (38.9%).
Per-call timing includes retry backoff; attempts measure each actual transport attempt, including reading the response body. Missing token counts are null, never fabricated. Reasoning may be included in prompt_tokens by the gateway; do not add it to prompt/completion totals.

Service metrics score only that service's preregistered tool/argument labels within each workflow. Immediate read-only clarification has no tool/argument denominator. Clarification/refusal contribute to kind/strict scores. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|


Cases not passing every requested run: ff15 (1/3).

Unchanged-label comparison: 18/18 cases, strict 96.3% versus 100% in one historical run. rf06 is excluded and reported separately. One historical run versus three current runs; expanded fixture/catalog context differs; no statistical parity claim.
