# Keycloak local provider

Keycloak is the selected self-hosted provider for local OIDC acceptance.
This environment uses `start-dev` and HTTP loopback. HTTPS staging, production
database operations, provider session revocation propagation, and user acceptance
remain separate gates.

## Verified local checkpoint

On 2026-09-21, after stopping and restarting Keycloak with its existing volume,
the acceptance harness passed on clean commit `fe9e3fb`. See the
[sanitized manifest](keycloak-local-20260921/manifest.json): two identities,
PKCE authorization code login, API restart session persistence, owner isolation,
application logout/revocation, and cleanup passed.
The browser executes the callback, but initial transaction cookies are injected
and subsequent API checks use Node fetch. Full ATI browser cookie policy,
provider SSO logout, expiry, and HTTPS staging acceptance are not established.

## Full ATI browser checkpoint

On 2026-09-21, this passed from clean commit `e9e9bc1`; see the
[sanitized browser manifest](keycloak-browser-local-20260921/manifest.json).

The separate `check:oidc:browser` harness starts an isolated API database and
the live Vite application, then drives the visible ATI LoginView SSO button,
the Keycloak credentials page, the ATI AppShell session, and UI logout in one
headless Chromium context. Transaction and session cookies are created through
the browser; no transaction cookie is injected. It restores the temporary
Keycloak callback/web-origin registrations and removes the isolated database.

Run it only after the local Keycloak service is ready:

```powershell
npm run check:oidc:browser
npm run check:oidc:https
```

It is loopback HTTP evidence, so its session cookie correctly lacks `Secure`.
The [HTTPS preparation gate](HTTPS-PREP.md) defines the separate staging
contract and remaining browser acceptance work.

## Usage

From the repository root:

```powershell
node scripts/keycloak-local.mjs up
npm run build -w @wap/api
node scripts/oidc-keycloak-e2e.mjs
npm run check:oidc:browser
```

The setup starts Compose project `ati-keycloak-local`, with persistent volume
`ati-keycloak-local_keycloak_data`, and binds only `127.0.0.1:18080`.
Admin console: <http://127.0.0.1:18080/admin/>. Realm: `ati-local`.
Confidential application client: `ati-web`, Authorization Code with PKCE S256;
application password grants and self-registration are disabled.
Test users: `alice` and `bob`.

Generated local credentials are in ignored `.cache/keycloak-local/runtime.json`;
the generated realm import also contains credentials. Treat both as local
secrets, do not share or commit them. Stop without removing data:

```powershell
node scripts/keycloak-local.mjs stop
```

Startup import skips an existing realm, preserving its state. Keep the runtime
file with its volume: deleting only the file regenerates credentials which will
not match an existing realm. Do not delete the volume to troubleshoot login.

The E2E script temporarily registers an exact ephemeral API callback, restores
the original callback list, and uses an isolated application test database.
It drives real Keycloak user login through a browser and checks the ATI session
and ownership boundary. It does not leave an ATI API running or modify the
normal application environment. Sanitized results are written to
`.cache/keycloak-local/evidence.json`; the Keycloak service remains available.

The initial setup is based on the official guides:
[Docker](https://www.keycloak.org/getting-started/getting-started-docker) and
[realm import](https://www.keycloak.org/server/importExport).
