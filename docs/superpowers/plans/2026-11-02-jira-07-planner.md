# JIRA-07 Planner Multi-Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route enabled Jira requests through personal Jira tools and keep planner context grounded to one verified workspace and site per resource.

**Architecture:** Reuse JIRA-02 tool catalog and JIRA-05 capability directory. Keep routing and memory logic inside planner; server supplies authorized directory/source snapshots and JIRA-08 retains authoritative binding and source revalidation.

**Tech Stack:** TypeScript, Vitest, existing planner and tool-schemas packages.

**Spec:** `docs/superpowers/specs/2026-10-30-jira-personal-workspaces-design.md` §§7–11.

## Global Constraints

- `MYJIRA_ENABLED` defaults off. Flag off preserves existing catalog and routing.
- Opaque siteId comes from verified directory, never model or browser authority.
- Workspace + cloudId + resource type + provider ID is the entity identity.
- Do not edit backend, adapter, executor or web modules.
- Do not call a model before evaluation labels are committed.

## Review Focus

- Same issue key in two sites must remain two entities.
- A missing or ambiguous site must ask for clarification.
- A reference to an issue in site A must fail as site B.
- Revoked Jira source must not enter a later model prompt.
- Tool output text must be treated as data, never instruction.

---

## Task 1: Routing

- [x] Add failing Vitest cases for Jira flag off/on, explicit Jira intent, and mixed Jira/Slack requests.
- [x] Run focused tests and record expected failure.
- [x] Add minimal routing selection that prefers myjira when its catalog is enabled, preserving old routing when off.
- [x] Run focused and planner tests; commit scoped files.

## Task 2: Site and resource grounding

- [x] Add failing tests for duplicate project/issue keys across sites, ambiguous destination, and cross-site reference.
- [x] Run focused tests and record failure.
- [x] Add site-aware memory identity and planner clarification using verified directory data.
- [x] Run focused and planner tests; commit scoped files.

## Task 3: Source hygiene and prompt

- [x] Add failing tests for revoked source filtering and prompt injection in Jira summaries.
- [x] Run focused tests and record failure.
- [x] Add memory source invalidation and explicit Jira grounding rules in prompt.
- [x] Run focused and planner tests; commit scoped files.

## Task 4: Evaluation and integration

- [x] Commit labeled Jira eval fixtures before any model call.
- [x] Run `npm run test -w @wap/planner` and `npm run check`.
- [x] Confirm JIRA-06 output schema; run sandbox integration after JIRA-06/08 are available.
- [x] Fill task card result, add one handoff log, open PR without merging.

