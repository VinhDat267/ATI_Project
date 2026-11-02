import type pg from 'pg';
import { decryptCredentials, detectCalendarConflicts, StepError, type CalendarEventWithConflict } from '@wap/tool-adapters';
import type { CalendarDigestConfig, CalendarDigestDelivery } from '@wap/tool-schemas';
import { computeCalendarDigestHash } from './calendar-digest-candidate.js';
import { localLabel } from './next-occurrence.js';
import type { RunToPlan } from './schedule-runner.js';

export const CALENDAR_DELIVERY_UNKNOWN = 'Chưa xác định bản tin lịch đã gửi hay chưa. Hãy kiểm tra kênh nhận trước khi gửi thêm; lượt này không tự gửi lại.';

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

function buildDayWindow(dueAt: Date, windowHours: number): { timeMin: string; timeMax: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(dueAt)
      .map((p) => [p.type, p.value]),
  );
  const startIso = `${parts.year}-${parts.month}-${parts.day}T00:00:00+07:00`;
  const startMs = Date.parse(startIso);
  const hours = Math.min(Math.max(1, windowHours || 24), 168);
  const endDate = new Date(startMs + hours * 3_600_000 - 1_000);
  const endParts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(endDate)
      .map((p) => [p.type, p.value]),
  );
  const endIso = `${endParts.year}-${endParts.month}-${endParts.day}T${endParts.hour}:${endParts.minute}:${endParts.second}+07:00`;
  return { timeMin: startIso, timeMax: endIso };
}

export function formatCalendarDigestMessage(input: {
  scheduleName: string;
  dueAt: Date;
  timeZone: string;
  calendarsChecked: number;
  events: EnrichedDigestEvent[];
  summaryText?: string;
}): { text: string; conflictCount: number } {
  const { scheduleName, dueAt, timeZone, calendarsChecked, events, summaryText } = input;
  const conflicting = events.filter((e) => e.conflict === true);
  const lines: string[] = [
    `📅 Bản tin Lịch làm việc: ${escapeDigestText(scheduleName)} (${localLabel(dueAt, timeZone)})`,
    `• Tổng số sự kiện: ${events.length} trên ${calendarsChecked} lịch`,
    conflicting.length > 0
      ? `• ⚠️ Cảnh báo trùng lịch: ${conflicting.length} sự kiện bị giao giờ họp`
      : '• ✅ Không có xung đột giờ họp',
  ];

  if (summaryText && summaryText.trim()) {
    lines.push('', `💡 Tóm tắt nhanh: ${escapeDigestText(summaryText.trim().slice(0, 600))}`);
  }

  if (events.length === 0) {
    lines.push('', 'Hôm nay bạn không có sự kiện nào trong khung giờ đã chọn.');
  } else {
    lines.push('', 'Chi tiết lịch trình:');
    for (const ev of events.slice(0, 20)) {
      const conflictNote =
        ev.conflict && ev.conflictsWith?.length
          ? ` [⚠️ Trùng giờ với: ${ev.conflictsWith.map((t) => escapeDigestText(t)).join(', ')}]`
          : '';
      lines.push(
        `- [${escapeDigestText(ev.calendarSummary)}] ${escapeDigestText(ev.title)} (${ev.start} → ${ev.end})${conflictNote}`,
      );
    }
  }

  return {
    text: lines.join('\n').slice(0, 3900),
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

    // Verify destination service (slack or telegram)
    const destService = config.destination.service;
    const destRow = (
      await options.pool.query(
        destService === 'telegram'
          ? 'SELECT config, status FROM service_credentials WHERE service = $1 AND (user_id = $2 OR user_id IS NULL) ORDER BY user_id IS NULL ASC LIMIT 1'
          : 'SELECT config, status FROM service_credentials WHERE service = $1 AND user_id IS NULL LIMIT 1',
        destService === 'telegram' ? [destService, run.userId] : [destService],
      )
    ).rows[0];

    if (!destRow || destRow.status !== 'active') {
      return {
        state: 'blocked',
        pauseReason: `Dịch vụ ${destService === 'slack' ? 'Slack' : 'Telegram'} không còn hoạt động.`,
      };
    }

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
      } else {
        const chats: string[] = Array.isArray(scopeObj?.chats)
          ? scopeObj.chats
          : Array.isArray(scopeObj)
            ? scopeObj
            : [];
        if (!chats.includes(config.destination.chatId)) {
          return {
            state: 'blocked',
            pauseReason: 'Nhóm Telegram nhận bản tin không còn nằm trong phạm vi cho phép.',
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
    try {
      const { timeMin, timeMax } = buildDayWindow(run.dueAt, config.windowHours);
      const mycalAdapter = await options.getAdapter('mycalendar', {
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
            limit: 20,
          },
          { signal: readSignal },
        );
        const items: CalendarEventWithConflict[] = Array.isArray(res?.events) ? res.events : [];
        for (const item of items) {
          rawEvents.push({
            ...item,
            calendarId: cal.id,
            calendarSummary: cal.summary,
          });
        }
      }
    } catch {
      return {
        state: 'digest_failed',
        error: 'Không đọc được dữ liệu từ Google Calendar. Sẽ thử lại ở lượt tiếp theo.',
      };
    } finally {
      clearTimeout(readTimer);
    }

    const enrichedEvents = detectCalendarConflicts(rawEvents, { annotateConflicts: true });

    // 3. Optional Bounded AI Summary (10s AbortSignal)
    let summaryText: string | undefined;
    let summaryIncluded = false;
    if (config.includeSummary && options.summarizeDigest && enrichedEvents.length > 0) {
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
    try {
      const destAdapter = await options.getAdapter(destService, { actor: { userId: run.userId } });
      if (!destAdapter) {
        return {
          state: 'digest_failed',
          error: `Không khởi tạo được kết nối ${destService === 'slack' ? 'Slack' : 'Telegram'}.`,
        };
      }
      signal.throwIfAborted();
      const marked = await options.pool.query(
        `UPDATE schedule_runs r SET delivery_started_at=now(), updated_at=now()
         FROM schedules s WHERE r.id=$1 AND r.schedule_id=s.id AND s.id=$2
           AND r.status='planning' AND r.delivery_started_at IS NULL
           AND s.version=$3 AND s.status IN ('active', 'completed') RETURNING r.id`,
        [run.runId, run.scheduleId, run.scheduleVersion],
      );
      if (!marked.rowCount) return { state: 'discarded' };
      deliveryStarted = true;
      signal.throwIfAborted();
      if (config.destination.service === 'slack') {
        await destAdapter.execute(
          'slack.send_message',
          { channel: config.destination.channelId, text: formatted.text },
          { signal },
        );
      } else {
        await destAdapter.execute(
          'telegram.send_message',
          { chatId: config.destination.chatId, text: formatted.text },
          { signal },
        );
      }
    } catch (error) {
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
