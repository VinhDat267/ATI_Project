import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceRepo as OrganizationRepo } from '../../src/db/repositories/workspace-repo.js';
import JiraWorkspaceRepo from '../../src/db/repositories/workspace/index.js';
import { createIsolatedTestSchema, createSyntheticUser, type IsolatedTestContext } from '../helpers/jira-test-db.js';

describe('Shared organization authority precedes Jira role and summary visibility', () => {
  let context: IsolatedTestContext;
  let jira: JiraWorkspaceRepo;
  let ownerId: string;
  let memberId: string;
  let workspaceId: string;

  beforeAll(async () => {
    context = await createIsolatedTestSchema();
    await context.runAllMigrations();
    jira = new JiraWorkspaceRepo(context.pool);
  });
  afterAll(async () => { await context?.cleanup(); });

  beforeEach(async () => {
    ownerId = await createSyntheticUser(context.pool, 'Owner', 'authority-owner', { role: 'admin', status: 'active' });
    memberId = await createSyntheticUser(context.pool, 'Member', 'authority-member', { role: 'member', status: 'active' });
    workspaceId = (await new OrganizationRepo(context.pool).create(ownerId, 'Authority Test')).id;
    await context.pool.query('INSERT INTO ati_workspaces (id,slug,created_by) VALUES ($1,$2,$3)', [workspaceId, `authority-${workspaceId}`, ownerId]);
    await context.pool.query("INSERT INTO workspace_members (workspace_id,user_id,role,status) VALUES ($1,$2,'member','active')", [workspaceId, memberId]);
    await context.pool.query("INSERT INTO ati_workspace_memberships (workspace_id,user_id,role,status) VALUES ($1,$2,'admin','active'),($1,$3,'member','active')", [workspaceId, ownerId, memberId]);
  });

  it('returns private 404 before revealing an ordinary Jira role after organization revocation', async () => {
    await context.pool.query("UPDATE workspace_members SET status='disabled' WHERE workspace_id=$1 AND user_id=$2", [workspaceId, memberId]);
    await expect(jira.createInvite(workspaceId, memberId)).rejects.toMatchObject({ statusCode: 404, code: 'WORKSPACE_NOT_FOUND' });
  });

  it('returns private 404 before revealing an ordinary Jira role when the user is disabled', async () => {
    await context.pool.query("UPDATE users SET status='disabled' WHERE id=$1", [memberId]);
    await expect(jira.createInvite(workspaceId, memberId)).rejects.toMatchObject({ statusCode: 404, code: 'WORKSPACE_NOT_FOUND' });
  });

  it('hides Jira summaries when the general organization membership has been revoked', async () => {
    expect(await jira.listWorkspacesForUser(memberId)).toHaveLength(1);
    await context.pool.query("UPDATE workspace_members SET status='disabled' WHERE workspace_id=$1 AND user_id=$2", [workspaceId, memberId]);
    expect(await jira.listWorkspacesForUser(memberId)).toEqual([]);
  });

  it('hides Jira summaries when the user has been disabled', async () => {
    await context.pool.query("UPDATE users SET status='disabled' WHERE id=$1", [memberId]);
    expect(await jira.listWorkspacesForUser(memberId)).toEqual([]);
  });

  it('does not count a Jira admin without organization access as a replacement for the last effective admin', async () => {
    await context.pool.query("UPDATE ati_workspace_memberships SET role='admin' WHERE workspace_id=$1 AND user_id=$2", [workspaceId, memberId]);
    await context.pool.query("UPDATE workspace_members SET status='disabled' WHERE workspace_id=$1 AND user_id=$2", [workspaceId, memberId]);
    await expect(jira.decideMember(workspaceId, ownerId, ownerId, { decision: 'remove', expectedVersion: 1 }))
      .rejects.toMatchObject({ statusCode: 409, code: 'LAST_ACTIVE_ADMIN' });
    const stored = await context.pool.query('SELECT status,version FROM ati_workspace_memberships WHERE workspace_id=$1 AND user_id=$2', [workspaceId, ownerId]);
    expect(stored.rows[0]).toMatchObject({ status: 'active', version: 1 });
  });
});
