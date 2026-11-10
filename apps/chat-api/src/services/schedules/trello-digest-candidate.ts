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
    ...(config.destination ? { destination: config.destination } : {}),
    ...(config.telegramChatId ? { telegramChatId: config.telegramChatId } : {}),
    ...(config.telegramChatTitle ? { telegramChatTitle: config.telegramChatTitle } : {}),
    ...(config.telegramCredentialId ? { telegramCredentialId: config.telegramCredentialId } : {}),
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

const GENERIC_BOARD_PHRASE_REGEX =
  /^(?:trello|các\s+bảng|tất\s+cả(?:\s+các)?\s+bảng|mọi\s+bảng|của\s+tôi|nhóm|tổ\s+chức|tin|báo\s+cáo|dự\s+án|công\s+việc|hiện\s+tại|đang\s+có)(?:\b|\s|$)/i;

function extractExplicitBoardTarget(request: string): string | null {
  const quotedMatch = request.match(/(?:bảng|board)\s*(?:trello\s*)?["'“”‘’]([^"'“”‘’]{1,80})["'“”‘’]/i);
  if (quotedMatch?.[1]?.trim()) {
    return quotedMatch[1].trim();
  }
  const unquotedMatch = request.match(
    /(?:trên|từ|của|cho|ở|về|tóm\s+tắt|báo\s+cáo|kiểm\s+tra|quét)?\s*(?:bảng|board)\s+([^\n,.;!?#]{1,60}?)(?=\s+(?:gửi|vào|qua|sang|tới|đến|lên|kênh|slack|telegram|mỗi|hàng|lúc|vào\s+lúc|trong\s+\d|sắp\s+đến\s+hạn|quá\s+hạn|chưa\s+gán)|[.,;!?]|$)/i,
  );
  const candidate = unquotedMatch?.[1]?.trim();
  if (!candidate) return null;
  if (GENERIC_BOARD_PHRASE_REGEX.test(candidate)) return null;
  return candidate;
}

function parseDueSoonHours(request: string): number {
  // Only match explicit horizon/duration phrases, never schedule clock times like "lúc 8h sáng" or "vào 8 giờ".
  const prefixHorizon = request.match(
    /(?:trong(?:\s+vòng)?|sắp\s+đến\s+hạn(?:\s+trong)?|đến\s+hạn(?:\s+trong)?|hạn\s+trong|vòng)\s*(\d{1,3})\s*(?:giờ|tiếng|h)\b/i,
  );
  if (prefixHorizon?.[1]) {
    const parsed = Number.parseInt(prefixHorizon[1], 10);
    if (Number.isInteger(parsed)) return Math.min(168, Math.max(1, parsed));
  }
  const suffixHorizon = request.match(
    /(?<!lúc\s)(?<!vào\s)\b(\d{1,3})\s*(?:giờ|tiếng|h)\s*(?:tới|tiếp\s+theo|nữa|sắp\s+tới)\b/i,
  );
  if (suffixHorizon?.[1]) {
    const parsed = Number.parseInt(suffixHorizon[1], 10);
    if (Number.isInteger(parsed)) return Math.min(168, Math.max(1, parsed));
  }
  return 24;
}

export interface EvaluateTrelloDigestInput {
  userId: string;
  scopeId?: string;
  workspaceMode?: 'legacy' | 'personal' | 'organization';
  workspaceId?: string | null;
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

  if (
    input.workspaceMode === 'organization' &&
    (!input.workspaceId || !String(input.workspaceId).trim())
  ) {
    return {
      canAutoDigest: false,
      disabledReason: 'Không gian làm việc Tổ chức không hợp lệ để lập lịch bản tin Trello.',
    };
  }

  const effectiveScopeId =
    input.scopeId ??
    (input.workspaceMode === 'organization' && input.workspaceId
      ? input.workspaceId
      : input.workspaceMode === 'personal'
        ? `personal:${userId}`
        : undefined);

  let trello: any;
  try {
    trello =
      effectiveScopeId !== undefined
        ? await input.trelloConnection?.(userId, effectiveScopeId)
        : await input.trelloConnection?.(userId);
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
  const matchedByNameCount = new Map<string, number>();
  for (const item of memberItems) {
    const bNameLower = String(item.boardName || '').trim().toLowerCase();
    const bIdLower = String(item.boardId || '').trim().toLowerCase();
    const idExplicitlyInReq = Boolean(bIdLower && lowerReq.includes(bIdLower));
    const nameInReq = Boolean(bNameLower && lowerReq.includes(bNameLower));
    if (nameInReq || idExplicitlyInReq) {
      matchedBoards.set(String(item.boardId), String(item.boardName || item.boardId));
      if (nameInReq && !idExplicitlyInReq) {
        matchedByNameCount.set(bNameLower, (matchedByNameCount.get(bNameLower) ?? 0) + 1);
      }
    }
  }

  for (const [, count] of matchedByNameCount) {
    if (count > 1) {
      return {
        canAutoDigest: false,
        disabledReason:
          'Có nhiều bảng Trello trùng tên trong phạm vi được phép. Vui lòng chỉ rõ ID bảng hoặc tên phân biệt.',
      };
    }
  }

  const explicitBoardTarget = extractExplicitBoardTarget(request);
  if (matchedBoards.size === 0) {
    if (explicitBoardTarget) {
      return {
        canAutoDigest: false,
        disabledReason: `Không tìm thấy bảng Trello "${explicitBoardTarget}" trong phạm vi được phép. Vui lòng kiểm tra lại tên bảng hoặc quyền truy cập.`,
      };
    }
    // Default to all member boards (up to 5) only when no specific board name was requested
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

  const dueSoonHours = parseDueSoonHours(request);

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
    const adapterContext = {
      userId,
      phase: 'planning' as const,
      ...(input.workspaceMode ? { workspaceMode: input.workspaceMode } : {}),
      ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
    };
    const slackAdapter = await input.getAdapter?.('slack', adapterContext);
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
