import { describe, expect, it } from 'vitest';
import { createMemoryConversationRepositories } from '../../src/db/repositories/memory-conversations.js';

describe('memory sandbox preserves the conversation creation scope contract', () => {
  it('retains an explicit personal scope when the optional title is omitted', async () => {
    const { convRepo } = createMemoryConversationRepositories();
    const conversation = await convRepo.createConversation('sandbox-owner', undefined, { workspaceMode: 'personal' });
    expect(conversation).toMatchObject({ user_id: 'sandbox-owner', title: null, workspace_mode: 'personal', workspace_id: null });
    expect(await convRepo.getConversationForUser('sandbox-owner', conversation.id, { workspaceMode: 'personal' }))
      .toMatchObject({ workspace_mode: 'personal', workspace_id: null });
  });
});
