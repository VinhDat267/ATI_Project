import type pg from 'pg';
import { decryptCredentials, detectCalendarConflicts, SlackAdapter, StepError, TelegramAdapter, type CalendarEventWithConflict } from '@wap/tool-adapters';
import type { CalendarDigestConfig, CalendarDigestDelivery } from '@wap/tool-schemas';
import { computeCalendarDigestHash } from './calendar-digest-candidate.js';
import { findSlackDigestCredential } from './multi-source-digest-candidate.js';
import { localLabel } from './next-occurrence.js';
import type { RunToPlan } from './schedule-runner.js';
import { slackMrkdwnToTelegramPlain } from './telegram-plain-text.js';
import { buildSlackMarkdownDigestBlocks } from '../slack/slack-digest-blocks.js';
import { isGoogleConnectionChanged } from '../gmail/token-manager.js';
import type { AdapterContext } from '../adapter-factory.js';

export const CALENDAR_DELIVERY_UNKNOWN = 'Chưa xác định bản tin lịch đã gửi hay chưa. Hãy kiểm tra kênh nhận trước khi gửi thêm; lượt này không tự gửi lại.';
export const MAX_DIGEST_DISPLAY_EVENTS = 20;
export const MAX_DIGEST_MESSAGE_CHARS = 3900;

export type CalendarCoverageStatus = 'complete' | 'partial' | 'unknown';

export interface CalendarListEventsCoverage {
  complete: boolean;
  returned: number;
  totalAvailable: number | null;
  reason?: string;
}

export interface CalendarDigestCoverageItem {
  calendarId: string;
  calendarSummary: string;
  status: CalendarCoverageStatus;
  returned: number;
  totalAvailable: number | null;
  reason?: string;
  titleClipped?: boolean;
}

export function escapeDigestText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/@(channel|here|everyone)\b/giu, '@\u200b$1');
}

export interface EnrichedDigestEvent extends CalendarEventWithConflict {
  calendarId: string;
  calendarSummary: string;
}

export type DigestRunOutcome =
  | { state: 'digest_sent'; delivery: CalendarDigestDelivery; messageText: string }
  | { state: 'digest_failed'; error: string }
  | { state: 'delivery_unknown'; error: string }
  | { state: 'blocked'; pauseReason: string }
  | { state: 'discarded' };

export type RunCalendarDigest = (
  run: RunToPlan & {
    digestConfig: CalendarDigestConfig | null;
    digestConfigHash: string | null;
  },
  signal: AbortSignal,
) => Promise<DigestRunOutcome>;

export interface CalendarDigestExecutorOptions {
  pool: pg.Pool;
  encryptionKey?: string;
  timeZone: string;
  getAdapter: (serviceName: string, context?: any) => Promise<any> | any;
  summarizeDigest?: (events: EnrichedDigestEvent[], signal: AbortSignal) => Promise<string>;
  readTimeoutMs?: number;
  summaryTimeoutMs?: number;
}

function localWallParts(
  at: Date,
  timeZone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  isoOffset: string;
} {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const rawOffset = (parts.timeZoneName ?? 'GMT+00:00').replace(/^GMT/, '');
  const isoOffset = rawOffset === '' || rawOffset === '+0' || rawOffset === '-0' ? '+00:00' : rawOffset;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    isoOffset,
  };
}

function formatInstantInTimeZone(at: Date, timeZone: string): string {
  const p = localWallParts(at, timeZone);
  const y = String(p.year).padStart(4, '0');
  const m = String(p.month).padStart(2, '0');
  const d = String(p.day).padStart(2, '0');
  const hh = String(p.hour).padStart(2, '0');
  const mm = String(p.minute).padStart(2, '0');
  const ss = String(p.second).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}${p.isoOffset}`;
}

function resolveLocalMidnightInstant(year: number, month: number, day: number, timeZone: string): Date {
  const targetMidnightUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  let guessMs = targetMidnightUtc;
  for (let i = 0; i < 4; i++) {
    const p = localWallParts(new Date(guessMs), timeZone);
    const observedUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
    const diffMs = targetMidnightUtc - observedUtc;
    if (diffMs === 0) break;
    guessMs += diffMs;
  }
  return new Date(guessMs);
}

export function buildDayWindow(
  dueAt: Date,
  windowHours: number,
  timeZone = 'Asia/Ho_Chi_Minh',
): { timeMin: string; timeMax: string } {
  const safeTz = timeZone || 'Asia/Ho_Chi_Minh';
  const dueLocal = localWallParts(dueAt, safeTz);
  const startDate = resolveLocalMidnightInstant(dueLocal.year, dueLocal.month, dueLocal.day, safeTz);

  const hours = Math.min(Math.max(1, windowHours || 24), 168);
  const wholeDays = Math.floor(hours / 24);
  const remainderHours = hours % 24;

  const targetEndDayUtc = new Date(Date.UTC(dueLocal.year, dueLocal.month - 1, dueLocal.day + wholeDays, 0, 0, 0, 0));
  const endDayMidnight = resolveLocalMidnightInstant(
    targetEndDayUtc.getUTCFullYear(),
    targetEndDayUtc.getUTCMonth() + 1,
    targetEndDayUtc.getUTCDate(),
    safeTz,
  );
  const endDate = new Date(endDayMidnight.getTime() + remainderHours * 3_600_000);

  return {
    timeMin: formatInstantInTimeZone(startDate, safeTz),
    timeMax: formatInstantInTimeZone(endDate, safeTz),
  };
}

export function normalizeCalendarReadCoverage(
  calendarId: string,
  calendarSummary: string,
  res: unknown,
  items: CalendarEventWithConflict[],
): CalendarDigestCoverageItem {
  const rawObj = res && typeof res === 'object' ? (res as Record<string, unknown>) : {};
  const rawCov = rawObj.coverage;
  const titleClipped = items.some((ev) => typeof ev?.title === 'string' && ev.title.length >= 200);

  if (!rawCov || typeof rawCov !== 'object') {
    return {
      calendarId,
      calendarSummary,
      status: 'unknown',
      returned: items.length,
      totalAvailable: null,
      reason: 'missing_coverage_metadata',
      ...(titleClipped ? { titleClipped: true } : {}),
    };
  }

  const cov = rawCov as Record<string, unknown>;
  const completeField = cov.complete;
  const returnedField = cov.returned;
  const totalAvailableField = cov.totalAvailable;
  const reasonField = typeof cov.reason === 'string' && cov.reason.trim() ? cov.reason.trim() : undefined;

  if (typeof completeField !== 'boolean' || typeof returnedField !== 'number' || !Number.isFinite(returnedField)) {
    return {
      calendarId,
      calendarSummary,
      status: 'unknown',
      returned: items.length,
      totalAvailable: null,
      reason: 'malformed_coverage_metadata',
      ...(titleClipped ? { titleClipped: true } : {}),
    };
  }

  const validTotalAvailable =
    typeof totalAvailableField === 'number' && Number.isFinite(totalAvailableField) && totalAvailableField >= items.length
      ? totalAvailableField
      : null;

  const isVerifiablyComplete =
    completeField === true &&
    returnedField === items.length &&
    items.length <= MAX_DIGEST_DISPLAY_EVENTS &&
    (validTotalAvailable === null || validTotalAvailable === items.length);

  if (isVerifiablyComplete) {
    return {
      calendarId,
      calendarSummary,
      status: 'complete',
      returned: items.length,
      totalAvailable: validTotalAvailable ?? items.length,
      ...(reasonField ? { reason: reasonField } : {}),
      ...(titleClipped ? { titleClipped: true } : {}),
    };
  }

  const partialTotalAvailable =
    validTotalAvailable !== null && validTotalAvailable > items.length ? validTotalAvailable : null;

  return {
    calendarId,
    calendarSummary,
    status: 'partial',
    returned: items.length,
    totalAvailable: partialTotalAvailable,
    reason: reasonField ?? (items.length > MAX_DIGEST_DISPLAY_EVENTS ? 'display_cap_exceeded' : 'incomplete_window'),
    ...(titleClipped ? { titleClipped: true } : {}),
  };
}

function summarizeOverallCoverage(
  calendarsChecked: number,
  events: EnrichedDigestEvent[],
  calendarCoverages?: CalendarDigestCoverageItem[],
): {
  overallStatus: CalendarCoverageStatus;
  items: CalendarDigestCoverageItem[];
  hasClippedTitles: boolean;
} {
  const titleClippedFromEvents = events.some((ev) => typeof ev?.title === 'string' && ev.title.length >= 200);
  if (!calendarCoverages || calendarCoverages.length === 0) {
    if (events.length > MAX_DIGEST_DISPLAY_EVENTS) {
      return {
        overallStatus: 'partial',
        items: [],
        hasClippedTitles: titleClippedFromEvents,
      };
    }
    return {
      overallStatus: 'unknown',
      items: [],
      hasClippedTitles: titleClippedFromEvents,
    };
  }

  const hasClippedTitles = titleClippedFromEvents || calendarCoverages.some((c) => c.titleClipped === true);
  if (calendarCoverages.length < calendarsChecked) {
    return {
      overallStatus: 'unknown',
      items: calendarCoverages,
      hasClippedTitles,
    };
  }

  const hasPartial = calendarCoverages.some((c) => c.status === 'partial');
  const hasUnknown = calendarCoverages.some((c) => c.status === 'unknown');

  if (hasPartial) {
    return { overallStatus: 'partial', items: calendarCoverages, hasClippedTitles };
  }
  if (hasUnknown) {
    return { overallStatus: 'unknown', items: calendarCoverages, hasClippedTitles };
  }
  return { overallStatus: 'complete', items: calendarCoverages, hasClippedTitles };
}

function formatEventDetailLine(ev: EnrichedDigestEvent): string {
  const conflictNote =
    ev.conflict && ev.conflictsWith?.length
      ? ` [⚠️ Trùng giờ với: ${ev.conflictsWith.map((t) => escapeDigestText(t)).join(', ')}]`
      : '';
  const extras: string[] = [];
  if (ev.meetLink) extras.push(`🎥 Meet: ${escapeDigestText(ev.meetLink)}`);
  if (ev.location) extras.push(`📍 ${escapeDigestText(ev.location)}`);
  if (typeof ev.attendeesCount === 'number' && ev.attendeesCount > 0) {
    extras.push(`👥 ${ev.attendeesCount} người tham dự`);
  }
  const extraSuffix = extras.length > 0 ? ` — ${extras.join(' | ')}` : '';
  return `- [${escapeDigestText(ev.calendarSummary)}] ${escapeDigestText(ev.title)} (${ev.start} → ${ev.end})${extraSuffix}${conflictNote}`;
}

export function formatCalendarDigestMessage(input: {
  scheduleName: string;
  dueAt: Date;
  timeZone: string;
  calendarsChecked: number;
  events: EnrichedDigestEvent[];
  summaryText?: string;
  calendarCoverages?: CalendarDigestCoverageItem[];
}): { text: string; conflictCount: number } {
  const { scheduleName, dueAt, timeZone, calendarsChecked, events, summaryText, calendarCoverages } = input;
  const conflicting = events.filter((e) => e.conflict === true);
  const { overallStatus, items: coverageItems, hasClippedTitles } = summarizeOverallCoverage(
    calendarsChecked,
    events,
    calendarCoverages,
  );

  const candidateDisplayLimit = Math.min(events.length, MAX_DIGEST_DISPLAY_EVENTS);

  const buildMessageForDisplayCount = (displayedCount: number): string => {
    const observedCount = events.length;
    const isDisplayClipped = displayedCount < observedCount;
    const canIncludeSummary = overallStatus === 'complete' && !isDisplayClipped;

    const lines: string[] = [
      `📅 Bản tin Lịch làm việc: ${escapeDigestText(scheduleName)} (${localLabel(dueAt, timeZone)})`,
    ];

    if (overallStatus === 'complete') {
      lines.push(
        `• Tổng số sự kiện: ${observedCount} trên ${calendarsChecked} lịch (độ phủ: COMPLETE — đã đọc ${observedCount}/${observedCount}, hiển thị ${displayedCount}/${observedCount})`,
      );
    } else if (overallStatus === 'partial') {
      const allHaveTotal =
        coverageItems.length === calendarsChecked &&
        coverageItems.every((c) => typeof c.totalAvailable === 'number' && Number.isFinite(c.totalAvailable));
      const knownTotalSum = allHaveTotal
        ? coverageItems.reduce((acc, c) => acc + (c.totalAvailable ?? 0), 0)
        : null;
      const totalLabel =
        knownTotalSum !== null && knownTotalSum > observedCount ? String(knownTotalSum) : 'UNKNOWN';
      lines.push(
        `• Số sự kiện ghi nhận: ${observedCount} sự kiện đã đọc trên ${calendarsChecked} lịch (độ phủ: PARTIAL — tổng số thực tế: ${totalLabel}, hiển thị ${displayedCount}/${observedCount})`,
      );
    } else {
      lines.push(
        `• Số sự kiện ghi nhận: ${observedCount} sự kiện đã đọc trên ${calendarsChecked} lịch (độ phủ: UNKNOWN — tổng số thực tế: UNKNOWN, hiển thị ${displayedCount}/${observedCount})`,
      );
    }

    if (overallStatus !== 'complete' && coverageItems.length > 0) {
      const perCalNotes = coverageItems.map((c) => {
        if (c.status === 'complete') {
          return `${escapeDigestText(c.calendarSummary)}: đầy đủ (${c.returned}/${c.totalAvailable ?? c.returned})`;
        }
        if (c.status === 'partial') {
          const countPart =
            c.totalAvailable !== null && c.totalAvailable > c.returned
              ? `${c.returned}/${c.totalAvailable}`
              : `${c.returned} sự kiện đã đọc`;
          return `${escapeDigestText(c.calendarSummary)}: một phần (${countPart})`;
        }
        return `${escapeDigestText(c.calendarSummary)}: UNKNOWN (${c.returned} sự kiện đã đọc)`;
      });
      lines.push(`• ℹ️ Độ phủ từng lịch: ${perCalNotes.join('; ')}`);
    }

    if (hasClippedTitles) {
      lines.push('• ℹ️ Một số tiêu đề sự kiện dài từ nguồn dữ liệu đã được rút gọn ở mức 200 ký tự.');
    }

    if (conflicting.length > 0) {
      const scopeSuffix =
        overallStatus === 'complete'
          ? ''
          : ` (ghi nhận trong ${observedCount} sự kiện đã đọc — độ phủ ${overallStatus === 'partial' ? 'PARTIAL' : 'UNKNOWN'})`;
      lines.push(`• ⚠️ Cảnh báo trùng lịch: ${conflicting.length} sự kiện bị giao giờ họp${scopeSuffix}`);
    } else if (overallStatus === 'complete') {
      lines.push('• ✅ Không có xung đột giờ họp');
    } else {
      const aggTag = overallStatus === 'partial' ? 'PARTIAL' : 'UNKNOWN';
      lines.push(
        `• ⚠️ Chưa thể kết luận lịch trống xung đột: 0 trùng giờ trong ${observedCount} sự kiện đã đọc, nhưng độ phủ dữ liệu là ${aggTag} (còn sự kiện chưa quét hoặc chưa rõ độ phủ)`,
      );
    }

    if (canIncludeSummary && summaryText && summaryText.trim()) {
      lines.push('', `💡 Tóm tắt nhanh: ${escapeDigestText(summaryText.trim().slice(0, 600))}`);
    }

    if (observedCount === 0) {
      if (overallStatus === 'complete') {
        lines.push('', 'Hôm nay bạn không có sự kiện nào trong khung giờ đã chọn.');
      } else {
        lines.push(
          '',
          'Chưa ghi nhận sự kiện trong dữ liệu đã đọc, nhưng độ phủ lịch chưa xác nhận đầy đủ.',
        );
      }
    } else {
      lines.push('', 'Chi tiết lịch trình:');
      for (const ev of events.slice(0, displayedCount)) {
        lines.push(formatEventDetailLine(ev));
      }
      if (displayedCount < observedCount) {
        const omittedCount = observedCount - displayedCount;
        const omittedConflictCount = events.slice(displayedCount).filter((e) => e.conflict === true).length;
        const conflictTailNote =
          omittedConflictCount > 0
            ? `, bao gồm ${omittedConflictCount} sự kiện trùng giờ ngoài danh sách hiển thị`
            : '';
        lines.push(
          `… Đã lược bớt ${omittedCount} sự kiện ngoài giới hạn hiển thị (hiển thị ${displayedCount}/${observedCount} sự kiện đã đọc${conflictTailNote}).`,
        );
      }
    }

    return lines.join('\n');
  };

  let displayedCount = candidateDisplayLimit;
  let text = buildMessageForDisplayCount(displayedCount);
  while (text.length > MAX_DIGEST_MESSAGE_CHARS && displayedCount > 0) {
    displayedCount--;
    text = buildMessageForDisplayCount(displayedCount);
  }
  if (text.length > MAX_DIGEST_MESSAGE_CHARS) {
    text = text.slice(0, MAX_DIGEST_MESSAGE_CHARS);
  }

  return {
    text,
    conflictCount: conflicting.length,
  };
}

export function createCalendarDigestExecutor(options: CalendarDigestExecutorOptions): RunCalendarDigest {
  const readTimeoutMs = options.readTimeoutMs ?? 30_000;
  const summaryTimeoutMs = options.summaryTimeoutMs ?? 10_000;

  return async (run, signal): Promise<DigestRunOutcome> => {
    const config = run.digestConfig;
    const expectedHash = run.digestConfigHash;
    if (!config || !expectedHash || computeCalendarDigestHash(config) !== expectedHash) {
      return {
        state: 'blocked',
        pauseReason: 'Cấu hình bản tin lịch không còn hợp lệ.',
      };
    }

    // 1. Pre-Read Gate: verify personal mycalendar connection & scope
    const mycalRow = (
      await options.pool.query(
        "SELECT id, config, status FROM service_credentials WHERE service = 'mycalendar' AND user_id = $1 LIMIT 1",
        [run.userId],
      )
    ).rows[0];

    if (!mycalRow || mycalRow.status !== 'active' || mycalRow.id !== config.credentialId) {
      return {
        state: 'blocked',
        pauseReason: 'Kết nối Google Calendar cá nhân đã thay đổi hoặc cần kết nối lại.',
      };
    }

    let allowedCalendarSet = new Set<string>();
    try {
      const decrypted = options.encryptionKey
        ? decryptCredentials(mycalRow.config, options.encryptionKey)
        : JSON.parse(mycalRow.config);
      const ids: string[] = Array.isArray(decrypted.allowedScope?.calendars)
        ? decrypted.allowedScope.calendars
        : Array.isArray(decrypted.selectedCalendars)
          ? decrypted.selectedCalendars.map((c: any) => c.id)
          : [];
      allowedCalendarSet = new Set(ids);
    } catch {
      return {
        state: 'blocked',
        pauseReason: 'Không đọc được cấu hình Google Calendar cá nhân.',
      };
    }

    if (
      config.calendars.length < 1 ||
      config.calendars.length > 5 ||
      config.calendars.some((c) => !allowedCalendarSet.has(c.id))
    ) {
      return {
        state: 'blocked',
        pauseReason: 'Danh sách lịch Google Calendar được cấp quyền đã thay đổi.',
      };
    }

    // Verify destination service (workspace-scoped Slack or personal Telegram)
    const destService = config.destination.service;
    const schedMeta =
      destService === 'slack'
        ? (await options.pool.query('SELECT workspace_id, workspace_mode FROM schedules WHERE id = $1', [run.scheduleId])).rows[0]
        : undefined;
    const scheduleWorkspaceId: string | null = schedMeta?.workspace_id ?? null;
    const scheduleWorkspaceMode: string | null = schedMeta?.workspace_mode ?? null;
    const destRow =
      destService === 'telegram'
        ? (
            await options.pool.query(
              'SELECT id, user_id, config, status FROM service_credentials WHERE service = $1 AND user_id = $2 LIMIT 1',
              [destService, run.userId],
            )
          ).rows[0]
        : await findSlackDigestCredential(options.pool, {
            userId: run.userId,
            workspaceMode: scheduleWorkspaceMode,
            workspaceId: scheduleWorkspaceId,
          });

    if (!destRow || destRow.status !== 'active') {
      return {
        state: 'blocked',
        pauseReason: `Dịch vụ ${destService === 'slack' ? 'Slack' : 'Telegram'} không còn hoạt động.`,
      };
    }

    if (
      config.destination.service === 'telegram' &&
      config.destination.credentialId &&
      String(destRow.id) !== config.destination.credentialId
    ) {
      return {
        state: 'blocked',
        pauseReason: 'Kết nối Telegram đã thay đổi kể từ lúc duyệt lịch.',
      };
    }

    let slackDestContext: Pick<AdapterContext, 'workspaceMode' | 'workspaceId' | 'expectedCredential'> | undefined;
    let telegramDestBinding:
      | { credentialId: string; telegramUserId: string; username: string; chatIds: string[] }
      | undefined;
    try {
      const decryptedDest = options.encryptionKey
        ? decryptCredentials(destRow.config, options.encryptionKey)
        : JSON.parse(destRow.config);
      const scopeObj = decryptedDest?.allowedScope ?? {};
      if (config.destination.service === 'slack') {
        const channels: string[] = Array.isArray(scopeObj?.channels)
          ? scopeObj.channels
          : Array.isArray(scopeObj)
            ? scopeObj
            : [];
        if (!channels.includes(config.destination.channelId)) {
          return {
            state: 'blocked',
            pauseReason: 'Kênh Slack nhận bản tin không còn nằm trong phạm vi cho phép.',
          };
        }
        // Resolve the adapter in the scope of the credential that passed this gate.
        // A personal schedule can select the legacy row when its owner has no active Slack credential.
        slackDestContext = {
          ...(destRow.workspace_id
            ? { workspaceMode: 'organization', workspaceId: destRow.workspace_id }
            : { workspaceMode: destRow.user_id ? 'personal' : 'legacy' }),
          expectedCredential: { id: destRow.id, config: destRow.config },
        };
      } else {
        const scopeChats: string[] = Array.isArray(scopeObj?.chats)
          ? scopeObj.chats
          : Array.isArray(scopeObj)
            ? scopeObj
            : [];
        const selectedChatIds: string[] = Array.isArray(decryptedDest?.selectedChats)
          ? decryptedDest.selectedChats
              .map((c: any) => (typeof c?.chatId === 'string' ? c.chatId : ''))
              .filter(Boolean)
          : [];
        const chats = new Set([...scopeChats, ...selectedChatIds]);
        if (!chats.has(config.destination.chatId)) {
          return {
            state: 'blocked',
            pauseReason: 'Nhóm Telegram nhận bản tin không còn nằm trong phạm vi cho phép.',
          };
        }
        if (destRow.user_id && destRow.id) {
          telegramDestBinding = {
            credentialId: String(destRow.id),
            telegramUserId:
              typeof decryptedDest?.telegramUserId === 'string' ? decryptedDest.telegramUserId : '',
            username: typeof decryptedDest?.username === 'string' ? decryptedDest.username : '',
            chatIds: [config.destination.chatId],
          };
        }
      }
    } catch {
      return {
        state: 'blocked',
        pauseReason: 'Không kiểm tra được phạm vi kênh nhận bản tin.',
      };
    }

    // 2. Bounded Read from Google Calendar (30s AbortSignal)
    const readController = new AbortController();
    const readTimer = setTimeout(() => readController.abort(), readTimeoutMs);
    const readSignal = AbortSignal.any([signal, readController.signal]);

    const rawEvents: EnrichedDigestEvent[] = [];
    const calendarCoverages: CalendarDigestCoverageItem[] = [];
    try {
      const { timeMin, timeMax } = buildDayWindow(run.dueAt, config.windowHours, options.timeZone);
      const mycalAdapter = await options.getAdapter('mycalendar', {
        userId: run.userId,
        phase: 'execution',
        actor: { userId: run.userId },
        connections: {
          mycalendar: {
            credentialId: config.credentialId,
            email: config.email,
            allowedCalendars: config.calendars.map((c) => c.id),
          },
        },
      });
      if (!mycalAdapter) {
        return { state: 'digest_failed', error: 'Không khởi tạo được kết nối Google Calendar.' };
      }

      for (const cal of config.calendars) {
        readSignal.throwIfAborted();
        const res = await mycalAdapter.execute(
          'mycalendar.list_events',
          {
            calendarId: cal.id,
            timeMin,
            timeMax,
            limit: MAX_DIGEST_DISPLAY_EVENTS,
          },
          { signal: readSignal },
        );
        if (!res || typeof res !== 'object' || !Array.isArray((res as any).events)) {
          throw new Error('Malformed calendar list_events response');
        }
        const items: CalendarEventWithConflict[] = (res as any).events;
        calendarCoverages.push(normalizeCalendarReadCoverage(cal.id, cal.summary, res, items));
        for (const item of items) {
          rawEvents.push({
            ...item,
            calendarId: cal.id,
            calendarSummary: cal.summary,
          });
        }
      }
    } catch (err) {
      if (
        (err instanceof StepError &&
          (err.category === 'AUTH_ERROR' || err.statusCode === 401 || err.statusCode === 403)) ||
        isGoogleConnectionChanged(err)
      ) {
        return {
          state: 'blocked',
          pauseReason:
            'Kết nối Google Calendar cá nhân không còn hợp lệ hoặc đã hết hạn. Hãy kết nối lại Google Calendar trong Cài đặt.',
        };
      }
      return {
        state: 'digest_failed',
        error: 'Không đọc được dữ liệu từ Google Calendar. Sẽ thử lại ở lượt tiếp theo.',
      };
    } finally {
      clearTimeout(readTimer);
    }

    const enrichedEvents = detectCalendarConflicts(rawEvents, {
      annotateConflicts: true,
      timeZone: options.timeZone,
    });
    const allCalendarsComplete =
      calendarCoverages.length === config.calendars.length &&
      calendarCoverages.every((c) => c.status === 'complete') &&
      enrichedEvents.length <= MAX_DIGEST_DISPLAY_EVENTS;

    // 3. Optional Bounded AI Summary (10s AbortSignal) — suppressed when coverage is partial or unknown
    let summaryText: string | undefined;
    let summaryIncluded = false;
    if (allCalendarsComplete && config.includeSummary && options.summarizeDigest && enrichedEvents.length > 0) {
      const summaryController = new AbortController();
      const summaryTimer = setTimeout(() => summaryController.abort(), summaryTimeoutMs);
      const summarySignal = AbortSignal.any([signal, summaryController.signal]);
      try {
        const abortPromise = new Promise<never>((_resolve, reject) => {
          summarySignal.addEventListener('abort', () => reject(new Error('Summary aborted')), { once: true });
        });
        const generated = await Promise.race([
          options.summarizeDigest(enrichedEvents, summarySignal),
          abortPromise,
        ]);
        if (typeof generated === 'string' && generated.trim()) {
          summaryText = generated.trim();
          summaryIncluded = true;
        }
      } catch {
        // Fallback gracefully without summary when AI summary times out or fails
        summaryText = undefined;
        summaryIncluded = false;
      } finally {
        clearTimeout(summaryTimer);
      }
    }

    // 4. Format and sanitize digest message
    const formatted = formatCalendarDigestMessage({
      scheduleName: run.name,
      dueAt: run.dueAt,
      timeZone: options.timeZone,
      calendarsChecked: config.calendars.length,
      events: enrichedEvents,
      summaryText,
      calendarCoverages,
    });

    // 5. Pre-Send Version Check (abort before sending if schedule changed or was cancelled)
    const currentSched = (
      await options.pool.query('SELECT version, status FROM schedules WHERE id = $1', [run.scheduleId])
    ).rows[0];
    if (!currentSched || currentSched.version !== run.scheduleVersion || currentSched.status === 'cancelled') {
      return { state: 'discarded' };
    }

    // 6. Send to locked Slack channel or Telegram chat
    let deliveryStarted = false;
    let discarded = false;
    try {
      const destAdapter = await options.getAdapter(destService, {
        userId: run.userId,
        phase: 'execution',
        actor: { userId: run.userId },
        ...slackDestContext,
        ...(telegramDestBinding ? { connections: { telegram: telegramDestBinding } } : {}),
      });
      if (!destAdapter) {
        return {
          state: 'digest_failed',
          error: `Không khởi tạo được kết nối ${destService === 'slack' ? 'Slack' : 'Telegram'}.`,
        };
      }
      const claimDelivery = async () => {
        signal.throwIfAborted();
        const expectedCredential = slackDestContext?.expectedCredential;
        const marked = await options.pool.query(
          `UPDATE schedule_runs r SET delivery_started_at=now(), updated_at=now(),
               dispatched_config=COALESCE(r.dispatched_config, $4::jsonb),
               dispatched_config_hash=COALESCE(r.dispatched_config_hash, $5)
           FROM schedules s WHERE r.id=$1 AND r.schedule_id=s.id AND s.id=$2
             AND r.status='planning' AND r.delivery_started_at IS NULL AND r.schedule_version=$3
             AND s.version=$3 AND s.kind='calendar_digest' AND s.user_id=$6
             AND s.digest_config=$4::jsonb AND s.digest_config_hash=$5
             AND (s.status='active' OR (s.status='completed' AND s.recurrence->>'type'='once'))
             AND (r.dispatched_config IS NULL OR r.dispatched_config=$4::jsonb)
             AND (r.dispatched_config_hash IS NULL OR r.dispatched_config_hash=$5)
             AND ($7::uuid IS NULL OR EXISTS (
               SELECT 1 FROM service_credentials sc
               WHERE sc.id=$7 AND sc.config=$8 AND sc.status='active'
               FOR SHARE NOWAIT
             ))
           RETURNING r.id`,
          [run.runId, run.scheduleId, run.scheduleVersion, JSON.stringify(config), expectedHash, run.userId,
            expectedCredential?.id ?? null, expectedCredential?.config ?? null],
        );
        if (!marked.rowCount) {
          if (expectedCredential) {
            const liveCredential = await options.pool.query(
              "SELECT 1 FROM service_credentials WHERE id=$1 AND config=$2 AND status='active'",
              [expectedCredential.id, expectedCredential.config],
            );
            if (!liveCredential.rowCount) {
              throw new StepError({
                category: 'VALIDATION',
                message: 'Kết nối hoặc phạm vi kênh Slack vừa thay đổi.',
                details: { requestSent: false },
              });
            }
          }
          discarded = true;
          throw new Error('Calendar digest delivery was not claimed');
        }
        deliveryStarted = true;
      };
      const nativeSlack = destService === 'slack' && destAdapter instanceof SlackAdapter;
      if (!nativeSlack) {
        await claimDelivery();
        signal.throwIfAborted();
      }
      if (config.destination.service === 'slack') {
        const blocks = buildSlackMarkdownDigestBlocks({
          headerTitle: 'Bản tin Lịch họp Google Calendar của Planora',
          messageText: formatted.text,
        });
        await destAdapter.execute(
          'slack.send_message',
          { channel: config.destination.channelId, text: formatted.text, blocks },
          { signal, ...(nativeSlack ? { beforeDispatch: claimDelivery } : {}) },
        );
      } else {
        await destAdapter.execute(
          'telegram.send_message',
          { chatId: config.destination.chatId, text: slackMrkdwnToTelegramPlain(formatted.text) },
          { signal },
        );
      }
    } catch (error) {
      if (discarded) return { state: 'discarded' };
      const definitelyRejected = error instanceof StepError &&
        ['AUTH_ERROR', 'NOT_FOUND', 'VALIDATION', 'RATE_LIMIT'].includes(error.category);
      if (deliveryStarted && !definitelyRejected) {
        return { state: 'delivery_unknown', error: CALENDAR_DELIVERY_UNKNOWN };
      }
      if (deliveryStarted) {
        await options.pool.query("UPDATE schedule_runs SET delivery_started_at=NULL WHERE id=$1 AND status='planning'", [run.runId]);
      }
      return {
        state: 'digest_failed',
        error: `Không gửi được bản tin tới ${destService === 'slack' ? 'Slack' : 'Telegram'}.`,
      };
    }

    const delivery: CalendarDigestDelivery = {
      destinationService: config.destination.service,
      channelId:
        config.destination.service === 'slack' ? config.destination.channelId : config.destination.chatId,
      ...(config.destination.service === 'slack' && config.destination.channelName
        ? { channelName: config.destination.channelName }
        : {}),
      ...(config.destination.service === 'telegram' && config.destination.chatTitle
        ? { channelName: config.destination.chatTitle }
        : {}),
      calendarsChecked: config.calendars.length,
      totalEvents: enrichedEvents.length,
      conflictCount: formatted.conflictCount,
      summaryIncluded,
      sentAt: new Date().toISOString(),
    };

    return {
      state: 'digest_sent',
      delivery,
      messageText: formatted.text,
    };
  };
}

export interface CalendarTriggerDestinationOption {
  key: string;
  service: string;
  channelId: string;
  channelName: string;
  credentialId?: string;
  label: string;
}

export interface VerifiedCalendarTriggerDestination {
  service: string;
  channelId: string;
  channelName?: string;
  credentialId: string;
  credentialConfig: string;
  slackDestContext?: Pick<AdapterContext, 'workspaceMode' | 'workspaceId' | 'expectedCredential'>;
  telegramDestBinding?: {
    credentialId: string;
    telegramUserId: string;
    username: string;
    chatIds: string[];
  };
}

function decryptRowConfig(rawConfig: unknown, encryptionKey?: string): Record<string, any> {
  if (typeof rawConfig !== 'string') {
    if (rawConfig && typeof rawConfig === 'object') return rawConfig as Record<string, any>;
    throw new Error('Malformed credential config');
  }
  return encryptionKey ? decryptCredentials(rawConfig, encryptionKey) : JSON.parse(rawConfig);
}

function extractSlackChannelsFromConfig(decrypted: Record<string, any>): string[] {
  const scopeObj = decrypted?.allowedScope;
  const rawChannels: unknown[] = Array.isArray(scopeObj?.channels)
    ? scopeObj.channels
    : Array.isArray(scopeObj)
      ? scopeObj
      : [];
  return Array.from(
    new Set<string>(rawChannels.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)),
  );
}

function extractTelegramChatsFromConfig(
  decrypted: Record<string, any>,
): Array<{ chatId: string; title: string }> {
  const scopeObj = decrypted?.allowedScope;
  const scopeChats: string[] = Array.isArray(scopeObj?.chats)
    ? scopeObj.chats.filter((c: unknown): c is string => typeof c === 'string' && c.trim().length > 0)
    : Array.isArray(scopeObj)
      ? scopeObj.filter((c: unknown): c is string => typeof c === 'string' && c.trim().length > 0)
      : [];
  const selected = Array.isArray(decrypted?.selectedChats)
    ? decrypted.selectedChats
        .map((c: any) => ({
          chatId: typeof c?.chatId === 'string' ? c.chatId.trim() : '',
          title: typeof c?.title === 'string' && c.title.trim() ? c.title.trim() : '',
        }))
        .filter((c: { chatId: string; title: string }) => c.chatId.length > 0)
    : [];
  const map = new Map<string, string>();
  for (const item of selected) {
    map.set(item.chatId, item.title || item.chatId);
  }
  for (const chatId of scopeChats) {
    if (!map.has(chatId)) map.set(chatId, chatId);
  }
  return Array.from(map.entries()).map(([chatId, title]) => ({ chatId, title }));
}

export async function listCalendarTriggerDestinations(
  pool: pg.Pool,
  userId: string,
  encryptionKey?: string,
): Promise<CalendarTriggerDestinationOption[]> {
  const options: CalendarTriggerDestinationOption[] = [];
  const seen = new Set<string>();

  const slackRow = await findSlackDigestCredential(pool, { userId, workspaceMode: 'personal' });
  if (slackRow && slackRow.status === 'active') {
    try {
      const dec = decryptRowConfig(slackRow.config, encryptionKey);
      for (const ch of extractSlackChannelsFromConfig(dec)) {
        const channelName = ch.startsWith('#') ? ch : `#${ch}`;
        const key = `slack:${ch}`;
        if (!seen.has(key)) {
          seen.add(key);
          options.push({
            key,
            service: 'slack',
            channelId: ch,
            channelName,
            credentialId: String(slackRow.id),
            label: `Slack · ${channelName}`,
          });
        }
      }
    } catch {
      // Ignore malformed Slack credential config when listing destinations
    }
  }

  const tgRes = await pool.query(
    `SELECT id, user_id, config, status
     FROM service_credentials
     WHERE service = 'telegram' AND user_id = $1 AND status = 'active'
     ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  const tgRow = tgRes.rows[0];
  if (tgRow) {
    try {
      const dec = decryptRowConfig(tgRow.config, encryptionKey);
      for (const chat of extractTelegramChatsFromConfig(dec)) {
        const key = `telegram:${chat.chatId}`;
        if (!seen.has(key)) {
          seen.add(key);
          options.push({
            key,
            service: 'telegram',
            channelId: chat.chatId,
            channelName: chat.title,
            credentialId: String(tgRow.id),
            label: `Telegram · ${chat.title}`,
          });
        }
      }
    } catch {
      // Ignore malformed Telegram credential config when listing destinations
    }
  }

  return options;
}

export async function verifyCalendarTriggerDestination(
  pool: pg.Pool,
  userId: string,
  dest: Record<string, any> | null | undefined,
  encryptionKey?: string,
): Promise<{ ok: true; verified: VerifiedCalendarTriggerDestination } | { ok: false; pauseReason: string }> {
  if (!dest || typeof dest !== 'object') {
    return { ok: false, pauseReason: 'Thiếu thông tin kênh nhận cảnh báo.' };
  }
  const service = dest.service;
  const channelId = typeof dest.channelId === 'string' && dest.channelId.trim() ? dest.channelId.trim() : '';
  const channelName = typeof dest.channelName === 'string' && dest.channelName.trim() ? dest.channelName.trim() : undefined;
  const pinnedCredId = typeof dest.credentialId === 'string' && dest.credentialId.trim() ? dest.credentialId.trim() : undefined;

  if (service !== 'slack' && service !== 'telegram') {
    return { ok: false, pauseReason: 'Kênh nhận cảnh báo chỉ hỗ trợ Slack hoặc Telegram.' };
  }
  if (!channelId) {
    return { ok: false, pauseReason: 'Vui lòng chọn kênh hoặc nhóm nhận cảnh báo hợp lệ.' };
  }

  if (service === 'slack') {
    const destRow = await findSlackDigestCredential(pool, { userId, workspaceMode: 'personal' });
    if (!destRow || destRow.status !== 'active' || typeof destRow.config !== 'string' ||
        (pinnedCredId && destRow.id !== pinnedCredId)) {
      return { ok: false, pauseReason: 'Dịch vụ Slack không còn hoạt động.' };
    }
    const rawSlackConfig = destRow.config;
    try {
      const dec = decryptRowConfig(rawSlackConfig, encryptionKey);
      const channels = extractSlackChannelsFromConfig(dec);
      if (!channels.includes(channelId)) {
        return { ok: false, pauseReason: 'Kênh Slack nhận cảnh báo không còn nằm trong phạm vi cho phép.' };
      }
      return {
        ok: true,
        verified: {
          service: 'slack',
          channelId,
          channelName: channelName ?? (channelId.startsWith('#') ? channelId : `#${channelId}`),
          credentialId: String(destRow.id),
          credentialConfig: rawSlackConfig,
          slackDestContext: {
            ...(destRow.workspace_id
              ? { workspaceMode: 'organization', workspaceId: destRow.workspace_id }
              : { workspaceMode: destRow.user_id ? 'personal' : 'legacy' }),
            expectedCredential: { id: destRow.id, config: rawSlackConfig },
          },
        },
      };
    } catch {
      return { ok: false, pauseReason: 'Không kiểm tra được phạm vi kênh Slack nhận cảnh báo.' };
    }
  }

  const tgRes = await pool.query(
    `SELECT id, user_id, config, status
     FROM service_credentials
     WHERE service = 'telegram' AND user_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  const tgRow = tgRes.rows[0];
  if (!tgRow || tgRow.status !== 'active' || typeof tgRow.config !== 'string') {
    return { ok: false, pauseReason: 'Kết nối Telegram cá nhân không còn hoạt động.' };
  }
  if (pinnedCredId && String(tgRow.id) !== pinnedCredId) {
    return { ok: false, pauseReason: 'Kết nối Telegram đã thay đổi kể từ lúc thiết lập cảnh báo.' };
  }
  try {
    const dec = decryptRowConfig(tgRow.config, encryptionKey);
    const chats = extractTelegramChatsFromConfig(dec);
    const matched = chats.find((c) => c.chatId === channelId);
    if (!matched) {
      return { ok: false, pauseReason: 'Nhóm Telegram nhận cảnh báo không còn nằm trong phạm vi cho phép.' };
    }
    return {
      ok: true,
      verified: {
        service: 'telegram',
        channelId,
        channelName: channelName ?? matched.title,
        credentialId: String(tgRow.id),
        credentialConfig: tgRow.config,
        telegramDestBinding: {
          credentialId: String(tgRow.id),
          telegramUserId: typeof dec?.telegramUserId === 'string' ? dec.telegramUserId : '',
          username: typeof dec?.username === 'string' ? dec.username : '',
          chatIds: [channelId],
        },
      },
    };
  } catch {
    return { ok: false, pauseReason: 'Không kiểm tra được phạm vi nhóm Telegram nhận cảnh báo.' };
  }
}

export async function deliverCalendarTriggerNotification(
  options: { getAdapter: (serviceName: string, context?: any) => Promise<any> | any },
  input: {
    userId: string;
    verified: VerifiedCalendarTriggerDestination;
    headerTitle: string;
    messageText: string;
    signal?: AbortSignal;
    beforeDispatch: () => Promise<void>;
  },
): Promise<void> {
  const { verified, userId, headerTitle, messageText, signal, beforeDispatch } = input;
  const destAdapter = await options.getAdapter(verified.service, {
    userId,
    phase: 'execution',
    actor: { userId },
    ...(verified.slackDestContext ?? {}),
    ...(verified.telegramDestBinding ? { connections: { telegram: verified.telegramDestBinding } } : {}),
  });
  if (!destAdapter) {
    throw new Error(`Không khởi tạo được kết nối ${verified.service === 'slack' ? 'Slack' : 'Telegram'}.`);
  }
  const guardedAdapter = destAdapter instanceof SlackAdapter || destAdapter instanceof TelegramAdapter;
  if (!guardedAdapter) {
    await beforeDispatch();
    signal?.throwIfAborted();
  }
  const context = { signal, ...(guardedAdapter ? { beforeDispatch } : {}) };

  if (verified.service === 'slack') {
    const blocks = buildSlackMarkdownDigestBlocks({
      headerTitle,
      messageText,
    });
    await destAdapter.execute(
      'slack.send_message',
      { channel: verified.channelId, text: messageText, blocks },
      context,
    );
    return;
  }

  await destAdapter.execute(
    'telegram.send_message',
    { chatId: verified.channelId, text: slackMrkdwnToTelegramPlain(messageText) },
    context,
  );
}
