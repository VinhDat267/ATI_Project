import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkspaceRepo as OrganizationRepo } from '../../src/db/repositories/workspace-repo.js';
import JiraWorkspaceRepo from '../../src/db/repositories/workspace/index.js';
import { createIsolatedTestSchema, createSyntheticUser, type IsolatedTestContext } from '../helpers/jira-test-db.js';

describe('Existing Jira policy conflicts do not precede current enablement authority', () => {
  let context: IsolatedTestContext;
  let jira: JiraWorkspaceRepo;
  let owner: string;
  let outsider: string;
  let enabledId: string;
  let ordinaryId: string;

  beforeAll(async () => {
    context = await createIsolatedTestSchema();
    await context.runAllMigrations();
    owner = await createSyntheticUser(context.pool, 'Owner', 'enable-owner', { role: 'admin', status: 'active' });
    outsider = await createSyntheticUser(context.pool, 'Outsider', 'enable-outsider', { role: 'admin', status: 'active' });
    const organizations = new OrganizationRepo(context.pool);
    enabledId = (await organizations.create(owner, 'Enabled Organization')).id;
    ordinaryId = (await organizations.create(owner, 'Ordinary Organization')).id;
    jira = new JiraWorkspaceRepo(context.pool);
    await jira.enableExistingWorkspace(owner, enabledId, { slug: `enabled-${enabledId}`, bootstrapAdminUserId: owner });
  });
  afterAll(async () => { await context?.cleanup(); });

  it('returns the same private 404 for an outsider whether the organization is enabled, unconfigured or nonexistent', async () => {
    for (const workspaceId of [enabledId, ordinaryId, randomUUID()]) {
      await expect(jira.enableExistingWorkspace(outsider, workspaceId, { slug: 'outsider-attempt', bootstrapAdminUserId: owner }))
        .rejects.toMatchObject({ statusCode: 404, code: 'WORKSPACE_NOT_FOUND' });
    }
  });

  it('rechecks a disabled system administrator before reporting an existing Jira policy conflict', async () => {
    await context.pool.query("UPDATE users SET status='disabled' WHERE id=$1", [owner]);
    try {
      await expect(jira.enableExistingWorkspace(owner, enabledId, { slug: 'disabled-attempt', bootstrapAdminUserId: owner }))
        .rejects.toMatchObject({ statusCode: 403, code: 'ADMIN_REQUIRED' });
    } finally {
      await context.pool.query("UPDATE users SET status='active' WHERE id=$1", [owner]);
    }
  });
});
