import { describe, expect, it, vi } from 'vitest';
import {
  evaluateJiraDigestCandidate,
  computeJiraDigestConfigHash,
  type JiraDigestConfig,
} from '../../../src/services/schedules/jira-digest-candidate.js';
import {
  analyzeJiraDigestIssues,
  formatJiraDigestReport,
  runJiraDigest,
} from '../../../src/services/schedules/jira-digest-runner.js';

describe('Jira Read-Only Standup Digest (Phase 3)', () => {
  const recurrence = { type: 'daily' as const, time: '08:30' };

  it('approves read-only myjira -> slack digest candidate when connected and channel matched', async () => {
    const candidate = await evaluateJiraDigestCandidate({
      userId: 'user-1',
      workspaceId: 'ws-1',
      request: 'Mỗi sáng 8h30 tổng hợp tiến độ và blocker Jira dự án ATI gửi vào kênh #standup',
      services: ['myjira', 'slack'],
      recurrence,
      jiraConnection: async () => ({
        status: 'connected',
        workspaceId: 'ws-1',
        grantId: 'grant-1',
        atlassianAccountId: 'acc-1',
        projects: [{ siteId: 'site-1', siteName: 'Acme Jira', projectKey: 'ATI', projectName: 'ATI Platform' }],
      }),
      getAdapter: async () => ({
        execute: vi.fn(async () => [{ id: 'C12345', name: 'standup' }]),
      }),
    });

    expect(candidate.canAutoDigest).toBe(true);
    expect(candidate.config?.workspaceId).toBe('ws-1');
    expect(candidate.config?.projects).toEqual([
      { siteId: 'site-1', siteName: 'Acme Jira', projectKey: 'ATI', projectName: 'ATI Platform' },
    ]);
    expect(candidate.config?.channelId).toBe('C12345');
    expect(candidate.configHash).toBeTruthy();
  });

  it('rejects write-intent requests from becoming auto-digest schedules', async () => {
    const candidate = await evaluateJiraDigestCandidate({
      userId: 'user-1',
      workspaceId: 'ws-1',
      request: 'Mỗi sáng 8h30 tạo issue mới trên Jira dự án ATI và báo kênh #standup',
      services: ['myjira', 'slack'],
      recurrence,
      jiraConnection: async () => ({
        status: 'connected',
        workspaceId: 'ws-1',
        grantId: 'grant-1',
        atlassianAccountId: 'acc-1',
        projects: [{ siteId: 'site-1', siteName: 'Acme Jira', projectKey: 'ATI' }],
      }),
    });

    expect(candidate.canAutoDigest).toBe(false);
    expect(candidate.disabledReason).toContain('chỉ đọc');
  });

  it('categorizes Blocker/High Priority, In Progress, and Done issues and executes read-only digest delivery', async () => {
    const config: JiraDigestConfig = {
      workspaceId: 'ws-1',
      grantId: 'grant-1',
      atlassianAccountId: 'acc-1',
      projects: [{ siteId: 'site-1', siteName: 'Acme Jira', projectKey: 'ATI', projectName: 'ATI Platform' }],
      channelId: 'C12345',
      channelName: 'standup',
    };
    const configHash = computeJiraDigestConfigHash({
      config,
      recurrence,
      userId: 'user-1',
    });

    const slackExecute = vi.fn(async () => ({ ok: true }));
    const jiraExecute = vi.fn(async () => [
      {
        key: 'ATI-10',
        summary: 'Done setup task',
        status: 'Done',
        priority: 'Low',
        url: 'https://acme.atlassian.net/browse/ATI-10',
      },
      {
        key: 'ATI-11',
        summary: 'Payment gateway timeout P1',
        status: 'Blocked',
        priority: 'Highest',
        assignee: 'Minh Nguyen',
        url: 'https://acme.atlassian.net/browse/ATI-11',
      },
      {
        key: 'ATI-12',
        summary: 'Implement transition tool',
        status: 'In Progress',
        priority: 'Medium',
        assignee: 'Lan Tran',
        url: 'https://acme.atlassian.net/browse/ATI-12',
      },
    ]);

    const outcome = await runJiraDigest({
      userId: 'user-1',
      recurrence,
      digestConfig: config,
      digestConfigHash: configHash,
      revalidatePolicy: async () => ({ allowed: true }),
      getAdapter: async (service) => ({
        execute: service === 'myjira' ? jiraExecute : slackExecute,
      }),
    });

    expect(outcome.state).toBe('digest_sent');
    if (outcome.state === 'digest_sent') {
      expect(outcome.text).toContain('🚨 1 ưu tiên cao/chặn');
      expect(outcome.text).toContain('🔄 1 đang làm');
      expect(outcome.text).toContain('✅ 1 hoàn thành');
      // Blocker ATI-11 should be sorted before Done ATI-10
      expect(outcome.text.indexOf('ATI-11')).toBeLessThan(outcome.text.indexOf('ATI-10'));
    }
    expect(jiraExecute).toHaveBeenCalledWith(
      'myjira.search_issues',
      { siteId: 'site-1', projectKey: 'ATI', maxResults: 20 },
      { signal: undefined },
    );
    expect(slackExecute).toHaveBeenCalledWith(
      'slack.send_message',
      expect.objectContaining({ channel: 'C12345' }),
      { signal: undefined },
    );
  });

  it('blocks digest execution when live Jira policy revalidation fails', async () => {
    const config: JiraDigestConfig = {
      workspaceId: 'ws-1',
      grantId: 'grant-1',
      atlassianAccountId: 'acc-1',
      projects: [{ siteId: 'site-1', siteName: 'Acme Jira', projectKey: 'ATI' }],
      channelId: 'C12345',
      channelName: 'standup',
    };
    const configHash = computeJiraDigestConfigHash({
      config,
      recurrence,
      userId: 'user-1',
    });

    const outcome = await runJiraDigest({
      userId: 'user-1',
      recurrence,
      digestConfig: config,
      digestConfigHash: configHash,
      revalidatePolicy: async () => ({ allowed: false, reason: 'Grant revoked by user' }),
      getAdapter: vi.fn(),
    });

    expect(outcome).toEqual({
      state: 'blocked',
      error: 'Grant revoked by user',
    });
  });
});
