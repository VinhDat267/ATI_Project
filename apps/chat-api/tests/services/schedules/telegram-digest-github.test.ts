import { describe, expect, it } from 'vitest';
import { GitHubAdapter } from '@wap/tool-adapters';
import { evaluateTelegramDigestCandidate } from '../../../src/services/schedules/telegram-digest-candidate.js';

const input = {
  proposal: {
    kind: 'schedule' as const, action: 'create' as const, name: 'GitHub report',
    request: 'Tổng hợp issue GitHub đang mở gửi Telegram của tôi',
    recurrence: { type: 'daily' as const, time: '08:00' }, summary: 'GitHub report',
  },
  services: ['github', 'telegram'], timeZone: 'Asia/Ho_Chi_Minh',
  telegramLookup: {
    status: 'connected' as const,
    connection: { credentialId: 'tg-credential', telegramUserId: '777', username: 'tester', chatIds: ['777'] },
    selectedChats: [{ chatId: '777', title: 'Telegram của tôi', type: 'private' as const }],
  },
};

describe('Telegram GitHub digest source contracts', () => {
  it('executes open-issue searches through the real GitHub adapter for each approved repository', async () => {
    const candidate = evaluateTelegramDigestCandidate({
      ...input,
      githubLookup: {
        status: 'connected',
        connection: { credentialId: 'gh-credential', githubUserId: '123', login: 'tester', repos: ['acme/ati', 'acme/ops'] },
      },
    });
    expect(candidate.canAutoDigest).toBe(true);
    const requests: string[] = [];
    const adapter = new GitHubAdapter({
      credentials: { token: 'fixture' }, allowedScope: { repos: ['acme/ati', 'acme/ops'] },
      fetchFn: async (url) => {
        const requested = new URL(String(url));
        requests.push(requested.searchParams.get('q')!);
        const repo = requested.searchParams.get('q')!.includes('repo:acme/ati') ? 'acme/ati' : 'acme/ops';
        return Response.json({ items: [{
          id: 42, number: 42, title: 'Open task', html_url: `https://github.com/${repo}/issues/42`,
          repository_url: `https://api.github.com/repos/${repo}`,
        }] });
      },
    });
    const outputs = [];
    for (const source of candidate.config!.sources) {
      outputs.push(await adapter.execute(source.tool, source.args ?? {}, { signal: AbortSignal.timeout(2000) }));
    }
    expect(requests).toEqual(['repo:acme/ati is:issue is:open', 'repo:acme/ops is:issue is:open']);
    expect(outputs).toEqual([
      [{ id: '42', number: 42, title: 'Open task', url: 'https://github.com/acme/ati/issues/42', repo: 'acme/ati' }],
      [{ id: '42', number: 42, title: 'Open task', url: 'https://github.com/acme/ops/issues/42', repo: 'acme/ops' }],
    ]);
  });

  it.each([undefined, { status: 'not_connected' as const }, {
    status: 'connected' as const,
    connection: { credentialId: 'gh', githubUserId: '123', login: 'tester', repos: [] },
  }])('does not offer automatic GitHub delivery without a current approved repository scope (%j)', (githubLookup) => {
    expect(evaluateTelegramDigestCandidate({ ...input, githubLookup }).canAutoDigest).toBe(false);
  });
});
