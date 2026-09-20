# OIDC Identity and Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-process demo principal with a durable OIDC-backed identity and session boundary while preserving B/local workflow contracts and proving owner isolation end-to-end.

**Architecture:** The API remains the authentication authority behind a BFF boundary. Authorization Code + PKCE is handled by a provider-neutral OIDC client; the callback maps `(issuer, subject)` to a local user and creates a hashed opaque application session in PostgreSQL. API routes resolve either the compatibility bearer token or the new cookie through one `SessionAuthority`, then create a principal-scoped engine/store before touching a run or connector.

**Tech Stack:** Node.js 22+, TypeScript 5.9, PostgreSQL 16 + pgcrypto/pgvector, native `fetch` and `crypto`, `jose` 6.2.12 for JWT/JWKS verification, Zod 4, React 19/Vite 8, Vitest 4, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-09-21-oidc-identity-design.md`

## Global Constraints

- Use OIDC Authorization Code with PKCE; never accept an ID token as an API bearer token.
- Browser authentication uses an opaque `HttpOnly`, `Secure` outside local HTTP, `SameSite=Lax` application-session cookie.
- The OIDC client is provider-neutral; Keycloak is only a local reference issuer.
- State, nonce and PKCE transactions are single-use, expiry-bounded and stored hashed where possible.
- Validate exact issuer, audience/authorized party, signature/JWKS rotation, `exp`, `iat`, nonce and PKCE before creating a session.
- Store only a hash of the application-session value; revoke and expiry must survive API restart.
- Role mapping is deny-by-default; local user IDs remain the owner authority for all resources.
- Cookie state-changing routes enforce origin/CSRF checks; `SameSite` is defense in depth.
- Provider credentials, codes, state, verifier, tokens and provider responses never enter logs or error bodies.
- Migrations are additive and must preserve the existing PostgreSQL volume and B/local fixture path.
- The password route is available only behind an explicit local compatibility flag and is disabled in the release profile.
- Existing `SessionAuthority` consumers, fixture mode, polling, approval and reconciliation contracts remain green until the compatibility cutover.
- Do not change visual direction or Design System without the existing frontend design approval gate.

## Review Focus

- **OIDC replay:** a reused state/code/verifier or mismatched nonce must be rejected and must not create a session. Test in Task 3 and Task 4.
- **Provider key/network variance:** a rotated JWKS key, wrong issuer/audience, expired token or timeout must fail closed without leaking token material. Test in Task 3.
- **Cookie/proxy/CSRF boundary:** only the allowlisted session/transaction cookies cross the local proxy, and a foreign origin cannot mutate auth state. Test in Task 4 and Task 5.
- **Principal crossing:** user A cannot read, approve, execute, trace or reconcile user B's run, even when the run ID and cursor are known. Test in Task 6.
- **Restart and rollback:** a revoked/expired session stays invalid after API restart, while the compatibility switch can be disabled without deleting identity data. Test in Task 2 and Task 7.

## File Map

The following boundaries are fixed before implementation:

- `apps/api/src/auth.ts`: session credential types, compatibility `SessionStore`, and the `SessionAuthority` contract.
- `apps/api/src/durable-auth.ts`: PostgreSQL-backed application sessions and identity mapping; no HTTP routing.
- `apps/api/src/oidc.ts`: discovery, authorization URL, code exchange, claim/JWKS validation and provider error mapping.
- `apps/api/src/http-auth.ts`: cookie parsing/serialization, CSRF/origin helpers and redacted auth errors.
- `apps/api/src/app.ts`: route wiring, principal resolution and compatibility flag behavior.
- `apps/api/src/config.ts` and `.env.example`: bounded OIDC/session configuration.
- `apps/api/src/main.ts`: production composition and principal-scoped engine factory.
- `packages/engine/src/engine.ts`: a principal-scoped engine factory seam; existing engine invariants remain unchanged.
- `db/migrations/0009_oidc_identity.sql`: additive identity, session and transaction tables.
- `packages/dsl/src/contracts.ts` and `packages/dsl/scripts/emit-openapi.ts`: `/auth/me`, OIDC callback/start and cookie-session contracts.
- `apps/web/src/core/api.ts`, `apps/web/src/core/session.ts`, `apps/web/src/app/App.tsx`, `apps/web/src/app/views/LoginView.tsx`, `apps/web/src/app/shell/AppShell.tsx`: cookie-mode transport, identity hydration, OIDC sign-in and logout.
- `apps/web/tooling/local-proxy.ts`: safe cookie forwarding and original-origin forwarding for local BFF development.
- `apps/api/tests/`, `apps/web/tests/`, and `packages/engine/tests/`: unit, integration and browser gates.
- `docs/BASELINE.md`, `docs/functional-requirements.md`, `docs/openapi.yaml`, `docs/PRODUCTION-EXPANSION-PLAN-2026-09-21.md`, and the UX spec: status/evidence updates after implementation gates pass.

### Task 1: Add bounded configuration and authentication contracts

**Files:**
- Modify: `apps/api/src/config.ts`
- Modify: `.env.example`
- Modify: `apps/api/src/auth.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `packages/dsl/src/contracts.ts`
- Modify: `packages/dsl/scripts/emit-openapi.ts`
- Test: `apps/api/tests/config.test.ts`, `apps/api/tests/session-authority.test.ts`, `packages/dsl/tests/contracts.test.ts`

**Interfaces:**
- Produce `OidcConfig` with `enabled`, `issuerUrl`, `clientId`, `clientSecret`, `redirectUri`, `audience`, `scopes`, `webOrigin`, `sessionCookieName`, `transactionTtlMs`, `sessionTtlMs`, and `clockSkewSeconds`.
- Produce `SessionCredential = { authorization?: string; cookie?: string }` and `SessionInput = SessionCredential | string | undefined` for the bearer compatibility path.
- Produce `SessionMetadata = { createdFrom: "oidc" | "legacy"; issuer?: string; subject?: string }`.
- Change `SessionAuthority.authenticate` and `revoke` to accept `SessionInput`; add `issue(userId: string, metadata: SessionMetadata): Promise<string>` while retaining `login` for compatibility.
- Produce `AuthIdentitySchema`, `AuthMeSchema`, and `OidcErrorSchema` in the shared DSL boundary. `AuthMeSchema` contains `user_id`, `email`, `display_name`, and `roles`.

- [ ] **Step 1: Write failing configuration and contract tests.** Assert OIDC is disabled when `OIDC_ENABLED=0`, enabled configuration requires an HTTPS issuer outside local mode, `OIDC_SCOPES` is non-empty, TTLs are positive and bounded, the cookie name is token-safe, and the new schemas reject unknown/empty identity fields.
- [ ] **Step 2: Run the focused tests to verify they fail.**

  Run: `npm run test:unit -w @wap/api -- config.test.ts session-authority.test.ts && npm test -w @wap/dsl -- contracts.test.ts`

  Expected: failures for missing `OidcConfig`, new credential signatures and schemas.
- [ ] **Step 3: Implement the contracts and parsers.** Keep defaults compatible with B/local (`OIDC_ENABLED=0`, existing demo credentials, existing bearer route). Parse comma-separated scopes once, reject duplicate/blank scopes, and never include `clientSecret` in an object exposed to the web package. Update `apps/api/src/index.ts` exports.
- [ ] **Step 4: Regenerate the API contract and verify the tests.**

  Run: `npm run test:unit -w @wap/api -- config.test.ts session-authority.test.ts && npm test -w @wap/dsl -- contracts.test.ts && npm run schema:json && npm run api:generate`

  Expected: all focused tests pass and `docs/openapi.yaml` describes cookie-based auth without claiming OIDC is enabled by default.
- [ ] **Step 5: Commit the contract slice.**

  ```powershell
  git diff --check
  git add apps/api/src/config.ts apps/api/src/auth.ts apps/api/src/index.ts .env.example packages/dsl/src/contracts.ts packages/dsl/scripts/emit-openapi.ts packages/dsl/tests/contracts.test.ts apps/api/tests/config.test.ts apps/api/tests/session-authority.test.ts docs/openapi.yaml packages/dsl/generated/api.d.ts
  git commit -m "feat(auth): add oidc configuration and session contracts"
  ```

### Task 2: Add additive PostgreSQL identity/session storage

**Files:**
- Create: `db/migrations/0009_oidc_identity.sql`
- Create: `apps/api/src/durable-auth.ts`
- Modify: `apps/api/src/auth.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/main.ts`
- Test: `apps/api/tests/durable-auth.integration.test.ts`, `apps/api/tests/auth.test.ts`

**Interfaces:**
- Produce `AuthRepository` methods `findOrCreateIdentity`, `createSession`, `findSession`, `revokeSession`, `consumeOidcTransaction`, and `createOidcTransaction`.
- Produce `DurableSessionAuthority implements SessionAuthority`, with `issue`, `authenticate`, `revoke`, and compatibility `login`.
- Session lookup accepts `SessionInput` and returns only a local UUID; repository methods never return raw session values.

- [ ] **Step 1: Write the migration and repository red tests.** Add tests that migrate a temporary database from schema 0008, create two users and verify unique `(issuer, subject)`, session hash-only persistence, transaction expiry/one-time consumption, and cascade behavior when a user is removed.
- [ ] **Step 2: Run the integration test to establish the failure.**

  Run: `npm run build -w @wap/db; npm run db:migrate:g1; npm run test:integration -w @wap/api -- durable-auth.integration.test.ts`

  Expected: missing tables/repository methods.
- [ ] **Step 3: Add `0009_oidc_identity.sql`.** Create `auth_identities`, `auth_sessions`, and `oidc_transactions` with UUID foreign keys to `users`, unique issuer/subject, hash columns, expiry/revocation timestamps, and indexes. Keep `users.password_hash` intact for the local compatibility principal; OIDC-created users use the sentinel `OIDC_MANAGED` and cannot pass the password path.
- [ ] **Step 4: Implement repository transactions.** Hash session/state values with SHA-256 before persistence, issue 32-byte base64url session values, use `SELECT ... FOR UPDATE` for transaction consumption, and make revoke idempotent while returning an authentication error for an unknown credential.
- [ ] **Step 5: Wire `DurableSessionAuthority` behind `CreateApiOptions.sessionStore`.** The in-memory `SessionStore` remains the fixture/default when OIDC is disabled; the main entrypoint selects durable authority only when `OIDC_ENABLED=1` and the database is available.
- [ ] **Step 6: Run focused integration and restart tests.**

  Run: `npm run test:integration -w @wap/api -- durable-auth.integration.test.ts && npm run test:unit -w @wap/api -- auth.test.ts session-authority.test.ts`

  Expected: session authentication works after constructing a second authority instance, revoked/expired sessions fail, and no raw token appears in selected database columns or request logs.
- [ ] **Step 7: Commit the durable storage slice.**

  ```powershell
  git diff --check
  git add db/migrations/0009_oidc_identity.sql apps/api/src/durable-auth.ts apps/api/src/auth.ts apps/api/src/app.ts apps/api/src/main.ts apps/api/tests/durable-auth.integration.test.ts apps/api/tests/auth.test.ts
  git commit -m "feat(auth): persist oidc identities and sessions"
  ```

### Task 3: Implement provider-neutral OIDC discovery and validation

**Files:**
- Create: `apps/api/src/oidc.ts`
- Modify: `apps/api/package.json`, `package-lock.json`
- Test: `apps/api/tests/oidc.test.ts`, `apps/api/tests/oidc-issuer.ts`

**Interfaces:**
- Produce `OidcProviderClient` with `authorizationUrl(transaction)`, `exchangeCode(code, verifier)`, and `validateIdentity(tokens, transaction)`.
- Produce `OidcIdentity = { issuer: string; subject: string; email: string; emailVerified: boolean; displayName: string | null; roles: string[] }`.
- Produce `OidcFlow` with `start(returnTo, requestContext)` and `complete(query, transactionCookie)`.

- [ ] **Step 1: Add `jose` as a direct API dependency at the lockfile-resolved version `6.2.12`, then write failing provider tests.** The tests use a local fake issuer with generated RSA keys and cover discovery, authorization URL parameters, code exchange, issuer/audience/nonce/expiry validation, JWKS rotation, unknown role claims and timeout behavior.
- [ ] **Step 2: Run the provider tests to verify they fail.**

  Run: `npm run test:unit -w @wap/api -- oidc.test.ts`

  Expected: missing provider client and fake issuer harness failures.
- [ ] **Step 3: Implement bounded discovery and token exchange.** Cache discovery/JWKS only for the configured TTL, use an `AbortController` timeout, allow only the configured issuer/token/JWKS endpoints, and map every provider/network error to a redacted `OidcProviderError`.
- [ ] **Step 4: Implement claim verification with `jose`.** Require exact `iss`, configured API audience, `exp`, bounded `iat`, transaction nonce and a verified signature; accept only configured role claim values and require the configured email verification policy.
- [ ] **Step 5: Verify all focused provider tests.**

  Run: `npm run test:unit -w @wap/api -- oidc.test.ts`

  Expected: all valid tokens pass, every malformed/replayed/rotated-key case fails closed, and snapshots contain no code, verifier, token or provider response.
- [ ] **Step 6: Commit the provider slice.**

  ```powershell
  git diff --check
  git add apps/api/src/oidc.ts apps/api/package.json package-lock.json apps/api/tests/oidc.test.ts apps/api/tests/oidc-issuer.ts
  git commit -m "feat(auth): validate provider-neutral oidc callbacks"
  ```

### Task 4: Wire API callback, cookies, CSRF and compatibility routes

**Files:**
- Create: `apps/api/src/http-auth.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/observability.ts`
- Modify: `packages/dsl/src/contracts.ts`
- Test: `apps/api/tests/oidc-http.integration.test.ts`, `apps/api/tests/http-boundary.integration.test.ts`, `apps/api/tests/logout.test.ts`

**Interfaces:**
- `parseCookieHeader(value: string | undefined): ReadonlyMap<string,string>` rejects malformed/oversized values.
- `serializeSessionCookie(name: string, value: string, options: CookieOptions): string` always emits `HttpOnly`, `Path=/`, bounded `Max-Age`, and configured `SameSite`.
- `assertAuthMutationOrigin(request, config): void` checks the trusted browser origin and anti-CSRF header for state-changing cookie routes.
- API routes: `GET /api/v1/auth/oidc/start`, `GET /api/v1/auth/oidc/callback`, `GET /api/v1/auth/me`, and `POST /api/v1/auth/logout`.

- [ ] **Step 1: Write failing HTTP tests.** Cover successful start/callback/me/logout, bad state/nonce/PKCE, foreign origin, missing CSRF header, cookie flags, 302 redirect allowlist, compatibility bearer logout, and no token material in request logs.
- [ ] **Step 2: Run the HTTP tests to verify they fail.**

  Run: `npm run test:integration -w @wap/api -- oidc-http.integration.test.ts http-boundary.integration.test.ts`

  Expected: 404/501 because routes and cookie authority are not wired.
- [ ] **Step 3: Implement cookie and origin helpers.** Limit cookie header size and cookie count, allow only the configured session and OIDC transaction names, and use `Cache-Control: no-store` for every auth response.
- [ ] **Step 4: Add start/callback/me/logout routing.** Consume transaction state atomically, create the local identity/session only after provider validation, set/clear cookies, and redirect only to an exact configured web origin/path. Pass `{ authorization, cookie }` into `SessionAuthority` before any engine or database read.
- [ ] **Step 5: Move the password route behind `API_LEGACY_PASSWORD_AUTH_ENABLED`.** A disabled release profile returns `404 AUTH_METHOD_DISABLED`; existing fixture tests set the flag explicitly. Keep bearer support only for compatibility and never issue a bearer token from the OIDC callback.
- [ ] **Step 6: Run the focused HTTP and logging tests.**

  Run: `npm run test:integration -w @wap/api -- oidc-http.integration.test.ts http-boundary.integration.test.ts && npm run test:unit -w @wap/api -- logout.test.ts observability.test.ts`

  Expected: cookie sessions authenticate `GET /auth/me` and protected routes, logout clears/revokes the session, and logs remain route/status/request-id only.
- [ ] **Step 7: Commit the API boundary.**

  ```powershell
  git diff --check
  git add apps/api/src/http-auth.ts apps/api/src/app.ts apps/api/src/config.ts apps/api/src/observability.ts packages/dsl/src/contracts.ts apps/api/tests/oidc-http.integration.test.ts apps/api/tests/http-boundary.integration.test.ts apps/api/tests/logout.test.ts docs/openapi.yaml packages/dsl/generated/api.d.ts
  git commit -m "feat(api): expose oidc cookie session routes"
  ```

### Task 5: Migrate the web client and local proxy to cookie sessions

**Files:**
- Modify: `apps/web/src/core/api.ts`
- Modify: `apps/web/src/core/contracts.ts`
- Modify: `apps/web/src/core/session.ts`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/views/LoginView.tsx`
- Modify: `apps/web/src/app/shell/AppShell.tsx`
- Modify: `apps/web/tooling/local-proxy.ts`
- Test: `apps/web/tests/unit/api.test.ts`, `apps/web/tests/unit/login-flow.test.ts`, `apps/web/tests/unit/local-proxy.test.ts`, `apps/web/tests/browser/session-races.spec.ts`, `apps/web/tests/browser/oidc-auth.spec.ts`

**Interfaces:**
- `Transport.me(signal): Promise<AuthMe>` and `Transport.logout(signal): Promise<void>` use `credentials: "include"` and never expose a provider token.
- `Transport.startOidcLogin(returnTo): void` assigns an exact API start URL; it does not use a fetch response as a credential.
- `SessionController` retains generation/abort semantics; live mode stores identity state, while fixture mode may retain the existing demo token.

- [ ] **Step 1: Write failing web tests.** Assert live transport sends no `Authorization` header, includes credentials, handles `401` by clearing the query/session generation, and renders an OIDC sign-in button while fixture mode keeps the existing password form.
- [ ] **Step 2: Run the focused web tests to verify they fail.**

  Run: `npm run test:unit -w @wap/web -- api.test.ts login-flow.test.ts local-proxy.test.ts`

  Expected: failures for `credentials: include`, new transport methods and cookie forwarding.
- [ ] **Step 3: Implement cookie-mode transport and identity hydration.** Add `credentials: "include"` to same-origin API calls, call `/auth/me` during live bootstrap, keep request abort/generation behavior, and make logout a non-retrying mutation followed by local query/controller cleanup.
- [ ] **Step 4: Update LoginView/App/AppShell.** Live mode starts OIDC and shows callback/expiry/error states; fixture mode remains unchanged. Logout calls the API before clearing local state and never reads a cookie or token value.
- [ ] **Step 5: Update the proxy safely.** Preserve only `wap_session` and `wap_oidc_tx` cookies, forward the browser origin in a single internal header that the API accepts only from loopback, continue stripping `Sec-Fetch-*`, reject foreign hosts/origins, and update proxy tests to prove arbitrary cookies are not forwarded.
- [ ] **Step 6: Run unit and browser gates.**

  Run: `npm run test:unit -w @wap/web -- api.test.ts login-flow.test.ts local-proxy.test.ts && npm run test:browser -w @wap/web -- oidc-auth.spec.ts session-races.spec.ts`

  Expected: fixture and live-cookie tests pass, logout aborts stale work, and no browser-visible provider credential exists.
- [ ] **Step 7: Commit the web boundary.**

  ```powershell
  git diff --check
  git add apps/web/src/core/api.ts apps/web/src/core/contracts.ts apps/web/src/core/session.ts apps/web/src/app/App.tsx apps/web/src/app/views/LoginView.tsx apps/web/src/app/shell/AppShell.tsx apps/web/tooling/local-proxy.ts apps/web/tests/unit/api.test.ts apps/web/tests/unit/login-flow.test.ts apps/web/tests/unit/local-proxy.test.ts apps/web/tests/browser/session-races.spec.ts apps/web/tests/browser/oidc-auth.spec.ts
  git commit -m "feat(web): use oidc cookie sessions"
  ```

### Task 6: Make engine access principal-scoped and close owner gaps

**Files:**
- Modify: `packages/engine/src/engine.ts`
- Modify: `packages/engine/src/gateway-manager.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/ai-runtime.ts`
- Test: `packages/engine/tests/principal-isolation.integration.test.ts`, `apps/api/tests/audit-ownership.integration.test.ts`, `apps/api/tests/audit-http.integration.test.ts`

**Interfaces:**
- Produce `PrincipalEngineFactory = (userId: string) => WorkflowEngine` with an explicit cache/lifecycle policy.
- `CreateApiOptions` accepts `engineFactory?: PrincipalEngineFactory`; the legacy single `engine` is used only when the authenticated principal equals the configured demo user.
- Every route resolves `const userId = await authenticate(...)` before parsing/accepting a run or querying a run detail, approval, event, trace or reconciliation.

- [ ] **Step 1: Write failing two-user tests.** Seed two users, create runs and cursors for each, then assert user A cannot list/read/approve/cancel/events/trace/reconcile user B's resources. Add a regression asserting a mismatched principal is rejected before `engine.accept` is called.
- [ ] **Step 2: Run the isolation tests to verify the current gap.**

  Run: `npm run test:integration -w @wap/engine -- principal-isolation.integration.test.ts && npm run test:integration -w @wap/api -- audit-ownership.integration.test.ts audit-http.integration.test.ts`

  Expected: failures that identify the fixed `config.userId` engine and the current post-accept principal check.
- [ ] **Step 3: Add the principal-scoped factory.** Construct a `Store` and AI authorization context with the authenticated UUID; bind connector/gateway handles to the same UUID and fail closed when no reviewed connector exists. Keep worker-owned execution leases tied to the run's durable `user_id`, not the request principal.
- [ ] **Step 4: Move authentication ahead of all side effects and owner queries.** For `POST /runs`, authenticate and authorize before body acceptance/engine calls; for all `/runs/:id/*`, pass the principal into the factory so SQL predicates and trace cursor bindings use the same UUID.
- [ ] **Step 5: Run isolation and regression gates.**

  Run: `npm run test:integration -w @wap/engine -- principal-isolation.integration.test.ts && npm run test:integration -w @wap/api -- audit-ownership.integration.test.ts audit-http.integration.test.ts && npm run test:unit -w @wap/api -- session-authority.test.ts`

  Expected: all cross-user attempts fail with `403`/not-found semantics without changing another user's DB rows, and no provider credential is touched before owner authorization.
- [ ] **Step 6: Commit the principal boundary.**

  ```powershell
  git diff --check
  git add packages/engine/src/engine.ts packages/engine/src/gateway-manager.ts apps/api/src/app.ts apps/api/src/main.ts apps/api/src/ai-runtime.ts packages/engine/tests/principal-isolation.integration.test.ts apps/api/tests/audit-ownership.integration.test.ts apps/api/tests/audit-http.integration.test.ts
  git commit -m "fix(auth): scope engine operations to authenticated principal"
  ```

### Task 7: Add release evidence, migration/restore checks and documentation

**Files:**
- Modify: `apps/api/README.md`
- Modify: `docs/BASELINE.md`
- Modify: `docs/functional-requirements.md`
- Modify: `docs/openapi.yaml`
- Modify: `docs/PRODUCTION-EXPANSION-PLAN-2026-09-21.md`
- Modify: `docs/superpowers/specs/2026-09-15-platform-ux-design.md`
- Create: `docs/auth-evidence/OIDC-01/README.md`
- Create: `scripts/check-oidc.mjs`
- Test: `apps/api/tests/auth-release-gate.integration.test.ts`

**Interfaces:**
- `scripts/check-oidc.mjs` runs the fake-issuer flow, migration-from-0008, restart/revoke, two-user owner matrix, cookie/CSRF checks and redaction canary, then writes a sanitized manifest containing commit, migration checksum, test counts and verdict.
- Documentation status values remain `CONFIRMED`, `TECHNICAL_PARTIAL`, `OPEN`, or `NOT_RUN`; no fixture evidence is labeled production readiness.

- [ ] **Step 1: Write the release-gate test and manifest assertions.** Require the exact acceptance cases from the spec: callback rejection matrix, JWKS rotation, two-user isolation, restart/revoke, CSRF/origin, role deny-by-default, migration and restore rehearsal, and absence of token material in the manifest.
- [ ] **Step 2: Run the gate before implementation is called complete.**

  Run: `node scripts/check-oidc.mjs`

  Expected before wiring: a deterministic `OIDC_GATE_NOT_READY` manifest identifying missing evidence; no secret values written.
- [ ] **Step 3: Implement the sanitized gate runner.** Use isolated temporary database names and exact cleanup, reuse the existing integration harness, redact values matching configured secrets/session patterns, and exit non-zero for any missing or failed case.
- [ ] **Step 4: Run the complete verification suite.**

  Run: `npm run typecheck; npm run build; npm run check:full; node scripts/check-oidc.mjs`

  Expected: all existing B/local gates plus OIDC gate pass on one release commit, with cleanup delta equal to zero.
- [ ] **Step 5: Update docs from evidence.** Record migration 0009, route contracts, compatibility switch, exact test counts, restore command/output and remaining production-owned inputs. Update Baseline B/local only to describe the approved expansion boundary; do not claim provider quality, UX approval or production rollout without their evidence.
- [ ] **Step 6: Commit the release evidence.**

  ```powershell
  git diff --check
  git add apps/api/README.md docs/BASELINE.md docs/functional-requirements.md docs/openapi.yaml docs/PRODUCTION-EXPANSION-PLAN-2026-09-21.md docs/superpowers/specs/2026-09-15-platform-ux-design.md docs/auth-evidence/OIDC-01/README.md scripts/check-oidc.mjs apps/api/tests/auth-release-gate.integration.test.ts
  git commit -m "docs(auth): record oidc release evidence"
  ```

## Self-Review Checklist

- **Spec coverage:** Sections 1–2 are covered by Tasks 1, 3 and 5; runtime flow by Tasks 2–5; durable data by Task 2; security by Tasks 3–5; rollout by Tasks 4–7; acceptance gates by Tasks 6–7; ownership inputs are documented without being silently invented.
- **Placeholder scan:** no task relies on `TBD`, `TODO`, an unspecified error handler, or a generic “test the above” instruction; commands, file paths and expected outcomes are explicit.
- **Type consistency:** `SessionCredential`, `SessionMetadata`, `OidcIdentity`, `OidcProviderClient`, `OidcFlow` and `PrincipalEngineFactory` are introduced before consumers; the existing `SessionAuthority` compatibility methods are updated in Task 1 before durable/API use.
- **Review focus coverage:** replay is pinned in Tasks 3–4; provider variance in Task 3; proxy/CSRF in Tasks 4–5; principal crossing in Task 6; restart/rollback in Tasks 2 and 7.
- **Scope guard:** no task changes frontend visual direction, adds a SaaS integration, enables provider calls, or removes the B/local fixture path without a separate approved decision and evidence update.

## Execution Handoff

This plan is intentionally staged: Tasks 1–3 establish contracts/storage/provider validation, Tasks 4–6 wire HTTP/web/principal isolation, and Task 7 is the release evidence gate. The recommended execution method is **native** because the tasks share `SessionAuthority`, database migrations and API contracts; one implementer can keep those interfaces consistent, followed by a whole-branch review and the full verification suite.
