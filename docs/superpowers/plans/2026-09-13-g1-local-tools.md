# G1 local tools implementation plan

> Execute inline against the user-approved B/local design. No Git repository exists; work in the requested folder and preserve existing data.

**Goal:** Run PostgreSQL migrations and three task_hub tools over real MCP stdio with durable local write receipts.

**Spec:** ../specs/2026-09-13-g1-local-tools-design.md and ../../EXECUTION-CONTRACT.md.

**Architecture:** Shared DB package owns migration/seed and schema mapping; local task_hub owns transport and transactional tool behavior. Integration tests act as a synthetic approved controller and verify actual PostgreSQL state.

**Tech stack:** Node >=22, TypeScript, postgres.js 3.4.9, Drizzle 0.45.2, MCP SDK 1.30.0, Zod 4, Vitest, PostgreSQL16/pgvector.

## Task 1 — Database

- [x] Add real DB tests for apply twice, migration checksum drift, pre-plan version constraints and non-destructive seeding.
- [x] Observe failure before implementing packages/db/src/{connection,migrate,schema,seed}.ts and migration 0003.
- [x] Implement runner using pinned connection/advisory lock, checksum ledger and transaction boundaries; test on isolated per-suite database.
- [x] Run db:up:g1, db:migrate:g1, db:seed:g1 on the dedicated local service and retain evidence.

## Task 2 — MCP receiver

- [x] Add tests for exact tools/list/input/output, range reads and approval/owner/payload denial.
- [x] Observe failure, then implement apps/mcp-task-hub/src/{contracts,service,server}.ts.
- [x] Add concurrent receipt replay, different-operation append, failed mutation rollback and server restart tests; verify mutations and receipts in PostgreSQL.
- [x] Expose npm start/build/check commands and explicit local launch metadata.

## Task 3 — Handoff

- [x] Run root offline checks plus dedicated integration suite; inspect live discovery and DB contents.
- [x] Review changed transaction/auth code; fix important findings with regression tests.
- [x] Update status/READMEs and evidence: 3 tools implemented; remaining tools, engine/API/UI/LLM remain planned. Keep old audit as historical evidence.
