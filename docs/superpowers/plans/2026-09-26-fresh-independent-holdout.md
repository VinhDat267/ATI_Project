# Fresh Independent Pilot Holdout Implementation Plan

> **For agentic workers:** Execute inline in the current isolated worktree. This is a data and evaluation workflow, not a request to modify product behavior. Steps use checkbox syntax for tracking.

**Goal:** Add a separately authored, source-complete 20-variant model-only holdout and freeze a new Gemini campaign without changing or reusing the opened prior holdout.

**Architecture:** Add a new immutable dataset version and provenance sidecar, then bind both into a distinct evaluation profile and freeze hash. Validate source IDs, tab IDs, source rows, eligibility, non-overlap, and oracle integrity before preparing a manifest; provider calls remain behind the existing 0 USD Free Tier gate.

**Tech Stack:** TypeScript, Zod, Vitest, Node.js campaign CLI, Gemini Interactions API.

**Spec:** User-approved request in this task; existing guardrails in `docs/ai-evidence/PILOT-V2-AI/MODEL-SCOPE-2026-09-26.md` and `docs/superpowers/specs/2026-09-26-pilot-full-dsl-quality-gate-design.md`.

## Global Constraints

- Never read, copy, repair, adjudicate, or run the previously opened holdout (`ai-holdout-v1.json`).
- Author new synthetic cases independently of public observations; source IDs and tab IDs must be explicit and synthetic, never user credentials or real SaaS resource IDs.
- Hash dataset bytes and provenance into the freeze; refuse provider authorization unless dataset and all metadata validate.
- Fixed-catalog only; no Trello, Sheets, or product tool execution.
- Budget is exactly `0 USD`; one campaign, at most 46 calls, bounded token caps; stop on any missing usage, failed provider attempt, unsafe output, or journal uncertainty.
- Preserve all pre-existing user changes outside this worktree.
- Keep automatic structural grade, independent semantic adjudication, and user acceptance as separate evidence.

## Review Focus

- New dataset has every `variantId` unique and every case ID disjoint from public and previous version.
- All source fixtures provide nonempty spreadsheet and tab identifiers which match the allowed-source policy.
- Both language variants encode the same expected outcome and exact tool args.
- Freeze fingerprints the v2 dataset, provenance, and versioned evaluation profile.
- Missing/invalid source metadata fails before reservation/provider call.
- No holdout observations are used to tune prompt or evaluator after the freeze.

---

### Task 1: Version the holdout contract

**Files:** `quality-scope.ts`, `quality-freeze.ts`, `provider-quality-runner.ts`, `pilot-ai-quality-campaign.mjs`, associated tests.

- [x] Add the `model-only-v2` profile, filename mapping, and holdout ID family without changing v1 or the opened v1 dataset.
- [x] Bind `ai-holdout-v2.json`, its provenance sidecar, and `dataset-schema.ts` into the v2 freeze fingerprint.
- [x] Require nonempty `spreadsheetId` and `tabId` on v2 holdout fixtures and reject invalid metadata before reservation.
- [x] Add tests proving selection, hashing, non-overlap, and the pre-provider failure boundary.
- [x] Run targeted tests and build.

### Task 2: Author and validate the new synthetic dataset

**Files:** `testdata/v2-dataset/ai-holdout-v2.json`, `testdata/v2-dataset/ai-holdout-v2.meta.json`, dataset validation tests.

- [x] Author 10 new bilingual scenarios with complete source rows, trusted synthetic source IDs, explicit expected outcomes, and independent case IDs.
- [x] Record provenance, authorship/review state, dataset hash, and source metadata in a sidecar without prompts from or observations of v1.
- [x] Validate schema, fixture compatibility, exact 20 count, language pairing, uniqueness, no public overlap, and secret-pattern scan.
- [x] Freeze the new manifest from a clean committed HEAD after a fresh exact-model price fetch and a valid Free Tier attestation.
- [x] Do not run the campaign until frozen manifest and all checks agree.

### Task 3: Run and adjudicate

**Files:** local manifest/journal/report outside Git; committed aggregate evidence and adjudication checklist only.

- [x] Run probe, smoke, public, then holdout once in the successful frozen campaign; the earlier separately frozen campaign stopped on a provider 503 and is not merged into these observations.
- [x] Grade exact contract results and independently adjudicate semantic differences; retain case IDs, fixed reason codes, and aggregate evidence in Git.
- [x] Prepare user-acceptance sheet for the project owner; user acceptance remains pending the user's decision.
- [ ] Verify all evidence, tests, diff, and branch state; commit and push the dedicated branch.

Campaign evidence and semantic adjudication: [Fresh Holdout v2 campaign report](../../ai-evidence/PILOT-V2-AI/FRESH-HOLDOUT-V2-2026-09-26.md).
