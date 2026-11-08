# Superpowers Plan: Trello Gate 0 — Evidence First

Date: 2026-11-09; Status: DRAFT / FOR REVIEW; baseline main SHA 08c8d8c5e7bf12625857ac3496fb96ec3914e34f.

## Goal
Establish an independently reproducible RED baseline, without production changes or live writes, for correctness of Trello scheduled operations. Gate 0 is evidence collection, not remediation.

## Task 0 — Freeze HEAD and rules
Read AGENTS.md, docs/team-workflow.md, docs/handoff/README.md, CURRENT-STATE.md, ROADMAP.md and existing Trello reviews. Verify SHA, CI and Sheets PR changed filenames. Do not touch shared files or CURRENT-STATE/ROADMAP.

## Task 1 — OAuth compatibility review
Read Trello OAuth code, read adapter and official Atlassian API reference for all actually used endpoints. Do not assume old docs or existing agent findings are correct. Record supported method/scope and unknown native runtime behavior. No OAuth credentials are available; native proof remains NOT_RUN.

## Task 2 — RED: Tenant scope and grounded board choice
Write failing Vitest contracts:
1. Candidate carries trusted Personal scope rather than default.
2. An explicitly named unknown board does not fall back to unrelated boards.
3. Runner carries Organization scope to both lookup and adapter.
Tests inject realistic connection callbacks; no production edit.

## Task 3 — RED: Digest accuracy and delivery
Write failing Vitest contracts:
4. A board with more cards than the read limit cannot be represented as a complete report.
5. Slack send without ts cannot be digest_sent.
6. Telegram send without messageId cannot be digest_sent.
7. Unverifiable Slack channel destination prohibits sending.

## Task 4 — Verification
Run new test files on exact branch SHA and record failing assertion names, counts, exit codes and real CI URL. Keep setup errors distinct from intended RED. Do not merge failing tests into main.

## Task 5 — Review and Handoff
Record code references, provider documentation, NOT_RUN live probes, deferred security concerns, Sheets shared-file conflicts and proposed GREEN acceptance criteria in evidence doc. Add separate handoff task/log. Obtain explicit approval before implementing fixes.

## RED-to-GREEN gates for a future PR (NOT authorized)
- Trusted tenant scope derived from persisted conversation/schedule; no arbitrary user authority.
- Complete/partial coverage with truthful counts and an explicit policy.
- Receipt validation + destination fail-closed; real DB claim/recovery tests.
- Native OAuth read-only verification and later consented send/readback.
- Rebase and rerun Google Sheets regression before modifying shared runtime.

This plan does not authorize new services, migrations, automatic merge or deployment.
