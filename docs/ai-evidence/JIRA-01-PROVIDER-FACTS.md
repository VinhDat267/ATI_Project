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
| Authorization code / refresh | 3LO confidential app; identity/Jira flows request `offline_access`; rotating refresh tokens | DOCUMENTED in [OAuth guide](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/); FIXTURE_VERIFIED; identity and Jira grant exchanges each followed by two consecutive rotations LIVE_OBSERVED 01/11 |
| Identity `/me` | User Identity API `read:me`; use provider account ID, not email | DOCUMENTED in OAuth guide; FIXTURE_VERIFIED; native `/me` LIVE_OBSERVED 01/11; actual account's no-site condition OPERATOR_ATTESTED before test-site creation |
| Accessible resources | Use returned cloudId/site scopes; account-level vs resource-level behavior depends on app/grant | DOCUMENTED in OAuth guide; container filtering FIXTURE_VERIFIED; one distinct Jira site LIVE_OBSERVED 01/11; simultaneous two-site set NOT_RUN |
| `GET /rest/api/3/mypermissions` | `read:jira-work`; global ADMINISTER differs from issue/project permissions | DOCUMENTED in [Permissions API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-permissions/); FIXTURE_VERIFIED; native read succeeded with one admin site LIVE_OBSERVED 01/11; non-admin case NOT_RUN |
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
| Existing site | LIVE_OBSERVED, 01/11 | Successful Jira callback, profile, one distinct resource and native permission read; profile remains matched across refreshes in this process, not compared across the earlier restart |
| Second simultaneous site | NOT_RUN | Repeat consent with same identity; two Jira sites observed together, not just two separate historical counts |
| Refresh twice | LIVE_OBSERVED for both identity and Jira grants, 01/11 | Each grant had two separate consecutive successful browser refresh submissions; replacement-token and account-match guards succeeded; no token values retained |
| Global permission read | LIVE_OBSERVED for one admin site, 01/11 | permissionsRead true, adminSiteCount 1; non-admin case remains NOT_RUN |
| Re-consent / wrong account / denial | Consent denial LIVE_OBSERVED 01/11 in a fresh local session; wrong-account and Jira re-consent outcomes NOT_RUN | Cancel returned CONSENT_DENIED and local connected false; this does not claim an existing provider grant was revoked |

Owner created/configured the development app after setup guidance. The local configuration check passes; console grant type remains unrecorded. On 01/11 the initial identity consent returned exactly `offline_access read:me`, and the owner explicitly confirmed that the actual account used had no Jira memberships at that point. This establishes the identity-before-site case through LIVE_OBSERVED and OPERATOR_ATTESTED; it is not inferred from the empty site count. Later the owner showed an accessible Jira site and accepted Jira consent. One-site authorization, global permission read and two Jira refreshes have now succeeded. A second distinct site is the next setup/acceptance step.

On 31/10 browser navigation reached the Atlassian login page ([browser-start log](../handoff/log/2026-10-31-codex-jira-01-browser-origin.md)). On 01/11 the identity consent and two refreshes were saved separately ([native identity log](../handoff/log/2026-11-01-codex-jira-01-native-identity.md)). The subsequent Jira report and its two refresh reports are also retained in ignored local evidence: connected true, scopes `offline_access read:jira-work read:me write:jira-work`, siteCount 1, adminSiteCount 1, identity/jiraAuthorization/permissionsRead true. See the [one-site log](../handoff/log/2026-11-01-codex-jira-01-native-one-site.md). No native Jira write has been performed.

**Gate verdict: NOT_COMPLETE.** Local probe verification may finish independently; JIRA-02–11 do not start until the provider gate is resolved as required by the approved design.

The real consent UI is served at `https://api.atlassian.com/oauth2/authorize/server/consent`, with a site installation target and an account-wide grant warning. Its wording is observed UI evidence, not proof of the console's grant-model setting. After the CSP fix and a separate successful consent-denial check, the owner accepted the real Jira grant and the probe observed the successful callback. See the [consent-host log](../handoff/log/2026-11-01-codex-jira-01-consent-host.md).

## Local tooling evidence

Client tests use native fetch against a loopback HTTP fixture, redirect prevention, response limits and actual response cancellation. Session tests consume codes once, rotate tokens, preserve owner/identity/generation boundaries and reject late refresh after disconnect. Browser-route tests use real cookies, Origin checks and redirects; process tests validate CLI exit codes and redacted output.

Detailed counts, mutations, code review and commit hashes are recorded in the [session log](../handoff/log/2026-10-31-codex-jira-01-feasibility.md). The report never labels a fixture as live, never infers native memberships from an empty resource response, and leaves live reports for human review rather than automatic PASS.
