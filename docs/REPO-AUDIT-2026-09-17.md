# Repository audit and cleanup — 17/09/2026

## Verdict

**Backend verification: PASS. Repository hygiene: CLEANED_WITH_PRESERVED_HISTORY.**

The current source, tests, package graph and backend integration gates pass. Rebuildable output was removed. The reviewed API-GATE/catalog implementation and selected evidence were subsequently checkpointed in focused commits; no migration history or evidence history was rewritten.

## Verified

- `npm run check:backend` exited `0`: 43 DSL tests; 104 engine unit tests plus 1 capability-dependent skip; 26 API unit tests; 38 web unit tests; 64 task_hub integration tests; 63 engine integration tests; 34 API integration tests.
- `node --test scripts/check-api.test.mjs` passed 13/13.
- `node scripts/check-api.mjs` exited `0`. The [fresh manifest](api-evidence/batch-03/API-05/20260917072147-30545e43-9414-43c8-9386-7fed97acc4e0/manifest.json) records `API_TECHNICAL_PASS`, H01–H20 `PASS`, six successful command groups and cleanup delta `PASS`.
- The fresh manifest fingerprints 182 source/config files. After cleanup, all 182 exist and match SHA-256; no `dist`, `generated`, `runtime`, Playwright report or test-result path is included.
- `npm audit --json` exited `0`: 254 dependencies, 0 critical/high/moderate/low vulnerabilities.
- `npm ls --all` and `npm ls --depth=0` found no missing or invalid package.
- High-confidence credential scan found no private key, GitHub/AWS/OpenAI token or real credential. Matches were synthetic test values and blank `.env.example` placeholders.
- `git diff --check` passed. There are no empty tracked/untracked files and no unexpected large non-generated file; the tracked historical ZIP is explicitly retained by policy.
- Portable relative Markdown links have no unresolved target after the fixes below. Sixteen `file:///D:/...` links remain only in historical evidence and are recorded as non-portable history.

## Corrections made

- Source-evidence collection now excludes rebuildable `.cache`, `.next`, `.turbo`, `dist`, `generated`, `runtime`, `test-results`, `playwright-report`, `coverage` and `node_modules` directories.
- README now reports all six migrations through `0006_http_trace_snapshots.sql`.
- Baseline now describes WEB-01B as a provisional fixture shell without live API/session/browser evidence instead of saying the frontend is wholly unimplemented.
- Two broken FS-04 evidence links now point to `1789368709477-final-check-r4/`.
- A stale historical Markdown link was converted to a literal path, and current API status/progress/API-05 documentation now points to the fresh gate.
- Web workspace lifecycle scripts now build `@wap/dsl` before dev, build, typecheck and unit-test entry points. Browser commands also build the matching fixture/live web bundle before preview. This closes a clean-checkout failure that had been masked by a stale `packages/dsl/dist/` directory.

## Cleanup performed

Exactly 123 ignored, rebuildable files (1,094,851 bytes) were removed from:

- `apps/api/dist/`
- `apps/mcp-task-hub/dist/`
- `apps/web/dist/`
- `packages/db/dist/`
- `packages/dsl/dist/`
- `packages/dsl/generated/`
- `packages/engine/dist/`
- `runtime/`
- `apps/web/test-results/`

These files are recoverable by the normal build/schema/test commands. No source, migration, fixture, dependency installation, local agent tool or evidence file was removed.

## Deliberately preserved

- All `docs/task-hub-evidence/` and `docs/api-evidence/` history, including failed and superseded runs. `docs/GIT-POLICY.md` and the API fix plan require preserving reviewed history and pre-existing evidence; no retention-policy change was authorized.
- `node_modules/`, because the installed graph is valid and needed for continued work.
- `.agents/`, `.claude/`, `.codex/`, `.impeccable/` and `.superpowers/sdd/`, because they are ignored local tooling/history, not build debris.
- `docs/archive/pre-fix-2026-09-13.zip`, because it is a tracked historical checkpoint explicitly protected by policy.
- Every existing modified/untracked source, test, design and specification file.

## Remaining limits

- Browser E2E against the live API/session, 2-second frontend polling, AI/retrieval/replan evaluation, official rubric and representative user work remain `NOT_RUN`/`OPEN`. They are not backend regressions.
- Historical absolute `file:///D:/...` citations are not portable. They were left unchanged to avoid rewriting evidence history.
