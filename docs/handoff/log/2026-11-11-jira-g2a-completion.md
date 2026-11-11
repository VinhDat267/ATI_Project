# 2026-11-11 — JIRA-G2A completion

## Scope and preservation

Owner requested completion of Jira/JIRA-G2A in `D:/ATI-Worktrees/jira-g2a-read-containment`, branch `feat/jira-g2a-read-containment`, baseline `92027d61a5eb9d8040d3658b452709dec698376f` plus 44 dirty files, staged zero. All 44 initial files were copied and hashed before edits under `D:/ATI-Audits/jira-g2a-completion-20261111/before`. Eleven of those files were refined; 33 retained their original bytes. The additional workspace-isolation fixture was backed up separately before correcting retired-Jira expectations. Main and adjacent worktrees were not modified.

Task: `docs/handoff/tasks/JIRA-G2A-completion.md`. Plan: `docs/superpowers/plans/2026-11-11-jira-g2a-completion.md`.

## Changes

- P0-01: implicit ticket routing is covered by D09-LLM-OFF. Sandbox exceptions require sandbox runtime. Jira context flows from conversation to planner actor; planner catalog/gather and provider enforce egress/context restrictions.
- P1-01: disabled-source policy data lives beside `READ_DIGEST_SOURCE_MAP`; the generic runner preflight rejects the entire run before credential lookup, source reads, AI summaries or Telegram delivery, including mixed-source/mismatched service-tool configurations. No schedule-row pause is requested. The architecture guard and all its exception definitions are unchanged.
- P1-02: bounded search requests remaining capacity; overfull provider responses are rejected rather than falsely declared COMPLETE; direct-key results obey filters; fetched results enforce numeric project identity.
- Independent P1-R1: dispatch without a named allowlisted read tool is rejected before token/lease acquisition; tool is mandatory in the TypeScript contract.
- Independent P1-R2: moved/substituted issues are rejected against the initial project and issue key before content can be returned under the original lease/provenance.
- Historical fixture corrections preserve existing tenant/admin/member/global credential isolation using Slack after shared Jira Basic Auth retirement.
- Five additional generic fixtures now expect seven legacy/shared-registry services (excluding retired Jira) and test generic refusal serialization with Notion/Trello, preserving all substantive assertions. Separate before-copies are under `before-extra-fixtures` in the evidence root.

## Verification

Raw receipts, independent review and screenshots: `D:/ATI-Audits/jira-g2a-completion-20261111`.

- RED receipts: `adapter-red.log`, `privacy-red.log`, `digest-red.log`, `dispatch-red.log`, `moved-issue-red.log`; failures reproduced the missing behavior before the respective fixes.
- Focused GREEN: adapter/workspace 38/38; live server smoke 1/1; Jira web 61/61; generic integration/registry compatibility 13 files / 53 tests; digest/containment/delivery/static guard 4 files / 31 tests; typecheck exit 0. Final broad results follow below.
- Independent reviewer: final scoped PASS, adapter 23/23 and runtime catalog 9/9 plus executable missing-tool/moved-issue probes. Report: `INDEPENDENT-REVIEW.md` in the evidence directory.
- Browser Chromium UI fixture: desktop 1440x1000/mobile 375x812; G2A disclosure visible, disconnected CTA disabled, no horizontal overflow. All external requests blocked (one font attempt); no real Jira provider used. Screenshots `jira-g2a-desktop.png`, `jira-g2a-mobile.png`.
- Test database: owned PostgreSQL 16 container `ati-jira-g2a-completion-db`, loopback port 56534, isolated test schemas. Initial runs used normal durability; the broad disposable fixture uses `fsync=off`, `synchronous_commit=off` to reduce migration I/O. Row-lock/transaction tests still run on PostgreSQL; this is not crash-durability acceptance.
- The fresh test database also requires the existing v3 migrations in `public`: several historical integration tests clone `public.service_credentials`, and direct repository tests use the default schema. The missing setup initially caused relation-not-found/setup failures and one fixture rejection; after test-only bootstrap through migration 0035, all 13 affected files / 53 tests pass with no unhandled errors (`test-db-bootstrap.log`, `bootstrap-and-registry-green.log`). No production database was migrated.
- An exploratory repo-root Vitest invocation picked up web/Playwright files without the web config. Its failures are retained in `jira-cross-service.log`, not treated as product evidence. Web was rerun from its proper workspace. An initial full-check receipt caught stale shared-Jira fixture expectations; after correction, the obsolete run was stopped and a final whole-project run is required on the final source set.
- A subsequent full source run passed all 5,931 source tests, but evaluation static guard rejected the inline Jira-specific branch in the generic digest runner. Policy was extracted into source-catalog metadata; no static-guard relaxation was made. Final independent containment/static-guard rerun: 14/14 PASS, with final candidate/runner hashes recorded in `INDEPENDENT-REVIEW.md`. The final uninterrupted all-stage receipt is `full-check-verified.log` and its companion exit-code file.

## Final gate

**Final uninterrupted `npm run check`: PASS, exit code 0**, with `DATABASE_URL` explicitly pointing to the owned local56534 test database and `VITEST_MAX_WORKERS=4`. Receipt: `full-check-verified.log`; machine-readable exit code: `full-check-verified.exit-code.txt` (`0`).

| Stage | Result |
| --- | --- |
| Typecheck | PASS |
| Tool schemas | 27 files / 593 tests PASS |
| Tool adapters | 28 files / 717 tests PASS; 32 Node probes PASS |
| Planner | 40 files / 567 tests PASS |
| Executor | 7 files / 56 tests PASS |
| Chat API | 280 files / 2,755 tests PASS |
| Chat web | 121 files / 1,243 tests PASS |
| Evaluations | 31 files / 500 PASS, 1 SKIP |
| Production build and credential-sentinel/UI-claims security check | PASS |
| Launcher | 1 PASS |
| Remaining Node suites | 66 PASS |

Source-test total: **5,931 PASS**. Independent final scope: **PASS**. Final policy extraction containment + unchanged architecture static guard independently passed 14/14. Final production hashes are preserved in `production-manifest.json`; the candidate file manifest and preservation receipt are external evidence artifacts.

Local Jira G2A implementation is complete with no reproduced blocking finding left open. The owned test database is stopped after verification; its data and all receipts are retained. No commit, push, PR, remote CI, production activation or native Jira Cloud provider acceptance is claimed. Jira writes, scheduled Jira and external Jira LLM egress remain disabled within the approved G2A scope. `CURRENT-STATE.md` and `ROADMAP.md` were not changed.
