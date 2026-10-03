import { describe, expect, it } from 'vitest';
import { createMemoryConversationRepositories } from '../../src/db/repositories/memory-conversations.js';

describe('FE-02 memory conversation history', () => {
  it('sets first-user title, preserves rename, and prevents foreign rename', async () => {
    const { convRepo, msgRepo } = createMemoryConversationRepositories();
    const conversation = await convRepo.createConversation('owner');
    await msgRepo.createMessage(conversation.id, 'assistant', 'Welcome');
    expect((await convRepo.getConversation(conversation.id))?.title).toBeNull();
    await msgRepo.createMessage(conversation.id, 'user', '😀'.repeat(61));
    expect((await convRepo.getConversation(conversation.id))?.title).toBe('😀'.repeat(60));
    expect(await convRepo.renameConversation(conversation.id, 'other', 'Forbidden')).toBeNull();
    await convRepo.renameConversation(conversation.id, 'owner', 'Tên mới');
    await msgRepo.createMessage(conversation.id, 'user', 'Later');
    expect((await convRepo.getConversation(conversation.id))?.title).toBe('Tên mới');
  });
  it('paginates more than 50 rows, applies literal title search and isolates owners', async () => {
    const { convRepo } = createMemoryConversationRepositories();
    for (let i = 0; i < 55; i++) await convRepo.createConversation('owner');
    const foreign = await convRepo.createConversation('other');
    const first = await convRepo.listConversationPage('owner');
    const second = await convRepo.listConversationPage('owner', { cursor: first.nextCursor! });
    expect(first.conversations).toHaveLength(50); expect(second.conversations).toHaveLength(5);
    const ids = [...first.conversations, ...second.conversations].map(row => row.id);
    expect(new Set(ids).size).toBe(55); expect(ids).not.toContain(foreign.id); expect(second.nextCursor).toBeNull();
    await convRepo.renameConversation(ids[0]!, 'owner', '100%_ frontend');
    expect((await convRepo.listConversationPage('owner', { search: '%_' })).conversations).toHaveLength(1);
  });
});
