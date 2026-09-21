# OIDC-01 release evidence

This directory describes the evidence contract for the provider-neutral OIDC BFF. The runtime is feature-gated: `OIDC_ENABLED=0` remains the safe B/local default.

Run the sanitized gate from the repository root:

```powershell
node scripts/check-oidc.mjs
```

The command writes a timestamped `manifest.json` containing only commit, file fingerprints, gate exit codes, bounded scrubbed tails, and status fields. It never writes provider URLs, client secrets, bearer values, cookies, prompts, or token payloads.

Current technical evidence:

- Authorization Code + PKCE state/nonce/verifier binding, discovery, ID-token/JWKS validation and rotation: API unit tests.
- Durable `(issuer, subject)` identity, hashed opaque session, one-time transaction and revoke: API integration tests.
- Cookie credentials, CSRF double-submit, origin guard and proxy cookie allowlist: web unit tests plus live compatibility smoke.
- UUID-scoped engine/gateway resolution and owner predicates: API audit and engine controller integration tests.

The release gate must remain `OPEN` until all of these are supplied and rerun in an isolated environment:

- an authorized real OIDC issuer/tenant with exact redirect/client/scope/role configuration;
- a representative two-user live owner matrix, restart/revoke evidence, migration/restore rehearsal and operator sign-off;
- UX direction and Design System approval.

`OPEN` or `NOT_RUN` is an evidence status, not a production-readiness claim.
