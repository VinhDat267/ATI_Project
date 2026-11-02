import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { JiraSourceRef } from '@wap/tool-schemas';
import { createIsolatedTestSchema, createSyntheticUser, connectSyntheticJiraAccount, type IsolatedTestContext } from '../helpers/jira-test-db.js';
import type { NativeUserPermissionsResult } from '../../src/services/jira/jira-native-verifier.js';
import { JiraPolicyService } from '../../src/services/jira/jira-policy-service.js';
import { JiraHistorySanitizer } from '../../src/services/jira/jira-history-sanitizer.js';

describe('JIRA-05 source revalidation against real PostgreSQL', () => {
  let ctx: IsolatedTestContext;
  let source: JiraSourceRef;
  let userId: string;
  let workspaceId: string;
  let siteId: string;
  let verifierResult: NativeUserPermissionsResult;
  let service: JiraPolicyService;

  beforeAll(async () => {
    ctx = await createIsolatedTestSchema({ maxConnections: 5 });
    await ctx.runAllMigrations();
  });
  afterAll(async () => { await ctx.cleanup(); });

  beforeEach(async () => {
    userId = await createSyntheticUser(ctx.pool, 'Policy User', 'jira_policy');
    const accountId = await connectSyntheticJiraAccount(ctx.pool, userId, `atlas-${randomUUID()}`);
    const grant = await ctx.pool.query<{ id: string }>(
      `INSERT INTO jira_oauth_grants (account_id, app_client_id, grant_kind, refresh_state, status)
       VALUES ($1, 'atlassian_3lo', '3lo', 'idle', 'active') RETURNING id`, [accountId]
    );
    const grantId = grant.rows[0]!.id;
    const cloudId = `cloud-${randomUUID()}`;
    await ctx.pool.query(
      `INSERT INTO jira_grant_sites (grant_id, cloud_id, site_name, site_url, product_type, scopes)
       VALUES ($1,$2,'Policy site','https://policy.atlassian.net','jira',$3)`, [grantId, cloudId, ['read:jira-work']]
    );
    workspaceId = randomUUID();
    await ctx.pool.query(`INSERT INTO workspaces (id,name,invite_code,created_by) VALUES ($1,'Policy workspace',$2,$3)`, [workspaceId, `ATI-${randomUUID()}`, userId]);
    await ctx.pool.query(`INSERT INTO workspace_members (workspace_id,user_id,role,status) VALUES ($1,$2,'admin','active')`, [workspaceId, userId]);
    await ctx.pool.query(`INSERT INTO ati_workspaces (id,slug,status,version,created_by) VALUES ($1,$2,'active',1,$3)`, [workspaceId, `policy-${randomUUID()}`, userId]);
    await ctx.pool.query(`INSERT INTO ati_workspace_memberships (workspace_id,user_id,role,status,version) VALUES ($1,$2,'admin','active',1)`, [workspaceId, userId]);
    const site = await ctx.pool.query<{ id: string }>(
      `INSERT INTO ati_workspace_jira_sites (workspace_id,cloud_id,site_name,site_url,active,policy_version,linked_by)
       VALUES ($1,$2,'Policy site','https://policy.atlassian.net',true,1,$3) RETURNING id`, [workspaceId, cloudId, userId]
    );
    siteId = site.rows[0]!.id;
    await ctx.pool.query(
      `INSERT INTO ati_workspace_jira_projects (workspace_id,site_id,cloud_id,numeric_project_id,project_key,project_name,selected,policy_version)
       VALUES ($1,$2,$3,'10001','POL','Policy Project',true,1)`, [workspaceId, siteId, cloudId]
    );
    const account = await ctx.pool.query<{ atlassian_account_id: string }>('SELECT atlassian_account_id FROM jira_accounts WHERE id = $1', [accountId]);
    source = {
      binding: { atiUserId: userId, jiraAccountId: accountId, atlassianAccountId: account.rows[0]!.atlassian_account_id,
        workspaceId, membershipVersion: 1, grantId, identityVersion: 1 },
      workspaceId, workspaceVersion: 1, siteId, cloudId, sitePolicyVersion: 1,
      projectId: '10001', projectPolicyVersion: 1, resourceType: 'issue', providerResourceId: '10001', revision: '1',
    };
    verifierResult = { canBrowse: true, canCreateIssue: true, canAddComment: true, status: 'granted' };
    service = new JiraPolicyService({ pool: ctx.pool, verifier: { verifyUserPermissions: async () => verifierResult } });
  });

  it('allows current source with current native browse authority', async () => {
    expect(await service.revalidateSource(userId, source)).toEqual({ allowed: true });
  });
  it.each([
    ['identity_changed', async () => ctx.pool.query('UPDATE jira_accounts SET identity_version = 2 WHERE id = $1', [source.binding.jiraAccountId])],
    ['workspace_inactive', async () => ctx.pool.query("UPDATE ati_workspaces SET status = 'archived' WHERE id = $1", [workspaceId])],
    ['membership_inactive', async () => ctx.pool.query("UPDATE ati_workspace_memberships SET status = 'removed' WHERE workspace_id = $1 AND user_id = $2", [workspaceId, userId])],
    ['site_disabled', async () => ctx.pool.query('UPDATE ati_workspace_jira_sites SET active = false WHERE id = $1', [siteId])],
    ['project_denied', async () => ctx.pool.query('UPDATE ati_workspace_jira_projects SET selected = false WHERE site_id = $1', [siteId])],
    ['policy_stale', async () => ctx.pool.query('UPDATE ati_workspace_jira_sites SET policy_version = 2 WHERE id = $1', [siteId])],
  ] as const)('%s after database policy mutation', async (reason, mutate) => {
    await mutate();
    expect(await service.revalidateSource(userId, source)).toEqual({ allowed: false, reason });
  });
  it('blocks when native Jira permissions are denied', async () => {
    verifierResult = { canBrowse: false, canCreateIssue: false, canAddComment: false, status: 'denied' };
    expect(await service.revalidateSource(userId, source)).toEqual({ allowed: false, reason: 'native_permission_denied' });
  });
  it('blocks when Jira provider is unavailable', async () => {
    verifierResult = { canBrowse: false, canCreateIssue: false, canAddComment: false, status: 'unavailable' };
    expect(await service.revalidateSource(userId, source)).toEqual({ allowed: false, reason: 'provider_unavailable' });
  });
  it('rejects invalid evidence', async () => {
    expect(await service.revalidateSource(userId, {} as JiraSourceRef)).toEqual({ allowed: false, reason: 'invalid_evidence' });
  });
  it('rejects source whose site binding does not match current site', async () => {
    expect(await service.revalidateSource(userId, { ...source, siteId: randomUUID() })).toEqual({ allowed: false, reason: 'source_mismatch' });
  });
  it('denies a disabled local user even when Jira membership rows remain active', async () => {
    await ctx.pool.query("UPDATE users SET status = 'disabled' WHERE id = $1", [userId]);
    expect(await service.revalidateSource(userId, source)).toEqual({ allowed: false, reason: 'membership_inactive' });
  });
  it('masks entire Jira-dependent message and removes every original metadata field after revocation', async () => {
    const sanitizer = new JiraHistorySanitizer(service);
    await ctx.pool.query('UPDATE ati_workspace_jira_projects SET selected = false WHERE site_id = $1', [siteId]);
    const result = await sanitizer.sanitizeMessage(userId, {
      id: randomUUID(), conv_id: randomUUID(), role: 'assistant', content: 'Secret ticket details',
      metadata: { sourceRefs: [source], ticket: { secret: 'sensitive' }, customSecret: 'must be gone' }, created_at: new Date(),
    });
    expect(result.content).not.toContain('Secret ticket details');
    expect(JSON.stringify(result)).not.toContain('sensitive');
    expect(JSON.stringify(result)).not.toContain('customSecret');
    expect(result.metadata).toEqual({ masked: true, maskReason: 'project_denied' });
  });
  it('masks Jira assistant content when provenance is missing', async () => {
    const sanitizer = new JiraHistorySanitizer(service);
    const result = await sanitizer.sanitizeMessage(userId, {
      id: randomUUID(), conv_id: randomUUID(), role: 'assistant', content: 'Untracked private issue',
      metadata: { ticket: 'secret' }, created_at: new Date(),
    });
    expect(JSON.stringify(result)).not.toContain('Untracked private issue');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result.metadata).toEqual({ masked: true, maskReason: 'invalid_evidence' });
  });
});
