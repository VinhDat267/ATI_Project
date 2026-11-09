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
| **Separate Ephemeral Audit Reproduction Harnesses (Not in Repo Total)** | `apps/chat-api/tests/integration/__audit_repro_temp.test.ts` (`10` tests, W1–W3) + `apps/chat-api/tests/integration/__audit_repro_w4_temp.test.ts` (`4` tests, W4) — ephemeral, deleted in `finally` | `2` *(temp)* | N/A | **`2` *(ephemeral)*** | **`14` *(reproduction tests)*** | `npx vitest run` (`EXIT=0`) |

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

### 6.1. Database Safety Guard & State Preservation Design
To guarantee the temporary reproduction harnesses (`apps/chat-api/tests/integration/__audit_repro_temp.test.ts` and `apps/chat-api/tests/integration/__audit_repro_w4_temp.test.ts`) can never run destructive `DELETE` statements against a shared or non-isolated database:
1. **Fail-Closed Connection Guard (`assertIsolatedTestDatabase`):**
   Before opening a `pg.Pool`, `beforeAll` parses `DB_URL` and asserts `hostname` is `localhost` or `127.0.0.1`, `port === '56534'`, and `pathname === '/ati_v3'`. Any other host, port, or database name immediately throws `[AUDIT-HARNESS-GUARD] Refusing to execute destructive SQL against non-isolated database URL`.
2. **Pre-Test Snapshot & `afterAll` Restoration:**
   `beforeAll` snapshots existing rows in `service_credentials WHERE service = 'slack' AND user_id IS NULL`, `github_team_scope WHERE id = 'default'`, and `github_team_repos WHERE scope_id = 'default'`. `afterAll` deletes only the synthetic test UUIDs (`00000000-0000-4000-8000-000000000901`, `...0902`, `...0911`) and restores the pre-existing snapshot rows.
3. **Ephemeral File Cleanup:**
   The PowerShell wrapper runs inside `try { ... } finally { Remove-Item -Force ... }`, leaving `git status --short` completely clean (`0` untracked or modified code files).

### 6.2. Cases Reproduced in the Waves 1–3 10-Test Harness (`__audit_repro_temp.test.ts`)
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

### 6.3. Raw Execution Log of Waves 1–3 10-Test Reproduction Harness
```text
RUN  v4.1.11 C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit

 ✓ apps/chat-api/tests/integration/__audit_repro_temp.test.ts (10 tests) 283ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  01:42:33
   Duration  2.44s (transform 1.25s, setup 0ms, import 1.96s, tests 283ms, environment 0ms)

REPRO_EXIT=0
```

### 6.4. Cases Reproduced in the Wave 4 4-Test Harness (`__audit_repro_w4_temp.test.ts`)
| Test Block | Finding ID(s) | Reproduced Runtime Behavior | Result |
|---|---|---|---|
| **W4 Test 1 (`AUD-W4-01`)** | `AUD-W4-01` | 1. `getToolCatalogFor` with `selectedSpreadsheets: []` returns 6 `MYSHEETS_DRIVE_TOOLS` (`service: 'mysheets'`), causing `runtimeToolCatalog` to strip all Organization shared `sheets` tools (`0` spreadsheet tools remain).<br>2. `PersonalSheetsAdapter.execute('mysheets.move_drive_file', { fileId: 'unapproved_sheet_999999', folderId: 'folder_target_123456' })` succeeds on an unapproved spreadsheet rejected by `mysheets.read_range`.<br>3. `PersonalSheetsAdapter.execute('mysheets.append_doc_text', ...)` exports as `text/plain` and issues `PATCH /upload/drive/v3/files/{id}?uploadType=media` with `Content-Type: text/plain`, overwriting the entire Google Doc as plain text. | **PASS** (`55ms`) |
| **W4 Test 2 (`AUD-W4-02`)** | `AUD-W4-02` | 1. Shared `SheetsAdapter.execute('sheets.append_rows', ...)` failing with `503` on pre-write `GET` (`tabs`) omits `details: { requestSent: false }`, causing `StepRunner.executeStep` to return `status: 'unknown'` with `postSent === false`.<br>2. `PersonalSheetsAdapter.execute('mysheets.append_rows', { deduplicate: true, keyColumn: 'ID', onDuplicate: 'update', records: [...] })` mutates row 1 via `POST :batchUpdate`, then hits `401` on the second `POST :append`, resetting `writeDispatched = false` and throwing `details: { requestSent: false }` despite the first `POST` having already mutated the spreadsheet. | **PASS** (`41ms`) |
| **W4 Test 3 (`AUD-W4-04`)** | `AUD-W4-04` | 1. `validatePlan` rejects a report plan grounded via `mysheets.search_rows` (`Report content must be grounded in verified read observations via reportEvidence`) because `mysheets.search_rows` is omitted from `REPORT_SOURCE_TOOLS`.<br>2. `AIPlanner.processMessage` on a mixed report + `github.create_issue` prompt forces a hardcoded clarification (`"Bạn muốn nội dung công việc mới là báo cáo dữ liệu hay một nội dung riêng?"`). | **PASS** (`7ms`) |
| **W4 Test 4 (`AUD-W4-06`)** | `AUD-W4-06` | `validatePlan` accepts `{ "$ref": "step_1.output[0].id" }` when `step_1` (`trello.search_lists`) has `outputSchema.type === 'array'`, and Executor `resolveArgs` then throws `Error: Property 'output[0].id' not found on step 'step_1'` at runtime. | **PASS** (`3ms`) |

### 6.5. Raw Execution Log of Wave 4 4-Test Reproduction Harness
```text
RUN  v4.1.11 C:/Users/VinhDat/.gemini/antigravity/worktrees/ATI_Project/independent_service_audit

 ✓ apps/chat-api/tests/integration/__audit_repro_w4_temp.test.ts (4 tests) 218ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  07:44:22
   Duration  1.66s (transform 878ms, setup 0ms, import 1.24s, tests 218ms, environment 0ms)

W4_REPRO_EXIT=0
```
