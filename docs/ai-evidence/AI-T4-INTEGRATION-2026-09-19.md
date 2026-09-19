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
- `npm run test:integration -w @wap/engine -- --reporter=verbose --no-file-parallelism`:
  PASS — 8 files, 93/93. This is the complete engine integration suite; it was
  run serially so the PostgreSQL fixtures do not compete for resources.
- `npm run test:integration -w @wap/api`: PASS — 20 files, 34/34.
- `npm run test:browser -w @wap/web`: PASS — 29/29 fixture browser tests.
- `npm run test:live -w @wap/web -- --workers=1`: PASS — 10/10 live browser
  tests in a standalone run; the NFR-03 latency sample set passed.
- `npm run build -w @wap/web -- --mode live` plus the bundle oracle: PASS —
  175,425 gzip bytes of JavaScript, 6,418 gzip bytes of CSS, no synthetic
  fixture leak, and both budgets satisfied.
- `npm run check:web`: the aggregate runner has a sequence-only flake in the
  live gate on this host (fixture gate passes, while an immediate live run can
  lose the dev-fixture/API response); the same live suite passes standalone as
  recorded above. No database, temp-root, or process leak was observed, and
  this does not touch the T4 backend verdict.
- `git diff --check`: PASS for the final candidate changes.
- GitNexus review: PASS on the indexed `ATI_Project` repository at `210139d`
  (23,257 symbols, 51,931 edges, PDG enabled). `detect-changes` reports 15
  files/102 symbols and 38 affected flows for the T4 follow-up range. The
  retrieval session boundary is intentionally reported as a lower-bound/high-
  risk dispatch boundary; direct planner/replan callers and tests were
  inspected, with no actionable correctness or security finding.

## Explicit limitations

- No real OpenAI/Gemini request, provider key, native MCP child transport, or
  paid call was used. Runtime composition defaults to `AI_LIVE_NOT_READY`.
- The WEB-03 aggregate runner remains a separate harness-flakiness follow-up;
  standalone fixture/live commands and the live bundle oracle are green.
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
