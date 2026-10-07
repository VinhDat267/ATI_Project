# Golden v2: services, llm — partial

- Source: `e8b06c96a1ffc6ae64d5a7dbb54aa32040096890`; labels `795229e24c64a38902e7efdce0680c729f37348a`, SHA-256 `6281f0869a6ca781a1ceb4650578a3cc095397ef28a87339029f0819b0fe9372`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: unverified.
- 44 selected cases × 3 requested runs; 2/132 attempted; complete: false.
- Clock: 2026-09-29T10:00:00+07:00, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only requests are labelled as immediate clarification with no searches under the 05/10 product policy.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 0.0% | ≥85% |
| Arguments among correct tools | n/a | ≥75% |
| Strict pass | 0.0% | — |
| Response kind | 0.0% | — |
| Latency p50 / p95 / max | 4544 / 4588 / 4588 ms | <15000 ms |

Model calls: 2; transport attempts: 2; timeouts: 0.
Attempts per call (0 means provider does not expose diagnostics): {"1":2}. Retry reasons: {}.
Time share: model 99.4%, directory 0.0%, search rounds 0.0%, other 0.6%.
Under 15 seconds: 2/2 (100.0%).
Per-call timing includes retry backoff; attempts measure each actual transport attempt, including reading the response body. Missing token counts are null, never fabricated. Reasoning may be included in prompt_tokens by the gateway; do not add it to prompt/completion totals.

Service metrics score only that service's preregistered tool/argument labels within each workflow. Immediate read-only clarification has no tool/argument denominator. Clarification/refusal contribute to kind/strict scores. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|
| sheets | 2 | 1 | 0 | 0.0% | n/a | 4544 / 4588 |

Cases not passing every requested run: sh01 (0/1), sh02 (0/1).


STOPPED: Evaluation stopped after provider failure. Unstarted current-run cases: sh03, sh04, sh05, sh06, sh07, sh08, ca01, ca02, ca03, ca04, ca05, ca06, ca07, ca08, no01, no02, no03, no04, no05, no06, no07, no08, tg01, tg02, tg03, tg04, tg05, tg06, tg07, tg08, ji01, ji02, ji03, ji04, ji05, ji06, ji07, ji08, wf01, wf02, wf03, wf04. Later requested runs were not started.
