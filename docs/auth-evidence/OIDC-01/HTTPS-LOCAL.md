# HTTPS local OIDC acceptance

**Status:** `LOCAL_BROWSER_PASS` (2026-09-21). This is loopback-only transport
evidence. It does not provide a trusted public certificate, DNS, or staging
provider acceptance.

## What the check runs

`npm run check:oidc:https` starts an isolated API database and live Vite app,
then places an ephemeral HTTPS reverse proxy at `https://localhost:<random>`.
The browser drives ATI LoginView → Keycloak → HTTPS callback → ATI AppShell.
The local Keycloak issuer remains HTTP loopback as its development realm is
explicitly permitted only for local use.

The script uses JDK `keytool` to generate a one-day, self-signed PKCS#12
certificate under the Windows temporary directory. Chromium ignores its trust
warning only for this local test; the proxy, certificate file, browser, API,
web process, isolated database, and temporary Keycloak client configuration
are removed or restored during cleanup.

## Verified local behavior

- A callback without a transaction cookie returns HTTP 400.
- `wap_oidc_tx` and `wap_csrf` are issued with `Secure`; `wap_session` is
  `Secure`, `HttpOnly`, and `SameSite=Lax`; `wap_csrf` is `Secure` and readable
  by the browser for the double-submit CSRF header.
- A short durable session is re-sent after its browser `Max-Age` has elapsed;
  the API rejects it with HTTP 401 and ATI returns to LoginView. This exercises
  the durable server-side expiry guard as well as browser cookie expiry.
- Re-login succeeds after expiry. In the recorded local run, Keycloak reused
  its provider SSO session and did not require credentials again.
- ATI logout revokes the application session and clears its cookie. Provider
  SSO logout remains a separate `NOT_VERIFIED` behavior.

Run the check after Keycloak local is ready:

```powershell
node scripts/keycloak-local.mjs up
npm run check:oidc:https
```

Use [HTTPS staging preparation](HTTPS-PREP.md) for a real hostname, trusted
certificate, authorized provider tenant, and staging browser matrix.
