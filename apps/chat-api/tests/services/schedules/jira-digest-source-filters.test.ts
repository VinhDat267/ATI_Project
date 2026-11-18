import { describe, expect, it } from 'vitest';
import { buildMultiDigestSources } from '../../../src/services/schedules/multi-source-digest-candidate.js';

// Live audit 18/11/2026: "bản tin issue Jira ATIT quá hạn" was dispatched with query '' and
// listed Done issues while the two overdue issues were cut into "... và 2 mục khác".
const WS = '1f58335d-25e7-4b3c-a205-d2d79f34e9b5';
const jiraLookup = {
  status: 'connected' as const,
  workspaceId: WS,
  grantId: 'a606ba68-e5fd-4b23-9dff-3f97049a1666',
  atlassianAccountId: '712020:c62d4174',
  projects: [{ siteId: 'b9a9b269-2a9d-479d-b371-9bb70910e8ee', projectKey: 'ATIT', projectName: 'ATI Test' }],
};
const jiraArgs = (requestText: string) => {
  const result = buildMultiDigestSources({
    sourceServices: ['myjira'], destinationLabel: 'Slack', requestText,
    jiraLookup: jiraLookup as any, workspaceMode: 'organization', workspaceId: WS,
  });
  if (!result.ok) throw new Error(result.disabledReason);
  return result.sources[0]!.args;
};

describe('multi-source digest keeps the Jira filters the user asked for', () => {
  it.each([
    'Tổng hợp issue Jira ATIT quá hạn gửi vào kênh Slack ati-test',
    'issue Jira ATIT tre han gui Slack',
    'overdue Jira issues in ATIT to Slack',
  ])('maps overdue wording to overdueOnly: %s', (text) => {
    expect(jiraArgs(text)).toMatchObject({ projectKey: 'ATIT', overdueOnly: true });
  });

  it('maps unassigned wording to unassignedOnly', () => {
    expect(jiraArgs('issue Jira ATIT chưa có người phụ trách')).toMatchObject({ unassignedOnly: true });
    expect(jiraArgs('issue Jira ATIT chưa được giao')).toMatchObject({ unassignedOnly: true });
  });

  it('maps due-soon wording to dueWithinDays, capped at the schema maximum', () => {
    expect(jiraArgs('issue Jira ATIT sắp đến hạn trong 5 ngày')).toMatchObject({ dueWithinDays: 5 });
    expect(jiraArgs('issue Jira ATIT sắp hết hạn')).toMatchObject({ dueWithinDays: 3 });
    expect(jiraArgs('issue Jira ATIT sắp đến hạn trong 90 ngày')).toMatchObject({ dueWithinDays: 30 });
  });

  it('keeps the unfiltered source when no filter is requested', () => {
    expect(jiraArgs('Tổng hợp issue Jira ATIT gửi Slack')).toEqual({
      siteId: 'b9a9b269-2a9d-479d-b371-9bb70910e8ee', projectKey: 'ATIT', query: '',
    });
  });
});
