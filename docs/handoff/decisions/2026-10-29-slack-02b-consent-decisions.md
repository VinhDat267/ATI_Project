# SLACK-02B: leader implementation decisions

Date:2026-10-29. Scope:remaining consent backend only. Owner:Backend. This record resolves the open choices in PR191 and supersedes conflicting draft examples in the02B plan. Product scope remains the approved Slack personal design. No live enable or merge approval is granted here.

## Accepted predecessor code

- PR184 ac448dd:existing OAuth/setup candidate, reused through02R.
- PR190 eeb70d0a:callback ordering fix; independent fullcheck2588v3+406eval+launcher1+Node66 exit0, two-state2/2 and actual child-process crash proof passed. Later documentation-only correction can be included without replacing source.
- PR187 68710874:canonical contracts; independent67targeted/183package tests,5review cases,typecheck and exact-headCI passed.
- PR185 811f5dc9:354-method documentation snapshot; reviewed and exact-headCI passed.
- PR188 27313dba:delivery roadmap, adequate for defining narrowly owned child cards; does not approve every future implementation.

The integration branch composes those dependencies. It is a feature staging branch; main is unchanged. Its draft02B plan must be updated to the decisions below before production code. Only explicit02B files belong in the implementation PR.

## Trusted provisioning boundary

Use an operator CLI for provider attestation and organization consent grant/revoke in this slice. Do not add HTTP endpoints that create trust. Browser members and model/request bodies cannot provision a provider or organization authorization. The CLI requires deployment/database access; document this operator privilege rather than pretending a user-supplied --by value authenticates a web role.

Keep HTTP APIs limited to existing connection setup and caller-scoped metadata. Tests must prove attempted HTTP consent/provider mutations cannot change policy. Future administrative UI requires its own reviewed authority model.

The operator records the authorized organization representative and evidence reference, distinct from the operator who recorded it. Record timestamps and revisions on the server. Do not infer organization authority from ATI membership/admin label or Slack OAuth alone. These records attest operator verification; fixture records do not prove real legal/provider authorization.

## Persistence and revisions

Proposed migration0016 is available after Slack0015. Concurrent unrelated PR189 also uses prefix0015 with a different filename; preserve that PR and do not rename its migration. Before committing, recheck current migration filenames. No duplicate tables or edits to earlier migrations.

Persist:
- Organization consents keyed by workspace+provider profile, with policyVersion, monotonic revision, authorized purposes, retentionDays>=0, organizationRepresentative/evidenceRef, recordedBy, grantedAt/revokedAt and audit timestamps.
- Trusted provider profiles with operator evidenceRef, verifiedBy/verifiedAt, noTraining, maximum retention, configuration fingerprint and monotonic revision. No trusted defaults or automatic true seeds. Never store API keys in these profile records.
- Durable policy-change events containing identifiers/revisions/reason only, committed atomically with revocation or policy/provider changes.03 will consume these for tombstone/purge; an in-memory listener alone is insufficient.02 does not claim to implement source purge.

Grant/update/revoke commands use expected revision/CAS. Validate nonblank strings, finite nonnegative safe retention integers, allowed purposes and required evidence. Test concurrent updates against actual PostgreSQL. Repeat the actual migration with real pending OAuth states and existing connections/consents.

retentionDays controls DATA retention, not the expiration date of consent.0 permits processing without retained copies; it must not immediately revoke consent. A workflow needing longer storage must be denied by its requested-retention gate. Do not implement a timer that revokes consent after retentionDays.

## Runtime provider and policy selection

Select the active processing profile through server configuration, not the first granted consent in a workspace. Match the actual runtime provider configuration. Existing providers are created by createProviderFromEnv in packages/planner/src/providers/factory.ts; use the resolved provider name/model and normalized endpoint/account/configuration identity in the server-owned fingerprint. Do not change planner code in02B or call a model. A changed provider/model/endpoint/account policy must invalidate the old attestation until reverified. Keep this separate from the Antigravity builder model.

No selected profile, missing evidence, unverified/noTraining=false, missing provider match, changed configuration/policy/revision, revoked consent, wrong purpose or excess requested retention must fail closed. No public field or cached DTO authorizes use.

The backend policy service resolves/rechecks persisted policy on each authorization decision. Validate current owner, connection, workspace, Slack actor, identityVersion and active ATI account; reject wrong/stale bindings. Return credential-free policy references containing consent/provider revisions and policyVersion for future03 consumers. Consumption must reject references invalidated by revoke/regrant even if a human reuses the same policyVersion label. Do not add shared schema contracts from the Backend role; reuse02A/foundation and document any interface request for Integration.

Authorized purposes cover manual_lookup, triage, planning, digest and storage as explicitly granted. Each future content path must authorize its actual purpose and requested retention. Metadata processingReady describes readiness for the configured policy/purpose bundle; it is not a replacement for per-use checks.

## Canonical and legacy metadata

Reuse slack_connections, slack_oauth_states, current locks and token manager. Do not rewrite OAuth or refresh. Keep the current per-state ordering fix and disclose broad disconnect invalidation as an existing limitation for later workspace-operation design.

Public connections provide02A canonical fields and preserve explicit safe legacy aliases needed by the existing UI/tests until02C. Map actor_id to slackUserId and use the actor ID as a safe label fallback; do not call users.info before content authorization. The same JSON status key cannot hold both disconnected and revoked. Existing list excludes disconnected rows, so visible statuses remain compatible; where a revoked row is returned, use canonical revoked and a separately named legacyStatus only if necessary.

Keep actual /api/connections/myslack paths and /api/services personalOAuth capability. Do not invent a legacy /api/connections/slack route or add an extra health fetch. Callback can include explicitly whitelisted legacy fields during transition while retaining canonical flat fields. Never spread credential rows into responses.

## Execution and evidence

Implementation owner may modify apps/chat-api, the new forward SQL, operator docs,02Bcard/plan and one new log. No frontend, schema, planner, executor or adapter edits. No root dependency changes or unrelated files. The UI follow-up is02C.

Write meaningful failing tests before code: trust mutation attempts, CLI validation, actualPGCAS, provider/config selection, missing/changed policy, stale revision after revoke/regrant, purpose/retention0 boundaries, full-binding isolation, durable event commit/rollback and safe compatibility metadata. Spawn the actual CLI in tests; do not test a fake boolean permission gate.

Run targeted tests, typecheck, existing Slack foundation and fullcheck. Use the disposable reviewer-owned PostgreSQL project on55533 with shipped migrations applied; never production or other containers. Keep raw output in ignored execution artifacts and derive counts from it. Distinguish first-run environment failures from code findings. No live Slack calls, app installation, source content/model calls, flag enable, main merge or shutdown.

Leader authorizes this bounded implementation. Code and exact-head CI still require independent review before integration into main.
