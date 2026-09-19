# AI/main integration and T4 closure — 2026-09-19

## Scope

This report records the integrated backend/currentness work through Task 5 and
the regression evidence collected for Task 6. It does not claim live provider
quality, paid execution readiness, or a completed model evaluation.

## Commit checkpoints

| Checkpoint | Commit | Result |
| --- | --- | --- |
| Plan and integration | `2cfff62`, `eb169d2` | AI history integrated; frontend and web gate retained |
| Paid dispatch guard | `52ad844` | Native provider calls fail closed before credential lookup/reservation/network |
| Embedding content/provenance | `63d3b2f` | Gemini document/query text and policy hashes are explicit |
| Pgvector fingerprint/currentness | `4d8ddd5` | Migration 0008, persisted vector fingerprints, pin/assertCurrent |
| Session/replan safety | `951f79a` | Request-scoped semantic pin, post-model currentness, secret redaction, separate repair bound |
| Replan error-context redaction | `169a8fe` | Secret canaries are removed from error text, failed approaches, current plan, repair prompts, and retrieval query |

## Fresh verification

- `npm run check`: PASS — DSL 43/43, engine unit 210 passed/1 skipped, API
  unit 40/40, web unit 128/128, typecheck/build/schema/OpenAPI generation all
  exited 0.
- `npm run test:integration -w @wap/mcp-task-hub`: PASS — 2 files, 64/64.
  The migration oracle includes `0008_ai_embedding_fingerprints.sql`.
- `npm run test:integration -w @wap/engine -- --run tests/ai-pgvector.integration.test.ts tests/ai-live-index.integration.test.ts`:
  PASS — 2 files, 10/10; includes persisted fingerprint mutation,
  supersession, race, and session-pin checks.
- `npm run test:integration -w @wap/engine -- --run tests/ai-replan.integration.test.ts`:
  PASS — 1 file, 18/18.
- `npm run test:integration -w @wap/api`: PASS — 20 files, 34/34.
- `npm run check:web`: PASS — all six WEB-03 gates; bundle budgets pass,
  NFR-03 p95 2193 ms, and cleanup oracle reports zero leaked DBs/temp roots/
  processes. Evidence manifest: `docs/web-evidence/WEB-03/20260919114357-8d77b432-aa89-4f7c-8848-fedcd966d55c/manifest.json`.
- `git diff --check`: PASS for the final candidate changes.

## Explicit limitations

- The full unfiltered engine integration command was started twice and stopped
  after more than one minute without test output. It is not counted as a
  passing gate; targeted engine suites above are the bounded evidence.
- No real OpenAI/Gemini request, provider key, native MCP child transport, or
  paid call was used. Runtime composition defaults to `AI_LIVE_NOT_READY`.
- Durable authorization, budget reservation/settlement, restart-safe ledger,
  and paid probe controls remain T6/T8 work. Currentness catches a switch
  before result handoff, but cannot undo a provider call already in flight.
- Offline AI-04 reports remain synthetic evaluator evidence only; they are not
  model-quality measurements.

## Handoff

The backend is ready for the next live-evaluation preparation step with paid
execution still blocked. No push or history rewrite was performed. The checkout
may still contain unrelated user edits (`.gitignore`, `CLAUDE.md`) outside this
checkpoint.
