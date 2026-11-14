import type { ScheduleRecurrence } from '@wap/tool-schemas';
import { computeJiraDigestConfigHash, type JiraDigestConfig } from './jira-digest-candidate.js';
import { escapeSlackMrkdwn } from './github-digest-runner.js';

export interface JiraDigestIssueItem {
  key: string;
  summary: string;
  status: string;
  priority?: string;
  assignee?: string;
  issueType?: string;
  dueDate?: string;
  url: string;
}

export interface JiraDigestStats {
  total: number;
  blockerOrHigh: number;
  inProgress: number;
  done: number;
}

export function analyzeJiraDigestIssues(issues: JiraDigestIssueItem[]): {
  stats: JiraDigestStats;
  sortedIssues: Array<{
    issue: JiraDigestIssueItem;
    bucket: 'blocker_high' | 'in_progress' | 'todo' | 'done';
  }>;
} {
  const stats: JiraDigestStats = {
    total: issues.length,
    blockerOrHigh: 0,
    inProgress: 0,
    done: 0,
  };

  const enriched = issues.map((issue) => {
    const statusLower = String(issue.status || '').toLowerCase();
    const prioLower = String(issue.priority || '').toLowerCase();
    const isDone = /^(done|closed|resolved|hoàn thành|đã xong)$/i.test(statusLower);
    const isBlockerOrHigh =
      !isDone &&
      (/(blocker|highest|high|khẩn|cao)/i.test(prioLower) || /(blocked|bị chặn|impediment)/i.test(statusLower));
    const isInProgress =
      !isDone && !isBlockerOrHigh && /(in progress|in-progress|doing|review|đang làm)/i.test(statusLower);

    let bucket: 'blocker_high' | 'in_progress' | 'todo' | 'done' = 'todo';
    if (isDone) {
      bucket = 'done';
      stats.done++;
    } else if (isBlockerOrHigh) {
      bucket = 'blocker_high';
      stats.blockerOrHigh++;
    } else if (isInProgress) {
      bucket = 'in_progress';
      stats.inProgress++;
    }
    return { issue, bucket };
  });

  const order: Record<'blocker_high' | 'in_progress' | 'todo' | 'done', number> = {
    blocker_high: 0,
    in_progress: 1,
    todo: 2,
    done: 3,
  };
  enriched.sort((a, b) => order[a.bucket] - order[b.bucket]);

  return { stats, sortedIssues: enriched };
}

export function formatJiraDigestReport(
  projectSections: Array<{ projectKey: string; projectName?: string; issues: JiraDigestIssueItem[] }>,
): string {
  const lines: string[] = ['📋 *Bản tin Tiến độ & Blocker Jira (Read-Only Standup Digest)*'];
  for (const section of projectSections) {
    const { stats, sortedIssues } = analyzeJiraDigestIssues(section.issues);
    const label = section.projectName
      ? `${escapeSlackMrkdwn(section.projectKey)} · ${escapeSlackMrkdwn(section.projectName)}`
      : escapeSlackMrkdwn(section.projectKey);
    const kpis = [`${stats.total} issue`];
    if (stats.blockerOrHigh > 0) kpis.push(`🚨 ${stats.blockerOrHigh} ưu tiên cao/chặn`);
    if (stats.inProgress > 0) kpis.push(`🔄 ${stats.inProgress} đang làm`);
    if (stats.done > 0) kpis.push(`✅ ${stats.done} hoàn thành`);
    lines.push(`• *Dự án ${label} (${kpis.join(' · ')}):*`);
    if (sortedIssues.length === 0) {
      lines.push('  - _(Không có issue nào)_');
      continue;
    }
    for (const { issue, bucket } of sortedIssues.slice(0, 10)) {
      const icon =
        bucket === 'blocker_high' ? '🚨 ' : bucket === 'in_progress' ? '🔄 ' : bucket === 'done' ? '✅ ' : '• ';
      const safeSummary = escapeSlackMrkdwn(issue.summary.slice(0, 100));
      const metaParts = [escapeSlackMrkdwn(issue.status)];
      if (issue.priority) metaParts.push(`⚡ ${escapeSlackMrkdwn(issue.priority)}`);
      if (issue.assignee) metaParts.push(`👤 ${escapeSlackMrkdwn(issue.assignee)}`);
      lines.push(`  - ${icon}<${issue.url}|${escapeSlackMrkdwn(issue.key)}>: ${safeSummary} _(${metaParts.join(' · ')})_`);
    }
  }
  return lines.join('\n');
}

export interface RunJiraDigestInput {
  userId: string;
  recurrence: ScheduleRecurrence;
  digestConfig: JiraDigestConfig;
  digestConfigHash: string;
  revalidatePolicy: (userId: string, config: JiraDigestConfig, signal?: AbortSignal) => Promise<{ allowed: boolean; reason?: string }>;
  getAdapter: (serviceName: string, context?: any) => Promise<any> | any;
  signal?: AbortSignal;
}

export async function runJiraDigest(
  input: RunJiraDigestInput,
): Promise<
  | { state: 'digest_sent'; text: string }
  | { state: 'blocked'; error: string }
  | { state: 'digest_failed'; error: string }
> {
  const { userId, recurrence, digestConfig, digestConfigHash, signal } = input;
  const expectedHash = computeJiraDigestConfigHash({
    config: digestConfig,
    recurrence,
    userId,
  });
  if (expectedHash !== digestConfigHash) {
    return {
      state: 'blocked',
      error: 'Cấu hình bản tin Jira đã thay đổi so với lần phê duyệt; vui lòng xác nhận lại lịch.',
    };
  }

  const policyCheck = await input.revalidatePolicy(userId, digestConfig, signal);
  if (!policyCheck.allowed) {
    return {
      state: 'blocked',
      error: policyCheck.reason ?? 'Quyền truy cập Jira hoặc Workspace đã thay đổi; tạm dừng bản tin tự động.',
    };
  }

  const jiraAdapter = await input.getAdapter('myjira', {
    userId,
    phase: 'planning',
    workspaceId: digestConfig.workspaceId,
    workspaceMode: 'organization',
  });
  if (!jiraAdapter || typeof jiraAdapter.execute !== 'function') {
    return { state: 'digest_failed', error: 'Không khởi tạo được bộ kết nối Jira chỉ đọc.' };
  }

  const sections: Array<{ projectKey: string; projectName?: string; issues: JiraDigestIssueItem[] }> = [];
  for (const proj of digestConfig.projects) {
    const rawIssues = await jiraAdapter.execute(
      'myjira.search_issues',
      { siteId: proj.siteId, projectKey: proj.projectKey, limit: 20 },
      { signal },
    );
    const issueList = Array.isArray(rawIssues)
      ? rawIssues
      : Array.isArray((rawIssues as any)?.issues)
        ? (rawIssues as any).issues
        : [];
    const issues: JiraDigestIssueItem[] = issueList.map((it: any) => ({
      key: String(it.key || ''),
      summary: String(it.title ?? it.summary ?? ''),
      status: String(it.status || 'Unknown'),
      ...(it.priority ? { priority: String(it.priority) } : {}),
      ...(it.assignee ? { assignee: String(it.assignee) } : {}),
      ...(it.issueType ? { issueType: String(it.issueType) } : {}),
      ...(it.dueDate ? { dueDate: String(it.dueDate) } : {}),
      url: String(it.url || ''),
    }));
    sections.push({
      projectKey: proj.projectKey,
      ...(proj.projectName ? { projectName: proj.projectName } : {}),
      issues,
    });
  }

  const text = formatJiraDigestReport(sections);

  if (digestConfig.telegramChatId) {
    const tgAdapter = await input.getAdapter('telegram', { userId, phase: 'execution' });
    await tgAdapter.execute(
      'telegram.send_message',
      { chatId: digestConfig.telegramChatId, text },
      { signal },
    );
    return { state: 'digest_sent', text };
  }

  const slackAdapter = await input.getAdapter('slack', { userId, phase: 'execution' });
  await slackAdapter.execute(
    'slack.send_message',
    { channel: digestConfig.channelId, text },
    { signal },
  );
  return { state: 'digest_sent', text };
}
