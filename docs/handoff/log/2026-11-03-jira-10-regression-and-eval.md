# JIRA-10 · Jira OAuth 3LO Regression, 11 Security Mutations, Browser E2E & Golden Evaluation (×3) — 2026-11-03

- **Task:** `docs/handoff/tasks/JIRA-10-regression-and-eval.md`
- **Report:** `docs/ai-evidence/V3-GOLDEN-V2/2026-11-03-JIRA-10-REPORT.md`
- **Branch:** `eval/jira-10-regression-and-eval`
- **Scope (`evaluations/`, `scripts/`, `apps/chat-web/tests/browser/`, `packages/planner/`):**
  1. `evaluations/golden/cases-myjira.json` & `evaluations/golden-v2/cases-myjira.json`: expanded `myjira` golden set to 24 cases (`mj01`–`mj20` author + `mi01`–`mi04` independent) covering all 10 mandatory Spec §12 categories; preregistered at commit `105cdb7b` prior to live LLM runs.
  2. `evaluations/golden-v2/fixtures.ts`, `evaluations/golden-v2/run.ts`, `evaluations/golden-v2/run-myjira.test.ts`, `packages/planner/tests/evaluation/golden.test.ts`, & `packages/planner/src/prompts/system-prompt.ts`: added `myjira` WorkingMemory entity preloading (`jira_site`, `jira_project`, `jira_issue` with `workspaceId: 'ws-eval'`), `myjira` actor `workspaceId`, and concise `myjira` planning prompt rules.
  3. `scripts/test-myjira-mutations.mjs`: implemented automated runner for all 11 mandatory Spec §12 security mutations (`M1`–`M11`) with SHA-256 restoration checks.
  4. `apps/chat-web/tests/browser/jira-09a.spec.ts`: added `JIRA-10C` browser E2E test covering `/settings#jira` (`#jira-start-conversation`) → Cockpit Moment 4 (`PlanMoment` + `#preview-s1` modal) → `#btn-approve-plan` → Moment 6 (`ReceiptMoment` with `ATI-101` and `Mở trong Jira` deep link).
  5. `docs/ai-evidence/V3-GOLDEN-V2/`: recorded partial campaign `myjira-llm-2026-11-03T11-05-18-984Z`, completed `×3` campaign `myjira-llm-2026-11-03T11-10-47-697Z` (`71/72` strict, `100.0%` tools, `100.0%` arguments), and synthesized `2026-11-03-JIRA-10-REPORT.md`.

## Verification Evidence
- `npx vitest run evaluations/golden-v2/run-myjira.test.ts packages/planner/tests/evaluation/golden.test.ts evaluations/generic-plumbing/static-guard.test.ts`: **3/3 files PASS, 32/32 tests PASS** (exit code 0).
- `node scripts/test-myjira-mutations.mjs`: **11/11 mutations CAUGHT (`M1`–`M11`), 100% SHA-256 restored** (exit code 0).
- `node scripts/test-v3-browser.mjs tests/browser/jira-09a.spec.ts`: **2/2 Playwright browser E2E tests PASS (`20.9s`)** (exit code 0).
- `LIVE_EVAL=1 EVAL_SET=myjira PLANNER_SEARCH_MODE=llm EVAL_CONCURRENCY=1 EVAL_RUNS=3 node --env-file=.env --import tsx evaluations/golden-v2/run.ts`: **`71/72` strict (`98.6%`: `24/24`, `23/24`, `24/24`), Tools `100.0%`, Arguments `100.0%`, Independent cases `12/12` (`100.0%`)** (exit code 0).
