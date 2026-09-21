# OIDC identity and session design

**Status:** SELECTED — OIDC BFF is the chosen identity path; production
activation still requires deployment-owned issuer, client, redirect and
two-user acceptance inputs. OIDC runtime remains disabled by default.

**Date:** 2026-09-21

**Scope:** P2 of `docs/PRODUCTION-EXPANSION-PLAN-2026-09-21.md`.

## 1. Decision

Adopt OpenID Connect (OIDC) Authorization Code with PKCE for human sign-in.
The application uses a backend-for-frontend (BFF) session boundary: the browser
receives only an opaque application-session cookie, while the API exchanges and
stores provider credentials server-side. An OIDC ID token is never accepted as
an API authorization token.

The OIDC client is provider-neutral and configured by environment variables. A
local Keycloak deployment may be used as a reference issuer for development,
but production is not coupled to Keycloak. The selected issuer, client, scopes,
audience and redirect URIs remain deployment-owned inputs.

## 2. Why this shape

The current API has an injectable `SessionAuthority` seam but its default
`SessionStore` is process memory, and the web client keeps a bearer token in
JavaScript memory. A direct SPA bearer design would expose provider access
tokens to the browser and would still require a durable application session
for revocation and owner checks. The BFF keeps provider tokens out of browser
state and lets the API preserve its existing principal boundary.

Alternatives considered:

| Option | Benefit | Rejected concern |
|---|---|---|
| SPA bearer with PKCE | Fewer server endpoints | Access-token exposure in JS, refresh/revocation complexity, harder CSRF posture |
| Self-managed password auth | No external issuer dependency | Credential lifecycle, recovery and MFA become application responsibilities |
| BFF OIDC (selected) | Server-side token handling, durable local session and clear owner boundary | Requires callback/state storage and a durable session migration |

## 3. Runtime contract

### 3.1 Browser/API flow

1. `GET /auth/oidc/start` creates a short-lived, single-use transaction with
   `state`, `nonce`, PKCE `code_verifier`, redirect URI and creation time. It
   stores hashes of the values in PostgreSQL and sets an `HttpOnly` pre-auth
   transaction cookie containing the one-time state/nonce/verifier envelope.
   The verifier must be recoverable for the code exchange; it is therefore
   never treated as a password hash, and the cookie envelope is bounded and
   cleared after callback.
2. The provider redirects to `GET /auth/oidc/callback` with `code` and `state`.
   The API atomically consumes the transaction, verifies the state and nonce,
   exchanges the code using the verifier, validates the returned ID/access
   token claims and resolves the provider subject.
3. The API upserts a local `auth_identities` record keyed by issuer and
   subject, resolves the local user and creates a durable application session.
   It sets an opaque cookie with `HttpOnly`, `Secure` outside local HTTP,
   `SameSite=Lax`, an explicit path and an expiry no longer than the session
   TTL, then redirects to the approved web route.
4. Authenticated API requests resolve the cookie through
   `SessionAuthority.authenticate`. The current principal is passed into all
   owner/role checks before a run, approval, trace, catalog, accounting or
   reconciliation query is executed.
5. `POST /auth/logout` revokes the local session and clears the cookie. Provider
   end-session is optional and must not be treated as local revocation evidence.

The existing password `/auth/login` route is retained only behind an explicit
local-development compatibility flag during migration. It is not a production
authentication path and must be disabled by the release configuration.

### 3.2 Provider validation

The callback must validate, at minimum:

- exact configured issuer (`iss`);
- expected API audience and authorized party (`aud`/`azp` where required);
- signature using the issuer JWKS, including key rotation and bounded cache;
- `exp`, `iat` and bounded clock skew;
- the transaction `nonce` against the ID token;
- authorization-code PKCE binding and one-time transaction consumption;
- configured email/verification and role-claim policy without trusting an
  unconfigured claim to grant operator access.

Access tokens are used only for the configured provider resource exchange or
provider calls. They are not logged, returned to the browser, or used in place
of the local session cookie.

## 4. Durable data model

Add additive migrations (without resetting the existing PostgreSQL volume):

- `auth_identities`: `id`, `user_id`, `issuer`, `subject`, optional normalized
  email, timestamps, unique `(issuer, subject)` and an index by `user_id`.
- `auth_sessions`: random session identifier hash, `user_id`, creation/expiry,
  `revoked_at`, last-seen metadata and an optional provider session reference.
  Only a hash of the cookie value is stored.
- `oidc_transactions`: hashed state, nonce and PKCE verifier, issuer/client,
  redirect target, creation/expiry and consumed timestamp. State is single-use
  and cleaned up by expiry; the raw verifier is only in the bounded, short-lived
  `HttpOnly` transaction cookie so the server can perform the code exchange.

The local user remains the authority for ownership. A provider subject is not
used directly as a run owner, and changing an identity mapping does not change
historical run ownership.

## 5. Security and operational requirements

- Cookie endpoints enforce allowed-origin checks and CSRF protection for every
  state-changing request; `SameSite` is defense in depth, not the only check.
- Session identifiers, codes, state, verifier, ID/access tokens and provider
  responses are excluded from structured logs and error bodies.
- Session rotation occurs after successful sign-in; logout/revoke is durable
  and survives API restart. Expired/revoked sessions fail closed.
- Role mapping is deny-by-default. At minimum, `user` and `operator` are
  distinct, with operator actions audited.
- Issuer metadata, JWKS and provider endpoints use configured HTTPS/allowlists
  in non-local environments; redirect URIs are exact, not wildcarded.
- Login/callback/session creation have bounded body, timeout, rate and storage
  limits. Provider failures do not create a local session.
- Secrets are injected through deployment configuration and rotation is
  documented; no client secret or refresh token enters the web bundle.

## 6. Compatibility and rollout

1. Implement the authority and migrations behind the existing
   `SessionAuthority` seam; keep current routes/tests green.
2. Add the OIDC start/callback/cookie transport and a fake issuer test harness.
3. Run dual-read only in local/staging: new OIDC sessions use durable storage;
   old bearer sessions remain accepted only while the compatibility flag is on.
4. Disable password login and raw bearer-token transport in the release profile;
   keep an explicit rollback switch that does not delete identity/session data.
5. Remove the compatibility path only after migration and owner-isolation gates
   pass on the release candidate.

## 7. Acceptance gates

The implementation is not complete until evidence exists for:

- callback success and rejection for bad state, nonce, issuer, audience,
  signature, expiry, redirect and PKCE;
- JWKS rotation and bounded provider/network failures;
- two users cannot read, approve, execute or reconcile each other's resources;
- session revoke, expiry and API restart behavior;
- CSRF/origin/cookie behavior in the browser and no token leakage in logs;
- role deny-by-default and audited operator actions;
- additive migration from the current schema and a restore rehearsal;
- full backend, web and integration gates on the release commit.

The result must update `docs/BASELINE.md`, functional requirements, API
contracts, the production-expansion evidence ledger and the web UX spec. Until
those updates and gates exist, P2 remains `OPEN`/`TECHNICAL PARTIAL`; this
document alone is not production approval.

## 8. Open inputs requiring explicit ownership

- production OIDC issuer/tenant and account owner;
- approved audience, scopes, role claim and redirect origins;
- session TTL, idle timeout, RPO/RTO and incident owner;
- staging credentials and a fresh two-user acceptance dataset;
- representative-user UX acceptance for sign-in, callback failure, expiry and
  logout states; the visual Design System is approved separately at
  `System Design/DESIGN.md`.
