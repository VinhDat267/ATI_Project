# GMAIL-G2 — Source-bound scheduled Gmail digests, crash recovery, and main integration

- Owner: Antigravity, direct execution and publication authorized by project owner on 2026-11-12.
- Branch: `feat/gmail-g2-source-binding`.
- Baseline: `5eef6c398bdae70384420c494a5e6c1dba8f7014` (`origin/main` after Cross-Service `#315`, Notion N2B `#317`, and Jira-G2A `#318`).
- Reviews:
  - `D:/ATI-Audits/gmail-g2-remediation-v2/G2-main315-bounded-integration/GMAIL-G2-MAIN315-INTEGRATION-REPORT.md`
  - `D:/ATI-Audits/gmail-g2-remediation-v2/G2-main315-bounded-integration/GMAIL-G2-SEPARATE-SESSION-ACCEPTANCE-REVIEW.md`

## Acceptance

- Bind scheduled Gmail Telegram digests (`sourceBindingVersion: 1`) to exact `{ credentialId, email, oauthClientId }` at preview, confirmation (`409 DIGEST_PREVIEW_CHANGED`), resume, and runner execution; fail closed on legacy unbound Gmail digest configs without auto-backfill.
- Enforce bounded PostgreSQL egress authority (`FOR SHARE NOWAIT` on `users` + `service_credentials`, `FOR UPDATE NOWAIT` on `conversations` + `schedules` + `schedule_runs`) before AI summarization and before outbound Telegram HTTP, releasing all PostgreSQL locks prior to external network I/O.
- Integrate Cross-Service `#315` durable pre-send `schedule_runs.delivery_started_at` claim and crash recovery (`RST-02` in-flight Telegram send crash and `RST-03A` post-HTTP-200 pre-persist crash transition to `needs_attention` with `TELEGRAM_DELIVERY_UNKNOWN`, zero automatic or manual duplicate resend, and explicit `resolveDelivery` recovery).
- Preserve all `Jira-G2A` (`#318`) read-containment and disabled-digest source guards (`getDigestSourceDisabledReason`, `JIRA_LLM_EGRESS_DISABLED_IN_G2A`, retired shared `jira`) without adding service-specific runner branches rejected by `evaluations` `static-guard`.
- Preserve R7 bounded test-harness verification (`A04-R7`) and harden pre-send claim failure cleanup (`claimSqlIssued` guard) so `delivery_started_at` is only cleared on post-claim `COMMIT` acknowledgement loss.
- Keep `Production: HOLD` unchanged and make no live Google Workspace / OAuth verification claims.

## Kết quả

**GMAIL-G2 MAIN INTEGRATION COMPLETE — separate-session review PASS (`0 P0`, `0 P1`); local verification PASS.**

- Integrated the 38-file Gmail-G2 × `#315` candidate cleanly onto `origin/main` (`5eef6c39`), reconciling the 4 overlapping files (`server.ts`, `chat-service.ts`, `telegram-digest-candidate.ts`, `telegram-digest-runner.ts`) with `#318` (`Jira-G2A`) and folding in `P2-01` (`claimSqlIssued` defense-in-depth guard before `SET delivery_started_at = NULL`).
- Enforced bounded Gmail tool schemas, RFC 5322 header folding/sanitization, planner array-bounds validation, refusal history serialization (`{"kind":"refusal"}`), scheduled run `gmail_account` grounding, and accurate Gmail UI/privacy disclosures (`GmailPreview`, `PlanMoment`, `RecoveryMoment`, `PrivacyPage`).
- Separate-session read-only acceptance review (`GMAIL-G2-SEPARATE-SESSION-ACCEPTANCE-REVIEW.md`): `REVIEW PASS` (`0 P0`, `0 P1`, `1 P2` folded in).
- Updated `chat-service-gmail.test.ts` Turn 1 unconfigured-Jira expectation from retired `jira` to `myjira` to align with `#318` shared-Jira retirement while preserving zero-LLM router refusal and recipient non-leakage assertions.
- Verification on isolated PostgreSQL 16 (`ati-gmail-g2-merge-pg`): `typecheck:v3` PASS, `build:v3` PASS, `test-v3-web-build-security.mjs` PASS, `evaluations` (`static-guard` + golden suites) 501 PASS / 1 SKIP, `@wap/tool-schemas` 609 PASS, `@wap/tool-adapters` 771 PASS + 32 Node probes PASS, `@wap/planner` 610 PASS, `@wap/executor` 56 PASS, `@wap/chat-api` 285 files / 2,836 PASS, `@wap/chat-web` 1,248 PASS, `SCENARIO=gmail` Playwright browser E2E 12/12 PASS, `launcher` 1 PASS, and root Node scripts 66 PASS.
- Live Google OAuth / `FLOW-07` provider verification and `Production: HOLD` remain outside this gate.
