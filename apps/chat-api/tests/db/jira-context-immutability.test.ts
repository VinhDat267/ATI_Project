import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WorkspaceRepo } from '../../src/db/repositories/workspace-repo.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { createIsolatedTestSchema, createSyntheticUser, type IsolatedTestContext } from '../helpers/jira-test-db.js';

describe('Jira conversation binding remains immutable for otherwise valid SQL updates', () => {
  let context: IsolatedTestContext;
  let userId: string;
  let workspaceId: string;
  let conversations: ConversationRepo;

  beforeAll(async () => {
    context = await createIsolatedTestSchema();
    await context.runAllMigrations();
    userId = await createSyntheticUser(context.pool, 'Binding Test', 'binding', { role: 'member', status: 'active' });
    const workspace = await new WorkspaceRepo(context.pool).create(userId, 'Binding Test');
    workspaceId = workspace.id;
    conversations = new ConversationRepo(context.pool);
  });

  afterAll(async () => { await context?.cleanup(); });

  it('rejects a coherent organization-to-legacy downgrade which satisfies all scope CHECK constraints', async () => {
    const conversation = await conversations.createConversation(userId, { workspaceMode: 'organization', workspaceId });
    await expect(context.pool.query(
      "UPDATE conversations SET workspace_id=NULL, workspace_mode='legacy', jira_context=false WHERE id=$1",
      [conversation.id],
    )).rejects.toMatchObject({ code: '23514' });
    const stored = await conversations.getConversation(conversation.id);
    expect(stored).toMatchObject({ workspace_id: workspaceId, workspace_mode: 'organization', jira_context: false });
  });

  it('rejects promoting existing organization history into Jira while retaining a valid organization scope', async () => {
    const conversation = await conversations.createConversation(userId, { workspaceMode: 'organization', workspaceId });
    await expect(context.pool.query(
      'UPDATE conversations SET jira_context=true WHERE id=$1', [conversation.id],
    )).rejects.toMatchObject({ code: '23514' });
    const stored = await conversations.getConversation(conversation.id);
    expect(stored).toMatchObject({ workspace_id: workspaceId, workspace_mode: 'organization', jira_context: false });
  });

  it('rejects assigning legacy history to an organization even with a matching workspace mode', async () => {
    const conversation = await conversations.createConversation(userId);
    await expect(context.pool.query(
      "UPDATE conversations SET workspace_id=$2, workspace_mode='organization', jira_context=false WHERE id=$1",
      [conversation.id, workspaceId],
    )).rejects.toMatchObject({ code: '23514' });
    const stored = await conversations.getConversation(conversation.id);
    expect(stored).toMatchObject({ workspace_id: null, workspace_mode: 'legacy', jira_context: false });
  });
});
