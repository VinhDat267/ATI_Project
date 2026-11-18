import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, GITHUB_OAUTH_TOOLS } from '@wap/tool-schemas';
import { AIPlanner } from '../src/planner.js';
import { WorkingMemory } from '../src/working-memory.js';
import { ReportArtifactStore } from '../src/reports/artifacts.js';
import { renderJiraProgressReport, requestedReportPrefix } from '../src/reports/renderers.js';

// Live audit 18/11/2026: the grounded report replaced the planner's message, so the requested
// prefix "[AUDIT 18/11 A1]" was lost, an overdue list was titled "Báo cáo tiến độ Jira Sprint",
// and a plain "liệt kê issue đang mở" became "Báo cáo GitHub Issue tồn đọng quá 7 ngày".
const CATALOG = [...ALL_TOOLS, ...GITHUB_OAUTH_TOOLS];
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

function plannerFor(readTool: string, readArgs: Record<string, unknown>, result: unknown, post: { tool: string; args: Record<string, unknown> }) {
  const store = new ReportArtifactStore();
  const planner = new AIPlanner({
    toolCatalog: CATALOG,
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

  it.each([
    ['gửi vào Slack, mở đầu bằng [AUDIT 18/11 A1].', '[AUDIT 18/11 A1]'],
    ['gửi Slack và bắt đầu bằng "Bản tin sáng v1.2"', 'Bản tin sáng v1.2'],
    ['send it to Slack starting with [Daily] please.', '[Daily]'],
    ['gửi danh sách vào Slack', undefined],
    // Only quoted or bracketed text is a literal prefix; ordinary instructions are not.
    ['Bắt đầu bằng việc tìm issue quá hạn, rồi gửi Slack', undefined],
    ['Tôi muốn bắt đầu từ dự án ATIT rồi gửi Slack', undefined],
  ])('extracts the requested prefix from %s', (text, expected) => {
    expect(requestedReportPrefix([text])).toBe(expected);
  });
});
