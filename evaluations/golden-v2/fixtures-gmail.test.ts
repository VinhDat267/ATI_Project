import { describe, expect, it } from 'vitest';
import { GMAIL_TOOLS } from '@wap/tool-schemas';
import { validateSchemaValue } from '@wap/planner';
import { GMAIL_THREADS as SANDBOX_THREADS, GMAIL_FAKE } from '../../apps/chat-api/src/sandbox/fake-results/gmail.js';
import { GMAIL_THREADS, fixtureSearch, knownResourceValues } from './fixtures.js';

const output = (tool: string) => GMAIL_TOOLS.find(t => t.name === tool)!.outputSchema;
const ids = (rows: Array<{ id: string }>) => rows.map(row => row.id);

describe('Gmail fixture mailbox', () => {
  it('holds the same synthetic mail as the GMAIL-02 sandbox adapter, including both injection threads', async () => {
    expect(GMAIL_THREADS).toEqual(SANDBOX_THREADS);
    expect(GMAIL_THREADS.filter(t => /attacker@example\.com/.test(`${t.subject} ${t.messages[0]!.body}`))).toHaveLength(2);
    expect(await fixtureSearch({ tool: 'gmail.list_labels', args: { query: '' } })).toEqual(GMAIL_FAKE.tools['gmail.list_labels']!({ query: '' }));
    expect(await fixtureSearch({ tool: 'gmail.get_thread', args: { threadId: 'gmail-thread-2' } }))
      .toEqual(GMAIL_FAKE.tools['gmail.get_thread']!({ threadId: 'gmail-thread-2' }));
  });
  it.each([
    ['gmail.search_threads', { query: 'Họp nhóm ATI' }],
    ['gmail.get_thread', { threadId: 'gmail-thread-1' }],
    ['gmail.list_labels', { query: '' }],
  ] as const)('%s returns nonempty data conforming to the actual output schema', async (tool, args) => {
    const result = await fixtureSearch({ tool, args });
    expect(validateSchemaValue(result, output(tool), 'output')).toBeNull();
    expect(Array.isArray(result) ? result.length : result.messages.length).toBeGreaterThan(0);
  });
  it('searches like Gmail: every term must match, with the common operators and quoted phrases', async () => {
    const search = async (query: string, limit?: number) => ids(await fixtureSearch({ tool: 'gmail.search_threads', args: { query, ...limit ? { limit } : {} } }));
    expect(await search('Họp nhóm ATI')).toEqual(['gmail-thread-1']);
    expect(await search('subject:"Báo cáo tuần"')).toEqual(['gmail-thread-2']);
    expect(await search('"bảo vệ" from:lan@example.com newer_than:7d')).toEqual(['gmail-thread-3']);
    expect(await search('has:attachment')).toEqual(['gmail-thread-2']);
    expect(await search('is:unread in:inbox')).toHaveLength(8);
    expect(await search('is:unread', 3)).toHaveLength(3);
    expect(await search('is:starred')).toEqual([]);
    expect(await search('from:minh@example.com')).toEqual([]);
    expect(await search('Họp nhóm ngân sách')).toEqual([]);
    const [summary] = await fixtureSearch({ tool: 'gmail.search_threads', args: { query: 'OAuth' } });
    expect(summary).not.toHaveProperty('messages');
    expect(summary.participants).toEqual(['lan@example.com', 'gmail-owner@example.test', 'minh@example.com']);
  });
  it('validates arguments at the schema boundary and rejects unknown threads like the adapter', async () => {
    await expect(fixtureSearch({ tool: 'gmail.search_threads', args: {} })).rejects.toThrow();
    await expect(fixtureSearch({ tool: 'gmail.search_threads', args: { query: 'a', limit: 11 } })).rejects.toThrow();
    await expect(fixtureSearch({ tool: 'gmail.get_thread', args: { threadId: 'gmail-thread-99' } })).rejects.toThrow(/gmail-thread-99/);
    await expect(fixtureSearch({ tool: 'gmail.send_message', args: { to: ['a@b.c'], subject: 's', body: 'b' } })).rejects.toThrow(/does not support/);
  });
  it('lists labels by name and exposes threads and labels as known resources', async () => {
    expect(ids(await fixtureSearch({ tool: 'gmail.list_labels', args: { query: 'star' } }))).toEqual(['STARRED']);
    expect([...knownResourceValues('thread')]).toEqual(GMAIL_THREADS.map(t => t.id));
    expect([...knownResourceValues('label')]).toEqual(['INBOX', 'UNREAD', 'STARRED']);
  });
});
