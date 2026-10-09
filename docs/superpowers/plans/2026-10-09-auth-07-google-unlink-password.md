# AUTH-07 Google unlink password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline with TDD and verification-before-completion. Parent handles independent review and PR; do not spawn agents or merge.

**Goal:** Require the caller's actual current password before removing their Google link.

**Architecture:** The protected Google route validates bounded input and verifies the existing password hash using the shared login failure budget. The repository compares that verified hash again while holding the existing user/session row locks, then clears the Google identity atomically.

**Tech Stack:** Express, TypeScript, PostgreSQL 16, Vitest/Supertest, React, Playwright.

**Spec:** `docs/handoff/tasks/AUTH-07-google-unlink-password.md`, preserving AUTH-04/05.

## Global constraints

- One branch/PR, no dependency or migration, no CURRENT-STATE/ROADMAP changes.
- Wrong passwords return 400, shared limit returns 429 with Retry-After; invalid sessions keep 401.
- Current password: nonempty string, maximum 128 characters; no new-password minimum for existing passwords.
- Preserve passwordless 409, active-user/session checks and existing Google session-creation guard.
- Only minimal legacy web caller/client compatibility; FE-09 owns the prototype UI.
- No credentials, hashes or tokens in evidence logs.

## Review focus

- Malformed input must leave link/sessions unchanged and not spend the password budget.
- Login, password-change and unlink failures must share one budget, including concurrent requests.
- Password changes while unlink waits on a real row lock must prevent stale verification from writing.
- Revoked/expired sessions and disabled users must fail the write-time recheck.
- Protected client refresh must retain the submitted password and mutation retry limits.

## Task 1: Protected backend unlink

Files: create `apps/chat-api/tests/auth/google-unlink-password.test.ts`; modify `apps/chat-api/src/routes/auth/google.ts`, `apps/chat-api/src/db/repositories/google-auth-repo.ts`; update existing direct repository fixtures in `tests/auth/google-auth.test.ts` and `tests/auth/account.test.ts`.

Interface: `GoogleAuthRepo.unlink(userId, sessionId, expectedPasswordHash, clock: () => number): Promise<void>`; POST body `{ currentPassword: string }`. Check expiry using a fresh clock value after both row locks.

- [x] Run existing AUTH-04/05 baseline against isolated PostgreSQL 56550.
- [x] Add real HTTP/DB tests: missing/wrong/valid/passwordless, length boundary, shared limit, no extra session, real blocked-row password/session/status changes and natural session expiry.
- [x] Run tests before implementation; retain failure count and log.
- [x] Implement current-password check with `LoginFailures.serialize`, `verifyPassword`, and expected-hash comparison under row locks.
- [x] Run focused backend regressions and retain GREEN output.

## Task 2: Minimal legacy caller compatibility and handoff

Files: modify `apps/chat-web/src/services/api-client.ts`, `src/views/AccountView.tsx`; related auth05/client/unit/browser fixtures; task Result and one handoff log.

Interface: `apiClient.unlinkGoogle(currentPassword: string)` keeps the existing protected request transport.

- [x] Update native HTTP/client/caller tests first; prove password body forwarding and cancel behavior fail before changes.
- [x] Add a small masked confirmation form to the legacy caller; forward password through refresh/retry, clear on cancel/success, retain all existing action race probes.
- [x] Update original AUTH-05 browser caller to provide its actual seeded password through the masked field.
- [x] Run focused web regressions, `npm run check` and canonical browser after parent grants the browser slot.
- [x] Commit explicit scoped files, fill Result/log with evidence and report exact head to parent. PR/review/CI remain parent-owned; no merge.
