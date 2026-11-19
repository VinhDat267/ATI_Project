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
    for (let i = 0; i < 55; i++) await convRepo.createConversation('owner', `Conversation ${i}`);
    const foreign = await convRepo.createConversation('other', 'Other owner');
    const first = await convRepo.listConversationPage('owner');
    const second = await convRepo.listConversationPage('owner', { cursor: first.nextCursor! });
    expect(first.conversations).toHaveLength(50); expect(second.conversations).toHaveLength(5);
    const ids = [...first.conversations, ...second.conversations].map(row => row.id);
    expect(new Set(ids).size).toBe(55); expect(ids).not.toContain(foreign.id); expect(second.nextCursor).toBeNull();
    await convRepo.renameConversation(ids[0]!, 'owner', '100%_ frontend');
    expect((await convRepo.listConversationPage('owner', { search: '%_' })).conversations).toHaveLength(1);
  });
  it('lists an untitled conversation once it has a message', async () => {
    const { convRepo, msgRepo } = createMemoryConversationRepositories();
    const draft = await convRepo.createConversation('owner');
    expect(await convRepo.listConversationPage('owner')).toEqual({ conversations: [], nextCursor: null });
    await msgRepo.createMessage(draft.id, 'assistant', 'Saved without a title');
    expect((await convRepo.listConversationPage('owner')).conversations.map(row => row.id)).toEqual([draft.id]);
  });
  it('removes a personal conversation and its messages only for the owner', async () => {
    const { convRepo, msgRepo } = createMemoryConversationRepositories();
    const personal = { workspaceMode: 'personal' as const };
    const target = await convRepo.createConversation('owner', 'Saved chat', personal);
    await msgRepo.createMessage(target.id, 'user', 'Saved message');
    expect(await convRepo.deleteConversation(target.id, 'other', personal)).toBe(false);
    expect(await convRepo.deleteConversation(target.id, 'owner', { workspaceMode: 'organization', workspaceId: 'other' })).toBe(false);
    expect(await msgRepo.listMessages(target.id)).toHaveLength(1);
    expect(await convRepo.deleteConversation(target.id, 'owner', personal)).toBe(true);
    expect(await convRepo.deleteConversation(target.id, 'owner', personal)).toBe(false);
    expect(await convRepo.getConversation(target.id)).toBeNull();
    expect(await msgRepo.listMessages(target.id)).toEqual([]);
  });
});
