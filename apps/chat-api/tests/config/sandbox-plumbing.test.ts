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
  expect(await adapter.execute('trello.search_cards', {})).toEqual([
    { id: 'card_1', name: 'Thẻ hiện có', idBoard: 'b1', idList: 'list_1' },
  ]);
});

it('returns default sandbox Slack channels across scenarios and filters by query in default sandbox mode', async () => {
  const { createSandboxAdapter } = await import('../../src/sandbox/index.js');
  const defaultSlack = createSandboxAdapter('slack');

  const allChannels = (await defaultSlack.execute('slack.search_channels', {})) as Array<{ id: string; name: string }>;
  expect(allChannels.length).toBeGreaterThanOrEqual(2);
  expect(allChannels).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'C_GENERAL', name: 'general' }),
      expect.objectContaining({ id: 'C_ATI_TEST', name: 'ati-test' }),
    ]),
  );

  const generalMatches = (await defaultSlack.execute('slack.search_channels', {
    query: 'general',
    limit: 5,
  })) as Array<{ id: string; name: string }>;
  expect(generalMatches).toEqual([expect.objectContaining({ id: 'C_GENERAL', name: 'general' })]);

  const hashGeneralMatches = (await defaultSlack.execute('slack.search_channels', {
    query: '#general',
    limit: 5,
  })) as Array<{ id: string; name: string }>;
  expect(hashGeneralMatches).toEqual([expect.objectContaining({ id: 'C_GENERAL', name: 'general' })]);

  const scheduleSlack = createSandboxAdapter('slack', 'schedule');
  const scheduleChannels = (await scheduleSlack.execute('slack.search_channels', {})) as Array<{ id: string; name: string }>;
  expect(scheduleChannels).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'C_GENERAL', name: 'general' }),
      expect.objectContaining({ id: 'C_ATI_TEST', name: 'ati-test' }),
    ]),
  );
});
