import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ALL_TOOLS,
  GITHUB_OAUTH_TOOLS,
  MYJIRA_SERVICE,
  MYJIRA_TOOLS,
  SERVICE_REGISTRY,
} from '@wap/tool-schemas';
import { AIPlanner } from '../src/planner.js';
import { WorkingMemory } from '../src/working-memory.js';
import { ReportArtifactStore } from '../src/reports/artifacts.js';
import {
  renderGithubIssueListReport,
  renderJiraProgressReport,
  requestedReportPrefix,
} from '../src/reports/renderers.js';

// Live audit 18/11/2026: the grounded report replaced the planner's message, so the requested
// prefix "[AUDIT 18/11 A1]" was lost, an overdue list was titled "Báo cáo tiến độ Jira Sprint",
// and a plain "liệt kê issue đang mở" became "Báo cáo GitHub Issue tồn đọng quá 7 ngày".
const CATALOG = [...ALL_TOOLS, ...GITHUB_OAUTH_TOOLS];
const MYJIRA_CATALOG = [...ALL_TOOLS.filter((t) => t.service !== 'jira'), ...MYJIRA_TOOLS, ...GITHUB_OAUTH_TOOLS];
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

function plannerFor(
  readTool: string,
  readArgs: Record<string, unknown>,
  result: unknown,
  post: { tool: string; args: Record<string, unknown> },
  useMyJira = false,
) {
  const store = new ReportArtifactStore();
  const planner = new AIPlanner({
    toolCatalog: useMyJira ? MYJIRA_CATALOG : CATALOG,
    ...(useMyJira ? { serviceRegistry: [...SERVICE_REGISTRY, MYJIRA_SERVICE] } : {}),
    searchMode: 'llm',
    prefetchDirectory: false,
    reportEvidenceStore: store,
    now: () => new Date('2026-11-18T00:00:00Z'),
    gatherSearch: async ({ tool }) => (tool === readTool ? result : []),
    provider: {
      name: 'mock',
      model: 'mock',
      generatePlan: async () => JSON.stringify({
        kind: 'plan', thinking: 'Đọc rồi gửi', summary: 'Gửi danh sách', warnings: [],
        steps: [
          { id: 's_read', tool: readTool, description: 'Đọc', args: readArgs, dependsOn: [] },
          { id: 's_post', tool: post.tool, description: 'Gửi', args: post.args, dependsOn: ['s_read'] },
        ],
      }),
    },
  });
  return { planner, store };
}

describe('grounded reports keep what the user asked for', () => {
  it('keeps the requested prefix and does not call a Jira issue list a Sprint report', async () => {
    const { planner, store } = plannerFor(
      'jira.search_issues', { projectKey: 'ATIT' },
      { issues: [
        { id: '1', key: 'ATIT-1', title: 'Task 1', status: 'To Do', url: 'https://jira.example/browse/ATIT-1' },
        { id: '2', key: 'ATIT-2', title: 'Task 2', status: 'In Progress', url: 'https://jira.example/browse/ATIT-2' },
      ] },
      { tool: 'slack.send_message', args: { channel: 'C_ATI', text: 'Placeholder' } },
    );
    const memory = new WorkingMemory();
    memory.setEntity('workflow_resource_defaults', { slack: { channelId: 'C_ATI', channelName: 'ati-test' } });
    memory.setEntity('jira_project', { key: 'ATIT', name: 'ATI Test' });

    const response = await planner.processMessage({
      userMessage: 'Liệt kê các issue Jira trong dự án ATIT rồi gửi danh sách vào kênh Slack ati-test, mở đầu bằng [AUDIT 18/11 A1].',
      memory,
      actor: { userId: 'u1', workspaceId: 'w1' },
    });

    expect(response.kind).toBe('plan');
    if (response.kind !== 'plan') return;
    const text = String(response.steps.find((s) => s.id === 's_post')!.args.text);
    expect(text.startsWith('[AUDIT 18/11 A1]\n')).toBe(true);
    expect(text).not.toContain('Sprint');
    expect(text).toContain('[ATIT-1] Task 1');
    // The prefix is part of the grounded, hash-bound content.
    expect(response.reportEvidence?.contentHash).toBe(sha256(text));
    expect(store.getArtifact(response.reportEvidence!.artifactId)?.renderedText).toBe(text);
  });

  it('lists open GitHub issues without an aging filter when the user did not ask about aging', async () => {
    const { planner } = plannerFor(
      'github.list_issues', { repo: 'VinhDat267/ati-test', state: 'open' },
      [
        { id: '6', number: 6, title: 'lỗi đăng nhập google', url: 'https://github.com/VinhDat267/ati-test/issues/6', repo: 'VinhDat267/ati-test', createdAt: '2026-11-15T00:00:00Z' },
        { id: '1', number: 1, title: 'Kiểm thử chạy thật ATI', url: 'https://github.com/VinhDat267/ati-test/issues/1', repo: 'VinhDat267/ati-test', createdAt: '2026-09-30T00:00:00Z' },
      ],
      { tool: 'telegram.send_message', args: { chatId: '-100123', text: 'Placeholder' } },
    );
    const memory = new WorkingMemory();
    memory.setEntity('workflow_resource_defaults', { github: { repo: 'VinhDat267/ati-test' } });
    memory.setEntity('chat', { id: '-100123', title: 'ATI Test' });

    const response = await planner.processMessage({
      userMessage: 'Liệt kê các issue đang mở trên repo GitHub VinhDat267/ati-test rồi gửi danh sách vào Telegram ATI Test, mở đầu bằng "[AUDIT 18/11 B3]".',
      memory,
      actor: { userId: 'u1', workspaceId: 'w1' },
    });

    expect(response.kind).toBe('plan');
    if (response.kind !== 'plan') return;
    const text = String(response.steps.find((s) => s.id === 's_post')!.args.text);
    expect(text.startsWith('[AUDIT 18/11 B3]\n')).toBe(true);
    expect(text).not.toContain('tồn đọng');
    expect(text).toContain('#6: lỗi đăng nhập google');
    expect(text).toContain('#1: Kiểm thử chạy thật ATI');
    expect(response.reportEvidence?.itemCount).toBe(2);
  });

  it('titles a filtered Jira read by its real filter, and keeps Sprint only for a named sprint', () => {
    const issues = [{ key: 'ATIT-1', title: 'Task 1', status: 'To Do' }];
    expect(renderJiraProgressReport(issues, { projectKey: 'ATIT', filters: { overdueOnly: true } }).text)
      .toMatch(/^Báo cáo issue Jira quá hạn \(ATIT\): Tổng số 1 ticket\./);
    expect(renderJiraProgressReport([], { projectKey: 'ATIT', filters: { unassignedOnly: true } }).text)
      .toBe('Báo cáo issue Jira chưa có người phụ trách (ATIT): Hiện không có ticket nào.');
    expect(renderJiraProgressReport(issues, { projectKey: 'FE', sprintName: 'Sprint 24' }).text)
      .toContain('Báo cáo tiến độ Jira Sprint (Sprint 24 - FE)');
  });

  it.each(['COMPLETE', 'PARTIAL'])('filters Jira before the limit and binds the %s source result to Slack', async (completeness) => {
    const openIssue = { id: '1', key: 'ATIT-1', title: 'Open task', status: 'In Progress' };
    const closedIssue = { id: '2', key: 'ATIT-2', title: 'Finished task', status: 'Done' };
    const request = { siteId: 'site-ati', projectKey: 'ATIT', limit: 3 };
    const issueLookup = { ...request, query: closedIssue.key, limit: 1 };
    const calls: Record<string, unknown>[] = [];
    let outputCount = 0;
    const planner = new AIPlanner({
      toolCatalog: MYJIRA_CATALOG,
      serviceRegistry: [...SERVICE_REGISTRY, MYJIRA_SERVICE],
      searchMode: 'llm',
      prefetchDirectory: false,
      reportEvidenceStore: new ReportArtifactStore(),
      gatherSearch: async ({ args }) => {
        calls.push(args);
        if (args.query === closedIssue.key) return { issues: [closedIssue] };
        return { issues: args.openOnly ? [openIssue] : [closedIssue, openIssue], coverage: { completeness } };
      },
      provider: {
        name: 'mock', model: 'mock',
        generatePlan: async ({ conversationHistory }) => {
          if (outputCount++ === 0) {
            return JSON.stringify({ kind: 'search', calls: [issueLookup, request].map((args) => ({ tool: 'myjira.search_issues', args })) });
          }
          expect(conversationHistory.at(-1)?.content).toContain('ATIT-1');
          return JSON.stringify({ kind: 'plan', thinking: 'Đọc rồi gửi', summary: 'Gửi danh sách', warnings: [], steps: [
            { id: 's_post', tool: 'slack.send_message', description: 'Gửi', args: { channel: 'C_ATI', text: 'Placeholder' }, dependsOn: [] },
          ] });
        },
      },
    });
    const memory = new WorkingMemory();
    memory.setEntity('workflow_resource_defaults', { slack: { channelId: 'C_ATI', channelName: 'ati-test' } });
    memory.setEntity('jira_site', [{ id: 'site-ati', siteId: 'site-ati', cloudId: 'cloud-ati', workspaceId: 'w1', name: 'ATI Jira' }]);
    memory.setEntity('jira_project', [{ id: '1001', key: 'ATIT', siteId: 'site-ati', cloudId: 'cloud-ati', workspaceId: 'w1', name: 'ATI Test' }]);

    const response = await planner.processMessage({
      userMessage: 'Tra cứu tối đa 3 công việc đang mở trong dự án Jira ATIT. Soạn bản tóm tắt demo gồm mã và trạng thái của các công việc để gửi vào kênh Slack #ati-test sau khi tôi duyệt.',
      memory,
      actor: { userId: 'u1', workspaceId: 'w1' },
    });

    expect(response.kind).toBe('plan');
    if (response.kind !== 'plan') return;
    const text = String(response.steps[0]?.args.text);
    expect(calls).toEqual([issueLookup, { ...request, openOnly: true }]);
    expect(text).toContain('Báo cáo issue Jira đang mở (ATIT)');
    expect(text).toContain('ATIT-1');
    expect(text).not.toContain('ATIT-2');
    expect(response.reportEvidence?.itemCount).toBe(1);
    expect(response.reportEvidence?.coverage).toBe(completeness.toLowerCase());
    if (completeness === 'PARTIAL') {
      expect(text).toContain('Đã đọc 1 ticket');
      expect(text).not.toContain('Tổng số');
    }
    expect(response.reportEvidence?.contentHash).toBe(sha256(text));
  });

  it('does not imply zero matches when the Jira read was incomplete and returned no issues', () => {
    const report = renderJiraProgressReport([], { sourcePartial: true, filters: { openOnly: true } });
    expect(report.text).toContain('Chưa thấy ticket nào trong phần dữ liệu đã đọc.');
    expect(report.coverage).toBe('partial');
  });

  it.each([
    ['gửi vào Slack, mở đầu bằng [AUDIT 18/11 A1].', '[AUDIT 18/11 A1]'],
    ['gửi Slack và bắt đầu bằng "Bản tin sáng v1.2"', 'Bản tin sáng v1.2'],
    ['send it to Slack starting with [Daily] please.', '[Daily]'],
    ['mở đầu tin nhắn bằng [AUDIT]', '[AUDIT]'],
    ['start the message with "[Daily]"', '[Daily]'],
    ['mở đầu bằng "[AUDIT  18/11]"', '[AUDIT  18/11]'],
    ['gửi danh sách vào Slack', undefined],
    // Only quoted or bracketed text is a literal prefix; ordinary instructions are not.
    ['Bắt đầu bằng việc tìm issue quá hạn, rồi gửi Slack', undefined],
    ['Tôi muốn bắt đầu từ dự án ATIT rồi gửi Slack', undefined],
    ['Liệt kê các issue có tiêu đề bắt đầu bằng "[FE]" trong dự án ATIT rồi gửi Slack', undefined],
    ['Find issues starting with "[BUG]" and send to Slack', undefined],
  ])('extracts the requested prefix from %s', (text, expected) => {
    expect(requestedReportPrefix([text])).toBe(expected);
  });

  it('preserves grounding and quoted prefix when the prompt uses Gửi without liệt kê/báo cáo', async () => {
    const { planner, store } = plannerFor(
      'myjira.search_issues', { siteId: 'site-ati', projectKey: 'ATIT', overdueOnly: true },
      { issues: [{ id: '1', key: 'ATIT-1', title: 'Overdue Task', status: 'In Progress', url: 'https://jira.example/browse/ATIT-1', siteId: 'site-ati' }] },
      { tool: 'slack.send_message', args: { channel: 'C_ATI', text: 'Placeholder' } },
      true,
    );
    const memory = new WorkingMemory();
    memory.setEntity('workflow_resource_defaults', { slack: { channelId: 'C_ATI', channelName: 'ati-test' } });
    memory.setEntity('jira_site', { id: 'site-ati', siteId: 'site-ati', cloudId: 'cloud-ati', workspaceId: 'w1', name: 'ATI Jira' });
    memory.setEntity('jira_project', { id: '1001', key: 'ATIT', siteId: 'site-ati', cloudId: 'cloud-ati', workspaceId: 'w1', name: 'ATI Test' });

    const response = await planner.processMessage({
      userMessage: 'Gửi các issue quá hạn trong dự án Jira ATIT vào kênh Slack ati-test, mở đầu bằng "Bản tin sáng".',
      memory,
      actor: { userId: 'u1', workspaceId: 'w1' },
    });

    expect(response.kind).toBe('plan');
    if (response.kind !== 'plan') return;
    const text = String(response.steps.find((s) => s.id === 's_post')!.args.text);
    expect(text.startsWith('Bản tin sáng\nBáo cáo issue Jira quá hạn (ATIT):')).toBe(true);
    expect(text).not.toContain('Placeholder');
    expect(response.reportEvidence).toBeDefined();
    expect(response.reportEvidence?.contentHash).toBe(sha256(text));
    expect(store.getArtifact(response.reportEvidence!.artifactId)?.renderedText).toBe(text);
  });

  it('preserves grounding and quoted prefix on a multi-turn clarification reply', async () => {
    const { planner } = plannerFor(
      'jira.search_issues', { projectKey: 'ATIT' },
      { issues: [{ id: '1', key: 'ATIT-1', title: 'Task 1', status: 'To Do', url: 'https://jira.example/browse/ATIT-1' }] },
      { tool: 'slack.send_message', args: { channel: 'C_ATI', text: 'Placeholder' } },
    );
    const memory = new WorkingMemory();
    memory.setEntity('workflow_resource_defaults', { slack: { channelId: 'C_ATI', channelName: 'ati-test' } });
    memory.setEntity('jira_project', { key: 'ATIT', name: 'ATI Test' });

    const response = await planner.processMessage({
      history: [
        { role: 'user', content: 'Liệt kê các issue Jira trong dự án ATIT rồi gửi vào Slack' },
        { role: 'assistant', content: 'Bạn muốn gửi vào kênh Slack nào?' },
      ],
      userMessage: 'Gửi vào kênh ati-test và bắt đầu bằng "Bản tin sáng v1.2"',
      memory,
      actor: { userId: 'u1', workspaceId: 'w1' },
    });

    expect(response.kind).toBe('plan');
    if (response.kind !== 'plan') return;
    const text = String(response.steps.find((s) => s.id === 's_post')!.args.text);
    expect(response.reportEvidence).toBeDefined();
    expect(text.startsWith('Bản tin sáng v1.2\n')).toBe(true);
  });

  it('does not prepend a source-filter "bắt đầu bằng" clause as a report prefix', async () => {
    const { planner } = plannerFor(
      'jira.search_issues', { projectKey: 'ATIT' },
      { issues: [{ id: '1', key: 'ATIT-1', title: '[FE] Login button', status: 'To Do', url: 'https://jira.example/browse/ATIT-1' }] },
      { tool: 'slack.send_message', args: { channel: 'C_ATI', text: 'Placeholder' } },
    );
    const memory = new WorkingMemory();
    memory.setEntity('workflow_resource_defaults', { slack: { channelId: 'C_ATI', channelName: 'ati-test' } });
    memory.setEntity('jira_project', { key: 'ATIT', name: 'ATI Test' });

    const response = await planner.processMessage({
      userMessage: 'Liệt kê các issue có tiêu đề bắt đầu bằng "[FE]" trong dự án Jira ATIT rồi gửi danh sách vào kênh Slack ati-test.',
      memory,
      actor: { userId: 'u1', workspaceId: 'w1' },
    });

    expect(response.kind).toBe('plan');
    if (response.kind !== 'plan') return;
    const text = String(response.steps.find((s) => s.id === 's_post')!.args.text);
    expect(text.startsWith('Báo cáo issue Jira (ATIT):')).toBe(true);
    expect(text.startsWith('[FE]')).toBe(false);
  });

  it('forwards dueWithinDays filter to Jira report title', async () => {
    const { planner } = plannerFor(
      'myjira.search_issues', { siteId: 'site-ati', projectKey: 'ATIT', dueWithinDays: 3 },
      { issues: [{ id: '1', key: 'ATIT-1', title: 'Due soon task', status: 'To Do', url: 'https://jira.example/browse/ATIT-1', siteId: 'site-ati' }] },
      { tool: 'slack.send_message', args: { channel: 'C_ATI', text: 'Placeholder' } },
      true,
    );
    const memory = new WorkingMemory();
    memory.setEntity('workflow_resource_defaults', { slack: { channelId: 'C_ATI', channelName: 'ati-test' } });
    memory.setEntity('jira_site', { id: 'site-ati', siteId: 'site-ati', cloudId: 'cloud-ati', workspaceId: 'w1', name: 'ATI Jira' });
    memory.setEntity('jira_project', { id: '1001', key: 'ATIT', siteId: 'site-ati', cloudId: 'cloud-ati', workspaceId: 'w1', name: 'ATI Test' });

    const response = await planner.processMessage({
      userMessage: 'Liệt kê các issue Jira sắp đến hạn trong dự án ATIT rồi gửi vào kênh Slack ati-test.',
      memory,
      actor: { userId: 'u1', workspaceId: 'w1' },
    });

    expect(response.kind).toBe('plan');
    if (response.kind !== 'plan') return;
    const text = String(response.steps.find((s) => s.id === 's_post')!.args.text);
    expect(text).toMatch(/^Báo cáo issue Jira sắp đến hạn trong 3 ngày \(ATIT\): Tổng số 1 ticket\./);
    expect(renderJiraProgressReport([{ key: 'ATIT-1', title: 'Due soon task', status: 'To Do' }], {
      projectKey: 'ATIT',
      filters: { dueWithinDays: 3 },
    }).text).toMatch(/^Báo cáo issue Jira sắp đến hạn trong 3 ngày \(ATIT\): Tổng số 1 ticket\./);
  });

  it('detects "tồn lâu" and English "older than 14 days" aging phrasings in AIPlanner.processMessage', async () => {
    const issues = [
      { id: '1', number: 1, title: 'Old bug', url: 'https://github.com/VinhDat267/ati-test/issues/1', repo: 'VinhDat267/ati-test', createdAt: '2026-10-01T00:00:00Z' },
      { id: '2', number: 2, title: 'Recent bug', url: 'https://github.com/VinhDat267/ati-test/issues/2', repo: 'VinhDat267/ati-test', createdAt: '2026-11-15T00:00:00Z' },
    ];
    const memory = new WorkingMemory();
    memory.setEntity('workflow_resource_defaults', { github: { repo: 'VinhDat267/ati-test' } });
    memory.setEntity('chat', { id: '-100123', title: 'ATI Test' });

    const { planner: vnPlanner } = plannerFor(
      'github.list_issues', { repo: 'VinhDat267/ati-test', state: 'open' },
      issues,
      { tool: 'telegram.send_message', args: { chatId: '-100123', text: 'Placeholder' } },
    );
    const vnRes = await vnPlanner.processMessage({
      userMessage: 'Nhắc nhóm các issue tồn lâu trên repo GitHub VinhDat267/ati-test rồi gửi vào Telegram ATI Test',
      memory,
      actor: { userId: 'u1', workspaceId: 'w1' },
    });
    expect(vnRes.kind).toBe('plan');
    if (vnRes.kind === 'plan') {
      const text = String(vnRes.steps.find((s) => s.id === 's_post')!.args.text);
      expect(text).toContain('tồn đọng quá 7 ngày');
      expect(text).toContain('#1: Old bug');
      expect(text).not.toContain('#2: Recent bug');
    }

    const { planner: enPlanner } = plannerFor(
      'github.list_issues', { repo: 'VinhDat267/ati-test', state: 'open' },
      issues,
      { tool: 'telegram.send_message', args: { chatId: '-100123', text: 'Placeholder' } },
    );
    const enRes = await enPlanner.processMessage({
      userMessage: 'Send stale issues older than 14 days on GitHub VinhDat267/ati-test to Telegram ATI Test',
      memory,
      actor: { userId: 'u1', workspaceId: 'w1' },
    });
    expect(enRes.kind).toBe('plan');
    if (enRes.kind === 'plan') {
      const text = String(enRes.steps.find((s) => s.id === 's_post')!.args.text);
      expect(text).toContain('tồn đọng quá 14 ngày');
      expect(text).toContain('#1: Old bug');
      expect(text).not.toContain('#2: Recent bug');
    }
  });

  it('honors real state/query filters and empty/partial branches in renderGithubIssueListReport', async () => {
    const { planner } = plannerFor(
      'github.list_issues', { repo: 'VinhDat267/ati-test', state: 'closed' },
      [
        { id: '10', number: 10, title: 'Resolved bug', url: 'https://github.com/VinhDat267/ati-test/issues/10', repo: 'VinhDat267/ati-test', createdAt: '2026-11-10T00:00:00Z' },
      ],
      { tool: 'telegram.send_message', args: { chatId: '-100123', text: 'Placeholder' } },
    );
    const memory = new WorkingMemory();
    memory.setEntity('workflow_resource_defaults', { github: { repo: 'VinhDat267/ati-test' } });
    memory.setEntity('chat', { id: '-100123', title: 'ATI Test' });

    const response = await planner.processMessage({
      userMessage: 'Liệt kê các issue đã đóng trên repo GitHub VinhDat267/ati-test rồi gửi vào Telegram ATI Test',
      memory,
      actor: { userId: 'u1', workspaceId: 'w1' },
    });
    expect(response.kind).toBe('plan');
    if (response.kind === 'plan') {
      const text = String(response.steps.find((s) => s.id === 's_post')!.args.text);
      expect(text.startsWith('Báo cáo GitHub Issue đã đóng (VinhDat267/ati-test):')).toBe(true);
      expect(text).not.toContain('đang mở');
    }

    expect(renderGithubIssueListReport([], { repo: 'acme/api' })).toEqual({
      text: 'Báo cáo GitHub Issue đang mở (acme/api): Hiện không có issue nào đang mở.',
      itemCount: 0,
      coverage: 'complete',
    });
    expect(renderGithubIssueListReport([], { repo: 'acme/api', filters: { state: 'closed' } }).text)
      .toBe('Báo cáo GitHub Issue đã đóng (acme/api): Hiện không có issue nào đã đóng.');
    expect(renderGithubIssueListReport([], { repo: 'acme/api', filters: { query: 'oauth' } }).text)
      .toBe('Báo cáo GitHub Issue (acme/api, từ khoá: "oauth"): Hiện không có issue nào khớp bộ lọc.');

    const twoIssues = [
      { id: '1', number: 1, title: 'Issue 1', url: 'https://github.com/acme/api/issues/1', createdAt: '2026-11-10T00:00:00Z' },
      { id: '2', number: 2, title: 'Issue 2', url: 'https://github.com/acme/api/issues/2', createdAt: '2026-11-11T00:00:00Z' },
    ];
    const partial = renderGithubIssueListReport(twoIssues, { repo: 'acme/api', limit: 1, clock: '2026-11-18T00:00:00Z' });
    expect(partial.coverage).toBe('partial');
    expect(partial.itemCount).toBe(2);
    expect(partial.text).toContain('(hiển thị 1 mục đầu tiên)');
  });
});
