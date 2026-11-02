# JIRA-06 implementation plan — 2026-11-02

Authority: Jira personal/workspace design §6, §11–12, JIRA-02 `MYJIRA_TOOLS`, JIRA-04 `JiraTokenManager.getAccessToken`, JIRA-05 `WorkspaceJiraCapabilitiesResponse`. Work only under `packages/tool-adapters/` plus this task's documentation. Never enable `MYJIRA_ENABLED`.

## Files and interfaces

- `src/jira/personal-jira-adapter.ts`: `PersonalJiraAdapter extends BaseAdapter`, config with `userId`, `workspaceId`, scoped capabilities snapshot, token provider matching JIRA-04, optional loopback API base/fetch/rate limiter. `execute(tool,args,{signal?})` returns exact JIRA-02 output schemas.
- `src/jira/personal-jira-http.ts`: bounded Bearer HTTP transport, deadline, retry rules, error sanitization, rate handling.
- `src/index.ts`: export new adapter and provider type only.
- `tests/personal-jira-adapter.test.ts`: real loopback HTTP fixture, never live provider; legacy `jira-adapter.test.ts` remains unchanged.

## Steps

1. Write loopback fixture and failing tests for capability directory reads. Verify RED. Implement explicit site and project resolution, list_sites/search_projects; verify GREEN.
2. Write failing tests for search_issues JQL, validation, direct issue key and cross-project result rejection. Verify RED. Implement read path, verify GREEN.
3. Write failing tests for create_issue metadata and plain ADF, add_comment current project/issue key after move. Verify RED. Implement write path, verify GREEN.
4. Write failing tests for token/transport boundaries: Bearer only, cloudId path, abort/deadline, 401 refresh, 429 bound, write network/5xx/malformed response UNKNOWN and no write replay. Verify RED. Implement transport, verify GREEN.
5. Run package suite, typecheck, full check with isolated environment if available. Inspect diff, commit scoped files, fill task result and new handoff log, open PR for independent review. No merge.

## Review focus

- `siteId` is opaque and never interpolated into URL; only trusted cloudId from snapshot forms gateway path.
- A capability snapshot is an adapter input, not an authorization proof for JIRA-08.
- No unsafe retry after a write may have reached Atlassian.
- Moved issue must be blocked when its current project is outside snapshot; do not infer project from issue key alone.
- No user token in errors, URLs, logs, or cache keys.
