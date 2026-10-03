# Golden v2: freeform, llm — provider observed

- Source: `7ba60efa8a7bc90dc42a309076e846d5af5a1cad`; labels `695ad8758d9d658bd3606d15d679845dce30f7e4`, SHA-256 `79812f905a3d51752d7f245f3f258b6f2f2673b42a9ecadf2404d706293f0f80`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash.
- 18 selected cases × 3 requested runs; 54/54 attempted; complete: true.
- Clock: 2026-09-29T03:00:00Z, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only protocol has no answer response kind: clarification is labelled, and successful read calls are scored separately.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 92.3% | ≥85% |
| Arguments among correct tools | 100.0% | ≥75% |
| Strict pass | 94.4% | — |
| Response kind | 94.4% | — |
| Latency p50 / p95 / max | 5942 / 13092 / 18425 ms | <15000 ms |

Service metrics score only that service's preregistered tool/argument labels within each workflow. Read cases use successful observed gather calls. Clarification/refusal contribute to kind/strict scores, not tool denominators. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|


Cases not passing every requested run: ff15 (0/3).

Unchanged-label comparison: 18/18 cases, strict 94.4% versus 100% in one historical run. rf06 is excluded and reported separately. One historical run versus three current runs; expanded fixture/catalog context differs; no statistical parity claim.

