# Golden v2: core, llm — partial

- Source: `7898aa72c7b4414d8c8d2861e0a7ae166326ce5c`; labels `1ab7f08d88546419048e0466f3214bb018c26592`, SHA-256 `7edeac39d6531cdc8bcc4340b1e64f02684eff61ea3bd1f39ab2f5b5ad00aa5a`.
- Provider: `openai-compatible`; requested model `ag/gemini-3.8-flash`; served: gemini-3.8-flash-n.
- 50 selected cases × 1 requested runs; 25/50 attempted; complete: false.
- Clock: 2026-09-29T03:00:00Z, Asia/Ho_Chi_Minh. Planning only; search results/memory are synthetic fixtures; no plan executed. Read-only protocol has no answer response kind: clarification is labelled, and successful read calls are scored separately.
- Usable plan rate is unmeasured; product quality gate remains incomplete. Provider transport retains its bounded production retries; campaign never retries after a provider failure.

| Metric | Value | Target |
|---|---|---|
| Tools | 92.0% | ≥85% |
| Arguments among correct tools | 100.0% | ≥75% |
| Strict pass | 92.0% | — |
| Response kind | 92.0% | — |
| Latency p50 / p95 / max | 22452 / 52099 / 60036 ms | <15000 ms |

Service metrics score only that service's preregistered tool/argument labels within each workflow. Read cases use successful observed gather calls. Clarification/refusal contribute to kind/strict scores, not tool denominators. Latency is the entire request involving the service.

| Service | Cases | Tool attempts | Argument attempts | Tools | Arguments | p50 / p95 ms |
|---|---|---|---|---|---|---|


Cases not passing every requested run: cs02 (0/1), cs05 (0/1).

Unchanged-label comparison: 25/49 cases, strict 92.0% versus 100% in one historical run. rf06 is excluded and reported separately. One historical run versus three current runs; expanded fixture/catalog context differs; no statistical parity claim.


STOPPED: LLM gateway request timed out after 30000ms. Unstarted current-run cases: cs06, cs07, cs08, cs09, cs10, cs11, cs12, cs13, cs14, cs15, cl01, cl02, cl03, cl04, cl05, cl06, cl07, cl08, rf01, rf02, rf03, rf04, rf05, rf06, rf07. Later requested runs were not started.


Public control copy: old runner unchanged; full corpus phrases and private values redacted after scoring. No per-call diagnostics exist on the old planner.
