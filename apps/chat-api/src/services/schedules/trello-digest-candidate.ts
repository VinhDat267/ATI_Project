import { createHash } from 'node:crypto';
import type { TrelloDigestConfig, TrelloDigestCandidate, ScheduleRecurrence } from '@wap/tool-schemas';
import { canonicalizeRecurrence } from './github-digest-candidate.js';

export function canonicalizeTrelloDigestConfig(config: TrelloDigestConfig): TrelloDigestConfig {
  return {
    credentialId: config.credentialId,
    trelloMemberId: config.trelloMemberId,
    username: config.username,
    boards: [...config.boards]
      .map((b) => ({ id: String(b.id), name: String(b.name) }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    channelId: config.channelId,
    channelName: config.channelName,
    dueSoonHours: config.dueSoonHours,
    ...(config.telegramChatId ? { telegramChatId: config.telegramChatId } : {}),
    ...(config.telegramChatTitle ? { telegramChatTitle: config.telegramChatTitle } : {}),
    ...(typeof config.includeAiSummary === 'boolean' ? { includeAiSummary: config.includeAiSummary } : {}),
  };
}

export function computeTrelloDigestConfigHash(input: {
  config: TrelloDigestConfig;
  recurrence: ScheduleRecurrence;
  userId: string;
}): string {
  const payload = {
    kind: 'trello_digest' as const,
    userId: input.userId,
    recurrence: canonicalizeRecurrence(input.recurrence),
    config: canonicalizeTrelloDigestConfig(input.config),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

const WRITE_INTENT_REGEX =
  /(?:^|\s)(tạo\s+thẻ|tạo\s+card|thêm\s+thẻ|thêm\s+card|sửa\s+thẻ|cập\s+nhật\s+thẻ|đóng\s+thẻ|lưu\s+trữ\s+thẻ|di\s+chuyển\s+thẻ|gán\s+thành\s+viên|create\s+card|update\s+card|archive\s+card|move\s+card|add\s+checklist)(?=$|\s|[.,;!?])/i;

export interface EvaluateTrelloDigestInput {
  userId: string;
  request?: string;
  proposal?: { request: string; recurrence: ScheduleRecurrence; [key: string]: any };
  services: string[];
  recurrence?: ScheduleRecurrence;
  trelloConnection?: (userId: string, scopeId?: string) => Promise<any>;
  telegramConnection?: (userId: string) => Promise<any>;
  getAdapter?: (serviceName: string, context?: any) => Promise<any> | any;
}

export async function evaluateTrelloDigestCandidate(
  input: EvaluateTrelloDigestInput
): Promise<TrelloDigestCandidate> {
  const { userId, services } = input;
  const request = input.request ?? input.proposal?.request ?? '';
  const recurrence = (input.recurrence ?? input.proposal?.recurrence)!;
  const serviceSet = new Set(services);
  const isTelegramDest =
    serviceSet.size === 2 &&
    serviceSet.has('trello') &&
    serviceSet.has('telegram') &&
    typeof input.telegramConnection === 'function';
  const isSlackDest = serviceSet.size === 2 && serviceSet.has('trello') && serviceSet.has('slack');

  if (!isSlackDest && !isTelegramDest) {
    return {
      canAutoDigest: false,
      disabledReason:
        'Chỉ bật được khi lịch chỉ đọc Trello và gửi báo cáo vào 1 kênh Slack hoặc Telegram đã chọn.',
    };
  }

  if (WRITE_INTENT_REGEX.test(request)) {
    return {
      canAutoDigest: false,
      disabledReason:
        'Chỉ bật được khi lịch chỉ đọc Trello và gửi báo cáo vào kênh nhận đã chọn (không tự động tạo hoặc sửa dữ liệu).',
    };
  }

  let trello: any;
  try {
    trello = await input.trelloConnection?.(userId);
  } catch {
    trello = null;
  }

  if (
    !trello ||
    trello.status !== 'connected' ||
    !trello.connection ||
    !Array.isArray(trello.connection.boardIds) ||
    trello.connection.boardIds.length === 0
  ) {
    return {
      canAutoDigest: false,
      disabledReason:
        'Cần kết nối Trello cá nhân và là thành viên của ít nhất 1 bảng Trello thuộc phạm vi nhóm.',
    };
  }

  const lowerReq = request.toLowerCase();
  const memberItems: Array<{ boardId: string; boardName: string }> =
    Array.isArray(trello.memberBoards) && trello.memberBoards.length > 0
      ? trello.memberBoards
      : (trello.connection.boardIds as string[]).map((id: string) => ({
          boardId: id,
          boardName: id,
        }));

  const matchedBoards = new Map<string, string>();
  for (const item of memberItems) {
    const bNameLower = String(item.boardName || '').toLowerCase();
    const bIdLower = String(item.boardId || '').toLowerCase();
    if (
      (bNameLower && lowerReq.includes(bNameLower)) ||
      (bIdLower && lowerReq.includes(bIdLower))
    ) {
      matchedBoards.set(String(item.boardId), String(item.boardName || item.boardId));
    }
  }

  if (matchedBoards.size === 0) {
    // Default to all member boards (up to 5) when no specific board name was narrowed
    for (const item of memberItems.slice(0, 5)) {
      matchedBoards.set(String(item.boardId), String(item.boardName || item.boardId));
    }
  }

  if (matchedBoards.size === 0 || matchedBoards.size > 5) {
    return {
      canAutoDigest: false,
      disabledReason:
        'Cần có từ 1 đến 5 bảng Trello hợp lệ thuộc phạm vi nhóm để tổng hợp bản tin.',
    };
  }

  const hoursMatch = request.match(/(\d{1,3})\s*(?:giờ|tiếng|h)\b/i);
  const parsedHours = hoursMatch ? Number.parseInt(hoursMatch[1]!, 10) : 24;
  const dueSoonHours = Number.isInteger(parsedHours) ? Math.min(168, Math.max(1, parsedHours)) : 24;

  const boards = Array.from(matchedBoards.entries()).map(([id, name]) => ({ id, name }));

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

    const config = canonicalizeTrelloDigestConfig({
      credentialId: trello.connection.credentialId,
      trelloMemberId: trello.connection.memberId,
      username: trello.connection.username,
      boards,
      channelId: '',
      channelName: '',
      dueSoonHours,
      telegramChatId: String(matchedChat.chatId),
      telegramChatTitle: String(matchedChat.title),
    });

    const configHash = computeTrelloDigestConfigHash({
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

  const config = canonicalizeTrelloDigestConfig({
    credentialId: trello.connection.credentialId,
    trelloMemberId: trello.connection.memberId,
    username: trello.connection.username,
    boards,
    channelId: matchedChannel.id,
    channelName: matchedChannel.name,
    dueSoonHours,
  });

  const configHash = computeTrelloDigestConfigHash({
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
