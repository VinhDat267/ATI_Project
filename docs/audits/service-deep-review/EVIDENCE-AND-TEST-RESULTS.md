# Evidence & Test Verification Log — Independent Deep Service Audit (Waves 1, 2, 3 & 4 — Complete)

- **Repository:** `VinhDat267/ATI_Project`
- **Audit Worktree:** `C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit`
- **Audit Branch:** `independent_service_audit`
- **Baseline Commit SHA (`origin/main`):** `08c8d8c5e7bf12625857ac3496fb96ec3914e34f`
- **Tracked Product Code Diff (`git diff origin/main -- packages apps db prompts evaluations`):** `0` changes
- **Isolated Test Database:** PostgreSQL 16 container `ati-pr277-fix-db` on `localhost:56534/ati_v3`

---

## 1. Baseline & Working Tree Verification

Executed directly on the audit worktree (`C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit`):

```text
HEAD=08c8d8c5e7bf12625857ac3496fb96ec3914e34f
ORIGIN_MAIN=08c8d8c5e7bf12625857ac3496fb96ec3914e34f
BRANCH=independent_service_audit
DIFF_COUNT=0
```

All test files listed in this report were enumerated directly from `git ls-files` at `08c8d8c5e7bf12625857ac3496fb96ec3914e34f` and verified on disk before execution.

---

## 2. True Set-Union Reconciliation & Full-Relative-Path Manifest (Waves 1, 2, 3 & 4)

### 2.1. Reconciliation of Set Union vs Checkpoint Re-Run Counts
1. **Why Raw Checkpoint Sums Must Not Be Added:**
   - In **Wave 1**, `npm test -w` executed **100% of test files** across 5 workspaces:
     - `packages/tool-schemas`: **`25` Vitest files (`579` tests)**
     - `packages/tool-adapters`: **`22` Vitest files (`638` tests)** + **`1` Node `--test` probe file (`packages/tool-adapters/tests/jira-oauth-probe.check.mjs`, `32` tests)** (`23` files / `670` tests)
     - `packages/planner`: **`39` Vitest files (`555` tests)**
     - `packages/executor`: **`7` Vitest files (`56` tests)**
     - `apps/chat-web`: **`114` Vitest files (`1,198` tests)**
     - Plus **`100` unique `apps/chat-api` files (`1,026` tests)** across `W1-A` (`32` files / `237` tests), `W1-B` (`56` net-new files / `680` tests), and `W1-C` (`12` files / `109` tests).
     - **Wave 1 True Unique Set (`|W1|`):** **`307` Vitest files (`4,052` tests) + `1` Node `--test` probe file (`32` tests) = `308` unique repository test files / `4,084` unique repository test cases**. *(The earlier summary row stating `275` files / `3,897` tests was an estimated service slice and is replaced below by the exact full-path manifest.)*
   - In **Wave 2**, `83` files (`1,107` tests) were executed. Because `packages/tool-schemas`, `packages/tool-adapters`, and `apps/chat-web` were already executed in full during Wave 1, the **`26` files (`269` tests)** run in those 3 workspaces during Wave 2 (`4` `tool-schemas` [`66` tests] + `7` `tool-adapters` [`88` tests] + `15` `chat-web` [`115` tests]) are **checkpoint re-runs (subsets of Wave 1)**, whereas the **`57` `apps/chat-api` files (`838` tests)** (`11` `W2-A` Trello [`106` tests] + `46` `W2-B` Jira/Workspace [`732` tests]) have `0` overlap with Wave 1 (`|W2 \ W1| = 57` unique files / `838` unique tests).
   - In **Wave 3**, `31` files (`229` tests) were executed. Of these, **`7` files (`118` tests)** in `packages/tool-schemas` (`1`), `packages/planner` (`1`), `packages/tool-adapters` (`2`), and `apps/chat-web` (`3`) were already executed in Wave 1's full-workspace runs, and **`1` `apps/chat-api` file (`4` tests)** (`apps/chat-api/tests/services/schedules/telegram-digest-github.test.ts`) was already executed in Wave 1 `W1-A`. Thus **`8` files (`122` tests)** in Wave 3 are **checkpoint re-runs (subsets of Wave 1)**, and **`23` `apps/chat-api` files (`107` tests)** (`12` GitHub [`77` tests] + `11` Notion [`30` tests]) are net-new unique repository test files (`|W3 \ (W1 ∪ W2)| = 23` unique files / `107` unique tests).
   - In **Wave 4**, **`11` net-new `apps/chat-api` files (`110` tests)** covering interactive `mysheets`/`sheets`, `report-evidence`, and `execution` recovery/security were executed with `0` overlap against `W1 ∪ W2 ∪ W3` (`|W4 \ (W1 ∪ W2 ∪ W3)| = 11` unique files / `110` unique tests).

### 2.2. Master Set-Union Summary Table (Strictly Separating Unique Union, Re-Runs & Reproduction Harness)

| Partition / Set Definition | Workspace Breakdown | Raw Checkpoint File Runs | Checkpoint Re-Run Overlap Deducted | **Net-New Unique Repo Files** | **Net-New Unique Repo Tests** | Execution Runner & Exit Code |
|---|---|---:|---:|---:|---:|---|
| **Wave 1 Unique Set (`W1`)** | `packages/tool-schemas` (`25` files: `579` tests), `packages/tool-adapters` (`22` Vitest files: `638` tests + `1` Node `--test` probe file: `32` tests), `packages/planner` (`39` files: `555` tests), `packages/executor` (`7` files: `56` tests), `apps/chat-web` (`114` files: `1,198` tests), `apps/chat-api` (`100` files: `32` `W1-A` [`237` tests] + `56` `W1-B` [`680` tests] + `12` `W1-C` [`109` tests] = `1,026` tests) | `308` | `0` | **`308`** (`307` Vitest + `1` Node probe) | **`4,084`** (`4,052` Vitest + `32` Node probe) | `npm test -w` (`5` workspaces) + `npx vitest run` (`100` `chat-api` files) (`EXIT=0`) |
| **Wave 2 Net-New Addition (`W2 \ W1`)** | `apps/chat-api` (`57` net-new files: `11` `W2-A` Trello [`106` tests] + `46` `W2-B` Jira/Workspace [`732` tests]); deducts `26` subset re-runs (`269` tests) in `tool-schemas` (`4`), `tool-adapters` (`7`), and `chat-web` (`15`) already in `W1` | `83` (`1,107` raw tests) | `-26` files (`-269` tests in `W1`) | **`57`** | **`838`** | `npx --prefix apps/chat-api vitest run` (`EXIT=0`) |
| **Wave 3 Net-New Addition (`W3 \ (W1 ∪ W2)`)** | `apps/chat-api` (`23` net-new files: `12` GitHub [`77` tests] + `11` Notion [`30` tests]); deducts `8` subset re-runs (`122` tests) already in `W1` (`4` `packages/*` [`90` tests], `3` `chat-web` [`28` tests], and `1` `chat-api` file `tests/services/schedules/telegram-digest-github.test.ts` [`4` tests]) | `31` (`229` raw tests) | `-8` files (`-122` tests in `W1`) | **`23`** | **`107`** | `npx --prefix apps/chat-api vitest run` (`EXIT=0`) |
| **Wave 4 Net-New Addition (`W4 \ (W1 ∪ W2 ∪ W3)`)** | `apps/chat-api` (`11` net-new files: interactive `mysheets`/`sheets`, `report-evidence`, `execution-routes`, `execution-security`, `memory-execution-snapshot`) | `11` (`110` raw tests) | `0` | **`11`** | **`110`** | `npx vitest run` (`EXIT=0`) |
| **True Set Union (`W1 ∪ W2 ∪ W3 ∪ W4`) — Unique Repository Test Suites** | **`25` `tool-schemas` + `23` `tool-adapters` (`22` Vitest + `1` Node probe) + `39` `planner` + `7` `executor` + `114` `chat-web` + `191` `chat-api` (`100 + 57 + 23 + 11`)** | `433` *(total file runs)* | `-34` *(re-run file executions)* | **`399`** (`398` Vitest + `1` Node probe) | **`5,139`** (`5,107` Vitest + `32` Node probe) | **All `399` unique repo files (`5,139` unique tests) `EXIT=0`** |
| **Separate Checkpoint Re-Run Count (Not in Unique Total)** | `26` Wave 2 re-runs (`269` tests) + `8` Wave 3 re-runs (`122` tests) | `34` *(re-runs)* | N/A | *(`0` net-new)* | *(`391` re-run test executions)* | `EXIT=0` |
| **Separate Ephemeral Audit Reproduction Harnesses (Not in Repo Total)** | Unified Sanitized 14-Test Package `apps/chat-api/tests/integration/__audit_repro_all_14_temp.test.ts` (`10` W1–W3 tests + `4` W4 tests = `14` tests; also run individually as `__audit_repro_temp.test.ts` and `__audit_repro_w4_temp.test.ts`) — self-contained source embedded in §6.6, deleted in `finally` | `1` unified *(or `2` split temp)* | N/A | **`1` *(ephemeral)*** | **`14` *(reproduction tests)*** | `npx vitest run` (`EXIT=0`) |

### 2.3. Complete Manifest by Full Relative Path (`399` Unique Repository Test Files in `W1 ∪ W2 ∪ W3 ∪ W4`)

Every path below is verified in `git ls-files` at `08c8d8c5e7bf12625857ac3496fb96ec3914e34f`:

#### A. `packages/tool-schemas` (`25` Unique Files / `579` Unique Tests — Executed in `W1`; Subset Re-Runs in `W2`/`W3` Marked)
- `packages/tool-schemas/tests/calendar.test.ts`
- `packages/tool-schemas/tests/gather-patterns.test.ts`
- `packages/tool-schemas/tests/gmail.test.ts`
- `packages/tool-schemas/tests/jira.test.ts` *(re-run in W2)*
- `packages/tool-schemas/tests/mycalendar-schemas.test.ts`
- `packages/tool-schemas/tests/myjira-context.test.ts`
- `packages/tool-schemas/tests/myjira-dto.test.ts`
- `packages/tool-schemas/tests/myjira-policy.test.ts` *(re-run in W2)*
- `packages/tool-schemas/tests/myjira-regression.test.ts` *(re-run in W2)*
- `packages/tool-schemas/tests/myjira-schemas.test.ts` *(re-run in W2)*
- `packages/tool-schemas/tests/mysheets-schemas.test.ts`
- `packages/tool-schemas/tests/myslack-assistant.test.ts`
- `packages/tool-schemas/tests/myslack-connection.test.ts`
- `packages/tool-schemas/tests/myslack-context.test.ts`
- `packages/tool-schemas/tests/myslack-plan-bindings.test.ts`
- `packages/tool-schemas/tests/myslack-policy.test.ts`
- `packages/tool-schemas/tests/myslack-post-plan.test.ts`
- `packages/tool-schemas/tests/myslack-source.test.ts`
- `packages/tool-schemas/tests/myslack-tools.test.ts`
- `packages/tool-schemas/tests/notion.test.ts` *(re-run in W3)*
- `packages/tool-schemas/tests/registry-invariants.test.ts`
- `packages/tool-schemas/tests/report-intent.test.ts`
- `packages/tool-schemas/tests/schemas.test.ts`
- `packages/tool-schemas/tests/sheets.test.ts`
- `packages/tool-schemas/tests/telegram.test.ts`

#### B. `packages/tool-adapters` (`23` Unique Files: `22` Vitest [`638` Tests] + `1` Node Probe [`32` Tests] — Executed in `W1`)
- `packages/tool-adapters/tests/bounded-results.test.ts`
- `packages/tool-adapters/tests/calendar-adapter.test.ts`
- `packages/tool-adapters/tests/calendar/personal-calendar-adapter.test.ts`
- `packages/tool-adapters/tests/crypto-ratelimit.test.ts`
- `packages/tool-adapters/tests/generic-scope.test.ts`
- `packages/tool-adapters/tests/github-adapter.test.ts` *(re-run in W3)*
- `packages/tool-adapters/tests/gmail-adapter.test.ts`
- `packages/tool-adapters/tests/google-service-account.test.ts`
- `packages/tool-adapters/tests/jira-adapter.test.ts` *(re-run in W2)*
- `packages/tool-adapters/tests/jira-oauth-probe.check.mjs` *(`node --test`, `32` tests)*
- `packages/tool-adapters/tests/notion-adapter.test.ts` *(re-run in W3)*
- `packages/tool-adapters/tests/personal-jira-adapter.test.ts` *(re-run in W2)*
- `packages/tool-adapters/tests/sheets-adapter.test.ts`
- `packages/tool-adapters/tests/sheets/personal-sheets-adapter.test.ts`
- `packages/tool-adapters/tests/slack-adapter.test.ts`
- `packages/tool-adapters/tests/slack/personal-slack-boundaries.test.ts`
- `packages/tool-adapters/tests/slack/personal-slack-read.test.ts`
- `packages/tool-adapters/tests/telegram-adapter.test.ts`
- `packages/tool-adapters/tests/transport-remediation.test.ts` *(re-run in W2)*
- `packages/tool-adapters/tests/trello-base.test.ts` *(re-run in W2)*
- `packages/tool-adapters/tests/trello-oauth-scope.test.ts` *(re-run in W2)*
- `packages/tool-adapters/tests/trello-read.test.ts` *(re-run in W2)*
- `packages/tool-adapters/tests/trello-write.test.ts` *(re-run in W2)*

#### C. `packages/planner` (`39` Unique Files / `555` Unique Tests — Executed in `W1`)
- `packages/planner/tests/actor-forwarding.test.ts`
- `packages/planner/tests/agentic-search.test.ts`
- `packages/planner/tests/calendar-routing.test.ts`
- `packages/planner/tests/deepseek-provider.test.ts`
- `packages/planner/tests/directory-prefetch.test.ts`
- `packages/planner/tests/evaluation/golden.test.ts`
- `packages/planner/tests/gather-service-names.test.ts`
- `packages/planner/tests/gemini-provider.test.ts`
- `packages/planner/tests/gmail-grounding.test.ts`
- `packages/planner/tests/gmail-search.test.ts`
- `packages/planner/tests/jira-routing.test.ts`
- `packages/planner/tests/key-grounding.test.ts`
- `packages/planner/tests/myjira-grounding.test.ts`
- `packages/planner/tests/myjira-routing.test.ts`
- `packages/planner/tests/myjira-security-source.test.ts`
- `packages/planner/tests/mysheets-routing.test.ts`
- `packages/planner/tests/notion-routing.test.ts` *(re-run in W3)*
- `packages/planner/tests/openai-compatible-provider.test.ts`
- `packages/planner/tests/planner.test.ts`
- `packages/planner/tests/read-answers.test.ts`
- `packages/planner/tests/read-only-policy.test.ts`
- `packages/planner/tests/refusal-naming.test.ts`
- `packages/planner/tests/report-evidence.test.ts`
- `packages/planner/tests/report-native-contracts.test.ts`
- `packages/planner/tests/report-renderers-all.test.ts`
- `packages/planner/tests/schedules.test.ts`
- `packages/planner/tests/schedule-validator.test.ts`
- `packages/planner/tests/search-bounds.test.ts`
- `packages/planner/tests/sheets-routing.test.ts`
- `packages/planner/tests/slack-model-attempts.test.ts`
- `packages/planner/tests/slack-proposal-plan.test.ts`
- `packages/planner/tests/slack-read-plan.test.ts`
- `packages/planner/tests/slack-triage.test.ts`
- `packages/planner/tests/structured-refusal.test.ts`
- `packages/planner/tests/telegram-routing.test.ts`
- `packages/planner/tests/tool-listing.test.ts`
- `packages/planner/tests/validator.test.ts`
- `packages/planner/tests/vietnamese-responses.test.ts`
- `packages/planner/tests/working-memory.test.ts`

#### D. `packages/executor` (`7` Unique Files / `56` Unique Tests — Executed in `W1`)
- `packages/executor/tests/controller.test.ts`
- `packages/executor/tests/gmail-pre-dispatch.test.ts`
- `packages/executor/tests/recovery.test.ts`
- `packages/executor/tests/resolver.test.ts`
- `packages/executor/tests/runner.test.ts`
- `packages/executor/tests/slack-post.test.ts`
- `packages/executor/tests/slack-read-guard.test.ts`

#### E. `apps/chat-web` (`114` Unique Files / `1,198` Unique Tests — Executed in `W1`)
- `apps/chat-web/tests/account-action-regressions.test.tsx`
- `apps/chat-web/tests/account-view.test.tsx`
- `apps/chat-web/tests/admin-users.test.tsx`
- `apps/chat-web/tests/app-auth.test.tsx`
- `apps/chat-web/tests/app-reconciliation.test.tsx`
- `apps/chat-web/tests/app-routing.test.tsx`
- `apps/chat-web/tests/app-safety.test.tsx`
- `apps/chat-web/tests/app-send.test.tsx`
- `apps/chat-web/tests/app-sessions.test.tsx`
- `apps/chat-web/tests/auth-google.test.tsx`
- `apps/chat-web/tests/auth-return-target.test.tsx`
- `apps/chat-web/tests/auth-signup-reset.test.tsx`
- `apps/chat-web/tests/cockpit-receipt-metrics.test.tsx`
- `apps/chat-web/tests/components/chat-container.test.tsx`
- `apps/chat-web/tests/components/execution-progress.test.tsx`
- `apps/chat-web/tests/components/gather-clarify.test.tsx`
- `apps/chat-web/tests/components/landing-page-view.test.tsx`
- `apps/chat-web/tests/components/login-view.test.tsx`
- `apps/chat-web/tests/components/message-time.test.tsx`
- `apps/chat-web/tests/components/mission-control-launchpad.test.tsx`
- `apps/chat-web/tests/components/plan-preview.test.tsx`
- `apps/chat-web/tests/components/plan-step-args.test.tsx`
- `apps/chat-web/tests/components/readable-workflow.test.tsx`
- `apps/chat-web/tests/components/recovery-editor.test.tsx`
- `apps/chat-web/tests/components/recovery-request.test.ts`
- `apps/chat-web/tests/components/service-credential-draft.test.tsx`
- `apps/chat-web/tests/components/service-naming.test.tsx`
- `apps/chat-web/tests/components/settings.test.tsx`
- `apps/chat-web/tests/components/settings-page.test.tsx`
- `apps/chat-web/tests/components/sidebar-history.test.tsx`
- `apps/chat-web/tests/components/sidebar-pagination.test.tsx`
- `apps/chat-web/tests/components/user-nav-menu.test.tsx`
- `apps/chat-web/tests/execution-snapshot.test.ts`
- `apps/chat-web/tests/fe-04b-prototype-foundation.test.tsx`
- `apps/chat-web/tests/fe-04-contrast.test.ts`
- `apps/chat-web/tests/fe-04-shell.test.tsx`
- `apps/chat-web/tests/fe-04-theme.test.tsx`
- `apps/chat-web/tests/fe-05b-parity-a.test.tsx`
- `apps/chat-web/tests/fe-05b-parity-b.test.tsx`
- `apps/chat-web/tests/fe-05-cockpit.test.tsx`
- `apps/chat-web/tests/fe-05-moment.test.ts`
- `apps/chat-web/tests/fe-05-request-ownership.test.ts`
- `apps/chat-web/tests/fe-06a-recovery.test.tsx`
- `apps/chat-web/tests/fe-06a-recovery-actions.test.tsx`
- `apps/chat-web/tests/fe-06b-errors.test.tsx`
- `apps/chat-web/tests/fe-06b-responses.test.tsx`
- `apps/chat-web/tests/fe-07-settings.test.tsx`
- `apps/chat-web/tests/fe-08-auth-deep-links.test.tsx`
- `apps/chat-web/tests/fe-08-landing-auth.test.tsx`
- `apps/chat-web/tests/fe-09-pages.test.tsx`
- `apps/chat-web/tests/fe-10-guide-privacy.test.tsx`
- `apps/chat-web/tests/fe-11-error-and-paths.test.tsx`
- `apps/chat-web/tests/fe-12-main-nav.test.tsx`
- `apps/chat-web/tests/fe-12-request-echo.test.tsx`
- `apps/chat-web/tests/github-connection.test.tsx` *(re-run in W3)*
- `apps/chat-web/tests/gmail-callback.test.tsx`
- `apps/chat-web/tests/gmail-plan-state.test.tsx`
- `apps/chat-web/tests/gmail-public.test.tsx`
- `apps/chat-web/tests/gmail-review-fixes.test.tsx`
- `apps/chat-web/tests/gmail-ui.test.tsx`
- `apps/chat-web/tests/google-picker.test.ts`
- `apps/chat-web/tests/guide-page.test.tsx`
- `apps/chat-web/tests/history-snapshot-race.test.tsx`
- `apps/chat-web/tests/jira-api.test.ts` *(re-run in W2)*
- `apps/chat-web/tests/jira-callback.test.tsx` *(re-run in W2)*
- `apps/chat-web/tests/jira-cockpit.test.tsx` *(re-run in W2)*
- `apps/chat-web/tests/jira-connection.test.tsx` *(re-run in W2)*
- `apps/chat-web/tests/jira-connection-responsive.test.tsx` *(re-run in W2)*
- `apps/chat-web/tests/landing-orbital-redesign.test.tsx`
- `apps/chat-web/tests/mycalendar-review-fixes.test.tsx`
- `apps/chat-web/tests/mycalendar-ui.test.tsx`
- `apps/chat-web/tests/mysheets-ui.test.tsx`
- `apps/chat-web/tests/notion-connection.test.tsx` *(re-run in W3)*
- `apps/chat-web/tests/oauth-01-flag.test.tsx`
- `apps/chat-web/tests/oauth-01-refusal.test.tsx`
- `apps/chat-web/tests/oauth-callback-session.test.tsx`
- `apps/chat-web/tests/personal-and-workspace-auth.test.tsx` *(re-run in W2)*
- `apps/chat-web/tests/planning-navigation.test.tsx`
- `apps/chat-web/tests/read-answers.test.tsx`
- `apps/chat-web/tests/sched-03-state.test.ts`
- `apps/chat-web/tests/sched-03-ui.test.tsx`
- `apps/chat-web/tests/schedule-calendar-digest-mode.test.tsx`
- `apps/chat-web/tests/schedule-github-digest-mode.test.tsx` *(re-run in W3)*
- `apps/chat-web/tests/schedule-recovery-and-modes.test.tsx` *(re-run in W2)*
- `apps/chat-web/tests/schedule-telegram-digest-mode.test.tsx`
- `apps/chat-web/tests/schedule-trello-digest-mode.test.tsx` *(re-run in W2)*
- `apps/chat-web/tests/services/api-client.test.ts`
- `apps/chat-web/tests/services/auth-sessions.test.ts`
- `apps/chat-web/tests/services/auth-storage.test.ts`
- `apps/chat-web/tests/services/conversation-time.test.ts`
- `apps/chat-web/tests/services/job-readiness.test.tsx` *(re-run in W2)*
- `apps/chat-web/tests/services/playbook-storage.test.ts`
- `apps/chat-web/tests/services/playbook-variables-and-catalog.test.tsx`
- `apps/chat-web/tests/services/workflow-defaults.test.ts` *(re-run in W2)*
- `apps/chat-web/tests/services/workflow-defaults-scope.test.tsx` *(re-run in W2)*
- `apps/chat-web/tests/settings-legacy-removal.test.ts`
- `apps/chat-web/tests/slack-assistant-settings.test.tsx`
- `apps/chat-web/tests/slack-oauth.test.tsx`
- `apps/chat-web/tests/slack-proposal-inbox.test.tsx`
- `apps/chat-web/tests/slack-read-controls.test.tsx`
- `apps/chat-web/tests/slack-read-refresh.test.ts`
- `apps/chat-web/tests/slack-read-results.test.tsx`
- `apps/chat-web/tests/sprint1-history-schedules-empty.test.tsx` *(re-run in W2)*
- `apps/chat-web/tests/sprint1-reopen-conversation.test.tsx` *(re-run in W2)*
- `apps/chat-web/tests/sprint1-workspace-switch.test.tsx` *(re-run in W2)*
- `apps/chat-web/tests/sse-auth-reconnect.test.tsx`
- `apps/chat-web/tests/sse-connection.test.tsx`
- `apps/chat-web/tests/store.test.ts`
- `apps/chat-web/tests/telegram-connection.test.tsx`
- `apps/chat-web/tests/trello-connection.test.tsx` *(re-run in W2)*
- `apps/chat-web/tests/trello-ui-ux.test.tsx` *(re-run in W2)*
- `apps/chat-web/tests/use-sse.test.ts`
- `apps/chat-web/tests/use-sse-hidden.test.tsx`
- `apps/chat-web/tests/workflow-flow-canvas.test.tsx`

#### F. `apps/chat-api` (`191` Unique Files / `2,081` Unique Tests Across `W1 ∪ W2 ∪ W3 ∪ W4`)
- **Wave 1 `W1-A` (`32` Unique Files / `237` Unique Tests):**
  - `apps/chat-api/tests/config/gmail-env.test.ts`
  - `apps/chat-api/tests/config/gmail-sandbox.test.ts`
  - `apps/chat-api/tests/config/google-project-isolation.test.ts`
  - `apps/chat-api/tests/config/telegram-env.test.ts`
  - `apps/chat-api/tests/config/telegram-sandbox.test.ts`
  - `apps/chat-api/tests/db/gmail-connection-repo.test.ts`
  - `apps/chat-api/tests/db/gmail-migration.test.ts`
  - `apps/chat-api/tests/db/telegram-oauth-migration.test.ts`
  - `apps/chat-api/tests/db/telegram-team-repo.test.ts`
  - `apps/chat-api/tests/db/telegram-update-repo.test.ts`
  - `apps/chat-api/tests/integration/gmail-personal-ab.test.ts`
  - `apps/chat-api/tests/integration/gmail-tools.test.ts`
  - `apps/chat-api/tests/integration/telegram-extension.test.ts`
  - `apps/chat-api/tests/routes/gmail-connections.test.ts`
  - `apps/chat-api/tests/routes/gmail-services.test.ts`
  - `apps/chat-api/tests/routes/google-grant-isolation.test.ts`
  - `apps/chat-api/tests/routes/google-transport.test.ts`
  - `apps/chat-api/tests/routes/telegram-connections.test.ts`
  - `apps/chat-api/tests/routes/telegram-scope.test.ts`
  - `apps/chat-api/tests/routes/telegram-shared-credentials.test.ts`
  - `apps/chat-api/tests/sandbox/telegram-sandbox.test.ts`
  - `apps/chat-api/tests/services/chat-service-gmail.test.ts`
  - `apps/chat-api/tests/services/gmail-oauth-errors.test.ts`
  - `apps/chat-api/tests/services/gmail-token-manager.test.ts`
  - `apps/chat-api/tests/services/google-project-revocation.test.ts`
  - `apps/chat-api/tests/services/schedules/telegram-digest-cancellation.test.ts`
  - `apps/chat-api/tests/services/schedules/telegram-digest-github.test.ts` *(also re-run in W3)*
  - `apps/chat-api/tests/services/schedules/telegram-digest-proposal.test.ts`
  - `apps/chat-api/tests/services/schedules/telegram-digest-runner.test.ts`
  - `apps/chat-api/tests/services/telegram-bot-client.test.ts`
  - `apps/chat-api/tests/services/telegram-planning.test.ts`
  - `apps/chat-api/tests/services/telegram-scope.test.ts`
- **Wave 1 `W1-B` (`56` Unique Files / `680` Unique Tests):**
  - `apps/chat-api/tests/cli/slack-consent-cli.test.ts`
  - `apps/chat-api/tests/config/slack-oauth-env.test.ts`
  - `apps/chat-api/tests/db/slack-assistant-artifact-repo.test.ts`
  - `apps/chat-api/tests/db/slack-assistant-repo.test.ts`
  - `apps/chat-api/tests/db/slack-connection-repo.test.ts`
  - `apps/chat-api/tests/db/slack-consent-repo.test.ts`
  - `apps/chat-api/tests/db/slack-derived-lineage-repo.test.ts`
  - `apps/chat-api/tests/db/slack-event-receipt-repo.test.ts`
  - `apps/chat-api/tests/db/slack-fanout-repo.test.ts`
  - `apps/chat-api/tests/db/slack-ingress-source-lock-order.test.ts`
  - `apps/chat-api/tests/db/slack-lifecycle-validation-repo.test.ts`
  - `apps/chat-api/tests/db/slack-source-repo.test.ts`
  - `apps/chat-api/tests/integration/slack-assistant-native.test.ts`
  - `apps/chat-api/tests/integration/slack-derived-expiry-runtime.test.ts`
  - `apps/chat-api/tests/integration/slack-fanout-native.test.ts`
  - `apps/chat-api/tests/integration/slack-message-memory-runtime.test.ts`
  - `apps/chat-api/tests/integration/slack-message-origin-runtime.test.ts`
  - `apps/chat-api/tests/integration/slack-native-runtime.test.ts`
  - `apps/chat-api/tests/integration/slack-plan-execution-runtime.test.ts`
  - `apps/chat-api/tests/integration/slack-plan-origin-runtime.test.ts`
  - `apps/chat-api/tests/integration/slack-public-read.test.ts`
  - `apps/chat-api/tests/integration/slack-public-write.test.ts`
  - `apps/chat-api/tests/integration/slack-read-binding.test.ts`
  - `apps/chat-api/tests/integration/slack-schedule-origin-runtime.test.ts`
  - `apps/chat-api/tests/integration/slack-schedule-runtime.test.ts`
  - `apps/chat-api/tests/routes/slack-assistant.test.ts`
  - `apps/chat-api/tests/routes/slack-compatibility.test.ts`
  - `apps/chat-api/tests/routes/slack-connections.test.ts`
  - `apps/chat-api/tests/routes/slack-events-ingress.test.ts`
  - `apps/chat-api/tests/routes/slack-events-lifecycle.test.ts`
  - `apps/chat-api/tests/routes/slack-proposals.test.ts`
  - `apps/chat-api/tests/services/slack/slack-authorizations-resolver.test.ts`
  - `apps/chat-api/tests/services/slack/slack-derived-policy-fanout.test.ts`
  - `apps/chat-api/tests/services/slack/slack-digest-service.test.ts`
  - `apps/chat-api/tests/services/slack/slack-fanout-runtime.test.ts`
  - `apps/chat-api/tests/services/slack/slack-invalidation-runner.test.ts`
  - `apps/chat-api/tests/services/slack/slack-invalidation-service.test.ts`
  - `apps/chat-api/tests/services/slack/slack-lifecycle-rotation.test.ts`
  - `apps/chat-api/tests/services/slack/slack-lifecycle-runtime.test.ts`
  - `apps/chat-api/tests/services/slack/slack-lifecycle-validation-worker.test.ts`
  - `apps/chat-api/tests/services/slack/slack-message-content-purger.test.ts`
  - `apps/chat-api/tests/services/slack/slack-message-purge-consumer.test.ts`
  - `apps/chat-api/tests/services/slack/slack-message-selectors.test.ts`
  - `apps/chat-api/tests/services/slack/slack-policy-event-consumer.test.ts`
  - `apps/chat-api/tests/services/slack/slack-private-read-wrapper.test.ts`
  - `apps/chat-api/tests/services/slack/slack-private-read-wrapper-provenance.test.ts`
  - `apps/chat-api/tests/services/slack/slack-rules-engine.test.ts`
  - `apps/chat-api/tests/services/slack/slack-source-store.test.ts`
  - `apps/chat-api/tests/services/slack/slack-triage-worker.test.ts`
  - `apps/chat-api/tests/services/slack/slack-write-safety.test.ts`
  - `apps/chat-api/tests/services/slack-ingress-env.test.ts`
  - `apps/chat-api/tests/services/slack-ingress-service.test.ts`
  - `apps/chat-api/tests/services/slack-oauth.test.ts`
  - `apps/chat-api/tests/services/slack-policy-service.test.ts`
  - `apps/chat-api/tests/services/slack-signature.test.ts`
  - `apps/chat-api/tests/services/slack-token-manager.test.ts`
- **Wave 1 `W1-C` (`12` Unique Files / `109` Unique Tests):**
  - `apps/chat-api/tests/config/calendar-sandbox.test.ts`
  - `apps/chat-api/tests/config/mycalendar-projects.test.ts`
  - `apps/chat-api/tests/db/calendar-digest-migration.test.ts`
  - `apps/chat-api/tests/db/mycalendar-migration.test.ts`
  - `apps/chat-api/tests/integration/calendar-extension.test.ts`
  - `apps/chat-api/tests/routes/mycalendar-connections.test.ts`
  - `apps/chat-api/tests/routes/mycalendar-services.test.ts`
  - `apps/chat-api/tests/services/calendar-conflict-planning.test.ts`
  - `apps/chat-api/tests/services/calendar-digest-approval.test.ts`
  - `apps/chat-api/tests/services/calendar-digest-delivery-safety.test.ts`
  - `apps/chat-api/tests/services/calendar-digest-runner.test.ts`
  - `apps/chat-api/tests/services/schedule-calendar-digest.test.ts`
- **Wave 2 Net-New `W2-A` & `W2-B` (`57` Unique Files / `838` Unique Tests):** Listed in full in Section 3.1 (`11` files) and Section 3.2 (`46` files) below.
- **Wave 3 Net-New (`23` Unique Files / `107` Unique Tests):** Listed in full in Section 4.2 (`12` net-new GitHub files + `1` re-run `telegram-digest-github.test.ts`) and Section 4.3 (`11` net-new Notion files) below.
- **Wave 4 Net-New (`11` Unique Files / `110` Unique Tests):** Listed in full in Section 5.1 below (`apps/chat-api/tests/config/mysheets-config.test.ts`, `apps/chat-api/tests/config/sheets-sandbox.test.ts`, `apps/chat-api/tests/db/mysheets-migration.test.ts`, `apps/chat-api/tests/integration/memory-execution-snapshot.test.ts`, `apps/chat-api/tests/integration/report-evidence.test.ts`, `apps/chat-api/tests/routes/execution-routes.test.ts`, `apps/chat-api/tests/routes/execution-security.test.ts`, `apps/chat-api/tests/routes/mysheets-connections.test.ts`, `apps/chat-api/tests/routes/mysheets-services.test.ts`, `apps/chat-api/tests/services/mysheets-backend.test.ts`, `apps/chat-api/tests/services/mysheets-planning-lookup.test.ts`).

---

## 3. Wave 2 Re-Verified Backend Test Manifest & Raw Vitest Output (`57` Files / `838` Tests)

### 3.1. `W2-A` Trello Backend Suite (`apps/chat-api` — `11` Files / `106` Tests)
- **Command:**
  ```powershell
  $env:DATABASE_URL="postgresql://ati_v3:ati_v3_local_only@localhost:56534/ati_v3"
  npx --prefix apps/chat-api vitest run tests/config/trello-env.test.ts tests/db/trello-oauth-migration.test.ts tests/db/trello-team-repo.test.ts tests/routes/trello-connections.test.ts tests/routes/trello-scope.test.ts tests/routes/trello-shared-credentials.test.ts tests/sandbox/trello-sandbox.test.ts tests/services/trello-digest.test.ts tests/services/trello-oauth-client.test.ts tests/services/trello-planning.test.ts tests/services/trello-token-manager.test.ts
  ```
- **Raw Vitest Output:**
  ```text
  RUN  v4.1.11 C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit

   ✓ apps/chat-api/tests/config/trello-env.test.ts (9 tests) 14ms
   ✓ apps/chat-api/tests/services/trello-token-manager.test.ts (11 tests) 26ms
   ✓ apps/chat-api/tests/sandbox/trello-sandbox.test.ts (3 tests) 38ms
   ✓ apps/chat-api/tests/services/trello-oauth-client.test.ts (16 tests) 39ms
   ✓ apps/chat-api/tests/services/trello-digest.test.ts (6 tests) 53ms
   ✓ apps/chat-api/tests/services/trello-planning.test.ts (21 tests) 98ms
   ✓ apps/chat-api/tests/routes/trello-shared-credentials.test.ts (6 tests) 232ms
   ✓ apps/chat-api/tests/routes/trello-scope.test.ts (9 tests) 388ms
   ✓ apps/chat-api/tests/routes/trello-connections.test.ts (13 tests) 463ms
   ✓ apps/chat-api/tests/db/trello-team-repo.test.ts (6 tests) 295ms
   ✓ apps/chat-api/tests/db/trello-oauth-migration.test.ts (6 tests) 338ms

   Test Files  11 passed (11)
        Tests  106 passed (106)
     Duration  8.73s
  W2A_CHAT_API_EXIT=0
  ```

### 3.2. `W2-B` Jira, MyJira & Workspace Backend Suite (`apps/chat-api` — `46` Files / `732` Tests)
- **Verified `git ls-files` Manifest (`46` files):**
  1. `apps/chat-api/tests/config/jira-sandbox.test.ts`
  2. `apps/chat-api/tests/db/jira-context-immutability.test.ts`
  3. `apps/chat-api/tests/db/jira-enablement-privacy.test.ts`
  4. `apps/chat-api/tests/db/jira-oauth-migration.test.ts`
  5. `apps/chat-api/tests/db/jira-oauth-repo.test.ts`
  6. `apps/chat-api/tests/db/jira-policy-lease-migration.test.ts`
  7. `apps/chat-api/tests/db/jira-shared-authorization.test.ts`
  8. `apps/chat-api/tests/db/jira-shared-conversations.test.ts`
  9. `apps/chat-api/tests/db/jira-shared-workspaces.test.ts`
  10. `apps/chat-api/tests/db/jira-workspace-conversation-repo.test.ts`
  11. `apps/chat-api/tests/db/jira-workspace-migration.test.ts`
  12. `apps/chat-api/tests/db/jira-workspace-repo.test.ts`
  13. `apps/chat-api/tests/db/jira-workspace-site-project.test.ts`
  14. `apps/chat-api/tests/db/memory-workspace-scope.test.ts`
  15. `apps/chat-api/tests/db/workspace-repo.test.ts`
  16. `apps/chat-api/tests/db/workspaces-migration.test.ts`
  17. `apps/chat-api/tests/integration/jira-execution.test.ts`
  18. `apps/chat-api/tests/integration/jira-extension.test.ts`
  19. `apps/chat-api/tests/integration/jira-oauth-integration.test.ts`
  20. `apps/chat-api/tests/jira-legacy-migration.test.ts`
  21. `apps/chat-api/tests/routes/jira-capabilities.test.ts`
  22. `apps/chat-api/tests/routes/jira-self-service-workspace.test.ts`
  23. `apps/chat-api/tests/routes/jira-shared-conversations.test.ts`
  24. `apps/chat-api/tests/routes/jira-shared-legacy-history.test.ts`
  25. `apps/chat-api/tests/routes/jira-sheets-schedule-compat.test.ts`
  26. `apps/chat-api/tests/routes/jira-workspace-admin-race.test.ts`
  27. `apps/chat-api/tests/routes/jira-workspace-authority-unavailable.test.ts`
  28. `apps/chat-api/tests/routes/jira-workspace-conversations.test.ts`
  29. `apps/chat-api/tests/routes/jira-workspaces.test.ts`
  30. `apps/chat-api/tests/routes/myjira-app-wiring.test.ts`
  31. `apps/chat-api/tests/routes/myjira-connection.test.ts`
  32. `apps/chat-api/tests/routes/workspace-isolation.test.ts`
  33. `apps/chat-api/tests/routes/workspaces-routes.test.ts`
  34. `apps/chat-api/tests/services/jira-approval-guard.test.ts`
  35. `apps/chat-api/tests/services/jira-dispatch-guard.test.ts`
  36. `apps/chat-api/tests/services/jira-lease-manager.test.ts`
  37. `apps/chat-api/tests/services/jira-native-verifier.test.ts`
  38. `apps/chat-api/tests/services/jira-oauth-client.test.ts`
  39. `apps/chat-api/tests/services/jira-plan-binding.test.ts`
  40. `apps/chat-api/tests/services/jira-runtime-catalog.test.ts`
  41. `apps/chat-api/tests/services/jira-source-guard.test.ts`
  42. `apps/chat-api/tests/services/jira-source-revalidation.test.ts`
  43. `apps/chat-api/tests/services/jira-token-manager.test.ts`
  44. `apps/chat-api/tests/services/schedules/jira-digest.test.ts`
  45. `apps/chat-api/tests/services/schedules/jira-schedule-refusal.test.ts`
  46. `apps/chat-api/tests/sse/jira-stream-guard.test.ts`
- **Raw Vitest Summary Output:**
  ```text
  Test Files  46 passed (46)
       Tests  732 passed (732)
    Duration  19.96s
  W2B_CHAT_API_EXIT=0
  ```

---

## 4. Wave 3 Re-Verified Test Manifest & Raw Vitest Output (`31` Files / `229` Tests)

Every single file below was verified against `git ls-files` at `08c8d8c5e7bf12625857ac3496fb96ec3914e34f` and executed:

### 4.1. Group 1 — `packages/` (`4` Files / `90` Tests)
- **Command:**
  ```powershell
  npx vitest run packages/tool-schemas/tests/notion.test.ts packages/planner/tests/notion-routing.test.ts packages/tool-adapters/tests/github-adapter.test.ts packages/tool-adapters/tests/notion-adapter.test.ts
  ```
- **Raw Vitest Output:**
  ```text
  RUN  v4.1.11 C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit

   ✓ packages/tool-schemas/tests/notion.test.ts (2 tests) 5ms
   ✓ packages/planner/tests/notion-routing.test.ts (4 tests) 14ms
   ✓ packages/tool-adapters/tests/github-adapter.test.ts (18 tests) 30ms
   ✓ packages/tool-adapters/tests/notion-adapter.test.ts (66 tests) 59ms

   Test Files  4 passed (4)
        Tests  90 passed (90)
     Duration  1.09s
  W3_PKG_EXIT=0
  ```

### 4.2. Group 2 — `apps/chat-api` GitHub (`13` Files / `81` Tests)
- **Command:**
  ```powershell
  $env:DATABASE_URL="postgresql://ati_v3:ati_v3_local_only@localhost:56534/ati_v3"
  npx --prefix apps/chat-api vitest run tests/config/github-env.test.ts tests/db/github-oauth-migration.test.ts tests/db/github-team-repo.test.ts tests/routes/github-connections.test.ts tests/routes/github-scope.test.ts tests/routes/github-shared-credentials.test.ts tests/sandbox/github-sandbox.test.ts tests/services/github-oauth-client.test.ts tests/services/github-planning.test.ts tests/services/github-token-manager.test.ts tests/services/schedules/github-digest-proposal.test.ts tests/services/schedules/github-digest-runner.test.ts tests/services/schedules/telegram-digest-github.test.ts
  ```
- **Raw Vitest Output:**
  ```text
  RUN  v4.1.11 C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit

   ✓ apps/chat-api/tests/config/github-env.test.ts (9 tests) 15ms
   ✓ apps/chat-api/tests/sandbox/github-sandbox.test.ts (3 tests) 11ms
   ✓ apps/chat-api/tests/services/github-token-manager.test.ts (4 tests) 16ms
   ✓ apps/chat-api/tests/services/github-oauth-client.test.ts (5 tests) 26ms
   ✓ apps/chat-api/tests/services/schedules/github-digest-proposal.test.ts (4 tests) 25ms
   ✓ apps/chat-api/tests/services/schedules/telegram-digest-github.test.ts (4 tests) 24ms
   ✓ apps/chat-api/tests/services/schedules/github-digest-runner.test.ts (12 tests) 51ms
   ✓ apps/chat-api/tests/services/github-planning.test.ts (21 tests) 74ms
   ✓ apps/chat-api/tests/routes/github-shared-credentials.test.ts (2 tests) 128ms
   ✓ apps/chat-api/tests/routes/github-scope.test.ts (3 tests) 200ms
   ✓ apps/chat-api/tests/routes/github-connections.test.ts (3 tests) 202ms
   ✓ apps/chat-api/tests/db/github-team-repo.test.ts (4 tests) 225ms
   ✓ apps/chat-api/tests/db/github-oauth-migration.test.ts (7 tests) 256ms

   Test Files  13 passed (13)
        Tests  81 passed (81)
     Duration  5.84s
  W3_GH_API_EXIT=0
  ```

### 4.3. Group 3 — `apps/chat-api` Notion (`11` Files / `30` Tests)
- **Command:**
  ```powershell
  $env:DATABASE_URL="postgresql://ati_v3:ati_v3_local_only@localhost:56534/ati_v3"
  npx --prefix apps/chat-api vitest run tests/config/notion-oauth-env.test.ts tests/config/notion-sandbox.test.ts tests/db/notion-connection-repo.test.ts tests/db/notion-oauth-migration.test.ts tests/integration/notion-extension.test.ts tests/routes/notion-connections.test.ts tests/services/notion-oauth.test.ts tests/services/notion-planning.test.ts tests/services/notion-scope.test.ts tests/services/notion-token-manager.test.ts tests/services/schedules/notion-digest.test.ts
  ```
- **Raw Vitest Output:**
  ```text
  RUN  v4.1.11 C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit

   ✓ apps/chat-api/tests/config/notion-sandbox.test.ts (2 tests) 7ms
   ✓ apps/chat-api/tests/services/notion-token-manager.test.ts (1 test) 9ms
   ✓ apps/chat-api/tests/services/notion-scope.test.ts (1 test) 9ms
   ✓ apps/chat-api/tests/config/notion-oauth-env.test.ts (4 tests) 14ms
   ✓ apps/chat-api/tests/services/notion-planning.test.ts (2 tests) 12ms
   ✓ apps/chat-api/tests/services/notion-oauth.test.ts (3 tests) 14ms
   ✓ apps/chat-api/tests/integration/notion-extension.test.ts (1 test) 15ms
   ✓ apps/chat-api/tests/services/schedules/notion-digest.test.ts (8 tests) 30ms
   ✓ apps/chat-api/tests/routes/notion-connections.test.ts (1 test) 131ms
   ✓ apps/chat-api/tests/db/notion-connection-repo.test.ts (3 tests) 216ms
   ✓ apps/chat-api/tests/db/notion-oauth-migration.test.ts (4 tests) 244ms

   Test Files  11 passed (11)
        Tests  30 passed (30)
     Duration  4.23s
  W3_NOTION_API_EXIT=0
  ```

### 4.4. Group 4 — `apps/chat-web` GitHub & Notion UI (`3` Files / `28` Tests)
- **Command:**
  ```powershell
  npx --prefix apps/chat-web vitest run tests/github-connection.test.tsx tests/notion-connection.test.tsx tests/schedule-github-digest-mode.test.tsx
  ```
- **Raw Vitest Output:**
  ```text
  RUN  v4.1.11 C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit

   ✓ apps/chat-web/tests/schedule-github-digest-mode.test.tsx (4 tests) 169ms
   ✓ apps/chat-web/tests/github-connection.test.tsx (12 tests) 462ms
   ✓ apps/chat-web/tests/notion-connection.test.tsx (12 tests) 557ms

   Test Files  3 passed (3)
        Tests  28 passed (28)
     Duration  4.49s
  W3_WEB_EXIT=0
  ```

---

## 5. Wave 4 Repository Test Suite Execution (`11` Net-New `apps/chat-api` Files / `110` Tests)

### 5.1. Interactive `mysheets` / `sheets`, Report Evidence & Execution Recovery Suite (`11` Files / `110` Tests)
- **Command:**
  ```powershell
  $env:DATABASE_URL="postgresql://ati_v3:ati_v3_local_only@localhost:56534/ati_v3"
  $env:TEST_DATABASE_URL="postgresql://ati_v3:ati_v3_local_only@localhost:56534/ati_v3"
  npx vitest run apps/chat-api/tests/routes/mysheets-connections.test.ts apps/chat-api/tests/routes/mysheets-services.test.ts apps/chat-api/tests/integration/report-evidence.test.ts apps/chat-api/tests/routes/execution-routes.test.ts apps/chat-api/tests/config/mysheets-config.test.ts apps/chat-api/tests/config/sheets-sandbox.test.ts apps/chat-api/tests/db/mysheets-migration.test.ts apps/chat-api/tests/routes/execution-security.test.ts apps/chat-api/tests/services/mysheets-backend.test.ts apps/chat-api/tests/services/mysheets-planning-lookup.test.ts apps/chat-api/tests/integration/memory-execution-snapshot.test.ts
  ```
- **Raw Vitest Output:**
  ```text
  RUN  v4.1.11 C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit

   ✓ apps/chat-api/tests/db/mysheets-migration.test.ts (4 tests) 1468ms
   ✓ apps/chat-api/tests/services/mysheets-backend.test.ts (9 tests) 159ms
   ✓ apps/chat-api/tests/config/sheets-sandbox.test.ts (1 test) 9ms
   ✓ apps/chat-api/tests/routes/execution-routes.test.ts (3 tests) 106ms
   ✓ apps/chat-api/tests/config/mysheets-config.test.ts (11 tests) 50ms
   ✓ apps/chat-api/tests/routes/execution-security.test.ts (11 tests) 310ms
   ✓ apps/chat-api/tests/integration/report-evidence.test.ts (12 tests) 1315ms
   ✓ apps/chat-api/tests/services/mysheets-planning-lookup.test.ts (9 tests) 2355ms
   ✓ apps/chat-api/tests/integration/memory-execution-snapshot.test.ts (2 tests) 4592ms
   ✓ apps/chat-api/tests/routes/mysheets-connections.test.ts (18 tests) 3500ms
   ✓ apps/chat-api/tests/routes/mysheets-services.test.ts (30 tests) 5060ms

   Test Files  11 passed (11)
        Tests  110 passed (110)
     Duration  8.28s
  W4_CHAT_API_EXIT=0
  ```

---

## 6. Deterministic Integration Reproduction Harnesses (Waves 1–3: `10` Tests + Wave 4: `4` Tests = `14` Total Reproduction Tests)

### 6.1. Database Safety Guard, Isolated Schema & Sanitized Self-Contained Package Design
To make all `14` reproduction tests (`10` in Waves 1–3 + `4` in Wave 4) **100% independently reproducible by any reviewer** without leaving untracked test files in the repository or risking any shared database:
1. **Fail-Closed Connection Guard (`assertIsolatedTestDatabase`):**
   Before opening a connection, `beforeAll` parses `DB_URL` (`process.env.DATABASE_URL ?? 'postgresql://ati_v3:ati_v3_local_only@localhost:56534/ati_v3'`) and asserts `hostname` is `localhost` or `127.0.0.1`, `port === '56534'`, and `pathname === '/ati_v3'`. Any other host, port, or database name immediately throws `[AUDIT-HARNESS-GUARD] Refusing to execute destructive SQL against non-isolated database URL`.
2. **Per-Run Isolated PostgreSQL Schema (`createIsolatedTestSchema` + `runAllMigrations`):**
   Using [`createIsolatedTestSchema`](file:///C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit/apps/chat-api/tests/helpers/jira-test-db.ts#L88-L255), `beforeAll` creates a dedicated ephemeral PostgreSQL schema (`test_...`), runs all `db/v3` migrations inside that isolated schema, executes all `14` tests against `isoCtx.pool`, and drops the schema cleanly in `afterAll` (`await isoCtx.cleanup()`). This guarantees deterministic execution even if the container's `public` schema is empty.
3. **Strict Sanitization (Zero Secrets, Zero Real Tokens, Zero User PII):**
   All credentials in the package use synthetic test placeholders (`TEST_KEY = 'a'.repeat(64)`, `000000:TEST_BOT_PLACEHOLDER`, `xoxb-test`, `ya29.test`, synthetic RSA keypair generated in-memory via `generateKeyPairSync('rsa', { modulusLength: 2048 })`, and synthetic UUIDs `00000000-0000-4000-8000-000000000901`..`0931`).
4. **Ephemeral Self-Extracting Execution (`try / finally`):**
   Section 6.6 below embeds the complete runnable TypeScript file between `<!-- BEGIN_SANITIZED_14_TEST_REPRO_PACKAGE -->` and `<!-- END_SANITIZED_14_TEST_REPRO_PACKAGE -->`. Running the one-line PowerShell command extracts the block to `apps/chat-api/tests/integration/__audit_repro_all_14_temp.test.ts`, runs `npx vitest run`, and removes the temporary file in `finally`, leaving `git status --short` completely clean.

### 6.2. Cases Reproduced in the Waves 1–3 10-Test Harness (`Case 1`–`Case 11`)
| Test Block | Finding ID(s) | Reproduced Runtime Behavior | Result |
|---|---|---|---|
| **Test 1 (`Case 1`)** | `AUD-W1-02` | `TelegramBotClient.getUpdates` advances `offset = 7002` and purges message `7001` from the Bot API queue before `TelegramAdapter.execute('telegram.read_messages')` runs, returning `{ messages: [] }`. | **PASS** (`21ms`) |
| **Test 2 (`Case 2`)** | `AUD-W1-06` | `SlackAdapter.execute('slack.send_message')` throws retryable `NETWORK` on mid-flight socket hang up, and pre-dispatch `waitForSlot` abort omits `requestSent: false`, causing `StepRunner` to return `status: 'unknown'` with `fetchCalled === false`. | **PASS** (`3ms`) |
| **Test 3 (`Case 3 & 4`)** | `AUD-W1-09`, `AUD-W1-10` | `evaluateCalendarDigestCandidate` binds Org A's `C01ORGA9999` into Personal User B's `digestConfig`; `createCalendarDigestExecutor` fails on Slack (`"No credentials configured for service 'slack'"`) and fails on Telegram (`AUTH_ERROR: 'Kết nối Telegram đã thay đổi, hãy lập lại kế hoạch.'`). | **PASS** (`43ms`) |
| **Test 4 (`Case 5`)** | `AUD-W2-01` | `ChatService.prepareProposal` refuses `myjira` schedule creation; `runJiraDigest` fails with `VALIDATION` (`maxResults: 20` vs `limit`); and when bypassed, `runJiraDigest` formats `0 issue` due to `{ issues }` / `title` vs array / `summary` mismatch. | **PASS** (`4ms`) |
| **Test 5 (`Case 6`)** | `AUD-W2-02` | `evaluateTrelloDigestCandidate` calls `trelloConnection(userA)` without `scopeId`, missing `personal:<userA>` and returning `canAutoDigest: false`. | **PASS** (`16ms`) |
| **Test 6 (`Case 7`)** | `AUD-W2-03` | `trello.add_checklist` rate-limit failure on item 2 leaves `step_1` in `status: 'failed'`, and `controller.retryStep('step_1')` creates a duplicate 2nd checklist (`createdChecklists.length === 2`). | **PASS** (`17ms`) |
| **Test 7 (`Case 8`)** | `AUD-W2-04`, `AUD-W2-06` | `JiraOAuthRepo.saveSitesGrant` deselecting `cloud-drop-2` leaves `lease-drop-2` with `status = 'active'`; `GET /api/services` in Personal Mode reports `myjira.connected === true` while `AdapterFactory.getAdapterForService('myjira', { workspaceMode: 'personal', workspaceId: null })` throws `AUTH_ERROR: 'Jira cá nhân yêu cầu không gian làm việc.'`. | **PASS** (`74ms`) |
| **Test 8 (`Case 9`)** | `AUD-W3-01` | `GitHubTeamRepo.replace` writes to singleton `scope_id = 'default'`, exposing Org A's `org-a/secret-roadmap` to User B in `GET /api/connections/github` and `GET /api/services` (`connected: true`), while `createGitHubConnectionLookup(userB)` blocks live repo access (`status: 'needs_membership'`). | **PASS** (`43ms`) |
| **Test 9 (`Case 10`)** | `AUD-W3-02` | `createNotionDigestRunner` omits `connections.telegram` when calling `getAdapter('telegram', { phase: 'execution' })`, failing with `state: 'blocked'` and `error: 'Kết nối Telegram đã thay đổi, hãy lập lại kế hoạch.'`. | **PASS** (`15ms`) |
| **Test 10 (`Case 11`)** | `AUD-W3-03`, `AUD-W3-04`, `AUD-W3-05` | `evaluateGithubDigestCandidate`, `createGithubDigestRunner`, and `evaluateNotionDigestCandidate` fail to resolve Org Slack (`"No credentials configured for service 'slack'"`); pre-dispatch abort on `github.create_issue` and `notion.create_page` returns `status: 'unknown'` with `fetchCalled === false`; `GET /api/services` reports connected Notion OAuth user as `configured: false, connected: false, connectionStatus: 'unconfigured'`. | **PASS** (`24ms`) |

### 6.3. Cases Reproduced in the Wave 4 4-Test Harness (`W4 Test 1`–`W4 Test 4`)
| Test Block | Finding ID(s) | Reproduced Runtime Behavior (Distinguishing Mock HTTP Transport vs Live Provider) | Result |
|---|---|---|---|
| **Test 11 (`W4 Test 1`)** | `AUD-W4-01` (`01a`, `01b`, `01c`) | 1. **Catalog (`AUD-W4-01a`):** `getToolCatalogFor` with `selectedSpreadsheets: []` returns 6 `MYSHEETS_DRIVE_TOOLS` (`service: 'mysheets'`), causing `runtimeToolCatalog` at baseline `08c8d8c5e7bf12625857ac3496fb96ec3914e34f` to strip all Organization shared `sheets` tools (`0` spreadsheet tools remain).<br>2. **ATI `allowedScope` Bypass (`AUD-W4-01b`):** `PersonalSheetsAdapter.execute('mysheets.move_drive_file', { fileId: 'unapproved_sheet_999999', folderId: 'folder_target_123456' })` succeeds in the adapter against mock `fetchFn` on an unapproved spreadsheet rejected by `mysheets.read_range` (proving ATI application-layer `allowedScope` is bypassed in `checkedDriveId`; Google OAuth token/scope enforcement on live Drive API is separate).<br>3. **Outbound `text/plain` Upload (`AUD-W4-01c`):** `PersonalSheetsAdapter.execute('mysheets.append_doc_text', ...)` issues `GET .../export?mimeType=text/plain` followed by `PATCH /upload/drive/v3/files/{id}?uploadType=media` with `Content-Type: text/plain` and concatenated body `'Existing Heading\nExisting Table Content\n\nAppended line'` against mock `fetchFn` (live Google Drive provider effect is `NOT_TESTED` per Audit Rule 4; no production data loss is claimed). | **PASS** (`55ms`) |
| **Test 12 (`W4 Test 2`)** | `AUD-W4-02` | 1. Shared `SheetsAdapter.execute('sheets.append_rows', ...)` failing with `503` on pre-write `GET` (`tabs`) omits `details: { requestSent: false }`, causing `StepRunner.executeStep` to return `status: 'unknown'` with `postSent === false`.<br>2. `PersonalSheetsAdapter.execute('mysheets.append_rows', { deduplicate: true, keyColumn: 'ID', onDuplicate: 'update', records: [...] })` mutates row 1 via `POST :batchUpdate`, then hits `401` on the second `POST :append`, resetting `writeDispatched = false` and throwing `details: { requestSent: false }` despite the first `POST` having already mutated the spreadsheet. | **PASS** (`41ms`) |
| **Test 13 (`W4 Test 3`)** | `AUD-W4-04` | 1. `validatePlan` rejects a report plan grounded via `mysheets.search_rows` (`Report content must be grounded in verified read observations via reportEvidence`) because `mysheets.search_rows` is omitted from `REPORT_SOURCE_TOOLS`.<br>2. `AIPlanner.processMessage` on a mixed report + `github.create_issue` prompt forces a hardcoded clarification (`"Bạn muốn nội dung công việc mới là báo cáo dữ liệu hay một nội dung riêng?"`). | **PASS** (`7ms`) |
| **Test 14 (`W4 Test 4`)** | `AUD-W4-06` | `validatePlan` accepts `{ "$ref": "step_1.output[0].id" }` when `step_1` (`trello.search_lists`) has `outputSchema.type === 'array'`, and Executor `resolveArgs` then throws `Error: Property 'output[0].id' not found on step 'step_1'` at runtime. | **PASS** (`3ms`) |

### 6.4. Raw Execution Log of Unified 14-Test Reproduction Package (`__audit_repro_all_14_temp.test.ts`)
```text
RUN  v4.1.11 C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit

 ✓ apps/chat-api/tests/integration/__audit_repro_all_14_temp.test.ts (14 tests) 908ms

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  09:07:35
   Duration  3.44s (transform 1.15s, setup 0ms, import 1.98s, tests 908ms, environment 0ms)

ALL_14_REPRO_EXIT=0
```

### 6.5. One-Command Self-Extracting PowerShell Reproduction Runner
Any reviewer on a machine with the local test PostgreSQL container running on `localhost:56534/ati_v3` can execute all `14` reproduction tests directly from this markdown file without leaving any modified or untracked files in the git worktree:

```powershell
$env:DATABASE_URL = "postgresql://ati_v3:ati_v3_local_only@localhost:56534/ati_v3"
$docPath = "docs/audits/service-deep-review/EVIDENCE-AND-TEST-RESULTS.md"
$tempTestPath = "apps/chat-api/tests/integration/__audit_repro_all_14_temp.test.ts"
try {
  $raw = [System.IO.File]::ReadAllText((Resolve-Path $docPath), [System.Text.Encoding]::UTF8)
  $pattern = '(?s)<!-- BEGIN_SANITIZED_14_TEST_REPRO_PACKAGE -->\s*```ts\r?\n(.*?)\r?\n```\s*<!-- END_SANITIZED_14_TEST_REPRO_PACKAGE -->'
  $match = [regex]::Match($raw, $pattern)
  if (-not $match.Success) { throw "Could not locate sanitized 14-test reproduction block in $docPath" }
  [System.IO.File]::WriteAllText((Join-Path (Get-Location) $tempTestPath), $match.Groups[1].Value, (New-Object System.Text.UTF8Encoding($false)))
  npx vitest run $tempTestPath
  Write-Output "ALL_14_REPRO_EXIT=$LASTEXITCODE"
} finally {
  if (Test-Path $tempTestPath) { Remove-Item -Force $tempTestPath }
}
```

### 6.6. Complete Sanitized 14-Test Reproduction Source (`__audit_repro_all_14_temp.test.ts`)

<!-- BEGIN_SANITIZED_14_TEST_REPRO_PACKAGE -->
```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import pg from 'pg';
import express from 'express';
import {
  TelegramAdapter,
  SlackAdapter,
  TrelloAdapter,
  GitHubAdapter,
  NotionAdapter,
  PersonalSheetsAdapter,
  SheetsAdapter,
  createPersonalJiraAdapter,
  encryptCredentials,
  GlobalRateLimiter,
} from '@wap/tool-adapters';
import { StepRunner, ExecutionController, resolveArgs } from '@wap/executor';
import {
  ALL_TOOLS,
  MYSHEETS_SERVICE,
  MYSHEETS_TOOLS,
  SERVICE_REGISTRY,
  SHEETS_EXTENDED_TOOLS,
} from '@wap/tool-schemas';
import { AIPlanner, WorkingMemory, validatePlan } from '@wap/planner';
import { ReportArtifactStore } from '../../../../packages/planner/src/reports/artifacts.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { TelegramBotClient } from '../../src/services/telegram/bot-client.js';
import { TelegramUpdateRepo } from '../../src/db/repositories/telegram-update-repo.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { TrelloTeamRepo } from '../../src/db/repositories/trello-team-repo.js';
import { GitHubTeamRepo } from '../../src/db/repositories/github-team-repo.js';
import { NotionConnectionRepo } from '../../src/db/repositories/notion-connection-repo.js';
import { JiraOAuthRepo } from '../../src/db/repositories/jira-oauth-repo.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { getToolCatalogFor } from '../../src/services/registered-services.js';
import { runtimeToolCatalog } from '../../src/config/gmail-tools-runtime.js';
import { evaluateCalendarDigestCandidate } from '../../src/services/schedules/calendar-digest-candidate.js';
import { createCalendarDigestExecutor } from '../../src/services/schedules/calendar-digest-runner.js';
import { evaluateTrelloDigestCandidate } from '../../src/services/schedules/trello-digest-candidate.js';
import {
  computeDigestConfigHash,
  evaluateGithubDigestCandidate,
} from '../../src/services/schedules/github-digest-candidate.js';
import { createGithubDigestRunner } from '../../src/services/schedules/github-digest-runner.js';
import { evaluateNotionDigestCandidate } from '../../src/services/schedules/notion-digest-candidate.js';
import { createNotionDigestRunner } from '../../src/services/schedules/notion-digest-runner.js';
import {
  computeJiraDigestConfigHash,
  type JiraDigestConfig,
} from '../../src/services/schedules/jira-digest-candidate.js';
import { runJiraDigest } from '../../src/services/schedules/jira-digest-runner.js';
import { createTrelloConnectionLookup } from '../../src/services/trello/connection-reference.js';
import { createGitHubConnectionLookup } from '../../src/services/github/connection-reference.js';
import { createNotionConnectionLookup } from '../../src/services/notion/connection-reference.js';
import { createGitHubConnectionRoutes } from '../../src/routes/connections/github.js';
import { createServicesRoutes } from '../../src/routes/services-routes.js';
import { ChatService } from '../../src/services/chat-service.js';
import { createIsolatedTestSchema, type IsolatedTestContext } from '../helpers/jira-test-db.js';

const TEST_KEY = 'a'.repeat(64);
const JWT_SECRET = 'audit-repro-jwt-secret-key-32-chars-min';
const DB_URL =
  process.env.DATABASE_URL ?? 'postgresql://ati_v3:ati_v3_local_only@localhost:56534/ati_v3';

function assertIsolatedTestDatabase(connectionString: string): void {
  const parsed = new URL(connectionString);
  const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  const isIsolatedTestPort = parsed.port === '56534';
  const isTestDbName = parsed.pathname === '/ati_v3';
  if (!isLoopback || !isIsolatedTestPort || !isTestDbName) {
    throw new Error(
      `[AUDIT-HARNESS-GUARD] Refusing to execute destructive SQL against non-isolated database URL: ${parsed.protocol}//${parsed.host}${parsed.pathname}. Expected localhost:56534/ati_v3.`,
    );
  }
}

describe('Independent Deep Service Audit — Sanitized 14-Test Deterministic Reproduction Package (Waves 1–4)', () => {
  let isoCtx: IsolatedTestContext;
  let pool: pg.Pool;
  let credRepo: CredentialRepo;
  let trelloTeamRepo: TrelloTeamRepo;
  let githubTeamRepo: GitHubTeamRepo;
  let notionRepo: NotionConnectionRepo;
  let jiraOAuthRepo: JiraOAuthRepo;

  const userA = '00000000-0000-4000-8000-000000000901';
  const userB = '00000000-0000-4000-8000-000000000902';
  const orgWorkspaceA = '00000000-0000-4000-8000-000000000911';
  const convIdB = '00000000-0000-4000-8000-000000000920';
  const calScheduleId = '00000000-0000-4000-8000-000000000921';
  const sessionIdB = '00000000-0000-4000-8000-000000000931';

  beforeAll(async () => {
    assertIsolatedTestDatabase(DB_URL);
    isoCtx = await createIsolatedTestSchema({ rawUrl: DB_URL });
    await isoCtx.runAllMigrations();
    pool = isoCtx.pool;
    credRepo = new CredentialRepo(pool, TEST_KEY);
    trelloTeamRepo = new TrelloTeamRepo(pool);
    githubTeamRepo = new GitHubTeamRepo(pool);
    notionRepo = new NotionConnectionRepo(pool);
    jiraOAuthRepo = new JiraOAuthRepo(pool, TEST_KEY);

    await pool.query(
      `INSERT INTO users (id, email, name, password, role, status)
       VALUES ($1, 'audit-repro-a@example.com', 'Audit User A', 'hash', 'admin', 'active'),
              ($2, 'audit-repro-b@example.com', 'Audit User B', 'hash', 'member', 'active')
       ON CONFLICT (id) DO NOTHING`,
      [userA, userB],
    );
    await pool.query(
      `INSERT INTO workspaces (id, name, invite_code, created_by)
       VALUES ($1, 'Audit Org A', 'AUDITORGA911', $2)
       ON CONFLICT (id) DO NOTHING`,
      [orgWorkspaceA, userA],
    );
    await pool.query(
      `INSERT INTO ati_workspaces (id, slug, status, version, created_by)
       VALUES ($1, 'audit-jira-org-a-911', 'active', 1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [orgWorkspaceA, userA],
    );
    await pool.query(
      `INSERT INTO conversations (id, user_id, title)
       VALUES ($1, $2, 'Audit Conv B')
       ON CONFLICT (id) DO NOTHING`,
      [convIdB, userB],
    );
  });

  afterAll(async () => {
    if (isoCtx) {
      await isoCtx.cleanup();
    }
  });

  it('Case 1 (AUD-W1-02): TelegramBotClient.getUpdates advances offset and purges messages before TelegramAdapter.read_messages runs', async () => {
    const serverQueue = [
      {
        update_id: 7001,
        message: {
          message_id: 55,
          date: 1730000000,
          chat: { id: -100777888, title: 'Ops Group', type: 'supergroup' },
          from: { id: 12345, is_bot: false, first_name: 'Alice', username: 'alice' },
          text: 'Deploy production at 18:00',
        },
      },
    ];

    const fakeTelegramFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('/getUpdates')) {
        let offset = 0;
        if (init?.body) {
          const parsed = JSON.parse(String(init.body));
          if (typeof parsed.offset === 'number') offset = parsed.offset;
        }
        const uObj = new URL(url);
        if (uObj.searchParams.has('offset')) offset = Number(uObj.searchParams.get('offset'));
        if (offset > 0) {
          for (let i = serverQueue.length - 1; i >= 0; i--) {
            if (serverQueue[i]!.update_id < offset) serverQueue.splice(i, 1);
          }
        }
        return new Response(JSON.stringify({ ok: true, result: [...serverQueue] }), { status: 200 });
      }
      if (url.includes('/getChat')) {
        return new Response(
          JSON.stringify({ ok: true, result: { id: -100777888, type: 'supergroup', title: 'Ops Group' } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true, result: { id: 999, is_bot: true, username: 'ati_bot' } }), {
        status: 200,
      });
    };

    const updateRepo = new TelegramUpdateRepo(pool);
    const botClient = new TelegramBotClient(
      {
        botToken: '000000:TEST_BOT_PLACEHOLDER',
        botUsername: 'ati_bot',
        apiBaseUrl: 'https://api.telegram.org',
        callbackUrl: 'http://localhost:5173/telegram/callback',
      } as any,
      fakeTelegramFetch,
      updateRepo,
    );

    await (botClient as any).getUpdates(AbortSignal.timeout(5000));
    await (botClient as any).getUpdates(AbortSignal.timeout(5000));
    expect(serverQueue.length).toBe(0);

    const adapter = new TelegramAdapter({
      credentials: { botToken: '000000:TEST_BOT_PLACEHOLDER' },
      allowedScope: { chats: ['-100777888'] },
      fetchFn: fakeTelegramFetch,
    });
    const readRes = await adapter.execute('telegram.read_messages', { chatId: '-100777888', limit: 10 });
    expect(readRes).toEqual({ messages: [] });
  });

  it('Case 2 (AUD-W1-06): SlackAdapter.send_message throws NETWORK without requestSent:false on pre-dispatch slot-wait abort', async () => {
    const netAdapter = new SlackAdapter({
      credentials: { botToken: 'xoxb-test' },
      allowedScope: { channels: ['C0123456789'] },
      fetchFn: async () => {
        throw new TypeError('fetch failed: socket hang up');
      },
    });
    await expect(
      netAdapter.execute('slack.send_message', { channel: 'C0123456789', text: 'hi' }),
    ).rejects.toMatchObject({ category: 'NETWORK', retryable: true });

    const preAbortLimiter = new GlobalRateLimiter({ slack: { maxRequests: 1, windowMs: 60_000 } });
    await preAbortLimiter.waitForSlot('slack:xoxb-preabort');
    let fetchCalled = false;
    const preAbortAdapter = new SlackAdapter({
      credentials: { botToken: 'xoxb-preabort' },
      allowedScope: { channels: ['C0123456789'] },
      rateLimiter: preAbortLimiter,
      fetchFn: async () => {
        fetchCalled = true;
        return new Response(JSON.stringify({ ok: true, ts: '1.1' }), { status: 200 });
      },
    });
    const runner = new StepRunner({ getAdapter: async () => preAbortAdapter });
    const abortCtrl = new AbortController();
    abortCtrl.abort();
    const stepOutcome = await runner.executeStep(
      {
        id: 'step_1',
        tool: 'slack.send_message',
        description: 'Send Slack message',
        args: { channel: 'C0123456789', text: 'hello' },
        dependsOn: [],
        risk: 'medium',
      },
      new Map(),
      { signal: abortCtrl.signal },
    );
    expect(fetchCalled).toBe(false);
    expect(stepOutcome.status).toBe('unknown');
  });

  it('Case 3 & 4 (AUD-W1-09 & AUD-W1-10): calendar_digest auto-binds foreign Org A Slack channelId for Personal User B, fails Slack runtime without workspaceId, and fails Telegram runtime without connections.telegram', async () => {
    await pool.query(`DELETE FROM service_credentials WHERE service = 'slack' AND user_id IS NULL`);
    await credRepo.upsertCredentials(
      'slack',
      encryptCredentials(
        { botToken: 'xoxb-org-a-secret', allowedScope: { channels: ['C01ORGA9999'] } },
        TEST_KEY,
      ),
      'active',
      'admin@orga.com',
      orgWorkspaceA,
    );
    await credRepo.upsertPersonalCredentials({
      service: 'mycalendar',
      userId: userB,
      config: encryptCredentials(
        {
          email: 'userb@example.com',
          refreshToken: 'rt-cal-b',
          selectedCalendars: [{ id: 'userb@example.com', summary: 'User B Cal', primary: true, accessRole: 'owner' }],
          allowedScope: { calendars: ['userb@example.com'] },
        },
        TEST_KEY,
      ),
      status: 'active',
    });
    const tgCred = await credRepo.upsertPersonalCredentials({
      service: 'telegram',
      userId: userB,
      config: encryptCredentials(
        {
          telegramUserId: '888002',
          username: 'userb_tg',
          selectedChats: [{ chatId: '888002', title: 'User B Private', type: 'private' }],
          allowedScope: { chats: ['888002'] },
        },
        TEST_KEY,
      ),
      status: 'active',
    });

    await pool.query(
      `INSERT INTO schedules (
         id, user_id, conv_id, name, request, services, recurrence, next_run_at, status, version
       )
       VALUES ($1, $2, $3, 'Cal Digest Test', 'Mỗi sáng gửi lịch họp', '{mycalendar,slack}', $4::jsonb, now(), 'active', 1)
       ON CONFLICT (id) DO UPDATE SET status = 'active', version = 1`,
      [calScheduleId, userB, convIdB, JSON.stringify({ type: 'daily', time: '08:00' })],
    );

    const candidateRes = await evaluateCalendarDigestCandidate({
      pool,
      encryptionKey: TEST_KEY,
      userId: userB,
      request: 'Mỗi sáng gửi lịch họp vào Slack',
      services: ['mycalendar', 'slack'],
    });
    expect(candidateRes.candidate.canAutoDigest).toBe(true);
    expect(candidateRes.config?.destination).toEqual({
      service: 'slack',
      channelId: 'C01ORGA9999',
    });

    let capturedDestErrors: any[] = [];
    const realFactory = new AdapterFactory({
      credentialRepo: credRepo,
      encryptionKey: TEST_KEY,
      mycalendarTokens: {
        forConnection: () => ({ getAccessToken: async () => 'ya29.fake', invalidate: () => {} }),
      } as any,
      createMyCalendarAdapter: () => ({
        execute: async () => ({ events: [] }),
      }),
      telegramBot: {
        botToken: '000000:TEST_BOT_PLACEHOLDER',
        botUsername: 'ati_bot',
        apiBaseUrl: 'https://api.telegram.org',
        callbackUrl: 'http://localhost:5173/telegram/callback',
      } as any,
      telegramBotClient: {
        getChatMember: async () => ({ status: 'member' }),
      } as any,
    });

    const calDigestExec = createCalendarDigestExecutor({
      pool,
      encryptionKey: TEST_KEY,
      timeZone: 'Asia/Ho_Chi_Minh',
      getAdapter: async (serviceName, ctx) => {
        try {
          return await realFactory.getAdapterForService(serviceName, ctx);
        } catch (err) {
          capturedDestErrors.push({ serviceName, err });
          throw err;
        }
      },
    });

    const slackRunOutcome = await calDigestExec(
      {
        runId: 'run-cal-slack-1',
        scheduleId: calScheduleId,
        scheduleVersion: 1,
        userId: userB,
        name: 'Cal Digest Test',
        request: 'Mỗi sáng gửi lịch họp vào Slack',
        services: ['mycalendar', 'slack'],
        dueAt: new Date('2026-10-15T01:00:00Z'),
        timeZone: 'Asia/Ho_Chi_Minh',
        recurrence: { type: 'daily', time: '08:00' },
        digestConfig: candidateRes.config!,
        digestConfigHash: candidateRes.configHash!,
      } as any,
      AbortSignal.timeout(5000),
    );
    expect(slackRunOutcome).toEqual({
      state: 'digest_failed',
      error: 'Không gửi được bản tin tới Slack.',
    });
    expect(capturedDestErrors[0]?.serviceName).toBe('slack');
    expect(String(capturedDestErrors[0]?.err?.message)).toContain("No credentials configured for service 'slack'");

    expect(tgCred.id).toBeTruthy();
    capturedDestErrors = [];
    const tgCandidate = await evaluateCalendarDigestCandidate({
      pool,
      encryptionKey: TEST_KEY,
      userId: userB,
      request: 'Mỗi sáng gửi lịch họp qua Telegram',
      services: ['mycalendar', 'telegram'],
    });
    expect(tgCandidate.candidate.canAutoDigest).toBe(true);

    const tgRunOutcome = await calDigestExec(
      {
        runId: 'run-cal-tg-1',
        scheduleId: calScheduleId,
        scheduleVersion: 1,
        userId: userB,
        name: 'Cal Digest Test',
        request: 'Mỗi sáng gửi lịch họp qua Telegram',
        services: ['mycalendar', 'telegram'],
        dueAt: new Date('2026-10-15T01:00:00Z'),
        timeZone: 'Asia/Ho_Chi_Minh',
        recurrence: { type: 'daily', time: '08:00' },
        digestConfig: tgCandidate.config!,
        digestConfigHash: tgCandidate.configHash!,
      } as any,
      AbortSignal.timeout(5000),
    );
    expect(tgRunOutcome).toEqual({
      state: 'digest_failed',
      error: 'Không gửi được bản tin tới Telegram.',
    });
    expect(capturedDestErrors[0]?.serviceName).toBe('telegram');
    expect(capturedDestErrors[0]?.err?.category).toBe('AUTH_ERROR');
    expect(String(capturedDestErrors[0]?.err?.message)).toContain(
      'Kết nối Telegram đã thay đổi, hãy lập lại kế hoạch.',
    );
  });

  it('Case 5 (AUD-W2-01): myjira_digest fails across ChatService schedule creation, PersonalJiraAdapter maxResults validation, and output schema mismatch', async () => {
    const chatServiceNoJiraDigest = new ChatService({
      convRepo: {} as any,
      msgRepo: {} as any,
      planRepo: {} as any,
      planner: {
        routeSchedule: async () => ({
          unavailable: [],
          services: ['myjira', 'slack'],
        }),
      } as any,
      eventEmitter: { emit: () => {} },
      schedules: {
        repo: {} as any,
        timeZone: 'Asia/Ho_Chi_Minh',
      },
    });
    const schedRes = await (chatServiceNoJiraDigest as any).prepareProposal(
      {
        kind: 'schedule',
        action: 'create',
        request: 'Mỗi sáng gửi báo cáo Jira project ENG vào Slack #general',
        recurrence: { type: 'daily', time: '08:00' },
      },
      { userId: userA, workspaceMode: 'organization', workspaceId: orgWorkspaceA },
      null,
    );
    expect(schedRes.kind).toBe('refusal');
    expect(schedRes.reason).toContain('Tính năng lịch tự động chưa hỗ trợ tích hợp Jira cá nhân (myjira)');

    const realPersonalJira = createPersonalJiraAdapter({
      userId: userA,
      workspaceId: orgWorkspaceA,
      capabilities: {
        workspaceId: orgWorkspaceA,
        sites: [
          {
            siteId: 'site-1',
            cloudId: '11111111-2222-3333-4444-555555555555',
            name: 'Acme Jira',
            url: 'https://acme.atlassian.net',
            projects: [{ id: '10001', key: 'ENG', name: 'Engineering' }],
          },
        ],
      },
      tokens: { getAccessToken: async () => 'jira-access-token' },
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            issues: [
              {
                id: '10099',
                key: 'ENG-1',
                fields: {
                  project: { key: 'ENG' },
                  summary: 'Critical login bug',
                  status: { name: 'In Progress' },
                  issuetype: { name: 'Bug' },
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });

    const jiraDigestConfig: JiraDigestConfig = {
      workspaceId: orgWorkspaceA,
      grantId: 'grant-1',
      atlassianAccountId: 'acct-1',
      projects: [{ siteId: 'site-1', siteName: 'Acme Jira', projectKey: 'ENG', projectName: 'Engineering' }],
      channelId: 'C0123456789',
      channelName: 'general',
    };
    const jiraDigestHash = computeJiraDigestConfigHash({
      config: jiraDigestConfig,
      recurrence: { type: 'daily', time: '08:00' },
      userId: userA,
    });

    await expect(
      runJiraDigest({
        userId: userA,
        recurrence: { type: 'daily', time: '08:00' },
        digestConfig: jiraDigestConfig,
        digestConfigHash: jiraDigestHash,
        revalidatePolicy: async () => ({ allowed: true }),
        getAdapter: async (service) => {
          if (service === 'myjira') return realPersonalJira;
          return { execute: async () => ({ ts: '1.1' }) };
        },
      }),
    ).rejects.toMatchObject({
      category: 'VALIDATION',
      message: 'Jira request failed: VALIDATION',
    });

    const adapterOutput = await realPersonalJira.execute('myjira.search_issues', {
      siteId: 'site-1',
      projectKey: 'ENG',
      limit: 20,
    });
    expect(Array.isArray(adapterOutput)).toBe(false);
    expect(adapterOutput.issues[0]?.title).toBe('Critical login bug');
    expect(adapterOutput.issues[0]?.summary).toBeUndefined();

    const bypassedOutcome = await runJiraDigest({
      userId: userA,
      recurrence: { type: 'daily', time: '08:00' },
      digestConfig: jiraDigestConfig,
      digestConfigHash: jiraDigestHash,
      revalidatePolicy: async () => ({ allowed: true }),
      getAdapter: async (service) => {
        if (service === 'myjira') {
          return {
            execute: async () => adapterOutput,
          };
        }
        return { execute: async () => ({ ts: '1.1' }) };
      },
    });
    expect(bypassedOutcome.state).toBe('digest_sent');
    if (bypassedOutcome.state === 'digest_sent') {
      expect(bypassedOutcome.text).toContain('0 issue');
      expect(bypassedOutcome.text).toContain('_(Không có issue nào)_');
    }
  });

  it('Case 6 (AUD-W2-02): trello_digest candidate and runner query scopeId="default" instead of personal:<userId> and omit connections.telegram', async () => {
    await pool.query(`DELETE FROM trello_team_boards WHERE scope_id = 'default'`);
    await pool.query(`DELETE FROM trello_team_scope WHERE id = 'default'`);
    const trelloCred = await credRepo.upsertPersonalCredentials({
      service: 'trello',
      userId: userA,
      config: encryptCredentials(
        { memberId: 'mem-a', username: 'usera', fullName: 'User A', refreshToken: 'trello-tok-a' },
        TEST_KEY,
      ),
      status: 'active',
    });
    await trelloTeamRepo.replace({
      chosenBy: userA,
      scopeId: `personal:${userA}`,
      workspaceId: 'ws-trello-1',
      workspaceName: 'User A Workspace',
      boards: [{ boardId: '5f0000000000000000000001', boardName: 'Personal Board A' }],
    });

    const trelloLookup = createTrelloConnectionLookup({
      credentialRepo: credRepo,
      teamRepo: trelloTeamRepo,
      encryptionKey: TEST_KEY,
      tokens: {
        forConnection: () => ({ getAccessToken: async () => 'trello-tok-a', invalidate: () => {} }),
      },
      client: {
        boards: async () => [{ id: '5f0000000000000000000001', name: 'Personal Board A', closed: false, member: true }],
      } as any,
    });

    const scopedLookup = await trelloLookup(userA, `personal:${userA}`);
    expect(scopedLookup.status).toBe('connected');
    expect(scopedLookup.connection?.credentialId).toBe(trelloCred.id);

    const candidate = await evaluateTrelloDigestCandidate({
      userId: userA,
      request: 'Mỗi sáng gửi báo cáo Trello bảng Personal Board A vào Slack #general',
      services: ['trello', 'slack'],
      recurrence: { type: 'daily', time: '08:00' },
      trelloConnection: trelloLookup,
      getAdapter: async () => ({
        execute: async () => [{ id: 'C0123456789', name: 'general' }],
      }),
    });
    expect(candidate.canAutoDigest).toBe(false);
    expect(candidate.disabledReason).toContain(
      'Cần kết nối Trello cá nhân và là thành viên của ít nhất 1 bảng Trello thuộc phạm vi nhóm.',
    );
  });

  it('Case 7 (AUD-W2-03): TrelloWriteTools.addChecklist partial failure on item 2 marks step failed and retryStep creates a duplicate 2nd checklist', async () => {
    const createdChecklists: string[] = [];
    let itemAttempts = 0;

    const fakeTrelloFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.includes('/1/cards/5f0000000000000000000099')) {
        return new Response(
          JSON.stringify({ id: '5f0000000000000000000099', idBoard: '5f0000000000000000000001' }),
          { status: 200 },
        );
      }
      if (method === 'POST' && url.includes('/1/cards/5f0000000000000000000099/checklists')) {
        const checklistId = `5f000000000000000000010${createdChecklists.length + 1}`;
        createdChecklists.push(checklistId);
        return new Response(JSON.stringify({ id: checklistId, name: 'Release QA' }), { status: 200 });
      }
      if (method === 'POST' && url.includes('/checkItems')) {
        itemAttempts++;
        if (itemAttempts === 2 || itemAttempts === 3) {
          return new Response('Rate limit exceeded', {
            status: 429,
            headers: { 'Retry-After': '0' },
          });
        }
        return new Response(JSON.stringify({ id: `item_${itemAttempts}`, name: 'ok' }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    };

    const trelloAdapter = new TrelloAdapter({
      credentials: { accessToken: 'tok' },
      allowedScope: { boards: ['5f0000000000000000000001'] },
      fetchFn: fakeTrelloFetch,
    });

    const steps = [
      {
        id: 'step_1',
        tool: 'trello.add_checklist',
        description: 'Add QA checklist',
        args: {
          cardId: '5f0000000000000000000099',
          title: 'Release QA',
          items: ['Run unit tests', 'Run smoke tests'],
        },
        dependsOn: [],
        risk: 'low' as const,
      },
    ];
    const controller = new ExecutionController({
      runner: new StepRunner({ getAdapter: async () => trelloAdapter }),
      steps,
    });

    const firstExec = await controller.runUntilPause();
    expect(firstExec.status).toBe('partial');
    expect(controller.getStepState('step_1')?.status).toBe('failed');
    expect(createdChecklists.length).toBe(1);

    const retryRes = await controller.retryStep('step_1');
    expect(retryRes.status).toBe('completed');
    expect(createdChecklists.length).toBe(2);
  });

  it('Case 8 (AUD-W2-04 & AUD-W2-06): GET /api/services reports myjira connected in Personal Mode while AdapterFactory rejects Personal Mode, and JiraOAuthRepo.saveSitesGrant leaves active lease row for deselected cloudId', async () => {
    await jiraOAuthRepo.saveIdentityGrant(userA, {
      atlassianAccountId: 'atlassian-acct-a',
      displayName: 'Audit User A',
      accessToken: 'jira-id-tok',
      refreshToken: 'jira-id-rt',
      expiresInSeconds: 3600,
      scopes: ['read:me'],
    });
    const grantRes = await jiraOAuthRepo.saveSitesGrant(userA, {
      atlassianAccountId: 'atlassian-acct-a',
      accessToken: 'jira-sites-tok',
      refreshToken: 'jira-sites-rt',
      expiresInSeconds: 3600,
      scopes: ['read:jira-work', 'write:jira-work'],
      sites: [
        { id: 'cloud-keep-1', name: 'Keep Site', url: 'https://keep.atlassian.net', scopes: ['read:jira-work'] },
        { id: 'cloud-drop-2', name: 'Drop Site', url: 'https://drop.atlassian.net', scopes: ['read:jira-work'] },
      ],
    });

    await pool.query(
      `INSERT INTO jira_authorization_leases (
         lease_id, workspace_id, cloud_id, ati_user_id, jira_account_id,
         atlassian_account_id, grant_id, membership_version, identity_version,
         workspace_version, site_policy_version, ttl_ms, acquired_at, expires_at, status
       )
       VALUES ('lease-drop-2', $1, 'cloud-drop-2', $2, $3, 'atlassian-acct-a', $4, 1, 1, 1, 1, 30000, clock_timestamp(), clock_timestamp() + interval '30 seconds', 'active')`,
      [orgWorkspaceA, userA, grantRes.accountId, grantRes.grantId],
    );

    await jiraOAuthRepo.saveSitesGrant(userA, {
      atlassianAccountId: 'atlassian-acct-a',
      accessToken: 'jira-sites-tok-2',
      refreshToken: 'jira-sites-rt-2',
      expiresInSeconds: 3600,
      scopes: ['read:jira-work', 'write:jira-work'],
      sites: [{ id: 'cloud-keep-1', name: 'Keep Site', url: 'https://keep.atlassian.net', scopes: ['read:jira-work'] }],
    });
    const leaseAfterDeselect = (
      await pool.query<{ status: string }>(`SELECT status FROM jira_authorization_leases WHERE lease_id = 'lease-drop-2'`)
    ).rows[0];
    expect(leaseAfterDeselect?.status).toBe('active');

    const app = express();
    app.use((req, _res, next) => {
      (req as any).user = { id: userA, email: 'audit-repro-a@example.com', role: 'admin' };
      (req as any).workspace = { mode: 'personal', workspaceId: null, role: 'owner' };
      next();
    });
    app.use(
      '/api/services',
      createServicesRoutes({
        credentialRepo: credRepo,
        encryptionKey: TEST_KEY,
        myjiraAvailable: true,
        jiraOAuthRepo,
      }),
    );
    const server = app.listen(0);
    try {
      const addr = server.address() as { port: number };
      const svcRes = await fetch(`http://127.0.0.1:${addr.port}/api/services`);
      const svcBody: any = await svcRes.json();
      const myjiraSvc = svcBody.services.find((s: any) => s.id === 'myjira');
      expect(myjiraSvc.connected).toBe(true);
      expect(myjiraSvc.connectionStatus).toBe('healthy');
      expect(myjiraSvc.personalStatus).toBe('connected');
      expect(myjiraSvc.allowedScope).toEqual(['cloud-keep-1']);
    } finally {
      server.close();
    }

    const factory = new AdapterFactory({
      credentialRepo: credRepo,
      encryptionKey: TEST_KEY,
      myjiraEnabled: true,
    });
    let thrownNoWs: any = null;
    try {
      await factory.getAdapterForService('myjira', {
        userId: userA,
        workspaceMode: 'personal',
        workspaceId: null,
      });
    } catch (e) {
      thrownNoWs = e;
    }
    expect(thrownNoWs).toBeDefined();
    expect(thrownNoWs.category).toBe('AUTH_ERROR');
    expect(thrownNoWs.message).toBe('Jira cá nhân yêu cầu không gian làm việc.');
  });

  it('Case 9 (AUD-W3-01): GitHub singleton scope_id="default" exposes Org A repo fullName to User B in GET /api/connections/github and reports false-healthy connected in GET /api/services while blocking live repo content access', async () => {
    await githubTeamRepo.replace({
      chosenBy: userA,
      repos: [{ repoId: '9001', fullName: 'org-a/secret-roadmap', name: 'secret-roadmap' }],
    });
    await credRepo.upsertPersonalCredentials({
      service: 'github',
      userId: userB,
      config: encryptCredentials(
        { githubUserId: '7702', login: 'userb-gh', name: 'User B', accessToken: 'gho_userb_token' },
        TEST_KEY,
      ),
      status: 'active',
    });

    const { accessToken: tokenB } = generateAccessToken(
      { id: userB, email: 'audit-repro-b@example.com', name: 'Audit User B', role: 'member' },
      JWT_SECRET,
      sessionIdB,
    );

    const app = express();
    app.use((req, _res, next) => {
      (req as any).user = { id: userB, email: 'audit-repro-b@example.com', role: 'member', sid: sessionIdB };
      (req as any).workspace = { mode: 'personal', workspaceId: null, role: 'owner' };
      next();
    });
    app.use(
      '/api/connections/github',
      createGitHubConnectionRoutes({
        jwtSecret: JWT_SECRET,
        sessionRepo: {
          findActiveUser: async () => ({
            id: userB,
            email: 'audit-repro-b@example.com',
            name: 'Audit User B',
            role: 'member',
            sid: sessionIdB,
          }),
        } as any,
        states: {} as any,
        credentialRepo: credRepo,
        teamRepo: githubTeamRepo,
        encryptionKey: TEST_KEY,
        oauth: {
          clientId: 'cid',
          clientSecret: 'csec',
          redirectUri: 'http://localhost:5173/github/callback',
          authorizationUrl: 'https://github.com/login/oauth/authorize',
          tokenUrl: 'https://github.com/login/oauth/access_token',
          apiBaseUrl: 'https://api.github.com',
        },
        fetchFn: async (input) => {
          const url = String(input);
          if (url.includes('/user/repos')) {
            return new Response(
              JSON.stringify([
                {
                  id: 8002,
                  full_name: 'userb-gh/personal-notes',
                  name: 'personal-notes',
                  private: true,
                  archived: false,
                  disabled: false,
                  permissions: { pull: true, push: true },
                },
              ]),
              { status: 200, headers: { 'content-type': 'application/json' } },
            );
          }
          return new Response(JSON.stringify({ id: 7702, login: 'userb-gh' }), { status: 200 });
        },
      }),
    );
    app.use(
      '/api/services',
      createServicesRoutes({
        credentialRepo: credRepo,
        encryptionKey: TEST_KEY,
        githubTeamRepo,
      }),
    );

    const server = app.listen(0);
    try {
      const addr = server.address() as { port: number };
      const connRes = await fetch(`http://127.0.0.1:${addr.port}/api/connections/github`, {
        headers: { Authorization: `Bearer ${tokenB}` },
      });
      const connBody: any = await connRes.json();
      expect(connBody.status).toBe('needs_membership');
      expect(connBody.repos).toEqual([
        { repoId: '9001', fullName: 'org-a/secret-roadmap', name: 'secret-roadmap', accessible: false },
      ]);

      const svcRes = await fetch(`http://127.0.0.1:${addr.port}/api/services`);
      const svcBody: any = await svcRes.json();
      const ghSvc = svcBody.services.find((s: any) => s.id === 'github');
      expect(ghSvc.personalStatus).toBe('connected');
      expect(ghSvc.connected).toBe(true);
      expect(ghSvc.allowedScope).toEqual(['org-a/secret-roadmap']);
    } finally {
      server.close();
    }

    const ghLookup = createGitHubConnectionLookup({
      credentialRepo: credRepo,
      teamRepo: githubTeamRepo,
      encryptionKey: TEST_KEY,
      tokens: {
        forConnection: () => ({ getAccessToken: async () => 'gho_userb_token', invalidate: () => {} }),
      },
      client: {
        repos: async () => [
          { id: '8002', fullName: 'userb-gh/personal-notes', name: 'personal-notes', private: true, member: true },
        ],
      } as any,
    });
    const lookupB = await ghLookup(userB);
    expect(lookupB.status).toBe('needs_membership');
    expect(lookupB.connection).toBeUndefined();
  });

  it('Case 10 (AUD-W3-02): createNotionDigestRunner omits connections.telegram when calling getAdapter("telegram", { phase: "execution" }), failing with AUTH_ERROR', async () => {
    const dbId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const inserted = await pool.query<{ id: string; identity_version: number }>(
      `INSERT INTO notion_connections (
         user_id, app_id, workspace_id, workspace_name, actor_id, bot_id,
         config, scopes, status, is_default, allowed_databases, selected_databases
       )
       VALUES ($1, 'notion-client-id', '11111111-2222-3333-4444-555555555555', 'Audit Notion WS',
               '22222222-3333-4444-5555-666666666666', '33333333-4444-5555-6666-777777777777',
               $2, '{}', 'active', true, $3, $4::jsonb)
       RETURNING id, identity_version`,
      [
        userA,
        encryptCredentials(
          {
            accessToken: 'ntn_test_token',
            refreshToken: 'ntn_refresh_token',
            botId: '33333333-4444-5555-6666-777777777777',
          },
          TEST_KEY,
        ),
        [dbId],
        JSON.stringify([{ id: dbId, title: 'Roadmap DB', url: 'https://www.notion.so/Roadmap-aaaa' }]),
      ],
    );
    expect(inserted.rows[0]?.id).toBeTruthy();

    const tgCredA = await credRepo.upsertPersonalCredentials({
      service: 'telegram',
      userId: userA,
      config: encryptCredentials(
        {
          telegramUserId: '888001',
          username: 'usera_tg',
          selectedChats: [{ chatId: '888001', title: 'User A Private', type: 'private' }],
          allowedScope: { chats: ['888001'] },
        },
        TEST_KEY,
      ),
      status: 'active',
    });

    const notionLookup = createNotionConnectionLookup({ repo: notionRepo });
    const cand = await evaluateNotionDigestCandidate({
      userId: userA,
      request: 'Mỗi sáng gửi báo cáo Notion Roadmap DB qua Telegram User A Private',
      services: ['notion', 'telegram'],
      recurrence: { type: 'daily', time: '08:00' },
      notionConnection: notionLookup,
      telegramConnection: async () => ({
        status: 'connected',
        selectedChats: [{ chatId: '888001', title: 'User A Private', type: 'private' }],
        connection: {
          credentialId: tgCredA.id,
          telegramUserId: '888001',
          username: 'usera_tg',
          chatIds: ['888001'],
        },
      }),
    });
    expect(cand.canAutoDigest).toBe(true);

    const realFactory = new AdapterFactory({
      credentialRepo: credRepo,
      encryptionKey: TEST_KEY,
      notionRepo,
      createNotionAdapter: () => ({
        execute: async () => ({ pages: [] }),
      }),
      telegramBot: {
        botToken: '000000:TEST_BOT_PLACEHOLDER',
        botUsername: 'ati_bot',
        apiBaseUrl: 'https://api.telegram.org',
        callbackUrl: 'http://localhost:5173/telegram/callback',
      } as any,
      telegramBotClient: {
        getChatMember: async () => ({ status: 'member' }),
      } as any,
    });

    const notionRunner = createNotionDigestRunner({
      pool,
      notionConnection: notionLookup,
      telegramConnection: async () => ({
        status: 'connected',
        selectedChats: [{ chatId: '888001', title: 'User A Private', type: 'private' }],
        connection: {
          credentialId: tgCredA.id,
          telegramUserId: '888001',
          username: 'usera_tg',
          chatIds: ['888001'],
        },
      }),
      getAdapter: (svc, ctx) => realFactory.getAdapterForService(svc, ctx),
    });

    const outcome = await notionRunner(
      {
        runId: 'run-notion-tg-1',
        scheduleId: 'sched-notion-tg-1',
        scheduleVersion: 1,
        userId: userA,
        request: 'Mỗi sáng gửi báo cáo Notion Roadmap DB qua Telegram User A Private',
        services: ['notion', 'telegram'],
        dueAt: new Date('2026-10-15T01:00:00Z'),
        timeZone: 'Asia/Ho_Chi_Minh',
        recurrence: { type: 'daily', time: '08:00' },
        digestConfig: cand.config!,
        digestConfigHash: cand.configHash!,
      },
      'conv-1',
      AbortSignal.timeout(5000),
    );
    expect(outcome.state).toBe('blocked');
    if (outcome.state === 'blocked') {
      expect(outcome.error).toContain('Kết nối Telegram đã thay đổi, hãy lập lại kế hoạch.');
    }
  });

  it('Case 11 (AUD-W3-03, AUD-W3-04 & AUD-W3-05): Org Slack lookup fails in github/notion digest candidates & runners, pre-dispatch abort on GitHub/Notion writes marks step unknown, and GET /api/services reports connected Notion OAuth user as unconfigured', async () => {
    await githubTeamRepo.replace({
      chosenBy: userA,
      repos: [{ repoId: '9001', fullName: 'org-a/secret-roadmap', name: 'secret-roadmap' }],
    });
    const ghCredA = await credRepo.upsertPersonalCredentials({
      service: 'github',
      userId: userA,
      config: encryptCredentials(
        { githubUserId: '7701', login: 'usera-gh', name: 'User A', accessToken: 'gho_usera_token' },
        TEST_KEY,
      ),
      status: 'active',
    });

    const realFactory = new AdapterFactory({
      credentialRepo: credRepo,
      encryptionKey: TEST_KEY,
      githubTeamRepo,
      githubTokens: {
        forConnection: () => ({ getAccessToken: async () => 'gho_usera_token', invalidate: () => {} }),
      } as any,
      notionRepo,
      createGitHubAdapter: () => ({
        execute: async () => [],
      }),
      createNotionAdapter: () => ({
        execute: async () => ({ pages: [] }),
      }),
    });

    const ghConnStub = async () => ({
      status: 'connected' as const,
      repos: [{ repoId: '9001', fullName: 'org-a/secret-roadmap', name: 'secret-roadmap' }],
      connection: {
        credentialId: ghCredA.id,
        githubUserId: '7701',
        login: 'usera-gh',
        repos: ['org-a/secret-roadmap'],
      },
    });

    const ghCand = await evaluateGithubDigestCandidate({
      userId: userA,
      request: 'Mỗi sáng gửi bản tin GitHub repo org-a/secret-roadmap vào Slack #general',
      services: ['github', 'slack'],
      recurrence: { type: 'daily', time: '08:00' },
      githubConnection: ghConnStub,
      getAdapter: (svc, ctx) => realFactory.getAdapterForService(svc, ctx),
    });
    expect(ghCand.canAutoDigest).toBe(false);
    expect(ghCand.disabledReason).toContain(
      'Cần chỉ rõ 1 kênh Slack hợp lệ thuộc phạm vi được phép nhận bản tin.',
    );

    const ghSlackConfig = {
      credentialId: ghCredA.id,
      githubUserId: '7701',
      login: 'usera-gh',
      repos: ['org-a/secret-roadmap'],
      channelId: 'C01ORGA9999',
      channelName: 'general',
      staleDays: 7,
    };
    const ghSlackHash = computeDigestConfigHash({
      config: ghSlackConfig,
      recurrence: { type: 'daily', time: '08:00' },
      userId: userA,
    });
    const ghRunner = createGithubDigestRunner({
      pool,
      githubConnection: ghConnStub,
      getAdapter: (svc, ctx) => realFactory.getAdapterForService(svc, ctx),
    });
    const ghSlackRun = await ghRunner(
      {
        runId: 'run-gh-slack-1',
        scheduleId: 'sched-gh-slack-1',
        scheduleVersion: 1,
        userId: userA,
        request: 'Mỗi sáng gửi bản tin GitHub repo org-a/secret-roadmap vào Slack #general',
        services: ['github', 'slack'],
        dueAt: new Date('2026-10-15T01:00:00Z'),
        timeZone: 'Asia/Ho_Chi_Minh',
        recurrence: { type: 'daily', time: '08:00' },
        digestConfig: ghSlackConfig,
        digestConfigHash: ghSlackHash,
      } as any,
      'conv-1',
      AbortSignal.timeout(5000),
    );
    expect(ghSlackRun.state).toBe('blocked');
    if (ghSlackRun.state === 'blocked') {
      expect(ghSlackRun.error).toContain("No credentials configured for service 'slack'");
    }

    const notionLookup = createNotionConnectionLookup({ repo: notionRepo });
    const ntCand = await evaluateNotionDigestCandidate({
      userId: userA,
      request: 'Mỗi sáng gửi báo cáo Notion Roadmap DB vào Slack #general',
      services: ['notion', 'slack'],
      recurrence: { type: 'daily', time: '08:00' },
      notionConnection: notionLookup,
      getAdapter: (svc, ctx) => realFactory.getAdapterForService(svc, ctx),
    });
    expect(ntCand.canAutoDigest).toBe(false);
    expect(ntCand.disabledReason).toContain(
      'Cần chỉ rõ 1 kênh Slack hợp lệ thuộc phạm vi được phép nhận bản tin.',
    );

    let ghFetchCalled = false;
    const ghAdapter = new GitHubAdapter({
      credentials: { token: 'gho_test' },
      allowedScope: { repos: ['org-a/secret-roadmap'] },
      fetchFn: async () => {
        ghFetchCalled = true;
        return new Response(JSON.stringify({ id: 1, number: 1 }), { status: 201 });
      },
    });
    const abortCtrl = new AbortController();
    abortCtrl.abort();
    const ghStepRunner = new StepRunner({ getAdapter: async () => ghAdapter });
    const ghStepRes = await ghStepRunner.executeStep(
      {
        id: 'gh_step_1',
        tool: 'github.create_issue',
        description: 'Create issue',
        args: { repo: 'org-a/secret-roadmap', title: 'Bug' },
        dependsOn: [],
        risk: 'medium',
      },
      new Map(),
      { signal: abortCtrl.signal },
    );
    expect(ghFetchCalled).toBe(false);
    expect(ghStepRes.status).toBe('unknown');

    let ntFetchCalled = false;
    const ntAdapter = new NotionAdapter({
      credentials: { token: 'ntn_test' },
      allowedScope: { databases: ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'] },
      fetchFn: async () => {
        ntFetchCalled = true;
        return new Response(JSON.stringify({ id: 'page-1' }), { status: 200 });
      },
    });
    const ntStepRunner = new StepRunner({ getAdapter: async () => ntAdapter });
    const ntStepRes = await ntStepRunner.executeStep(
      {
        id: 'nt_step_1',
        tool: 'notion.create_page',
        description: 'Create page',
        args: {
          databaseId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          title: 'New Page',
        },
        dependsOn: [],
        risk: 'medium',
      },
      new Map(),
      { signal: abortCtrl.signal },
    );
    expect(ntFetchCalled).toBe(false);
    expect(ntStepRes.status).toBe('unknown');

    const app = express();
    app.use((req, _res, next) => {
      (req as any).user = { id: userA, email: 'audit-repro-a@example.com', role: 'admin' };
      (req as any).workspace = { mode: 'personal', workspaceId: null, role: 'owner' };
      next();
    });
    app.use(
      '/api/services',
      createServicesRoutes({
        credentialRepo: credRepo,
        encryptionKey: TEST_KEY,
      }),
    );
    const server = app.listen(0);
    try {
      const addr = server.address() as { port: number };
      const svcRes = await fetch(`http://127.0.0.1:${addr.port}/api/services`);
      const svcBody: any = await svcRes.json();
      const notionSvc = svcBody.services.find((s: any) => s.id === 'notion');
      expect(notionSvc.configured).toBe(false);
      expect(notionSvc.connected).toBe(false);
      expect(notionSvc.connectionStatus).toBe('unconfigured');
    } finally {
      server.close();
    }
  });

  it('W4 Test 1 (AUD-W4-01): mysheets with 0 selectedSpreadsheets blacks out Organization shared sheets catalog AND PersonalSheetsAdapter Drive/Docs tools bypass allowedScope + overwrite Docs as text/plain (mock HTTP transport)', async () => {
    const encKey = '0123456789abcdef0123456789abcdef';
    const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();

    const fakeRepo: any = {
      getAllActiveServices: vi.fn(async () => ['sheets']),
      getCredentials: vi.fn(async (service: string) => {
        if (service === 'sheets') {
          return {
            service: 'sheets',
            status: 'active',
            config: encryptCredentials(
              {
                clientEmail: 'sa@unit.iam.gserviceaccount.com',
                privateKey,
                allowedScope: { spreadsheets: ['org_shared_sheet_123456'] },
              },
              encKey,
            ),
          };
        }
        return null;
      }),
      getPersonalCredentials: vi.fn(async (service: string, userId: string) => {
        if (service === 'mysheets' && userId === 'user-1') {
          return {
            service: 'mysheets',
            userId: 'user-1',
            status: 'active',
            config: encryptCredentials(
              {
                accessToken: 'ya29.test',
                refreshToken: '1//test',
                expiresAt: new Date(Date.now() + 3600_000).toISOString(),
                email: 'user@example.com',
                selectedSpreadsheets: [],
                allowedScope: { spreadsheets: [] },
              },
              encKey,
            ),
          };
        }
        return null;
      }),
    };

    const personalAndShared = await getToolCatalogFor(fakeRepo, encKey, {
      userId: 'user-1',
      workspaceMode: 'organization',
      workspaceId: 'ws-org-1',
      gmailEnabled: false,
      mysheetsEnabled: true,
    });
    expect(personalAndShared.filter((t) => t.service === 'mysheets').length).toBe(6);
    expect(personalAndShared.some((t) => t.name === 'mysheets.read_range')).toBe(false);

    const effectiveCatalog = await runtimeToolCatalog('live', fakeRepo, encKey, {
      userId: 'user-1',
      workspaceMode: 'organization',
      workspaceId: 'ws-org-1',
      gmailEnabled: false,
      mysheetsEnabled: true,
    });
    expect(effectiveCatalog.some((t) => t.service === 'sheets')).toBe(false);
    expect(effectiveCatalog.some((t) => t.name.includes('read_range') || t.name.includes('append_rows'))).toBe(false);

    const calls: Array<{ url: string; method: string; contentType?: string; body?: string }> = [];
    const adapter = new PersonalSheetsAdapter({
      userId: 'user-1',
      tokens: {
        getAccessToken: async () => 'ya29.test',
        refreshAccessToken: async () => 'ya29.refreshed',
      },
      allowedScope: { spreadsheets: ['allowed_sheet_123456'] },
      fetchFn: (async (url: string | URL, init?: RequestInit) => {
        const u = String(url);
        const method = init?.method ?? 'GET';
        const headers = (init?.headers ?? {}) as Record<string, string>;
        calls.push({ url: u, method, contentType: headers['Content-Type'], body: typeof init?.body === 'string' ? init.body : undefined });
        if (u.includes('/export')) {
          return new Response('Existing Heading\nExisting Table Content', { status: 200 });
        }
        if (u.includes('/upload/drive/v3/files/')) {
          return new Response(JSON.stringify({ id: 'unscoped_doc_123456', name: 'Spec Doc', mimeType: 'application/vnd.google-apps.document' }), { status: 200 });
        }
        return new Response(JSON.stringify({ id: 'unapproved_sheet_999999', name: 'Secret Sheet', mimeType: 'application/vnd.google-apps.spreadsheet', parents: ['folder_target_123456'] }), { status: 200 });
      }) as typeof fetch,
    });

    await expect(
      adapter.execute('mysheets.read_range', { spreadsheetId: 'unapproved_sheet_999999', range: 'A1:B2' }),
    ).rejects.toThrow(/Allowed scope restriction/i);

    const moveRes = await adapter.execute('mysheets.move_drive_file', {
      fileId: 'unapproved_sheet_999999',
      folderId: 'folder_target_123456',
    });
    expect(moveRes).toMatchObject({ id: 'unapproved_sheet_999999', folderId: 'folder_target_123456' });

    await adapter.execute('mysheets.append_doc_text', {
      documentId: 'unscoped_doc_123456',
      text: 'Appended line',
    });
    const uploadCall = calls.find((c) => c.url.includes('/upload/drive/v3/files/unscoped_doc_123456'));
    expect(uploadCall).toBeDefined();
    expect(uploadCall?.method).toBe('PATCH');
    expect(uploadCall?.contentType).toContain('text/plain');
    expect(uploadCall?.body).toBe('Existing Heading\nExisting Table Content\n\nAppended line');
  });

  it('W4 Test 2 (AUD-W4-02): Shared SheetsAdapter pre-write GET failure yields false status="unknown" in StepRunner AND PersonalSheetsAdapter two-POST append_rows resets writeDispatched', async () => {
    const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    let postSent = false;
    const sharedAdapter = new SheetsAdapter({
      credentials: { clientEmail: 'bot@example.iam.gserviceaccount.com', privateKey },
      allowedScope: { spreadsheets: ['shared_sheet_123456'] },
      fetchFn: (async (url: string | URL, init?: RequestInit) => {
        const u = String(url);
        if ((init?.method ?? 'GET') === 'POST' && !u.includes('oauth2.googleapis.com')) {
          postSent = true;
        }
        if (u.includes('oauth2.googleapis.com/token')) {
          return new Response(JSON.stringify({ access_token: 'sa-tok', expires_in: 3600 }), { status: 200 });
        }
        return new Response('Backend unavailable', { status: 503 });
      }) as typeof fetch,
    });

    const runner = new StepRunner({ sheets: sharedAdapter });
    const stepResult = await runner.executeStep(
      {
        id: 'step_1',
        tool: 'sheets.append_rows',
        description: 'Append row',
        args: { spreadsheetId: 'shared_sheet_123456', sheet: 'Tasks', rows: [['Task 1']] },
        dependsOn: [],
        requiresApproval: true,
      },
      new Map(),
    );
    expect(postSent).toBe(false);
    expect(stepResult.status).toBe('unknown');

    let batchUpdateMutated = false;
    const personalAdapter = new PersonalSheetsAdapter({
      userId: 'user-1',
      tokens: {
        getAccessToken: async (_userId: string, options?: { forceRefresh?: boolean }) => {
          if (options?.forceRefresh) {
            throw new Error('Refresh token revoked during second POST');
          }
          return 'ya29.initial';
        },
        refreshAccessToken: async () => {
          throw new Error('Refresh token revoked');
        },
      },
      allowedScope: { spreadsheets: ['personal_sheet_123456'] },
      fetchFn: (async (url: string | URL, init?: RequestInit) => {
        const u = decodeURIComponent(String(url));
        const method = init?.method ?? 'GET';
        if (method === 'GET' && u.includes('fields=sheets.properties')) {
          return new Response(JSON.stringify({ sheets: [{ properties: { sheetId: 0, title: 'Tasks' } }] }), { status: 200 });
        }
        if (method === 'GET' && u.includes('!A1:Z500')) {
          return new Response(JSON.stringify({ values: [['ID', 'Name'], ['101', 'Old Name']] }), { status: 200 });
        }
        if (method === 'POST' && u.includes(':batchUpdate')) {
          batchUpdateMutated = true;
          return new Response(JSON.stringify({ totalUpdatedRows: 1 }), { status: 200 });
        }
        if (method === 'POST' && u.includes(':append')) {
          return new Response('Unauthorized', { status: 401 });
        }
        return new Response('{}', { status: 200 });
      }) as typeof fetch,
    });

    let caughtError: any;
    try {
      await personalAdapter.execute('mysheets.append_rows', {
        spreadsheetId: 'personal_sheet_123456',
        sheet: 'Tasks',
        deduplicate: true,
        keyColumn: 'ID',
        onDuplicate: 'update',
        records: [
          { ID: '101', Name: 'Updated Name' },
          { ID: '102', Name: 'New Name' },
        ],
      });
    } catch (err) {
      caughtError = err;
    }
    expect(batchUpdateMutated).toBe(true);
    expect(caughtError?.details).toEqual({ requestSent: false });
  });

  it('W4 Test 3 (AUD-W4-04): AIPlanner & validatePlan reject mysheets.search_rows as report evidence source AND trap mixed report + issue creation in clarification loop', async () => {
    const store = new ReportArtifactStore();
    const catalog = [
      ...ALL_TOOLS.filter((t) => t.service !== 'sheets'),
      ...MYSHEETS_TOOLS,
      ...SHEETS_EXTENDED_TOOLS,
    ];
    const services = [...SERVICE_REGISTRY, MYSHEETS_SERVICE];

    const searchRowsReportPlan = {
      kind: 'plan',
      thinking: 'Tìm dòng lỗi và gửi báo cáo Slack',
      summary: 'Gửi báo cáo dòng lỗi',
      warnings: [],
      steps: [
        {
          id: 's_read',
          tool: 'mysheets.search_rows',
          description: 'Tìm dòng lỗi',
          args: { spreadsheetId: 'sheet_1234567890', sheet: 'Tasks', query: 'ERROR' },
          dependsOn: [],
        },
        {
          id: 's_post',
          tool: 'slack.send_message',
          description: 'Gửi báo cáo Slack',
          args: { channel: 'C_OPS', text: 'Báo cáo: phát hiện 1 dòng lỗi tại hàng 2' },
          dependsOn: ['s_read'],
        },
      ],
    };

    const validation = validatePlan(JSON.stringify(searchRowsReportPlan), catalog, {
      grounding: {
        memory: {
          myspreadsheet: { id: 'sheet_1234567890', title: 'Ops Tracker' },
          mysheet: { id: 'Tasks', title: 'Tasks' },
          channel: { id: 'C_OPS', name: 'ops' },
        },
        userTexts: ['Tổng hợp báo cáo các dòng lỗi trong bảng tính Ops Tracker rồi gửi vào kênh Slack ops'],
      },
    });
    expect(validation.valid).toBe(false);
    expect(validation.error).toContain('Report content must be grounded in verified read observations via reportEvidence');

    const planner = new AIPlanner({
      toolCatalog: catalog,
      services,
      searchMode: 'llm',
      prefetchDirectory: false,
      reportEvidenceStore: store,
      gatherSearch: async ({ tool }) => {
        if (tool === 'mysheets.read_range') {
          return {
            spreadsheetId: 'sheet_1234567890',
            range: 'Tasks!A1:B2',
            values: [['ID', 'Status'], ['1', 'ERROR']],
          };
        }
        return [];
      },
      provider: {
        name: 'mock',
        model: 'mock',
        generatePlan: async () =>
          JSON.stringify({
            kind: 'plan',
            thinking: 'Đọc bảng tính gửi báo cáo Slack và tạo issue GitHub',
            summary: 'Báo cáo Slack và tạo issue GitHub',
            warnings: [],
            steps: [
              {
                id: 's_read',
                tool: 'mysheets.read_range',
                description: 'Đọc bảng tính',
                args: { spreadsheetId: 'sheet_1234567890', range: 'Tasks!A1:B2' },
                dependsOn: [],
              },
              {
                id: 's_post',
                tool: 'slack.send_message',
                description: 'Gửi báo cáo Slack',
                args: { channel: 'C_OPS', text: 'Placeholder report' },
                dependsOn: ['s_read'],
              },
              {
                id: 's_issue',
                tool: 'github.create_issue',
                description: 'Tạo issue theo dõi',
                args: { repo: 'acme/ops', title: 'Follow up error row', body: 'Investigate error row' },
                dependsOn: ['s_read'],
              },
            ],
          }),
      },
    });

    const memory = new WorkingMemory();
    memory.setEntity('workflow_resource_defaults', {
      mysheets: { spreadsheetId: 'sheet_1234567890', sheetName: 'Ops Tracker' },
      slack: { channelId: 'C_OPS', channelName: 'ops' },
      github: { repo: 'acme/ops' },
    });

    const turn1 = await planner.processMessage({
      userMessage: 'Tổng hợp báo cáo dữ liệu từ bảng tính Ops Tracker gửi vào kênh Slack ops và tạo issue GitHub trên repo acme/ops',
      memory,
      actor: { userId: 'user_live', workspaceId: 'ws_live' },
    });
    expect(turn1.kind).toBe('clarification');
    if (turn1.kind === 'clarification') {
      expect(turn1.question).toContain('Bạn muốn nội dung công việc mới là báo cáo dữ liệu hay một nội dung riêng?');
    }
  });

  it('W4 Test 4 (AUD-W4-06): validatePlan accepts bracket array indexing step_1.output[0].id on array-output tools, but Executor resolveArgs throws at runtime', () => {
    const plan = {
      kind: 'plan',
      thinking: 'Tìm danh sách Trello và tạo thẻ',
      summary: 'Tạo thẻ Trello',
      warnings: [],
      steps: [
        {
          id: 'step_1',
          tool: 'trello.search_lists',
          description: 'Search list',
          args: { boardId: 'board_123456', query: 'Todo' },
          dependsOn: [],
        },
        {
          id: 'step_2',
          tool: 'trello.create_card',
          description: 'Create card in first matched list',
          args: {
            listId: { $ref: 'step_1.output[0].id' },
            title: 'Investigate bug',
          },
          dependsOn: ['step_1'],
        },
      ],
    };

    const validation = validatePlan(JSON.stringify(plan), ALL_TOOLS);
    expect(validation.valid).toBe(true);

    const stepOutputs = new Map<string, unknown>([
      ['step_1', [{ id: 'list_abc123', name: 'Todo', boardId: 'board_123456' }]],
    ]);

    expect(() => resolveArgs(plan.steps[1].args, stepOutputs)).toThrow(
      "Property 'output[0].id' not found on step 'step_1'",
    );
  });
});
```
<!-- END_SANITIZED_14_TEST_REPRO_PACKAGE -->
