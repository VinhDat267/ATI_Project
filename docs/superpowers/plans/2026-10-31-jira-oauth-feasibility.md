# Jira OAuth Feasibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify the local JIRA-01 OAuth probe, then use it to establish the provider facts required before workspace/runtime implementation.

**Architecture:** Isolated diagnostic tooling under tool-adapters, not a runtime API or exported adapter. An HTTP client, an in-memory OAuth session controller and a loopback browser runner exercise the documented Atlassian protocol; real HTTP fixtures test the probe itself. The live report is separate from fixture results and cannot mark unobserved onboarding or multi-site behavior as passing.

**Tech Stack:** Node.js built-ins (fetch, http, crypto, node:test), ESM `.mjs`; existing Vitest adapter suite; no new dependency.

**Spec:** [Approved Jira design](../specs/2026-10-30-jira-personal-workspaces-design.md), especially sections 5, 11–13. [Task card](../../handoff/tasks/JIRA-01-oauth-feasibility.md).

## Global Constraints

- “Workspace quản lý Jira trước; chưa áp dụng cơ chế workspace cho các dịch vụ khác.”
- “JIRA-01 phải thử bằng tài khoản Atlassian chưa thuộc bất kỳ site nào”. A local fixture cannot prove that fact.
- “Không log token/code, không đưa token vào browser/prompt”. Keep probe secrets in memory; environment files are ignored.
- “Không cung cấp tool HTTP/JQL/method tùy ý.” The probe only calls authorize/token, `/me`, accessible-resources and read-only permissions/metadata.
- Do not edit CURRENT-STATE/ROADMAP or ship runtime contracts/migrations before the provider gate.
- This plan is the independently deliverable JIRA-01 subsystem. JIRA-02–11 need their own detailed plans/cards after its live evidence; the approved overall design remains their scope authority.

## Review Focus

1. A provider body containing a token/code/error_description must never reach browser HTML, reports or CLI stderr; Task 1 error tests and Task 3 process tests pin this.
2. Concurrent/replayed callbacks and a superseded flow must not exchange or replace the current identity; Task 2 uses real HTTP counters and distinct account fixtures.
3. Cancelling/reconnecting while refresh is in flight must discard the late result; Task 2 controls an HTTP response barrier and checks subsequent authorization.
4. A fixture or an operator-attested no-site account is not observed Atlassian proof; Tasks 1/3 keep endpoint provenance and report separate assertions.
5. A browser other than the one starting the flow must not use state; Task 3 tests actual cookies, POST Origin checks, callback redirects and duplicate query parameters.

## File Structure

- `packages/tool-adapters/scripts/jira-probe/client.mjs`: fixed provider endpoints, timeouts, safe errors and token/profile/resource response validation.
- `packages/tool-adapters/scripts/jira-probe/session.mjs`: scopes, expiring one-use state, flow generations, identity binding, refresh serialization and redacted observation report.
- `packages/tool-adapters/scripts/jira-probe/server.mjs`: loopback routes, browser cookie and Origin checks; no raw secret responses.
- `packages/tool-adapters/scripts/jira-probe/cli.mjs`: environment validation, explicit live opt-in, start/shutdown and safe CLI output.
- `packages/tool-adapters/scripts/jira-probe/jira-probe.env.example`: blank local environment template.
- `packages/tool-adapters/scripts/jira-probe/README.md`: app setup and operator walkthrough; records no-site attestation separately from observations.
- `packages/tool-adapters/tests/jira-oauth-probe.check.mjs`: Node test entry, named `.check.mjs` to avoid accidental Vitest collection.
- `packages/tool-adapters/tests/helpers/jira-oauth-probe-fixture.mjs`: stateful loopback provider, including token rotation and response barriers.
- `packages/tool-adapters/package.json`: add `test:probe`; include the Node entry in this package's test script so CI actually runs it.
- `docs/ai-evidence/JIRA-01-PROVIDER-FACTS.md`: official source matrix and live NOT_RUN/observed status; never contains private identities/tokens.

### Task 1: Provider HTTP boundary

**Files:** Create `scripts/jira-probe/client.mjs`, tests and helper under the package paths above.

**Interfaces:** Produces `ProbeError(code)`, `createProbeClient({clientId, clientSecret, redirectUri, mode, fixtureBaseUrl?, timeoutMs?})`; client methods `authorizationUrl({state, scopes})`, `exchangeCode(code)`, `refresh(refreshToken)`, `profile(accessToken)`, `resources(accessToken)`, `permissions(accessToken, cloudId)`. Tokens stay inside trusted session code. Mode is exactly `live` or `fixture`; fixture endpoints require an explicit loopback URL, live endpoints cannot be overridden.

- [x] Write failing Node tests: token exchange sends JSON grant_type/client_id/client_secret/code/redirect_uri; authorization URL excludes the secret and Google-only parameters; resources filter Confluence entries; malformed token/body, redirect and actual deadline abort fail safely. Derive scope and request expectations as literals in the fixture.
- [x] Run `node --test packages/tool-adapters/tests/jira-oauth-probe.check.mjs`; record behavioral RED (missing module is the initial foundation RED only).
- [x] Implement the client with 10 s default request deadline, `redirect: 'error'`, 64 KiB response limit and stable error codes. Reject arbitrary live endpoints, URL credentials, non-loopback fixture hosts and invalid site/permission response shapes.
- [x] Run the same command; Expected: all Task 1 cases pass with no secret sentinel in errors.
- [x] Commit exact package client/tests/helper paths: `feat(jira): add OAuth feasibility HTTP client`.

### Task 2: Session and redacted observations

**Files:** Create `scripts/jira-probe/session.mjs`; extend the Node test entry/helper.

**Interfaces:** Consumes Task 1 client. Produces `createProbeSession({client, mode, clock?})` with `start(flow, browserBinding)`, `callback({state, code?, error?, browserBinding})`, `refresh(browserBinding)`, `disconnect(browserBinding)`, `report(browserBinding)`. Flows are `identity` (`read:me offline_access`) and `jira` (`read:me read:jira-work write:jira-work offline_access`). State TTL is 600,000 ms. Session is diagnostic memory only, not the later PostgreSQL production token manager.

- [x] Write RED tests for wrong browser/state, 10-minute expiry, replay/parallel callback (exactly one HTTP exchange), superseded flow, changed provider account, missing scope and no refresh token. A second identity must not leave the first connection marked usable after re-consent.
- [x] Run Node test entry; Expected: new tests fail on missing session behavior while Task 1 stays green.
- [x] Implement one-use state deletion before async exchange, generation checks around every async result, provider account comparison and owner checks. A report records only safe counts/boolean observations, requested/granted scopes and `fixture`/`live` provenance; never tokens, codes or raw provider bodies. Empty resources are not proof an account has no Jira memberships.
- [x] Add RED tests for two refresh callers sharing one exchange, new refresh token used on the next exchange, disconnect beating a delayed response, and invalid_grant requiring reconnect. Implement only this memory-session behavior; do not claim PostgreSQL/multi-process concurrency is tested here.
- [x] Run Node test entry; Expected: complete client/session suite passes, HTTP request counts match, report remains unready for unobserved live gates.
- [x] Commit exact session/tests/helper files: `feat(jira): add safe OAuth probe sessions`.

### Task 3: Local browser runner and operator setup

**Files:** Create `scripts/jira-probe/server.mjs`, `cli.mjs`, `jira-probe.env.example`, `README.md`; modify package.json; extend tests.

**Interfaces:** Consumes session/client. Produces `startProbeServer({clientId, clientSecret, redirectUri, mode, fixtureBaseUrl?, timeoutMs?}) → {url, close}`. Live CLI is `node --env-file=.env.jira-probe packages/tool-adapters/scripts/jira-probe/cli.mjs --live`; `--help`/`--check-config` have no network side effects. Env names: `JIRA_PROBE_CLIENT_ID`, `JIRA_PROBE_CLIENT_SECRET`, `JIRA_PROBE_REDIRECT_URI`. Callback default is exactly `http://127.0.0.1:4187/oauth/callback`; runner binds only to 127.0.0.1.

- [x] Write RED HTTP/process tests for missing config, explicit live opt-in, non-loopback redirect rejection, independent browser cookie rejection, cross-origin POST rejection, cancellation, duplicate callback params, code-free redirect after callback, safe `/report` and clean shutdown. Assert no secret/code sentinel in all response bodies and process output.
- [x] Run Node test entry; Expected: Task 3 failures for routes/CLI not implemented.
- [x] Implement routes `/`, `/start` POST, `/oauth/callback` GET, `/refresh` POST, `/disconnect` POST and `/report` GET. Browser binding cookie is HttpOnly/SameSite=Lax; POST requires exact local Origin. All responses use no-store and no-referrer; callback clears code/state from the displayed URL by redirecting to `/`. No issue/comment write routes. Keep the first bound browser as owner, do not silently rebind a second browser.
- [x] Add `test:probe` and chain it after existing Vitest package test. Document app creation, `read:me`/Jira scopes, sharing for a second test account, callback configuration, token secrecy, provider account attestation and gate outcomes.
- [x] Run `npm run test:probe -w @wap/tool-adapters` and `npm test -w @wap/tool-adapters`; Expected: full package suite green. Use an explicit sandbox environment for the package; do not load the root live .env.
- [x] Commit exact runner/template/readme/package/test files: `feat(jira): add local OAuth feasibility runner`.

### Task 4: Facts, native gate and handoff

**Files:** Create `docs/ai-evidence/JIRA-01-PROVIDER-FACTS.md`; fill only JIRA-01 card Results; add one session handoff log.

**Interfaces:** Consumes actual runner observations and official docs, produces provider facts with `DOCUMENTED`, `FIXTURE_VERIFIED`, `LIVE_OBSERVED`, `OPERATOR_ATTESTED`, `NOT_RUN` kept distinct. The gate is not complete until the approved no-site onboarding and multi-site cases are observed on Atlassian with operator attestation where external membership cannot be inferred by API.

- [ ] Self-check scope matrix against current official OAuth/profile/permissions/project/search/metadata/issues/comments docs. Do not call a write endpoint without a specifically approved plan.
- [ ] Run the runner through identity-only, existing site, second-site consent, refresh and ADMINISTER read using the owner's app/accounts. If missing app/credentials/user consent prevents this, record exact NOT_RUN gates and continue only independent test/docs work.
- [ ] Run `npm test -w @wap/tool-adapters`, mutations of owner/state/provenance/rotation guards, `git diff --check` and safe output scan. Expected: local harness verification passes; native status still reflects actual evidence.
- [ ] Fresh independent whole-branch review. Fix actionable defects with regression RED/GREEN. Commit task/log/facts: `docs(jira): record feasibility evidence and remaining native gate`.
- [ ] Open PR following repository template when GitHub authentication is available; otherwise retain tested local commits and report that PR creation is blocked by missing GitHub login. Do not mark JIRA-01 or proceed to JIRA-02 merely because the local harness passed.

## Self-review

Spec sections 5.1–5.4 map to Tasks 1–4. No production database rotation, membership/runtime adapter or planner implementation is hidden inside this provider spike. Five Review Focus cases each have a specified HTTP/process test. All session/client signatures match the consumers. Platform decision: loopback HTTP is diagnostic-only; production callback remains HTTPS. Live acceptance depends on Atlassian app/account access, not on fixture success.
