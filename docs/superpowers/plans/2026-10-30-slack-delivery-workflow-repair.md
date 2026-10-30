# Slack delivery workflow repair Implementation Plan

> **For agentic workers:** Use `executing-plans`, direct implementation. One fresh read-only review of the whole branch at the end.

**Goal:** Make ongoing Slack work resumable by accepted deliverables and put actual native bootstrap regressions into ordinary CI.

**Architecture:** A single delivery matrix owns cross-task status; parent cards retain requirements and point to it. Committed Vitest integration tests launch the real server against isolated PostgreSQL schemas and loopback Slack fixtures. No product behavior change is planned.

**Tech Stack:** TypeScript, Vitest, PostgreSQL16, Node child_process, Markdown; no dependencies/migrations.

**Spec:** [personal Slack](../specs/2026-10-28-slack-personal-oauth-design.md), [source contracts](../../handoff/decisions/2026-10-29-slack-source-ingress-contracts.md), parent03/04 and approved workflow-review corrections.

## Constraints / review focus

- Content/automation flags off; subprocess environment allowlists OS essentials plus synthetic test configuration. Never load live secrets from `.env` into children.
- A real signed revocation event must reach durable receipt/job, auth.test validation, binding invalidation and actual registered-message erasure; an unrelated ATI owner in the same workspace stays intact.
- Native erasure must still run without any Slack config/network. Six unsupported derived kinds remain pending; tests must not assert whole-receipt closure.
- Poll persisted state with deadlines; bound child termination and always close fixture/database. Do not claim production shutdown certification from test teardown.
- No native-provider/model/Free/Pro acceptance from HTTP fixtures; no weakening fullcheck/browser/exact-head CI.

## Task1: committed bootstrap evidence and delivery matrix

Files: create `apps/chat-api/tests/integration/slack-native-runtime.test.ts`, `docs/handoff/SLACK-DELIVERY.md`, task/plan/log; update parent03/04, macro delivery plan, handoff README and `docs/slack/method-inventory.md` (snapshot semantics only). No edits to implementation files or frozen inventory JSON.

- [x] Add integration regressions using the existing PG/HTTP fixture, actual server child and signed ingress.
- [x] Temporarily remove native lifecycle/message-consumer wiring in this isolated branch; observe both regressions RED. Restore exact source, observe GREEN. Tests protect existing integration, so mutation evidence is the appropriate failure check.
- [x] Write the single requirement→task→head→evidence matrix, milestone gates and next deliverable; correct parent/macro instructions that still say no code or all03 must precede04.
- [x] Run targeted tests/typecheck, then freeze source/base and one full `npm run check`. Update task/log with actual counts and omitted validation.
- [x] Fresh independent whole-branch review; one fix pass completed for the stale03B2D headerP3. Source/test unchanged, diff-checkPASS.
- [ ] Publish staging PR; require exact-head CI/browser before integration.

Pre-flight: metadata validation produces binding invalidation consumed by registered-message purge. Both must be wired into the same real server child. FullF3 consumes future06 artifacts; therefore the current source milestone cannot close fullF3. Write dispatch consumes04C safety, so no03→04 sequential barrier is valid.
