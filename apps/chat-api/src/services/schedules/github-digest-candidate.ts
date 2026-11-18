import { createHash } from 'node:crypto';
import type { GithubDigestConfig, ScheduleDigestCandidate, ScheduleRecurrence } from '@wap/tool-schemas';
import { extractSlackDigestChannelHint } from './slack-digest-channel.js';

export function canonicalizeDigestConfig(config: GithubDigestConfig): GithubDigestConfig {
  return {
    credentialId: config.credentialId,
    githubUserId: config.githubUserId,
    login: config.login,
    repos: [...config.repos].sort(),
    channelId: config.channelId,
    channelName: config.channelName,
    staleDays: config.staleDays,
    ...(config.telegramChatId ? { telegramChatId: config.telegramChatId } : {}),
    ...(config.telegramChatTitle ? { telegramChatTitle: config.telegramChatTitle } : {}),
    ...(config.telegramCredentialId ? { telegramCredentialId: config.telegramCredentialId } : {}),
    ...(config.telegramUserId ? { telegramUserId: config.telegramUserId } : {}),
    ...(config.telegramUsername ? { telegramUsername: config.telegramUsername } : {}),
  };
}

export function canonicalizeRecurrence(recurrence: ScheduleRecurrence): ScheduleRecurrence {
  if (recurrence.type === 'once') {
    return { type: 'once', date: recurrence.date, time: recurrence.time };
  }
  if (recurrence.type === 'daily') {
    return { type: 'daily', time: recurrence.time };
  }
  return {
    type: 'weekly',
    time: recurrence.time,
    days: [...recurrence.days].sort((a, b) => a - b),
  };
}

export function computeDigestConfigHash(input: {
  config: GithubDigestConfig;
  recurrence: ScheduleRecurrence;
  userId: string;
}): string {
  const payload = {
    kind: 'github_digest' as const,
    userId: input.userId,
    recurrence: canonicalizeRecurrence(input.recurrence),
    config: canonicalizeDigestConfig(input.config),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

// A schedule proposal carries the request and service set, but no tool steps.
// Match action + object phrases so status descriptions such as "open issues"
// and "PR chờ review" remain eligible for the built-in read-only digest.
const WRITE_INTENT_PATTERNS = [
  /\b(?:create|close|reopen|update|edit|assign|unassign|merge)\s+(?:(?:a|an|the|new|draft|old|open|stale|existing|all)\s+){0,4}(?:issues?|prs?|pull[\s-]+requests?)\b/i,
  /\bopen\s+(?:(?:a|an|the)(?:\s+(?:new|draft))?|new|draft)\s+(?:issues?|prs?|pull[\s-]+requests?)\b/i,
  /\bopen\s+(?:issue|pr|pull[\s-]+request)\s+#[1-9]\d*\b/i,
  /\bdraft\s+(?:a|the)\s+(?:pr|pull[\s-]+request)\b/i,
  /\b(?:request|ask\s+for)\s+(?:(?:a|an|the|code|pull[\s-]+request|pr)\s+){0,4}review(?:s|ers?)?\b/i,
  /\bassign\s+@?[a-z0-9][a-z0-9-]*\s+to\s+(?:the\s+)?issues?\b/i,
  /\bask\s+@?[a-z0-9][a-z0-9-]*\s+to\s+review\s+(?:the\s+)?(?:prs?|pull[\s-]+requests?)\b/i,
  /\b(?:add|remove|apply|set|change)\s+(?:(?:a|an|the|new|bug|existing)\s+){0,4}labels?\b/i,
  /\b(?:add|leave|post|write|submit|send)\s+(?:(?:a|an|the|new)\s+){0,4}comments?\b/i,
  /(?:^|[,;:.!?]|\b(?:and|then|also|please|và|rồi))\s*comment\s+on\b/i,
  /(?:^|[^\p{L}\p{N}_])(?:tạo|mở|đóng|mở\s+lại|sửa|cập\s+nhật|gán|giao|hợp\s+nhất|merge)\s+(?:(?:một|các|những|mấy|tất\s+cả|lại)\s+){0,4}(?:issues?|prs?|pull[\s-]+requests?|thẻ)(?![\p{L}\p{N}_])/iu,
  /(?:^|[^\p{L}\p{N}_])(?:(?:gắn|thêm|gỡ|đổi)\s+(?:một\s+)?nhãn|(?:gán|thêm)\s+(?:một\s+)?reviewers?|(?:yêu\s+cầu|nhờ|xin)\s+(?:một\s+)?(?:review|đánh\s+giá)|(?:thêm|đăng|gửi|viết|để\s+lại)\s+(?:một\s+)?(?:bình\s+luận|comments?)|bình\s+luận\s+(?:vào|trên|cho))(?![\p{L}\p{N}_])/iu,
  /\bcreate\s+(?:a\s+)?card\b/i,
];

export interface EvaluateGithubDigestInput {
  userId: string;
  scopeId?: string;
  workspaceMode?: 'legacy' | 'personal' | 'organization';
  workspaceId?: string | null;
  request?: string;
  proposal?: { request: string; recurrence: ScheduleRecurrence; [key: string]: any };
  services: string[];
  recurrence?: ScheduleRecurrence;
  githubConnection?: (userId: string, scopeId?: string) => Promise<any>;
  telegramConnection?: (userId: string) => Promise<any>;
  getAdapter?: (serviceName: string, context?: any) => Promise<any> | any;
}

export async function evaluateGithubDigestCandidate(
  input: EvaluateGithubDigestInput,
): Promise<ScheduleDigestCandidate> {
  const { userId, services } = input;
  const request = input.request ?? input.proposal?.request ?? '';
  const recurrence = (input.recurrence ?? input.proposal?.recurrence)!;
  const serviceSet = new Set(services);
  const isTelegramDest =
    serviceSet.size === 2 &&
    serviceSet.has('github') &&
    serviceSet.has('telegram') &&
    typeof input.telegramConnection === 'function';
  const isSlackDest = serviceSet.size === 2 && serviceSet.has('github') && serviceSet.has('slack');

  if (!isSlackDest && !isTelegramDest) {
    return {
      canAutoDigest: false,
      disabledReason:
        'Chỉ bật được khi lịch chỉ đọc GitHub và gửi báo cáo vào 1 kênh Slack đã chọn.',
    };
  }

  const normalizedRequest = request.normalize('NFC');
  if (WRITE_INTENT_PATTERNS.some((pattern) => pattern.test(normalizedRequest))) {
    return {
      canAutoDigest: false,
      disabledReason:
        'Chỉ bật tự động cho lịch đọc GitHub và gửi bản tin. Lịch có thao tác ghi cần duyệt từng lượt.',
    };
  }

  let gh: any;
  try {
    gh = input.scopeId
      ? await input.githubConnection?.(userId, input.scopeId)
      : await input.githubConnection?.(userId);
  } catch {
    gh = null;
  }

  if (
    !gh ||
    gh.status !== 'connected' ||
    !gh.connection ||
    !Array.isArray(gh.connection.repos) ||
    gh.connection.repos.length === 0
  ) {
    return {
      canAutoDigest: false,
      disabledReason:
        'Cần kết nối GitHub cá nhân và có quyền truy cập ít nhất 1 repository của nhóm.',
    };
  }

  const lowerReq = request.toLowerCase();
  const memberItems: Array<{ fullName: string; name: string }> = Array.isArray(gh.memberRepos) && gh.memberRepos.length > 0
    ? gh.memberRepos
    : (gh.connection.repos as string[]).map((fullName: string) => ({
        fullName,
        name: fullName.split('/')[1] ?? fullName,
      }));

  const matchedRepos = new Set<string>();
  const nameCounts = new Map<string, number>();
  for (const item of memberItems) {
    const n = item.name.toLowerCase();
    nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
    if (lowerReq.includes(item.fullName.toLowerCase())) {
      matchedRepos.add(item.fullName);
    }
  }
  for (const item of memberItems) {
    if (matchedRepos.has(item.fullName)) continue;
    const nameLower = item.name.toLowerCase();
    if ((nameCounts.get(nameLower) ?? 0) > 1) continue;
    const escapedName = nameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:^|[^a-z0-9_./-])${escapedName}(?:$|[^a-z0-9_./-])`, 'i').test(request)) {
      matchedRepos.add(item.fullName);
    }
  }

  if (matchedRepos.size === 0 && gh.connection.repos.length === 1) {
    matchedRepos.add(gh.connection.repos[0]);
  }

  if (matchedRepos.size === 0 || matchedRepos.size > 5) {
    return {
      canAutoDigest: false,
      disabledReason:
        'Cần chỉ rõ từ 1 đến 5 repository GitHub thuộc phạm vi nhóm trong yêu cầu đặt lịch.',
    };
  }

  const staleMatch = request.match(/(?:quá|trên|hơn)\s*(\d{1,2})\s*ngày/i);
  const parsedStale = staleMatch ? Number.parseInt(staleMatch[1]!, 10) : 2;
  const staleDays = Number.isInteger(parsedStale) ? Math.min(14, Math.max(1, parsedStale)) : 2;

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
        disabledReason: 'Cần kết nối Telegram cá nhân và chọn ít nhất 1 cuộc trò chuyện nhận bản tin.',
      };
    }

    let matchedChat: { chatId: string; title: string } | null = null;
    const byTitle = selectedChats.filter(
      (c) => c.title && lowerReq.includes(String(c.title).toLowerCase()),
    );
    if (byTitle.length === 1) {
      matchedChat = byTitle[0]!;
    } else if (selectedChats.length === 1) {
      matchedChat = selectedChats[0]!;
    }

    if (!matchedChat) {
      return {
        canAutoDigest: false,
        disabledReason: 'Cần chỉ rõ 1 cuộc trò chuyện Telegram hợp lệ thuộc phạm vi được phép nhận bản tin.',
      };
    }

    const config = canonicalizeDigestConfig({
      credentialId: gh.connection.credentialId,
      githubUserId: gh.connection.githubUserId,
      login: gh.connection.login,
      repos: [...matchedRepos],
      channelId: '',
      channelName: '',
      staleDays,
      telegramChatId: String(matchedChat.chatId),
      telegramChatTitle: String(matchedChat.title),
      ...(tg.connection?.credentialId ? { telegramCredentialId: String(tg.connection.credentialId) } : {}),
      ...(tg.connection?.telegramUserId ? { telegramUserId: String(tg.connection.telegramUserId) } : {}),
      ...(tg.connection?.username ? { telegramUsername: String(tg.connection.username) } : {}),
    });

    const configHash = computeDigestConfigHash({
      config,
      recurrence,
      userId,
    });

    return {
      canAutoDigest: true,
      config,
      configHash,
    };
  }

  // Extract Slack channel from request
  const channelQuery = extractSlackDigestChannelHint(request);

  let matchedChannel: { id: string; name: string } | null = null;
  try {
    const slackAdapter = await input.getAdapter?.('slack', {
      userId,
      phase: 'planning',
      ...(input.workspaceMode ? { workspaceMode: input.workspaceMode } : {}),
      ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
    });
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
      disabledReason:
        'Cần chỉ rõ 1 kênh Slack hợp lệ thuộc phạm vi được phép nhận bản tin.',
    };
  }

  const config = canonicalizeDigestConfig({
    credentialId: gh.connection.credentialId,
    githubUserId: gh.connection.githubUserId,
    login: gh.connection.login,
    repos: [...matchedRepos],
    channelId: matchedChannel.id,
    channelName: matchedChannel.name,
    staleDays,
  });

  const configHash = computeDigestConfigHash({
    config,
    recurrence,
    userId,
  });

  return {
    canAutoDigest: true,
    config,
    configHash,
  };
}
