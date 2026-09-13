# Controller/engine implementation plan

> Execute the user-approved next step in the current non-Git folder. Use TDD and a bounded independent code review before completion; no branch/commit workflow applies.

**Goal:** Run hand plan b02 through a real controller, one immutable approval, local MCP writes and persisted trace.

**Architecture:** `packages/engine` separates reviewed gateway, snapshot/validation, transactional storage, preparation, execution/recovery and CLI. Reuse DB/DSL; do not couple engine to tool receiver implementation.

**Tech stack:** Existing Node >=22, TypeScript, postgres.js/Drizzle, Zod4, MCP SDK1.30.0, Vitest. No additional framework.

**Spec:** ../specs/2026-09-13-controller-engine-design.md; ../../EXECUTION-CONTRACT.md.

## Constraints

- One worker, sequential dispatch; local three-tool catalog only.
- Approval TTL 600000ms; read attempts <=3 with exponential backoff. No automatic write retry/replan/resume.
- Test database engine_it_* only; preserve existing G1 services/data and historical evidence.
- Public CLI accepts plan data but no executable/server override; launcher sets principal and local DB.

## 1. Preview and decision

- [x] Create package/config plus `tests/controller.integration.test.ts`: `const run=await engine.prepare(b02); expect(run.status).toBe('awaiting_approval'); expect(run.approval.actions).toHaveLength(2);` and SQL assert zero hub_receipts/messages.
- [x] Run test to observe missing engine failure.
- [x] Implement `src/snapshot.ts` (canonical bytes, hashes, inputs/plan validation), `src/gateway.ts` (fixed local launch/discovery), `src/store.ts` (owner/run locks, seq/event/outbox), `src/prepare.ts` and `src/engine.ts` facade.
- [x] Implement decision transaction: `await engine.decide(run.run_id,{approval_id:run.approval.id,workflow_version_id:run.workflow_version_id,snapshot_hash:run.approval.snapshot_hash,decision:'approved'})`; compare identities/status/expiry and snapshot bytes before update.
- [x] Verify preview content, owner/hash/version rejection, duplicate decisions, expiry, read-only and skipped conditions with real DB/MCP.

## 2. Execution and uncertainty

- [x] Add failing test: approve then `await engine.execute(run.run_id)` → succeeded, source rows copied exactly, one #team message, two operation receipts. Mutate source after preview and assert copied data stays as previewed.
- [x] Implement `src/execute.ts`: global worker lock, immutable snapshot verification, operation claim, MCP call and receipt/result check; `src/attempts.ts` captures immutable attempt fields and read retry.
- [x] Add failure test wrapping real gateway: `const response=await real.call(...args); if(write) throw new Error('lost response'); return response;` → reconciliation_required, only first receipt, no notify.
- [x] Implement `src/recovery.ts`: cancel, orphan marking, owner-scoped read-only receipt inspection. No write retries or automatic recovery dispatch.
- [x] Test concurrent workers, changed registry/preview, before-dispatch denial, unknown result, subprocess crash/recovery and continuous event seq.

## 3. Usable CLI and handoff

- [x] Implement `src/cli.ts` and root scripts: prepare/preview/approve/reject/execute/events/trace/cancel/recover/reconcile; emit JSON, no auto approval. `src/index.ts` exports facade and local gateway.
- [x] Run `npm run check:engine` (typecheck/build/offline + existing G1 + engine integration). Inspect b02 DB, one approval/two receipts and trace/event evidence.
- [x] Apply bounded independent review of snapshot/claim/uncertainty paths; reproduce/fix important findings and rerun affected/full checks as justified.
- [x] Write current controller status, README and evidence links; distinguish service-level verification from HTTP/UI/LLM and remaining G1 tools.
