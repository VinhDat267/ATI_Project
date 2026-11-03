import { createHash } from 'node:crypto';
import type { NotionDigestConfig, NotionDigestCandidate, ScheduleRecurrence } from '@wap/tool-schemas';
import { canonicalizeRecurrence } from './github-digest-candidate.js';

export function canonicalizeNotionDigestConfig(config: NotionDigestConfig): NotionDigestConfig {
  return {
    credentialId: config.credentialId,
    workspaceId: config.workspaceId,
    workspaceName: config.workspaceName,
    botId: config.botId,
    identityVersion: config.identityVersion,
    databases: [...config.databases]
      .map((d) => ({
        id: String(d.id).toLowerCase(),
        title: String(d.title),
        ...(d.url ? { url: String(d.url) } : {}),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    channelId: config.channelId,
    channelName: config.channelName,
    ...(config.telegramChatId ? { telegramChatId: config.telegramChatId } : {}),
    ...(config.telegramChatTitle ? { telegramChatTitle: config.telegramChatTitle } : {}),
    ...(typeof config.includeAiSummary === 'boolean' ? { includeAiSummary: config.includeAiSummary } : {}),
  };
}

export function computeNotionDigestConfigHash(input: {
  config: NotionDigestConfig;
  recurrence: ScheduleRecurrence;
  userId: string;
}): string {
  const payload = {
    kind: 'notion_digest' as const,
    userId: input.userId,
    recurrence: canonicalizeRecurrence(input.recurrence),
    config: canonicalizeNotionDigestConfig(input.config),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

const WRITE_INTENT_REGEX =
  /(?:^|\s)(tạo\s+trang|tạo\s+page|thêm\s+trang|thêm\s+page|thêm\s+nội\s+dung|sửa\s+trang|cập\s+nhật\s+trang|ghi\s+vào\s+notion|create\s+page|append\s+block|update\s+page)(?=$|\s|[.,;!?])/i;

export interface EvaluateNotionDigestInput {
  userId: string;
  request?: string;
  proposal?: { request: string; recurrence: ScheduleRecurrence; [key: string]: any };
  services: string[];
  recurrence?: ScheduleRecurrence;
  notionConnection?: (userId: string, scopeId?: string) => Promise<any>;
  telegramConnection?: (userId: string) => Promise<any>;
  getAdapter?: (serviceName: string, context?: any) => Promise<any> | any;
}

export async function evaluateNotionDigestCandidate(
  input: EvaluateNotionDigestInput
): Promise<NotionDigestCandidate> {
  const { userId, services } = input;
  const request = input.request ?? input.proposal?.request ?? '';
  const recurrence = (input.recurrence ?? input.proposal?.recurrence)!;
  const serviceSet = new Set(services);
  const isTelegramDest =
    serviceSet.size === 2 &&
    serviceSet.has('notion') &&
    serviceSet.has('telegram') &&
    typeof input.telegramConnection === 'function';
  const isSlackDest = serviceSet.size === 2 && serviceSet.has('notion') && serviceSet.has('slack');

  if (!isSlackDest && !isTelegramDest) {
    return {
      canAutoDigest: false,
      disabledReason:
        'Chỉ bật được khi lịch chỉ đọc Notion và gửi báo cáo vào 1 kênh Slack hoặc Telegram đã chọn.',
    };
  }

  if (WRITE_INTENT_REGEX.test(request)) {
    return {
      canAutoDigest: false,
      disabledReason:
        'Chỉ bật được khi lịch chỉ đọc Notion và gửi báo cáo vào kênh nhận đã chọn (không tự động tạo hoặc sửa dữ liệu).',
    };
  }

  let notion: any;
  try {
    notion = await input.notionConnection?.(userId);
  } catch {
    notion = null;
  }

  if (
    !notion ||
    notion.status !== 'connected' ||
    !notion.connection ||
    !Array.isArray(notion.connection.databaseIds) ||
    notion.connection.databaseIds.length === 0
  ) {
    return {
      canAutoDigest: false,
      disabledReason:
        'Cần kết nối Notion cá nhân và chọn ít nhất 1 database Notion trong phạm vi cho phép.',
    };
  }

  const lowerReq = request.toLowerCase();
  const dbItems: Array<{ id: string; title: string; url?: string }> =
    Array.isArray(notion.selectedDatabases) && notion.selectedDatabases.length > 0
      ? notion.selectedDatabases
      : (notion.connection.databaseIds as string[]).map((id: string) => ({
          id,
          title: id,
        }));

  const matchedDbs = new Map<string, { id: string; title: string; url?: string }>();
  for (const item of dbItems) {
    const dTitleLower = String(item.title || '').toLowerCase();
    const dIdLower = String(item.id || '').toLowerCase();
    if (
      (dTitleLower && lowerReq.includes(dTitleLower)) ||
      (dIdLower && lowerReq.includes(dIdLower))
    ) {
      matchedDbs.set(dIdLower, {
        id: dIdLower,
        title: String(item.title || item.id),
        ...(item.url ? { url: String(item.url) } : {}),
      });
    }
  }

  if (matchedDbs.size === 0) {
    for (const item of dbItems.slice(0, 5)) {
      const dIdLower = String(item.id).toLowerCase();
      matchedDbs.set(dIdLower, {
        id: dIdLower,
        title: String(item.title || item.id),
        ...(item.url ? { url: String(item.url) } : {}),
      });
    }
  }

  if (matchedDbs.size === 0 || matchedDbs.size > 5) {
    return {
      canAutoDigest: false,
      disabledReason:
        'Cần có từ 1 đến 5 database Notion hợp lệ thuộc phạm vi được phép để tổng hợp bản tin.',
    };
  }

  const databases = Array.from(matchedDbs.values());

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
      (c) => c.title && lowerReq.includes(String(c.title).toLowerCase())
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

    const config = canonicalizeNotionDigestConfig({
      credentialId: notion.connection.credentialId,
      workspaceId: notion.connection.workspaceId,
      workspaceName: notion.connection.workspaceName,
      botId: notion.connection.botId,
      identityVersion: notion.connection.identityVersion,
      databases,
      channelId: '',
      channelName: '',
      telegramChatId: String(matchedChat.chatId),
      telegramChatTitle: String(matchedChat.title),
    });

    const configHash = computeNotionDigestConfigHash({
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

  // Slack destination
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
              String(c.id ?? '') === channelQuery
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
      disabledReason: 'Cần chỉ rõ 1 kênh Slack hợp lệ thuộc phạm vi được phép nhận bản tin.',
    };
  }

  const config = canonicalizeNotionDigestConfig({
    credentialId: notion.connection.credentialId,
    workspaceId: notion.connection.workspaceId,
    workspaceName: notion.connection.workspaceName,
    botId: notion.connection.botId,
    identityVersion: notion.connection.identityVersion,
    databases,
    channelId: matchedChannel.id,
    channelName: matchedChannel.name,
  });

  const configHash = computeNotionDigestConfigHash({
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
