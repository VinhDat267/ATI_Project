# OIDC staging preparation

**Status:** `CONFIGURATION_TEMPLATE_READY` (2026-09-21). The visual Design
System is approved. OIDC remains disabled in the checked-in template because an
authorized issuer, tenant, and secret references have not yet been provided.

The project owner subsequently selected self-hosted Keycloak for local provider
integration. See [Keycloak local setup](KEYCLOAK-LOCAL.md). Its HTTP loopback
development realm does not satisfy the HTTPS staging deployment gate below.

## Tracked assets

- Non-secret environment template:
  [`config/oidc-staging.env.example`](../../../config/oidc-staging.env.example)
- HTTPS ingress and execution gate:
  [HTTPS preparation](HTTPS-PREP.md)
- Current local technical evidence:
  [`local-20260921071503494-6321629d-e85e-4efa-9e37-e057ad822183/manifest.json`](local-20260921071503494-6321629d-e85e-4efa-9e37-e057ad822183/manifest.json)
- Current release gate:
  [`20260921071316-825ab795-6bfe-4388-880f-6d73269143f8/manifest.json`](20260921071316-825ab795-6bfe-4388-880f-6d73269143f8/manifest.json)

## Provider contract required before enablement

Record these values in the staging change record and secret manager, never in
Git, chat, command arguments, logs, or evidence captures:

1. HTTPS issuer and tenant owner; client ID; secret reference and rotation owner.
2. Exact HTTPS callback URI, approved web origin, audience, scopes, and `azp`
   semantics.
3. Verified-email policy, role claim and mapping, membership-revocation owner.
4. Cookie name; session and transaction TTLs; clock skew; idle-timeout policy.
5. Two independent staging accounts, synthetic data allowlist, and operator for
   role-change, revoke, and outage cases.

## Safe enablement sequence

1. Inject the template values into the staging runtime through the secret
   manager. The API launchers do not auto-load `.env` files.
2. Keep `API_NEW_RUNS_ENABLED=0` and `AI_PROVIDER_CALLS_ENABLED=0` for the
   identity preflight. Set `API_LEGACY_PASSWORD_AUTH_ENABLED=0`.
3. Verify the HTTPS reverse proxy, the exact callback route, and that only the
   approved `OIDC_WEB_ORIGIN` reaches the API. The API itself binds loopback.
4. Review the resolved non-secret values and secret references, then set
   `OIDC_ENABLED=1` in the staging runtime.
5. Run `npm run check:full` on the release commit and `npm run check:oidc` to
   record sanitized technical evidence. Then execute the two-user matrix:
   login, owner isolation, role change, expiry, revoke, logout, restart, JWKS
   rotation or provider outage, migration, and restore.
6. Enable new runs only after the identity matrix, operator sign-off, and the
   separate representative-user UX acceptance are recorded.

The release gate remains `OPEN` until this external-provider evidence exists.
