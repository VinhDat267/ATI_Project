# JIRA-01 · Provider facts and current gate

**Updated:** 01/11/2026 (Asia/Saigon). **Scope:** OAuth feasibility diagnostic tooling; not production Jira OAuth.
**Spec:** [Jira personal/workspaces](../superpowers/specs/2026-10-30-jira-personal-workspaces-design.md). **Task:** [JIRA-01](../handoff/tasks/JIRA-01-oauth-feasibility.md).

## Evidence vocabulary

- DOCUMENTED: official provider documentation was read; not a successful live request.
- FIXTURE_VERIFIED: real HTTP/process test against a local stateful provider; proves ATI tooling behavior only.
- LIVE_OBSERVED: the actual Atlassian endpoint/consent flow was exercised and an outcome retained in private evidence.
- OPERATOR_ATTESTED: the account owner confirms a condition that cannot be inferred from the probe (especially no Jira site memberships).
- NOT_RUN: no native evidence; never replace with a documentation or fixture PASS.

## Source and scope matrix

| Boundary | Proposed scopes / provider condition | Evidence now |
|---|---|---|
| Authorization code / refresh | 3LO confidential app; identity/Jira flows request `offline_access`; rotating refresh tokens | DOCUMENTED in [OAuth guide](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/); FIXTURE_VERIFIED; identity grant exchange and two consecutive rotations LIVE_OBSERVED 01/11; Jira-scope grant NOT_RUN |
| Identity `/me` | User Identity API `read:me`; use provider account ID, not email | DOCUMENTED in OAuth guide; FIXTURE_VERIFIED; native `/me` LIVE_OBSERVED 01/11; actual account's no-site condition OPERATOR_ATTESTED before test-site creation |
| Accessible resources | Use returned cloudId/site scopes; account-level vs resource-level behavior depends on app/grant | DOCUMENTED in OAuth guide; container filtering FIXTURE_VERIFIED; native two-site set NOT_RUN |
| `GET /rest/api/3/mypermissions` | `read:jira-work`; global ADMINISTER differs from issue/project permissions | DOCUMENTED in [Permissions API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-permissions/); FIXTURE_VERIFIED for global read; native NOT_RUN |
| Project lookup/directory | `read:jira-work`; actual visibility/project allowlist still checked | DOCUMENTED in [Projects API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-projects/); new OAuth runtime not implemented; native NOT_RUN |
| Issue search/JQL | `read:jira-work`; restricted query/grounding remains required | DOCUMENTED in [Issue search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/); new OAuth runtime not implemented; native NOT_RUN |
| Issue type create metadata / issue reads | `read:jira-work`; exact metadata response and project restrictions checked during later adapter integration | DOCUMENTED in [Issues API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/); native NOT_RUN |
| Create issue | `write:jira-work`, native Create Issues and Browse Projects; still requires approved plan | DOCUMENTED in Issues API; deliberately no live write in this diagnostic; NOT_RUN |
| Add comment | `write:jira-work`, native Browse Projects/Add Comments and issue security | DOCUMENTED in [Comments API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-comments/); deliberately no live write; NOT_RUN |

This matrix is not a claim that scope alone grants a native permission. No admin, webhook or Jira user-profile scope is requested by this probe. The production adapter must independently keep the approved project/issue checks.

## Native acceptance gate

| Case | Current result | Needed evidence |
|---|---|---|
| Development app / actual grant type | App used LIVE_OBSERVED; console grant type NOT_RECORDED | Owner records account/resource-level console grant model; no client secret in evidence |
| Identity-only before any Jira membership | LIVE_OBSERVED + OPERATOR_ATTESTED, 01/11 | Owner explicitly confirmed the actual consent account had no Jira memberships; condition applies before subsequent test-site creation, not forever |
| Existing site | NOT_RUN | Successful consent, resource result and identity match |
| Second simultaneous site | NOT_RUN | Repeat consent with same identity; two Jira sites observed together, not just two separate historical counts |
| Refresh twice | LIVE_OBSERVED for identity grant, 01/11 | Two separate consecutive browser refresh submissions each returned TOKEN_ROTATION_OBSERVED and connected true; Jira-scope refresh still NOT_RUN |
| Global permission read | NOT_RUN | Actual response from site; both admin and non-admin cases if available |
| Re-consent / wrong account / denial | Consent denial LIVE_OBSERVED 01/11 in a fresh local session; wrong-account and Jira re-consent outcomes NOT_RUN | Cancel returned CONSENT_DENIED and local connected false; this does not claim an existing provider grant was revoked |

Owner created/configured the development app after setup guidance. The local configuration check passes; console grant type remains unrecorded. On 01/11 the owner reported connection complete; the live browser report confirmed identity and the exact granted scopes `offline_access read:me`. The owner then explicitly confirmed that the actual account used had not joined any Jira site. This establishes the identity-before-site case through two distinct evidence classes, LIVE_OBSERVED and OPERATOR_ATTESTED; it is not inferred from the empty site count. The owner currently has no test Jira sites; provisioning the first test site is the next external setup step.

On 31/10 the authorization endpoint and browser navigation reached the official Atlassian login page ([browser-start log](../handoff/log/2026-10-31-codex-jira-01-browser-origin.md)). On 01/11 the probe observed the actual callback, identity and two successful refreshes. The initial report was saved before refresh; both sequential refresh results were saved separately in ignored local evidence. No Jira resource/permission read or write has been observed. See the [native identity log](../handoff/log/2026-11-01-codex-jira-01-native-identity.md).

**Gate verdict: NOT_COMPLETE.** Local probe verification may finish independently; JIRA-02–11 do not start until the provider gate is resolved as required by the approved design.

On 01/11 the owner showed an accessible Jira site. The real consent screen was observed at `https://api.atlassian.com/oauth2/authorize/server/consent`, with a site installation target, Jira view/update scopes and an account-wide grant warning. This is a consent preview, not a successful Jira grant or proof of the console's grant-model setting. The runner's CSP was extended to this exact official host; the fresh browser flow now reaches consent. A separate identity consent was cancelled successfully before starting the real Jira consent. See the [consent-host log](../handoff/log/2026-11-01-codex-jira-01-consent-host.md).

## Local tooling evidence

Client tests use native fetch against a loopback HTTP fixture, redirect prevention, response limits and actual response cancellation. Session tests consume codes once, rotate tokens, preserve owner/identity/generation boundaries and reject late refresh after disconnect. Browser-route tests use real cookies, Origin checks and redirects; process tests validate CLI exit codes and redacted output.

Detailed counts, mutations, code review and commit hashes are recorded in the [session log](../handoff/log/2026-10-31-codex-jira-01-feasibility.md). The report never labels a fixture as live, never infers native memberships from an empty resource response, and leaves live reports for human review rather than automatic PASS.
