import { createHash } from 'node:crypto';
import { decryptCredentials } from '@wap/tool-adapters';
import type { CalendarDigestCandidate, CalendarDigestConfig } from '@wap/tool-schemas';
import type { Queryable } from '../../db/repositories/schedule-repo.js';
import { hasGoogleCredentialOrigin } from '../gmail/credential-origin.js';
import { findSlackDigestCredential } from './multi-source-digest-candidate.js';

const WRITE_INTENT_RE =
  /\b(tạo\s+sự\s+kiện|tao\s+su\s+kien|đặt\s+lịch\s+họp|dat\s+lich\s+hop|thêm\s+sự\s+kiện|them\s+su\s+kien|xóa\s+sự\s+kiện|xoa\s+su\s+kien|hủy\s+cuộc\s+họp|huy\s+cuoc\s+hop|create\s+event|book\s+meeting|schedule\s+a\s+meeting|tạo\s+thẻ|create\s+card|tạo\s+issue|create\s+issue|gửi\s+email|send\s+email|cập\s+nhật\s+bảng\s+tính|append\s+row)\b/iu;

const SLACK_CHANNEL_ID_RE = /^[CGD][A-Z0-9]{8,}$/;
const TELEGRAM_CHAT_ID_RE = /^-?\d{1,20}$/;

export function isCalendarWriteIntent(request: string): boolean {
  return WRITE_INTENT_RE.test(request);
}

export function computeCalendarDigestHash(config: CalendarDigestConfig): string {
  const canonical = {
    version: config.version,
    source: config.source,
    credentialId: config.credentialId,
    email: config.email,
    calendars: config.calendars.map((c) => ({
      id: c.id,
      summary: c.summary,
      ...(c.primary ? { primary: true } : {}),
    })),
    destination:
      config.destination.service === 'slack'
        ? {
            service: 'slack' as const,
            channelId: config.destination.channelId,
            ...(config.destination.channelName ? { channelName: config.destination.channelName } : {}),
          }
        : {
            service: 'telegram' as const,
            chatId: config.destination.chatId,
            ...(config.destination.chatTitle ? { chatTitle: config.destination.chatTitle } : {}),
            ...(config.destination.credentialId ? { credentialId: config.destination.credentialId } : {}),
          },
    windowHours: config.windowHours,
    includeSummary: config.includeSummary,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export interface EvaluateCalendarDigestInput {
  pool: Queryable;
  encryptionKey?: string;
  mycalendarOAuthClientId?: string;
  userId: string;
  services: string[];
  request: string;
  workspaceMode?: 'legacy' | 'personal' | 'organization';
  workspaceId?: string | null;
  windowHours?: number;
  includeSummary?: boolean;
}

export interface CalendarDigestEvaluation {
  candidate: CalendarDigestCandidate;
  config?: CalendarDigestConfig;
  configHash?: string;
}

/** Compare resource sets without changing hashes of already approved schedules. */
export function calendarDigestCandidateMatches(
  candidate: CalendarDigestCandidate | undefined,
  current: CalendarDigestEvaluation,
): candidate is CalendarDigestCandidate & { config: CalendarDigestConfig } {
  if (!candidate?.canAutoDigest || !candidate.config || !candidate.configPreview ||
      !current.config || !current.candidate.configPreview) return false;
  const ordered = <T extends { id: string }>(values: T[]) => [...values].sort((a, b) => a.id.localeCompare(b.id));
  const configHash = (config: CalendarDigestConfig) => computeCalendarDigestHash({ ...config, calendars: ordered(config.calendars) });
  const preview = (value: NonNullable<CalendarDigestCandidate['configPreview']>) => JSON.stringify({
    email: value.email,
    calendars: ordered(value.calendars).map(c => ({ id: c.id, summary: c.summary, primary: Boolean(c.primary) })),
    destinationService: value.destinationService,
    destinationId: value.destinationId,
    destinationLabel: value.destinationLabel,
  });
  return configHash(candidate.config) === configHash(current.config) &&
    preview(candidate.configPreview) === preview(current.candidate.configPreview);
}

export async function evaluateCalendarDigestCandidate(
  input: EvaluateCalendarDigestInput,
): Promise<CalendarDigestEvaluation> {
  const { pool, encryptionKey, userId, services, request } = input;
  const uniqueServices = [...new Set(services)];
  const hasCalendar = uniqueServices.includes('mycalendar') || uniqueServices.includes('calendar');
  const destService = uniqueServices.includes('slack')
    ? ('slack' as const)
    : uniqueServices.includes('telegram')
      ? ('telegram' as const)
      : null;

  if (!hasCalendar || !destService || uniqueServices.length !== 2) {
    return {
      candidate: {
        canAutoDigest: false,
        defaultMode: 'manual',
        disabledReason: 'Chế độ tự động gửi Bản tin Lịch chỉ áp dụng cho lịch kết hợp Google Calendar cá nhân với Slack hoặc Telegram.',
      },
    };
  }

  if (isCalendarWriteIntent(request)) {
    return {
      candidate: {
        canAutoDigest: false,
        defaultMode: 'manual',
        disabledReason: 'Yêu cầu có chứa thao tác tạo/chỉnh sửa dữ liệu nên cần duyệt thủ công mỗi lượt để đảm bảo an toàn.',
      },
    };
  }

  // 1. Check user's personal mycalendar connection
  const mycalRow = (
    await pool.query(
      "SELECT id, config, status FROM service_credentials WHERE service = 'mycalendar' AND user_id = $1 LIMIT 1",
      [userId],
    )
  ).rows[0];

  if (!mycalRow || mycalRow.status !== 'active') {
    return {
      candidate: {
        canAutoDigest: false,
        defaultMode: 'manual',
        disabledReason: 'Hãy kết nối Google Calendar cá nhân trước khi bật chế độ tự động gửi bản tin.',
      },
    };
  }
  if (
    input.mycalendarOAuthClientId &&
    encryptionKey &&
    !hasGoogleCredentialOrigin(mycalRow.config, encryptionKey, input.mycalendarOAuthClientId)
  ) {
    return {
      candidate: {
        canAutoDigest: false,
        defaultMode: 'manual',
        disabledReason: 'Kết nối Google Calendar cá nhân không khớp cấu hình OAuth hiện tại. Hãy kết nối lại.',
      },
    };
  }

  let email = '';
  let calendars: Array<{ id: string; summary: string; primary?: boolean }> = [];
  try {
    const decrypted = encryptionKey
      ? decryptCredentials(mycalRow.config, encryptionKey)
      : JSON.parse(mycalRow.config);
    email = typeof decrypted.email === 'string' ? decrypted.email : '';
    if (Array.isArray(decrypted.selectedCalendars) && decrypted.selectedCalendars.length > 0) {
      calendars = decrypted.selectedCalendars
        .filter((c: any) => typeof c?.id === 'string' && c.id)
        .map((c: any) => ({
          id: String(c.id),
          summary: typeof c.summary === 'string' && c.summary ? c.summary : String(c.id),
          ...(c.primary ? { primary: true } : {}),
        }));
    } else if (Array.isArray(decrypted.allowedScope?.calendars)) {
      calendars = decrypted.allowedScope.calendars
        .filter((id: unknown) => typeof id === 'string' && id)
        .map((id: string) => ({ id, summary: id }));
    }
  } catch {
    return {
      candidate: {
        canAutoDigest: false,
        defaultMode: 'manual',
        disabledReason: 'Không đọc được cấu hình Google Calendar cá nhân. Hãy kết nối lại.',
      },
    };
  }

  if (!email || calendars.length < 1 || calendars.length > 5) {
    return {
      candidate: {
        canAutoDigest: false,
        defaultMode: 'manual',
        disabledReason: 'Hãy chọn từ 1 đến 5 lịch Google Calendar cá nhân trong phần Cài đặt trước khi bật tự động gửi.',
      },
    };
  }

  // 2. Check destination service (workspace-scoped slack or personal telegram)
  const targetWorkspaceId = input.workspaceMode === 'organization' ? input.workspaceId ?? null : null;
  if (destService === 'slack' && input.workspaceMode === 'organization' && !targetWorkspaceId) {
    return {
      candidate: {
        canAutoDigest: false,
        defaultMode: 'manual',
        disabledReason: 'Không xác định được workspace tổ chức cho kênh Slack nhận bản tin.',
      },
    };
  }
  const destRow =
    destService === 'telegram'
      ? (
          await pool.query(
            'SELECT id, config, status FROM service_credentials WHERE service = $1 AND user_id = $2 LIMIT 1',
            [destService, userId],
          )
        ).rows[0]
      : await findSlackDigestCredential(pool, {
          userId,
          workspaceMode: input.workspaceMode,
          workspaceId: targetWorkspaceId,
        });

  if (!destRow || destRow.status !== 'active') {
    return {
      candidate: {
        canAutoDigest: false,
        defaultMode: 'manual',
        disabledReason: `Dịch vụ ${destService === 'slack' ? 'Slack' : 'Telegram'} chưa được kích hoạt.`,
      },
    };
  }

  let destAllowedScope: any = {};
  let destSelectedChats: Array<{ chatId: string; title?: string }> = [];
  try {
    const decryptedDest = encryptionKey
      ? decryptCredentials(destRow.config, encryptionKey)
      : JSON.parse(destRow.config);
    destAllowedScope = decryptedDest?.allowedScope ?? {};
    if (Array.isArray(decryptedDest?.selectedChats)) {
      destSelectedChats = decryptedDest.selectedChats
        .filter((c: any) => typeof c?.chatId === 'string' && TELEGRAM_CHAT_ID_RE.test(c.chatId))
        .map((c: any) => ({
          chatId: String(c.chatId),
          ...(typeof c?.title === 'string' && c.title.trim() ? { title: c.title.trim() } : {}),
        }));
    }
  } catch {
    return {
      candidate: {
        canAutoDigest: false,
        defaultMode: 'manual',
        disabledReason: `Không đọc được cấu hình ${destService === 'slack' ? 'Slack' : 'Telegram'}.`,
      },
    };
  }

  if (destService === 'slack') {
    const rawChannels = Array.isArray(destAllowedScope?.channels)
      ? destAllowedScope.channels
      : Array.isArray(destAllowedScope)
        ? destAllowedScope
        : [];
    const channels: string[] = rawChannels.filter(
      (c: unknown) => typeof c === 'string' && SLACK_CHANNEL_ID_RE.test(c),
    );
    if (channels.length !== 1) {
      return {
        candidate: {
          canAutoDigest: false,
          defaultMode: 'manual',
          disabledReason: 'Chế độ tự gửi chỉ bật khi phạm vi Slack được khóa vào đúng 1 kênh.',
        },
      };
    }
    const channelId = channels[0]!;
    const config: CalendarDigestConfig = {
      version: 1,
      source: 'mycalendar',
      credentialId: mycalRow.id,
      email,
      calendars,
      destination: { service: 'slack', channelId },
      windowHours: input.windowHours ?? 24,
      includeSummary: input.includeSummary ?? true,
    };
    return {
      candidate: {
        canAutoDigest: true,
        defaultMode: 'manual',
        config,
        configPreview: {
          email,
          calendars,
          destinationService: 'slack',
          destinationId: channelId,
          destinationLabel: `#${channelId}`,
        },
      },
      config,
      configHash: computeCalendarDigestHash(config),
    };
  }

  const rawChats = Array.isArray(destAllowedScope?.chats)
    ? destAllowedScope.chats
    : Array.isArray(destAllowedScope)
      ? destAllowedScope
      : [];
  const scopeChats: string[] = rawChats.filter(
    (c: unknown) => typeof c === 'string' && TELEGRAM_CHAT_ID_RE.test(c),
  );
  const chatMap = new Map<string, { chatId: string; title?: string }>();
  for (const c of destSelectedChats) {
    chatMap.set(c.chatId, c);
  }
  for (const id of scopeChats) {
    if (!chatMap.has(id)) chatMap.set(id, { chatId: id });
  }
  const chats = Array.from(chatMap.values());
  if (chats.length === 0) {
    return {
      candidate: {
        canAutoDigest: false,
        defaultMode: 'manual',
        disabledReason: 'Telegram cá nhân chưa có nhóm/chat nào trong phạm vi được phép gửi.',
      },
    };
  }
  let chosenChat: { chatId: string; title?: string } | undefined;
  if (chats.length === 1) {
    chosenChat = chats[0];
  } else {
    const reqLower = request.toLocaleLowerCase();
    const matched = chats.filter(
      (c) =>
        reqLower.includes(c.chatId.toLocaleLowerCase()) ||
        (typeof c.title === 'string' && c.title.trim() !== '' && reqLower.includes(c.title.trim().toLocaleLowerCase())),
    );
    if (matched.length === 1) chosenChat = matched[0];
  }
  if (!chosenChat) {
    return {
      candidate: {
        canAutoDigest: false,
        defaultMode: 'manual',
        disabledReason: 'Hãy nêu rõ tên hoặc mã cuộc trò chuyện Telegram nhận bản tin trong yêu cầu để khóa đúng 1 đích gửi.',
      },
    };
  }
  const chatId = chosenChat.chatId;
  const chatTitle = chosenChat.title;
  const config: CalendarDigestConfig = {
    version: 1,
    source: 'mycalendar',
    credentialId: mycalRow.id,
    email,
    calendars,
    destination: {
      service: 'telegram',
      chatId,
      ...(chatTitle ? { chatTitle } : {}),
      ...(destRow.id ? { credentialId: String(destRow.id) } : {}),
    },
    windowHours: input.windowHours ?? 24,
    includeSummary: input.includeSummary ?? true,
  };
  return {
    candidate: {
      canAutoDigest: true,
      defaultMode: 'manual',
      config,
      configPreview: {
        email,
        calendars,
        destinationService: 'telegram',
        destinationId: chatId,
        destinationLabel: chatTitle ?? `Telegram (${chatId})`,
      },
    },
    config,
    configHash: computeCalendarDigestHash(config),
  };
}
