# HTTPS staging preparation

**Status:** `PREPARED_NOT_DEPLOYED` (2026-09-21). No public staging hostname,
certificate, or externally authorized provider configuration has been supplied.
This checkpoint prepares the exact ingress and OIDC contract; it is not HTTPS
acceptance evidence.

The local HTTPS transport/cookie check is recorded separately in
[HTTPS local acceptance](HTTPS-LOCAL.md). It does not replace the public
staging gate below.

## Prepared deployment contract

- [Caddy ingress template](../../../config/Caddyfile.staging.example) terminates
  TLS, serves the built web application, and proxies only `/api/v1/*` to the
  loopback API at `127.0.0.1:3001`.
- The API remains loopback-bound. The proxy strips a client-supplied
  `X-Wap-Frontend-Origin`; the browser's ordinary `Origin` is retained for the
  API's existing CSRF/origin validation.
- Set the same public HTTPS web origin in `OIDC_WEB_ORIGIN` and the provider's
  allowed web origins. Set `OIDC_REDIRECT_URI` to
  `https://<staging-host>/api/v1/auth/oidc/callback` exactly.
- The API already derives `Secure` on transaction, session, and CSRF cookies
  from an `https://` `OIDC_WEB_ORIGIN`. Its configuration rejects non-loopback
  HTTP issuer and callback URLs.

## Required staging inputs

1. A controlled DNS hostname and `ATI_ACME_EMAIL`; keep the ACME account and
   certificate state outside this repository.
2. An approved HTTPS issuer/tenant, client ID, secret-manager reference,
   audience, claims policy, and two synthetic test identities.
3. The built web artifact placed at `/srv/ati-web` (or the equivalent explicit
   absolute path in the deployment unit), with the API reachable only from the
   ingress host.
4. The non-secret values from
   [`config/oidc-staging.env.example`](../../../config/oidc-staging.env.example)
   resolved in the staging secret manager. Keep writes and provider calls
   disabled for identity preflight.

## Execution gate — still required

1. Validate the rendered Caddy configuration on the staging host, deploy it,
   and confirm HTTP redirects to the exact HTTPS origin.
2. Register the exact callback and web origin at the authorized provider; do
   not use wildcard callbacks or wildcard web origins.
3. From a clean browser profile, execute SSO, reload, API-authenticated read,
   logout, and post-logout reload. Record that `wap_session`, `wap_oidc_tx`,
   and `wap_csrf` have `Secure`; confirm `HttpOnly` on the session and
   transaction cookies.
4. Run the two-user staging matrix in
   [OIDC staging preparation](STAGING-PREP.md), including revoke, expiry,
   provider outage/JWKS rotation, migration, and restore. Only then consider
   enabling new runs.

The local Keycloak browser check is useful transport evidence, but it uses
loopback HTTP by design. HTTPS browser acceptance, provider SSO logout, DNS,
certificate issuance, and public ingress verification are `NOT_RUN` until the
above external inputs exist.
