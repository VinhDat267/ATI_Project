# Jira G2A completion implementation plan

> Execute inline with TDD; obtain independent final review under the repository review protocol.

**Goal:** Close the three blocking findings on the existing G2A candidate without reopening locked read-only scope.

**Architecture:** Keep the current OAuth authority, adapters, and planner. Enforce privacy at chat routing, planner catalog/gather and provider boundaries. Block scheduled Jira sources before digest processing rather than relying on per-source exceptions, which are intentionally recoverable.

**Tech stack:** TypeScript, Vitest, PostgreSQL 16, HTTP loopback fixtures.

**Spec:** Existing G2A containment contract in `D:/ATI-Audits/jira-g1-5-antigravity-readiness-20261111/03-G2A-SERVER-SIDE-CONTAINMENT-CONTRACT.md` and independent review listed in the task card.

## Constraints and review focus

- Preserve existing 44-file candidate; no migration/schema changes, persistent schedule changes or production activation.
- Only four Jira read tools; maximum 50 items, three pages, 8,000ms; COMPLETE requires proof of exhaustion.
- Protect implicit Jira intent and historical Jira content, not only prompts spelling Jira.
- Mixed-source digests must fail before any source, LLM or delivery call.
- Numeric project IDs remain authoritative if a project key is reused.
- Preserve synthetic sandbox scenarios while preventing live scenario-variable bypass.

## Task 1 — Privacy and runtime boundary (P0-01)

- [x] Add failing tests for ordinary org ticket prompts with LLM off; provider with valid authority but explicit LLM off; live sandbox-variable bypass. Review planner/gather context gates and add a real-server ticket refusal smoke.
- [x] Gate sandbox exceptions on runtime mode, propagate conversation Jira context, gate planner catalog and gather, enforce explicit provider LLM-off policy.
- [x] Run privacy and runtime catalog suites and confirm the planner is not invoked on denied turns; booted live-server smoke confirms zero LLM calls. Connected-caller planner/gather wiring is source-reviewed, not a real-provider acceptance claim.

## Task 2 — Scheduled containment (P1-01)

- [x] Add failing TelegramDigestRunner tests for Jira-only and mixed Jira sources, both namespaces, with zero source/LLM/delivery calls and no schedule pause mutation.
- [x] Add an early runner preflight rejecting any Jira service/tool source. Update only the runner boundary needed by the actual call path.
- [x] Run containment and Telegram digest regression suites.

## Task 3 — Read correctness and acceptance (P1-02)

- [x] Add HTTP fixture regressions for page-size remainder, truncated terminal pages, direct-key filters and numeric project ID mismatches across search/get.
- [x] Correct project verification, direct-key filtering and completeness proof while retaining limits and cancellation. Also close independent omitted-tool and post-bind moved/substituted-issue findings with RED/GREEN tests.
- [x] Run adapter, security, Jira and cross-service regressions; typecheck/build/full checks. Final `npm run check`: exit 0 (`full-check-verified.log` and exit-code receipt).
- [x] Obtain independent review, fix actionable findings, record receipts and update the task result and one new handoff log. Local scope PASS; native/live acceptance remains explicitly NOT_RUN.
