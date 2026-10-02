import { expect, it } from 'vitest';

it('runs extracted sandbox handlers with the same write results and partial failure', async () => {
  const module = await import('../../src/sandbox/index.js').catch(() => null);
  expect(module, 'sandbox factory must be separated from server bootstrap').not.toBeNull();
  const adapter = module!.createSandboxAdapter('trello', 'clarification');
  expect(await adapter.execute('trello.search_members', {})).toEqual([
    { id: 'member_minh_nguyen', name: 'Minh Nguyễn' }, { id: 'member_minh_tran', name: 'Minh Trần' },
  ]);
  expect(await adapter.execute('trello.create_card', { title: 'Fixture', listId: 'L1', desc: 'text' })).toMatchObject({
    name: 'Fixture', listId: 'L1', desc: 'text', url: 'https://trello.com/c/sandbox/card',
  });
  await expect(module!.createSandboxAdapter('slack', 'partial_failure').execute('slack.send_message', { channel: 'C1', text: 'x' })).rejects.toMatchObject({ category: 'VALIDATION' });
  expect(await module!.createSandboxAdapter('github').execute('github.create_issue', { repo: 'owner/repo', title: 'x' })).toMatchObject({ number: 42, repo: 'owner/repo', title: 'x' });
  expect(await adapter.execute('trello.search_cards', {})).toEqual([]);
});
