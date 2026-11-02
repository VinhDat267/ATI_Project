# JIRA-01 · OAuth feasibility probe

This is a local diagnostic runner, not the ATI Jira integration. It never creates issues or comments, stores credentials only in memory, and must not be exposed on a LAN or public tunnel. Production OAuth will use an HTTPS backend callback after this gate.

## 1. Create ATI's development OAuth app

1. Open the [Atlassian developer console](https://developer.atlassian.com/console/myapps/).
2. Create → OAuth 2.0 integration; name it `ATI Jira Development`. Choose account-level grant if that choice is offered; record if the console offers a different model instead of assuming a grant type.
3. Authorization → OAuth 2.0 (3LO): configure the exact callback `http://127.0.0.1:4187/oauth/callback` for this local probe. If the console rejects this callback, record its policy and stop; do not silently substitute the production callback.
4. Permissions: add User Identity API (`read:me`) and Jira platform API (`read:jira-work`, `write:jira-work`). `offline_access` is requested in the authorization URL; it is not a Jira permission to add in the API list.
5. Settings: copy Client ID and Secret into the ignored root `.env.jira-probe`. Never send the Secret in chat, commit it, put it in a command argument or paste provider callback URLs into an issue.
6. For an account other than the app creator, use Distribution → Enable sharing after reviewing the console's terms/settings. Sharing and granting access to a Jira site are separate. No Marketplace listing or approval is claimed by this probe.

[Official OAuth guide](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/).

## 2. Local configuration

The example `jira-probe.env.example` contains blank values. The root `.env.jira-probe` must remain ignored (`git check-ignore .env.jira-probe`). Fill it directly in your editor:

```dotenv
JIRA_PROBE_CLIENT_ID=
JIRA_PROBE_CLIENT_SECRET=
JIRA_PROBE_REDIRECT_URI=http://127.0.0.1:4187/oauth/callback
```

Use Node 22.12+ or 24+. From the repository root:

```powershell
node --env-file=.env.jira-probe packages/tool-adapters/scripts/jira-probe/cli.mjs --check-config
node --env-file=.env.jira-probe packages/tool-adapters/scripts/jira-probe/cli.mjs --live
```

The first command validates configuration only; it makes no provider request. The second listens at `http://127.0.0.1:4187/`. Open that URL in **one** browser; its first session owns the probe. If port 4187 is occupied, stop the old process or change both the callback in Atlassian and local configuration deliberately. Do not expose this server to a public reverse proxy.

Keep the process running during consent. Ctrl+C ends the probe and discards tokens. Reloading the editor/browser does not persist a connection into ATI. To use a different browser, stop and start the process again.

## 3. Provider cases

Record only observations, the run's date and operator-attested account conditions in private local evidence (for example ignored `.artifacts/jira-probe/`). Observations apply to the current consent/connection and reset when a new consent starts or the session disconnects; save the safe report for each case before proceeding. The displayed report deliberately omits account IDs, site IDs/names, tokens, code and state. Site counts are counts of distinct cloudId values; conflicting duplicate metadata fails closed. Do not attach raw network traces or filled environment files to the public repository.

1. **Identity before site access:** use an Atlassian account whose owner confirms it is not a member of any Jira site. Click `1. Kết nối danh tính`. The requested scope is `read:me offline_access`. Record whether consent completes without selecting a Jira site and whether the report observes identity. A zero site count here proves nothing about memberships: the identity flow does not request site access. Account conditions remain OPERATOR_ATTESTED.
2. **Existing site:** with the same identity, obtain appropriate native Jira access, then click `2. Cấp quyền Jira / thêm site`. Approve only the intended site. The probe requests Jira read/write scopes but performs only profile, resource and permission reads. Record site count and permission observations.
3. **Second site:** repeat step 2 for a second site using the same Atlassian identity; observe the resulting resource set. Record the actual consent/grant behavior; do not assume a prior site's access survives. Multi-site is not verified unless two sites are simultaneously observed.
4. **Rotation:** click `Làm mới token và kiểm rotation` twice. Each refresh must return a different refresh token and the next exchange must use the replacement. The report records this comparison as a boolean, never the values.
5. **Permissions:** the Jira flow reads `ADMINISTER` in global context for each returned site. An account without that permission should still be identifiable; `adminSiteCount` may be zero. This is not a check of Create Issues/Add Comments permissions and does not prove a Jira write succeeded.
6. **Wrong account / denial:** if another account is selected during additional consent, the old connection becomes unusable. Explicit local disconnect is required before deliberately switching accounts. Cancelled consent consumes the flow. Restart/connect when needed; do not reuse callback URLs.

If identity-only cannot complete for a genuinely unaffiliated account, record the provider result and return to the owner for an onboarding decision. Do not implement workspace/runtime consumers by treating a fixture or a documentation example as native proof.

`Ngắt phiên local` invalidates the in-memory session only. To revoke the app at Atlassian, use your Atlassian account's connected-app controls; the probe does not invent a revoke API.

## 4. Test the probe itself

```powershell
npm run test:probe -w @wap/tool-adapters
npm test -w @wap/tool-adapters
```

Tests use a stateful HTTP server on loopback with real JSON requests, single-use authorization codes, rotated refresh tokens and delayed-response barriers. Timeout tests inspect actual HTTP cancellation. They prove the runner, not Atlassian behavior, PostgreSQL production concurrency or completed JIRA-01 acceptance. Fixture reports are labelled `local_fixture` / `nativeGate: NOT_RUN`; live reports require review and operator attestation, never automatic PASS.
