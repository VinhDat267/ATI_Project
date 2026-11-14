# TRELLO-G0 — Independent Evidence First

**Status:** IN_REVIEW — RED contract tests on isolated branch; no production changes  
**Owner:** Independent reviewer + product owner  
**Base SHA:** 08c8d8c5e7bf12625857ac3496fb96ec3914e34f  
**Branch:** test/trello-gate0-evidence

## Scope authorized 09/11/2026
- Read GitHub main, AGENTS.md, team-workflow.md, CURRENT-STATE.md, ROADMAP.md, and Trello source/tests.
- Verify Trello OAuth claims with Atlassian documentation and mark provider-live checks NOT_RUN.
- Write deliberately failing behavior tests for trusted scope, board mismatch, digest coverage and provider receipts.
- Document source lines, reproducibility, conflict boundaries and decisions needed for a future GREEN plan.

## Explicitly out of scope
- Production/service code changes; DB migrations; new OAuth grants; service-provider writes.
- Merge or deploy; silently modify Google Sheets Gate A shared files.

## Acceptance checklist
- [x] HEAD SHA and main CI verified by GitHub API.
- [x] OAuth endpoint capability cross-checked with official Trello reference; previous incompatibility claim withdrawn.
- [x] RED test source files created under apps/chat-api/tests/services.
- [x] Evidence document separates SOURCE, DOC, RED and NATIVE_NOT_RUN.
- [ ] Independent execution logs prove RED failures at intended assertions (not test setup).
- [ ] Reviewer approves Gate 0 closure and GREEN Design Spec.

See docs/audits/2026-11-09-trello-gate0/EVIDENCE.md and docs/superpowers/plans/2026-11-09-trello-gate0-evidence-first.md.
