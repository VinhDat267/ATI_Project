# 2026-11-12 — GMAIL-G2 main integration

## Scope and baseline

Owner authorized merging `Gmail-G2` into `main` from baseline `5eef6c398bdae70384420c494a5e6c1dba8f7014` (`origin/main` containing Cross-Service `#315`, Notion N2B `#317`, and Jira-G2A `#318`) in isolated worktree `D:/ATI-Worktrees/gmail-g2-main-merge` on branch `feat/gmail-g2-source-binding`. Prior implementation and audit worktrees (`D:/ATI-Worktrees/gmail-g2-main315-integration` and `C:/Users/VinhDat/orca/workspaces/ATI_Project/gmail-g2-remediation-v2`) were preserved unmodified.

Task: `docs/handoff/tasks/GMAIL-G2-main-integration.md`.
Audit artifacts: `D:/ATI-Audits/gmail-g2-remediation-v2/G2-main315-bounded-integration/`.

## Changes

- **Gmail digest source binding (`sourceBindingVersion: 1`):** `gmail-digest-binding.ts`, `telegram-digest-candidate.ts`, `digest-scope-guard.ts`, `schedule-service.ts`, and `telegram-digest-runner.ts` pin `{ kind: 'gmail', credentialId, email, oauthClientId }` inside `digest_config_hash`, enforce `409 DIGEST_PREVIEW_CHANGED` on preview-to-confirm drift, block legacy unbound Gmail schedules without silent backfill, and pause schedules fail-closed on account replacement, disconnect, scope loss, or `oauthClientId` mismatch.
- **Bounded PostgreSQL egress authority & `#315` crash recovery:** `TelegramDigestRunner` verifies live authority in canonical `NOWAIT` lock order (`users` -> `service_credentials` -> `conversations` -> `schedules` -> `schedule_runs`), releases all locks before AI/Telegram HTTP calls, commits `schedule_runs.delivery_started_at` durably prior to `telegram.send_message`, and classifies `RST-02` / `RST-03A` mid-send crashes as `needs_attention` (`TELEGRAM_DELIVERY_UNKNOWN`) via `ScheduleRunner.recoverInterrupted` with zero duplicate replay.
- **P2-01 defense-in-depth hardening:** Added `claimSqlIssued` tracking via `onBeforeClaimSql` so pre-send error cleanup only clears `delivery_started_at` if the `UPDATE schedule_runs SET delivery_started_at = now()` statement was actually issued in that attempt.
- **Reconciliation with `#318` (`Jira-G2A`):** Preserved `DISABLED_READ_DIGEST_SERVICES` / `getDigestSourceDisabledReason` in `telegram-digest-candidate.ts` and the generic preflight guard in `telegram-digest-runner.ts` (zero inline service branches, `evaluations` `static-guard` unchanged), plus `#318`'s `chat-service.ts` and `server.ts` Jira containment wiring. Updated one fixture expectation in `chat-service-gmail.test.ts` (`jira` -> `myjira`) for retired shared Jira.
- **Schemas, adapter, planner, and UI:** Enforced Gmail recipient/query/body bounds in `@wap/tool-schemas` and `@wap/planner`, RFC 5322 header sanitization in `@wap/tool-adapters`, typed `{"kind":"refusal"}` history serialization and scheduled `gmail_account` grounding in `ChatService`, and honest UI/privacy copy in `@wap/chat-web`. Zero database migrations added (`db/v3/` remains at 48 files / `0036`).

## Verification

Verified against isolated disposable PostgreSQL 16 container `ati-gmail-g2-merge-pg` (48 migrations applied cleanly):

- `npm run typecheck:v3`: PASS (exit 0)
- `npm run build:v3`: PASS (exit 0)
- `node scripts/test-v3-web-build-security.mjs`: PASS (exit 0)
- `npm run test:eval:v3` (including `evaluations/generic-plumbing/static-guard.test.ts`): 31 files / 501 PASS, 1 SKIP
- `@wap/tool-schemas`: 28 files / 609 PASS
- `@wap/tool-adapters`: 28 files / 771 PASS + 32 Node probes PASS
- `@wap/planner`: 41 files / 610 PASS
- `@wap/executor`: 7 files / 56 PASS
- `@wap/chat-web`: 120 unit/integration files / 1,248 PASS
- `SCENARIO=gmail npm run test:browser:v3`: 12/12 PASS (`gmail-03.spec.ts` + `OAUTH-01`)
- `npm run test:launcher:v3` + root Node suites: 1 PASS + 66 PASS
- `@wap/chat-api`: 285 files / 2,836 PASS (including `gmail-digest-source-binding.test.ts` 27/27, `gmail-main315-crash-recovery.test.ts` 10/10, `cross-service-combined-gate.test.ts`, `chat-service-gmail.test.ts` 10/10, and all `Jira-G2A` containment/privacy suites).

## Remaining boundaries

- Live Google OAuth / `FLOW-07` real-provider verification remains open (all tests use synthetic local fixtures).
- `Production: HOLD` remains in effect. `CURRENT-STATE.md` and `ROADMAP.md` were not modified in the feature branch per `AGENTS.md` Section 4.3.
