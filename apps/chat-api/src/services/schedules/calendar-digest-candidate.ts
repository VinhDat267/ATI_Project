import { createHash } from 'node:crypto';
import { decryptCredentials } from '@wap/tool-adapters';
import type { CalendarDigestCandidate, CalendarDigestConfig } from '@wap/tool-schemas';
import type { Queryable } from '../../db/repositories/schedule-repo.js';

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
          },
    windowHours: config.windowHours,
    includeSummary: config.includeSummary,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export interface EvaluateCalendarDigestInput {
  pool: Queryable;
  encryptionKey?: string;
  userId: string;
  services: string[];
  request: string;
  windowHours?: number;
  includeSummary?: boolean;
}

export interface CalendarDigestEvaluation {
  candidate: CalendarDigestCandidate;
  config?: CalendarDigestConfig;
  configHash?: string;
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

  // 2. Check destination service (slack or telegram)
  const destRow = (
    await pool.query(
      destService === 'telegram'
        ? 'SELECT config, status FROM service_credentials WHERE service = $1 AND (user_id = $2 OR user_id IS NULL) ORDER BY user_id IS NULL ASC LIMIT 1'
        : 'SELECT config, status FROM service_credentials WHERE service = $1 AND user_id IS NULL LIMIT 1',
      destService === 'telegram' ? [destService, userId] : [destService],
    )
  ).rows[0];

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
  try {
    const decryptedDest = encryptionKey
      ? decryptCredentials(destRow.config, encryptionKey)
      : JSON.parse(destRow.config);
    destAllowedScope = decryptedDest?.allowedScope ?? {};
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
  const chats: string[] = rawChats.filter(
    (c: unknown) => typeof c === 'string' && TELEGRAM_CHAT_ID_RE.test(c),
  );
  if (chats.length !== 1) {
    return {
      candidate: {
        canAutoDigest: false,
        defaultMode: 'manual',
        disabledReason: 'Chế độ tự gửi chỉ bật khi phạm vi Telegram được khóa vào đúng 1 nhóm/chat.',
      },
    };
  }
  const chatId = chats[0]!;
  const config: CalendarDigestConfig = {
    version: 1,
    source: 'mycalendar',
    credentialId: mycalRow.id,
    email,
    calendars,
    destination: { service: 'telegram', chatId },
    windowHours: input.windowHours ?? 24,
    includeSummary: input.includeSummary ?? true,
  };
  return {
    candidate: {
      canAutoDigest: true,
      defaultMode: 'manual',
      configPreview: {
        email,
        calendars,
        destinationService: 'telegram',
        destinationId: chatId,
        destinationLabel: `Telegram (${chatId})`,
      },
    },
    config,
    configHash: computeCalendarDigestHash(config),
  };
}
