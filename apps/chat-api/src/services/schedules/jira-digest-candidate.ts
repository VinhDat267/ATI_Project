import { createHash } from 'node:crypto';
import type { ScheduleRecurrence } from '@wap/tool-schemas';
import { canonicalizeRecurrence } from './github-digest-candidate.js';

export interface JiraDigestProjectItem {
  siteId: string;
  siteName: string;
  projectKey: string;
  projectName?: string;
}

export interface JiraDigestConfig {
  workspaceId: string;
  grantId: string;
  atlassianAccountId: string;
  projects: JiraDigestProjectItem[];
  channelId: string;
  channelName: string;
  telegramChatId?: string;
  telegramChatTitle?: string;
}

export interface JiraDigestCandidate {
  canAutoDigest: boolean;
  disabledReason?: string;
  config?: JiraDigestConfig;
  configHash?: string;
}

export function canonicalizeJiraDigestConfig(config: JiraDigestConfig): JiraDigestConfig {
  return {
    workspaceId: String(config.workspaceId),
    grantId: String(config.grantId),
    atlassianAccountId: String(config.atlassianAccountId),
    projects: [...config.projects]
      .map((p) => ({
        siteId: String(p.siteId),
        siteName: String(p.siteName),
        projectKey: String(p.projectKey).toUpperCase(),
        ...(p.projectName ? { projectName: String(p.projectName) } : {}),
      }))
      .sort((a, b) => `${a.siteId}:${a.projectKey}`.localeCompare(`${b.siteId}:${b.projectKey}`)),
    channelId: String(config.channelId || ''),
    channelName: String(config.channelName || ''),
    ...(config.telegramChatId ? { telegramChatId: String(config.telegramChatId) } : {}),
    ...(config.telegramChatTitle ? { telegramChatTitle: String(config.telegramChatTitle) } : {}),
  };
}

export function computeJiraDigestConfigHash(input: {
  config: JiraDigestConfig;
  recurrence: ScheduleRecurrence;
  userId: string;
}): string {
  const payload = {
    kind: 'myjira_digest' as const,
    userId: input.userId,
    recurrence: canonicalizeRecurrence(input.recurrence),
    config: canonicalizeJiraDigestConfig(input.config),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

const JIRA_WRITE_INTENT_REGEX =
  /(?:^|\s)(tạo\s+(?:issue|ticket|task|bug)|thêm\s+(?:issue|ticket|bình\s+luận|comment)|chuyển\s+trạng\s+thái|cập\s+nhật\s+(?:issue|ticket)|sửa\s+(?:issue|ticket)|xoá\s+(?:issue|ticket)|create\s+(?:issue|ticket)|transition\s+issue|update\s+issue|add\s+comment)(?=$|\s|[.,;!?])/i;

export interface EvaluateJiraDigestInput {
  userId: string;
  workspaceId?: string | null;
  request?: string;
  services: string[];
  recurrence: ScheduleRecurrence;
  jiraConnection?: (userId: string, workspaceId?: string | null) => Promise<{
    status: 'connected' | 'disconnected';
    workspaceId?: string;
    grantId?: string;
    atlassianAccountId?: string;
    projects?: JiraDigestProjectItem[];
  } | null>;
  telegramConnection?: (userId: string) => Promise<any>;
  getAdapter?: (serviceName: string, context?: any) => Promise<any> | any;
}

export async function evaluateJiraDigestCandidate(
  input: EvaluateJiraDigestInput,
): Promise<JiraDigestCandidate> {
  const { userId, services, recurrence } = input;
  const request = input.request ?? '';
  const serviceSet = new Set(services);
  const hasMyJira = serviceSet.has('myjira');
  const isTelegramDest =
    serviceSet.size === 2 &&
    hasMyJira &&
    serviceSet.has('telegram') &&
    typeof input.telegramConnection === 'function';
  const isSlackDest = serviceSet.size === 2 && hasMyJira && serviceSet.has('slack');

  if (!isSlackDest && !isTelegramDest) {
    return {
      canAutoDigest: false,
      disabledReason:
        'Chỉ bật được khi lịch chỉ đọc Jira (myjira) và gửi bản tin tổng hợp vào 1 kênh Slack hoặc Telegram đã chọn.',
    };
  }

  if (JIRA_WRITE_INTENT_REGEX.test(request)) {
    return {
      canAutoDigest: false,
      disabledReason:
        'Lịch bản tin Jira chỉ hỗ trợ tra cứu chỉ đọc (read-only digest); không tự động tạo, sửa hoặc chuyển trạng thái issue theo lịch.',
    };
  }

  let jiraConn: Awaited<ReturnType<NonNullable<EvaluateJiraDigestInput['jiraConnection']>>> = null;
  try {
    jiraConn = (await input.jiraConnection?.(userId, input.workspaceId)) ?? null;
  } catch {
    jiraConn = null;
  }

  if (
    !jiraConn ||
    jiraConn.status !== 'connected' ||
    !jiraConn.workspaceId ||
    !jiraConn.grantId ||
    !jiraConn.atlassianAccountId ||
    !Array.isArray(jiraConn.projects) ||
    jiraConn.projects.length === 0
  ) {
    return {
      canAutoDigest: false,
      disabledReason:
        'Cần kết nối Jira OAuth 3LO trong Workspace và được cấp quyền ít nhất 1 dự án Jira hợp lệ.',
    };
  }

  const lowerReq = request.toLowerCase();
  const matchedProjects = jiraConn.projects.filter(
    (p) =>
      lowerReq.includes(p.projectKey.toLowerCase()) ||
      (p.projectName && lowerReq.includes(p.projectName.toLowerCase())),
  );
  const selectedProjects = (matchedProjects.length > 0 ? matchedProjects : jiraConn.projects).slice(0, 5);

  if (isTelegramDest) {
    let tg: any;
    try {
      tg = await input.telegramConnection?.(userId);
    } catch {
      tg = null;
    }
    const selectedChats: Array<{ chatId: string; title: string }> = Array.isArray(tg?.selectedChats)
      ? tg.selectedChats
      : [];
    if (!tg || tg.status !== 'connected' || selectedChats.length === 0) {
      return {
        canAutoDigest: false,
        disabledReason: 'Cần kết nối Telegram cá nhân và chọn ít nhất 1 cuộc trò chuyện nhận bản tin Jira.',
      };
    }

    const byTitle = selectedChats.filter(
      (c) => c.title && lowerReq.includes(String(c.title).toLowerCase()),
    );
    const matchedChat =
      byTitle.length === 1 ? byTitle[0]! : selectedChats.length === 1 ? selectedChats[0]! : null;

    if (!matchedChat) {
      return {
        canAutoDigest: false,
        disabledReason: 'Cần chỉ rõ 1 cuộc trò chuyện Telegram hợp lệ thuộc phạm vi được phép nhận bản tin Jira.',
      };
    }

    const config = canonicalizeJiraDigestConfig({
      workspaceId: jiraConn.workspaceId,
      grantId: jiraConn.grantId,
      atlassianAccountId: jiraConn.atlassianAccountId,
      projects: selectedProjects,
      channelId: '',
      channelName: '',
      telegramChatId: String(matchedChat.chatId),
      telegramChatTitle: String(matchedChat.title),
    });

    return {
      canAutoDigest: true,
      config,
      configHash: computeJiraDigestConfigHash({ config, recurrence, userId }),
    };
  }

  const hashMatch =
    request.match(/#([a-z0-9._-]+)/i) ?? request.match(/(?:kênh|slack)\s+#?([a-z0-9._-]+)/i);
  const channelQuery = hashMatch?.[1]?.trim() ?? '';

  let matchedChannel: { id: string; name: string } | null = null;
  try {
    const slackAdapter = await input.getAdapter?.('slack', { userId, phase: 'planning' });
    if (slackAdapter && typeof slackAdapter.execute === 'function') {
      const channels = await slackAdapter.execute('slack.search_channels', { query: channelQuery });
      if (Array.isArray(channels) && channels.length > 0) {
        if (channelQuery) {
          const exact = channels.find(
            (c: any) =>
              String(c.name ?? '').replace(/^#/, '').toLowerCase() === channelQuery.toLowerCase() ||
              String(c.id ?? '') === channelQuery,
          );
          matchedChannel = exact
            ? { id: String(exact.id), name: String(exact.name).replace(/^#/, '') }
            : channels.length === 1
              ? { id: String(channels[0].id), name: String(channels[0].name).replace(/^#/, '') }
              : null;
        } else if (channels.length === 1) {
          matchedChannel = { id: String(channels[0].id), name: String(channels[0].name).replace(/^#/, '') };
        }
      }
    }
  } catch {
    matchedChannel = null;
  }

  if (!matchedChannel) {
    return {
      canAutoDigest: false,
      disabledReason: 'Cần chỉ rõ 1 kênh Slack hợp lệ thuộc phạm vi được phép nhận bản tin Jira.',
    };
  }

  const config = canonicalizeJiraDigestConfig({
    workspaceId: jiraConn.workspaceId,
    grantId: jiraConn.grantId,
    atlassianAccountId: jiraConn.atlassianAccountId,
    projects: selectedProjects,
    channelId: matchedChannel.id,
    channelName: matchedChannel.name,
  });

  return {
    canAutoDigest: true,
    config,
    configHash: computeJiraDigestConfigHash({ config, recurrence, userId }),
  };
}
