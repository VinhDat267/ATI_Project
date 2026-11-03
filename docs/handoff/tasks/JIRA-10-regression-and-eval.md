# JIRA-10 · Jira OAuth 3LO Regression, 11 Security Mutations, Browser E2E & Golden Evaluation (×3)

**Status:** Complete (ready for review). **Owner:** Evaluation & QA (`evaluations/`, `scripts/`, `apps/chat-web/tests/browser/`). **Branch:** `eval/jira-10-regression-and-eval`.

## Scope

Complete the full regression, security mutation, browser E2E, and Golden v2 evaluation gate for personal Jira (`myjira.*` tools) per Spec §12:
- **JIRA-10A (Preregistered Golden Set — 24 cases):**
  - Expand `evaluations/golden/cases-myjira.json` and `evaluations/golden-v2/cases-myjira.json` from 18 to 24 cases (`mj01`–`mj20` author cases + `mi01`–`mi04` independent cases) covering all 10 mandatory Spec §12 categories (including `read_only`, `scope_required` refusal, and `WorkingMemory` composite `(workspaceId, siteId)` grounding).
  - Add `myjira` (`siteId`, `projectKey`, `issueKey`) WorkingMemory preloading to `evaluations/golden-v2/fixtures.ts` (`makeWorkingMemory`), `workspaceId: 'ws-eval'` actor context in `evaluations/golden-v2/run.ts`, and concise `myjira` multi-site / read-only planning guidance in `packages/planner/src/prompts/system-prompt.ts`.
  - Commit preregistered labels (`105cdb7b`) before any live model calls.
- **JIRA-10B (11 Mandatory Security Mutations — Spec §12):**
  - Create `scripts/test-myjira-mutations.mjs` automating all 11 mandatory security mutations (`M1`–`M11`) with SHA-256 file restoration verification.
- **JIRA-10C (Playwright Browser E2E — Cockpit Preview → Approve → Receipt):**
  - Extend `apps/chat-web/tests/browser/jira-09a.spec.ts` with a full E2E browser journey from `/settings#jira` (`#jira-start-conversation`) to Cockpit Moment 4 (`PlanMoment` with `atlassianAccountId`, `workspaceId`, `Site đích`, and step preview modal `#preview-s1`) through `#btn-approve-plan` to Moment 6 (`ReceiptMoment` with `ATI-101` and `Mở trong Jira` deep link).
- **JIRA-10D (Live Golden v2 Evaluation `×3` & Evidence Report):**
  - Run `LIVE_EVAL=1 EVAL_SET=myjira PLANNER_SEARCH_MODE=llm EVAL_RUNS=3` via `9router`, preserve all campaign folders (including partial runs), and document full metrics and separated independent-case results in `docs/ai-evidence/V3-GOLDEN-V2/2026-11-03-JIRA-10-REPORT.md`.

## Acceptance

- Preregistered 24-case `myjira` set passes schema/hash validation (`evaluations/golden-v2/run-myjira.test.ts` and `packages/planner/tests/evaluation/golden.test.ts`) and is committed before model calls.
- `node scripts/test-myjira-mutations.mjs` catches `11/11` mutations (`M1`–`M11`) and restores all target files with 100% SHA-256 verification.
- `node scripts/test-v3-browser.mjs tests/browser/jira-09a.spec.ts` passes `2/2` browser tests with `externalRequests = []`.
- Live Golden v2 `myjira` `×3` campaign meets Spec §12 thresholds (`Tools ≥ 85%`, `Arguments ≥ 75%`) and preserves all evidence folders under `docs/ai-evidence/V3-GOLDEN-V2/`.

## Results

### Implementation Highlights
1. **Preregistered 24-Case `myjira` Golden Set (`105cdb7b`)**:
   - Added `mj19` (`read_only` immediate clarification), `mj20` (`WorkingMemory` `jira_issue` + `jira_site` grounding), and `mi01`–`mi04` (`promptSource: "independent"`).
   - Updated `evaluations/golden-v2/fixtures.ts`, `evaluations/golden-v2/run.ts`, `evaluations/golden-v2/run-myjira.test.ts`, `packages/planner/tests/evaluation/golden.test.ts`, and `packages/planner/src/prompts/system-prompt.ts`.
2. **11 Security Mutations Runner (`scripts/test-myjira-mutations.mjs`)**:
   - Implemented `M1`–`M11` covering owner `(user_id, workspace_id)` binding, `pending` member denial, adapter site/project intersection, `WorkingMemory` `workspaceId` namespace, composite `(workspaceId, siteId)` grounding, server `connections.myjira` binding, `invalid_grant` → `reconnect_required`, stale policy version rejection, no fallback to legacy `jira.*`, OAuth callback stale-session guard, and `UNKNOWN` error classification on `myjira` write timeout/5xx.
3. **Browser E2E (`apps/chat-web/tests/browser/jira-09a.spec.ts`)**:
   - Added `JIRA-10C: exercises #jira-start-conversation -> Cockpit preview -> approve -> receipt with myjira binding` and verified `2/2` Playwright tests pass.
4. **Live Golden v2 Evaluation `×3` (`docs/ai-evidence/V3-GOLDEN-V2/2026-11-03-JIRA-10-REPORT.md`)**:
   - Preserved partial campaign `myjira-llm-2026-11-03T11-05-18-984Z` (`21/72` at `EVAL_CONCURRENCY=2`) and completed full `×3` campaign `myjira-llm-2026-11-03T11-10-47-697Z` (`72/72` at `EVAL_CONCURRENCY=1`).
   - Achieved **Tools: `100.0%`** (target `≥ 85%`), **Arguments: `100.0%`** (target `≥ 75%`), **Strict pass: `98.6%` (`71/72`)** (`24/24`, `23/24`, `24/24`), and **Independent cases (`mi01`–`mi04`): `100.0%` (`12/12`)**.

### Verification Evidence
- **Golden v2 & Planner Evaluation Unit Tests**:
  `npx vitest run evaluations/golden-v2/run-myjira.test.ts packages/planner/tests/evaluation/golden.test.ts evaluations/generic-plumbing/static-guard.test.ts`
  - Output: 3 test files passed, 32 tests passed (exit code 0).
- **11 Security Mutations (`M1`–`M11`)**:
  `node scripts/test-myjira-mutations.mjs`
  - Output: `All 11 myjira security mutations caught and verified! Files 100% restored.` (`11/11 PASS ✅`, exit code 0).
- **Playwright Browser E2E (`jira-09a.spec.ts`)**:
  `node scripts/test-v3-browser.mjs tests/browser/jira-09a.spec.ts`
  - Output: `2 passed (20.9s)` (exit code 0).
- **Live Golden v2 `myjira` `×3` Campaign**:
  `LIVE_EVAL=1 EVAL_SET=myjira PLANNER_SEARCH_MODE=llm EVAL_CONCURRENCY=1 EVAL_RUNS=3 node --env-file=.env --import tsx evaluations/golden-v2/run.ts`
  - Output: `run 1: 24/24 strict`, `run 2: 23/24 strict`, `run 3: 24/24 strict` (`71/72` strict, `100.0%` tools, `100.0%` arguments, exit code 0).

### Limitations
- Golden v2 evaluates planner behavior against deterministic synthetic search/WorkingMemory fixtures; live Atlassian Cloud execution (`P-LIVE`) is covered separately under `JIRA-11`.
