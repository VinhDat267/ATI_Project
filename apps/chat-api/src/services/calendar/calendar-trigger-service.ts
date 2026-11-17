import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type pg from 'pg';
import { decryptCredentials, StepError } from '@wap/tool-adapters';
import { CALENDAR_ID_PATTERN } from '@wap/tool-schemas';
import {
  escapeDigestText,
  type CalendarTriggerDestinationOption,
  type VerifiedCalendarTriggerDestination,
} from '../schedules/calendar-digest-runner.js';

export type CalendarTriggerType = 'pre_meeting_reminder' | 'event_change_watch';
export type CalendarTriggerStatus = 'active' | 'paused' | 'blocked';

export interface CalendarTriggerDestination {
  service: string;
  channelId: string;
  channelName?: string;
  credentialId?: string;
}

export interface CalendarEventTriggerDto {
  id: string;
  name: string;
  triggerType: CalendarTriggerType;
  calendarIds: string[];
  leadMinutes: number;
  destination: CalendarTriggerDestination;
  status: CalendarTriggerStatus;
  pauseReason: string | null;
  watchActive: boolean;
  watchExpiration: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarTriggerDispatchDto {
  id: string;
  triggerId: string;
  dedupeKey: string;
  eventId: string | null;
  deliveryStatus: 'pending' | 'sent' | 'failed';
  summary: string | null;
  createdAt: string;
  sentAt: string | null;
}

export class CalendarTriggerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

interface StoredEventSnapshot {
  title: string;
  start: string;
  end: string;
  meetLink?: string;
  location?: string;
}

interface TriggerRow {
  id: string;
  user_id: string;
  name: string;
  trigger_type: CalendarTriggerType;
  credential_id: string;
  calendar_ids: string[];
  lead_minutes: number;
  destination: CalendarTriggerDestination;
  status: CalendarTriggerStatus;
  pause_reason: string | null;
  snapshot: Record<string, Record<string, StoredEventSnapshot>> | null;
  watch_channel_id: string | null;
  watch_resource_id: string | null;
  watch_expiration: Date | string | null;
  last_checked_at: Date | string | null;
  last_error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface CalendarTriggerServiceOptions {
  pool: pg.Pool;
  encryptionKey?: string;
  timeZone?: string;
  clock?: () => Date;
  webhookSecret?: string;
  getAdapter: (serviceName: string, context?: any) => Promise<any> | any;
  verifyDestination: (
    pool: pg.Pool,
    userId: string,
    dest: Record<string, any> | null | undefined,
    encryptionKey?: string,
  ) => Promise<{ ok: true; verified: VerifiedCalendarTriggerDestination } | { ok: false; pauseReason: string }>;
  listDestinations: (
    pool: pg.Pool,
    userId: string,
    encryptionKey?: string,
  ) => Promise<CalendarTriggerDestinationOption[]>;
  deliverNotification: (
    options: { getAdapter: (serviceName: string, context?: any) => Promise<any> | any },
    input: {
      userId: string;
      verified: VerifiedCalendarTriggerDestination;
      headerTitle: string;
      messageText: string;
      signal?: AbortSignal;
    },
  ) => Promise<void>;
}

const VALID_TRIGGER_TYPES = new Set<CalendarTriggerType>(['pre_meeting_reminder', 'event_change_watch']);

function toIsoOrNull(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toDto(row: TriggerRow): CalendarEventTriggerDto {
  const watchExpIso = toIsoOrNull(row.watch_expiration);
  return {
    id: String(row.id),
    name: row.name,
    triggerType: row.trigger_type,
    calendarIds: Array.isArray(row.calendar_ids) ? row.calendar_ids : [],
    leadMinutes: Number(row.lead_minutes ?? 15),
    destination: {
      service: String(row.destination?.service ?? ''),
      channelId: String(row.destination?.channelId ?? ''),
      ...(row.destination?.channelName ? { channelName: String(row.destination.channelName) } : {}),
      ...(row.destination?.credentialId ? { credentialId: String(row.destination.credentialId) } : {}),
    },
    status: row.status,
    pauseReason: row.pause_reason ?? null,
    watchActive: Boolean(row.watch_channel_id),
    watchExpiration: watchExpIso,
    lastCheckedAt: toIsoOrNull(row.last_checked_at),
    lastError: row.last_error ?? null,
    createdAt: toIsoOrNull(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIsoOrNull(row.updated_at) ?? new Date().toISOString(),
  };
}

function formatLocalRange(startRaw: string, endRaw: string, timeZone: string): string {
  if (!startRaw.includes('T')) return `${startRaw} (Cả ngày)`;
  const s = new Date(startRaw);
  const e = new Date(endRaw);
  if (Number.isNaN(s.getTime())) return startRaw;
  const fmtTime = (d: Date) =>
    new Intl.DateTimeFormat('vi-VN', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(d);
  const fmtDate = (d: Date) =>
    new Intl.DateTimeFormat('vi-VN', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
    }).format(d);
  return `${fmtDate(s)} · ${fmtTime(s)}${Number.isFinite(e.getTime()) ? `–${fmtTime(e)}` : ''}`;
}

export function signCalendarWatchToken(secret: string, channelId: string, triggerId: string): string {
  const mac = createHmac('sha256', secret).update(`${channelId}:${triggerId}`).digest('hex');
  return `${triggerId}.${mac}`;
}

export function verifyCalendarWatchToken(secret: string, channelId: string, token: string): string | null {
  if (typeof token !== 'string' || !channelId) return null;
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx <= 0) return null;
  const triggerId = token.slice(0, dotIdx);
  const providedHex = token.slice(dotIdx + 1);
  if (!/^[0-9a-f]{64}$/i.test(providedHex)) return null;
  const expectedHex = createHmac('sha256', secret).update(`${channelId}:${triggerId}`).digest('hex');
  const a = Buffer.from(providedHex.toLowerCase(), 'utf8');
  const b = Buffer.from(expectedHex.toLowerCase(), 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return triggerId;
}

export class CalendarTriggerService {
  private readonly pool: pg.Pool;
  private readonly encryptionKey?: string;
  private readonly timeZone: string;
  private readonly clock: () => Date;
  private readonly webhookSecret: string;
  private readonly getAdapter: CalendarTriggerServiceOptions['getAdapter'];
  private readonly verifyDestination: CalendarTriggerServiceOptions['verifyDestination'];
  private readonly listDestinationsFn: CalendarTriggerServiceOptions['listDestinations'];
  private readonly deliverNotification: CalendarTriggerServiceOptions['deliverNotification'];
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<unknown> | null = null;

  constructor(options: CalendarTriggerServiceOptions) {
    this.pool = options.pool;
    this.encryptionKey = options.encryptionKey;
    this.timeZone = options.timeZone ?? 'Asia/Ho_Chi_Minh';
    this.clock = options.clock ?? (() => new Date());
    this.webhookSecret =
      options.webhookSecret ||
      createHash('sha256').update(`mycalendar-watch:${options.encryptionKey ?? 'default-dev'}`).digest('hex');
    this.getAdapter = options.getAdapter;
    this.verifyDestination = options.verifyDestination;
    this.listDestinationsFn = options.listDestinations;
    this.deliverNotification = options.deliverNotification;
  }

  private async getAuthorizedMyCalendarScope(
    userId: string,
  ): Promise<{ ok: true; credentialId: string; email: string; allowedCalendars: Set<string> } | { ok: false; reason: string }> {
    const row = (
      await this.pool.query(
        "SELECT id, config, status FROM service_credentials WHERE service = 'mycalendar' AND user_id = $1 LIMIT 1",
        [userId],
      )
    ).rows[0];
    if (!row || row.status !== 'active') {
      return { ok: false, reason: 'Kết nối Google Calendar cá nhân chưa sẵn sàng hoặc cần kết nối lại.' };
    }
    try {
      const dec = this.encryptionKey ? decryptCredentials(row.config, this.encryptionKey) : JSON.parse(row.config);
      const ids: string[] = Array.isArray(dec?.allowedScope?.calendars)
        ? dec.allowedScope.calendars
        : Array.isArray(dec?.selectedCalendars)
          ? dec.selectedCalendars.map((c: any) => c?.id).filter((id: unknown): id is string => typeof id === 'string')
          : [];
      const cleaned = new Set(ids.filter((id) => CALENDAR_ID_PATTERN.test(id)));
      if (cleaned.size === 0) {
        return { ok: false, reason: 'Chưa có lịch Google Calendar nào trong phạm vi được phép.' };
      }
      return {
        ok: true,
        credentialId: String(row.id),
        email: typeof dec?.email === 'string' ? dec.email : '',
        allowedCalendars: cleaned,
      };
    } catch {
      return { ok: false, reason: 'Không đọc được cấu hình Google Calendar cá nhân.' };
    }
  }

  async listAvailableDestinations(userId: string): Promise<CalendarTriggerDestinationOption[]> {
    return this.listDestinationsFn(this.pool, userId, this.encryptionKey);
  }

  async listTriggers(userId: string): Promise<CalendarEventTriggerDto[]> {
    const res = await this.pool.query<TriggerRow>(
      `SELECT id, user_id, name, trigger_type, credential_id, calendar_ids, lead_minutes, destination,
              status, pause_reason, NULL::jsonb AS snapshot, watch_channel_id, watch_resource_id,
              watch_expiration, last_checked_at, last_error, created_at, updated_at
       FROM calendar_event_triggers
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );
    return res.rows.map(toDto);
  }

  async createTrigger(
    userId: string,
    input: {
      name: string;
      triggerType: CalendarTriggerType;
      calendarIds: string[];
      leadMinutes?: number;
      destination: CalendarTriggerDestination;
    },
  ): Promise<CalendarEventTriggerDto> {
    const cleanName = typeof input.name === 'string' ? input.name.trim() : '';
    if (!cleanName || cleanName.length > 120) {
      throw new CalendarTriggerError('CALENDAR_TRIGGER_INVALID', 'Tên cảnh báo phải từ 1 đến 120 ký tự.', 400);
    }
    if (!VALID_TRIGGER_TYPES.has(input.triggerType)) {
      throw new CalendarTriggerError('CALENDAR_TRIGGER_INVALID', 'Loại cảnh báo không hợp lệ.', 400);
    }
    const leadMinutes = input.leadMinutes === undefined ? 15 : Number(input.leadMinutes);
    if (!Number.isInteger(leadMinutes) || leadMinutes < 1 || leadMinutes > 1440) {
      throw new CalendarTriggerError('CALENDAR_TRIGGER_INVALID', 'Thời gian nhắc trước phải từ 1 đến 1440 phút.', 400);
    }

    const calAuth = await this.getAuthorizedMyCalendarScope(userId);
    if (!calAuth.ok) {
      throw new CalendarTriggerError('MYCALENDAR_NOT_CONNECTED', calAuth.reason, 409);
    }
    const calIds = Array.isArray(input.calendarIds)
      ? [...new Set(input.calendarIds.map((c) => (typeof c === 'string' ? c.trim() : '')).filter(Boolean))]
      : [];
    if (calIds.length === 0 || calIds.length > 5 || calIds.some((c) => !calAuth.allowedCalendars.has(c))) {
      throw new CalendarTriggerError(
        'CALENDAR_TRIGGER_SCOPE_INVALID',
        'Danh sách lịch được chọn không hợp lệ hoặc nằm ngoài phạm vi cấp quyền.',
        400,
      );
    }

    const destCheck = await this.verifyDestination(this.pool, userId, input.destination, this.encryptionKey);
    if (!destCheck.ok) {
      throw new CalendarTriggerError('CALENDAR_TRIGGER_DEST_INVALID', destCheck.pauseReason, 400);
    }

    const safeDest: CalendarTriggerDestination = {
      service: destCheck.verified.service,
      channelId: destCheck.verified.channelId,
      ...(destCheck.verified.channelName ? { channelName: destCheck.verified.channelName } : {}),
      ...(destCheck.verified.credentialId ? { credentialId: destCheck.verified.credentialId } : {}),
    };

    const inserted = await this.pool.query<TriggerRow>(
      `INSERT INTO calendar_event_triggers(
         user_id, name, trigger_type, credential_id, calendar_ids, lead_minutes, destination, status
       ) VALUES($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, 'active')
       RETURNING *`,
      [userId, cleanName, input.triggerType, calAuth.credentialId, JSON.stringify(calIds), leadMinutes, JSON.stringify(safeDest)],
    );
    return toDto(inserted.rows[0]!);
  }

  async updateTrigger(
    userId: string,
    triggerId: string,
    patch: {
      name?: string;
      status?: 'active' | 'paused';
      leadMinutes?: number;
      calendarIds?: string[];
      destination?: CalendarTriggerDestination;
    },
  ): Promise<CalendarEventTriggerDto | null> {
    const existingRes = await this.pool.query<TriggerRow>(
      'SELECT * FROM calendar_event_triggers WHERE id = $1 AND user_id = $2',
      [triggerId, userId],
    );
    const existing = existingRes.rows[0];
    if (!existing) return null;

    let nextName = existing.name;
    if (patch.name !== undefined) {
      const clean = typeof patch.name === 'string' ? patch.name.trim() : '';
      if (!clean || clean.length > 120) {
        throw new CalendarTriggerError('CALENDAR_TRIGGER_INVALID', 'Tên cảnh báo phải từ 1 đến 120 ký tự.', 400);
      }
      nextName = clean;
    }

    let nextLead = existing.lead_minutes;
    if (patch.leadMinutes !== undefined) {
      const n = Number(patch.leadMinutes);
      if (!Number.isInteger(n) || n < 1 || n > 1440) {
        throw new CalendarTriggerError('CALENDAR_TRIGGER_INVALID', 'Thời gian nhắc trước phải từ 1 đến 1440 phút.', 400);
      }
      nextLead = n;
    }

    let nextCalIds = existing.calendar_ids;
    let nextCredId = existing.credential_id;
    const activating = patch.status === 'active';
    if (patch.calendarIds !== undefined || activating) {
      const calAuth = await this.getAuthorizedMyCalendarScope(userId);
      if (!calAuth.ok) {
        throw new CalendarTriggerError('MYCALENDAR_NOT_CONNECTED', calAuth.reason, 409);
      }
      nextCredId = calAuth.credentialId;
      const candidateCals = patch.calendarIds !== undefined
        ? [...new Set(patch.calendarIds.map((c) => (typeof c === 'string' ? c.trim() : '')).filter(Boolean))]
        : existing.calendar_ids;
      if (candidateCals.length === 0 || candidateCals.length > 5 || candidateCals.some((c) => !calAuth.allowedCalendars.has(c))) {
        throw new CalendarTriggerError('CALENDAR_TRIGGER_SCOPE_INVALID', 'Lịch được chọn nằm ngoài phạm vi cấp quyền hiện tại.', 400);
      }
      nextCalIds = candidateCals;
    }

    let nextDest = existing.destination;
    if (patch.destination !== undefined || activating) {
      const destCheck = await this.verifyDestination(this.pool, userId, patch.destination ?? existing.destination, this.encryptionKey);
      if (!destCheck.ok) {
        throw new CalendarTriggerError('CALENDAR_TRIGGER_DEST_INVALID', destCheck.pauseReason, 400);
      }
      nextDest = {
        service: destCheck.verified.service,
        channelId: destCheck.verified.channelId,
        ...(destCheck.verified.channelName ? { channelName: destCheck.verified.channelName } : {}),
        ...(destCheck.verified.credentialId ? { credentialId: destCheck.verified.credentialId } : {}),
      };
    }

    let nextStatus = existing.status;
    let nextPauseReason = existing.pause_reason;
    let nextError = existing.last_error;
    if (patch.status !== undefined) {
      if (patch.status !== 'active' && patch.status !== 'paused') {
        throw new CalendarTriggerError('CALENDAR_TRIGGER_INVALID', 'Trạng thái cập nhật chỉ hỗ trợ active hoặc paused.', 400);
      }
      nextStatus = patch.status;
      if (patch.status === 'active') {
        nextPauseReason = null;
        nextError = null;
      }
    }

    const updated = await this.pool.query<TriggerRow>(
      `UPDATE calendar_event_triggers
       SET name = $3,
           lead_minutes = $4,
           calendar_ids = $5::jsonb,
           credential_id = $6,
           destination = $7::jsonb,
           status = $8,
           pause_reason = $9,
           last_error = $10,
           updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [
        triggerId,
        userId,
        nextName,
        nextLead,
        JSON.stringify(nextCalIds),
        nextCredId,
        JSON.stringify(nextDest),
        nextStatus,
        nextPauseReason,
        nextError,
      ],
    );
    return toDto(updated.rows[0]!);
  }

  async deleteTrigger(userId: string, triggerId: string): Promise<boolean> {
    const res = await this.pool.query(
      'DELETE FROM calendar_event_triggers WHERE id = $1 AND user_id = $2 RETURNING id',
      [triggerId, userId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async listDispatches(userId: string, triggerId: string, limit = 20): Promise<CalendarTriggerDispatchDto[] | null> {
    const owns = await this.pool.query(
      'SELECT 1 FROM calendar_event_triggers WHERE id = $1 AND user_id = $2',
      [triggerId, userId],
    );
    if (!owns.rowCount) return null;
    const bounded = Math.min(Math.max(1, Number(limit) || 20), 50);
    const res = await this.pool.query(
      `SELECT id, trigger_id, dedupe_key, event_id, delivery_status, summary, created_at, sent_at
       FROM calendar_trigger_dispatches
       WHERE trigger_id = $1 AND user_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [triggerId, userId, bounded],
    );
    return res.rows.map((r) => ({
      id: String(r.id),
      triggerId: String(r.trigger_id),
      dedupeKey: String(r.dedupe_key),
      eventId: r.event_id ? String(r.event_id) : null,
      deliveryStatus: r.delivery_status,
      summary: r.summary ? String(r.summary) : null,
      createdAt: toIsoOrNull(r.created_at) ?? new Date().toISOString(),
      sentAt: toIsoOrNull(r.sent_at),
    }));
  }

  private async markBlocked(triggerId: string, reason: string): Promise<void> {
    await this.pool.query(
      `UPDATE calendar_event_triggers
       SET status = 'blocked', pause_reason = $2, updated_at = now()
       WHERE id = $1`,
      [triggerId, reason],
    );
  }

  private async claimAndDeliver(input: {
    triggerId: string;
    userId: string;
    dedupeKey: string;
    eventId: string;
    summary: string;
    headerTitle: string;
    messageText: string;
    verifiedDest: VerifiedCalendarTriggerDestination;
    signal?: AbortSignal;
  }): Promise<boolean> {
    const claimed = await this.pool.query(
      `INSERT INTO calendar_trigger_dispatches(trigger_id, user_id, dedupe_key, event_id, delivery_status, summary)
       VALUES($1, $2, $3, $4, 'pending', $5)
       ON CONFLICT (trigger_id, dedupe_key) DO NOTHING
       RETURNING id`,
      [input.triggerId, input.userId, input.dedupeKey.slice(0, 256), input.eventId, input.summary.slice(0, 200)],
    );
    if (!claimed.rowCount) return false;
    const dispatchId = String(claimed.rows[0].id);

    try {
      await this.deliverNotification(
        { getAdapter: this.getAdapter },
        {
          userId: input.userId,
          verified: input.verifiedDest,
          headerTitle: input.headerTitle,
          messageText: input.messageText,
          signal: input.signal,
        },
      );
      await this.pool.query(
        "UPDATE calendar_trigger_dispatches SET delivery_status = 'sent', sent_at = now() WHERE id = $1",
        [dispatchId],
      );
      return true;
    } catch (err: any) {
      await this.pool.query(
        "UPDATE calendar_trigger_dispatches SET delivery_status = 'failed' WHERE id = $1",
        [dispatchId],
      );
      await this.pool.query(
        'UPDATE calendar_event_triggers SET last_error = $2, updated_at = now() WHERE id = $1',
        [input.triggerId, String(err?.message ?? 'Không gửi được cảnh báo.').slice(0, 400)],
      );
      return false;
    }
  }

  async evaluateTriggerById(
    triggerId: string,
    opts?: { signal?: AbortSignal; userId?: string },
  ): Promise<{
    evaluated: boolean;
    status: CalendarTriggerStatus;
    pauseReason?: string | null;
    notificationsSent: number;
    baselineSeeded?: boolean;
    checkedEvents: number;
  }> {
    const rowRes = opts?.userId
      ? await this.pool.query<TriggerRow>('SELECT * FROM calendar_event_triggers WHERE id = $1 AND user_id = $2', [
          triggerId,
          opts.userId,
        ])
      : await this.pool.query<TriggerRow>('SELECT * FROM calendar_event_triggers WHERE id = $1', [triggerId]);
    const row = rowRes.rows[0];
    if (!row) {
      throw new CalendarTriggerError('CALENDAR_TRIGGER_NOT_FOUND', 'Không tìm thấy quy tắc cảnh báo lịch.', 404);
    }

    const calAuth = await this.getAuthorizedMyCalendarScope(row.user_id);
    if (!calAuth.ok) {
      await this.markBlocked(row.id, calAuth.reason);
      return { evaluated: true, status: 'blocked', pauseReason: calAuth.reason, notificationsSent: 0, checkedEvents: 0 };
    }
    if (calAuth.credentialId !== String(row.credential_id)) {
      const reason = 'Kết nối Google Calendar cá nhân đã thay đổi hoặc cần kết nối lại.';
      await this.markBlocked(row.id, reason);
      return { evaluated: true, status: 'blocked', pauseReason: reason, notificationsSent: 0, checkedEvents: 0 };
    }
    if (!Array.isArray(row.calendar_ids) || row.calendar_ids.some((c) => !calAuth.allowedCalendars.has(c))) {
      const reason = 'Danh sách lịch Google Calendar được cấp quyền đã thay đổi.';
      await this.markBlocked(row.id, reason);
      return { evaluated: true, status: 'blocked', pauseReason: reason, notificationsSent: 0, checkedEvents: 0 };
    }

    const destCheck = await this.verifyDestination(this.pool, row.user_id, row.destination, this.encryptionKey);
    if (!destCheck.ok) {
      await this.markBlocked(row.id, destCheck.pauseReason);
      return {
        evaluated: true,
        status: 'blocked',
        pauseReason: destCheck.pauseReason,
        notificationsSent: 0,
        checkedEvents: 0,
      };
    }

    const now = this.clock();
    const nowMs = now.getTime();
    let notificationsSent = 0;
    let checkedEvents = 0;

    try {
      const mycalAdapter = await this.getAdapter('mycalendar', {
        userId: row.user_id,
        phase: 'execution',
        actor: { userId: row.user_id },
        connections: {
          mycalendar: {
            credentialId: String(row.credential_id),
            email: calAuth.email,
            allowedCalendars: row.calendar_ids,
          },
        },
      });
      if (!mycalAdapter) {
        const reason = 'Không khởi tạo được adapter Google Calendar cá nhân.';
        await this.markBlocked(row.id, reason);
        return { evaluated: true, status: 'blocked', pauseReason: reason, notificationsSent: 0, checkedEvents: 0 };
      }

      if (row.trigger_type === 'pre_meeting_reminder') {
        const timeMin = new Date(nowMs - 60_000).toISOString();
        const leadMs = Math.max(2, row.lead_minutes) * 60_000;
        const timeMax = new Date(nowMs + leadMs).toISOString();

        for (const calendarId of row.calendar_ids) {
          const listed = await mycalAdapter.execute(
            'mycalendar.list_events',
            { calendarId, timeMin, timeMax, limit: 20 },
            { signal: opts?.signal },
          );
          const events = Array.isArray(listed?.events) ? listed.events : [];
          checkedEvents += events.length;

          for (const ev of events) {
            if (!ev || ev.status === 'cancelled' || ev.transparency === 'transparent') continue;
            if (typeof ev.start !== 'string' || !ev.start.includes('T')) continue;
            const startMs = Date.parse(ev.start);
            if (!Number.isFinite(startMs)) continue;
            if (startMs < nowMs - 60_000 || startMs > nowMs + row.lead_minutes * 60_000) continue;

            const minsLeft = Math.max(0, Math.round((startMs - nowMs) / 60_000));
            const titleSafe = escapeDigestText(String(ev.title || '(Không có tiêu đề)'));
            const lines = [
              `🔔 *Nhắc lịch họp sắp diễn ra (${minsLeft} phút nữa)*: *${titleSafe}*`,
              `🕒 Thời gian: ${formatLocalRange(ev.start, ev.end ?? ev.start, this.timeZone)}`,
            ];
            if (typeof ev.meetLink === 'string' && ev.meetLink) {
              lines.push(`🎥 Google Meet: ${ev.meetLink}`);
            }
            if (typeof ev.location === 'string' && ev.location) {
              lines.push(`📍 Địa điểm: ${escapeDigestText(ev.location)}`);
            }
            if (Array.isArray(ev.attendees) && ev.attendees.length > 0) {
              const preview = ev.attendees.slice(0, 5).map((a: unknown) => escapeDigestText(String(a))).join(', ');
              const extra = ev.attendees.length > 5 ? ` (+${ev.attendees.length - 5})` : '';
              lines.push(`👥 Khách mời: ${preview}${extra}`);
            }
            if (typeof ev.url === 'string' && ev.url) {
              lines.push(`🔗 Xem trên Google Calendar: ${ev.url}`);
            }

            const dedupeKey = `pre:${calendarId}:${ev.id}:${ev.start}`;
            const sent = await this.claimAndDeliver({
              triggerId: row.id,
              userId: row.user_id,
              dedupeKey,
              eventId: String(ev.id),
              summary: String(ev.title || ''),
              headerTitle: 'Nhắc lịch họp sắp diễn ra',
              messageText: lines.join('\n'),
              verifiedDest: destCheck.verified,
              signal: opts?.signal,
            });
            if (sent) notificationsSent++;
          }
        }

        await this.pool.query(
          'UPDATE calendar_event_triggers SET last_checked_at = now(), last_error = NULL, updated_at = now() WHERE id = $1',
          [row.id],
        );
        return { evaluated: true, status: 'active', notificationsSent, checkedEvents };
      }

      // event_change_watch
      const timeMin = new Date(nowMs - 60_000).toISOString();
      const timeMax = new Date(nowMs + 14 * 86_400_000).toISOString();
      const prevSnapshot = row.snapshot ?? null;
      const nextSnapshot: Record<string, Record<string, StoredEventSnapshot>> = {};
      const todayIso = now.toISOString().slice(0, 10);

      for (const calendarId of row.calendar_ids) {
        const listed = await mycalAdapter.execute(
          'mycalendar.list_events',
          { calendarId, timeMin, timeMax, limit: 20 },
          { signal: opts?.signal },
        );
        const events = Array.isArray(listed?.events) ? listed.events : [];
        checkedEvents += events.length;
        const complete = listed?.coverage?.complete !== false;

        const currMap: Record<string, StoredEventSnapshot> = {};
        for (const ev of events) {
          if (!ev || ev.status === 'cancelled' || typeof ev.id !== 'string') continue;
          currMap[ev.id] = {
            title: String(ev.title || '(Không có tiêu đề)'),
            start: String(ev.start || ''),
            end: String(ev.end || ''),
            ...(typeof ev.meetLink === 'string' && ev.meetLink ? { meetLink: ev.meetLink } : {}),
            ...(typeof ev.location === 'string' && ev.location ? { location: ev.location } : {}),
          };
        }

        if (!complete && prevSnapshot?.[calendarId]) {
          // Preserve previous baseline when coverage is incomplete to avoid false cancellation alerts
          nextSnapshot[calendarId] = { ...prevSnapshot[calendarId], ...currMap };
          continue;
        }
        nextSnapshot[calendarId] = currMap;

        if (prevSnapshot !== null) {
          const prevMap = prevSnapshot[calendarId] ?? {};
          for (const [evId, curr] of Object.entries(currMap)) {
            const prev = prevMap[evId];
            if (!prev) {
              const titleSafe = escapeDigestText(curr.title);
              const msg = [
                `📅 *Sự kiện mới trên lịch*: *${titleSafe}*`,
                `🕒 Thời gian: ${formatLocalRange(curr.start, curr.end, this.timeZone)}`,
                ...(curr.meetLink ? [`🎥 Meet: ${curr.meetLink}`] : []),
              ].join('\n');
              const sent = await this.claimAndDeliver({
                triggerId: row.id,
                userId: row.user_id,
                dedupeKey: `chg:add:${calendarId}:${evId}:${curr.start}`,
                eventId: evId,
                summary: curr.title,
                headerTitle: 'Sự kiện mới trên Google Calendar',
                messageText: msg,
                verifiedDest: destCheck.verified,
                signal: opts?.signal,
              });
              if (sent) notificationsSent++;
            } else if (prev.start !== curr.start || prev.end !== curr.end || prev.title !== curr.title) {
              const titleSafe = escapeDigestText(curr.title);
              const msg = [
                `🔄 *Lịch họp vừa thay đổi*: *${titleSafe}*`,
                `• Trước: ${formatLocalRange(prev.start, prev.end, this.timeZone)}`,
                `• Mới: ${formatLocalRange(curr.start, curr.end, this.timeZone)}`,
                ...(curr.meetLink ? [`🎥 Meet: ${curr.meetLink}`] : []),
              ].join('\n');
              const sent = await this.claimAndDeliver({
                triggerId: row.id,
                userId: row.user_id,
                dedupeKey: `chg:upd:${calendarId}:${evId}:${curr.start}:${curr.end}:${curr.title.slice(0, 60)}`,
                eventId: evId,
                summary: curr.title,
                headerTitle: 'Cập nhật lịch họp trên Google Calendar',
                messageText: msg,
                verifiedDest: destCheck.verified,
                signal: opts?.signal,
              });
              if (sent) notificationsSent++;
            }
          }

          for (const [prevId, prev] of Object.entries(prevMap)) {
            if (currMap[prevId]) continue;
            const stillInFuture = prev.start.includes('T')
              ? Date.parse(prev.start) > nowMs
              : prev.end > todayIso;
            if (!stillInFuture) continue;
            const titleSafe = escapeDigestText(prev.title);
            const msg = [
              `🗑️ *Lịch họp đã bị huỷ / gỡ khỏi lịch*: *${titleSafe}*`,
              `🕒 Khung giờ trước đó: ${formatLocalRange(prev.start, prev.end, this.timeZone)}`,
            ].join('\n');
            const sent = await this.claimAndDeliver({
              triggerId: row.id,
              userId: row.user_id,
              dedupeKey: `chg:del:${calendarId}:${prevId}:${prev.start}`,
              eventId: prevId,
              summary: prev.title,
              headerTitle: 'Lịch họp bị huỷ trên Google Calendar',
              messageText: msg,
              verifiedDest: destCheck.verified,
              signal: opts?.signal,
            });
            if (sent) notificationsSent++;
          }
        }
      }

      await this.pool.query(
        'UPDATE calendar_event_triggers SET snapshot = $2::jsonb, last_checked_at = now(), last_error = NULL, updated_at = now() WHERE id = $1',
        [row.id, JSON.stringify(nextSnapshot)],
      );
      return {
        evaluated: true,
        status: 'active',
        notificationsSent,
        ...(prevSnapshot === null ? { baselineSeeded: true } : {}),
        checkedEvents,
      };
    } catch (error: any) {
      if (error instanceof StepError && error.category === 'AUTH_ERROR') {
        const reason = 'Quyền truy cập Google Calendar đã hết hạn hoặc bị thu hồi. Hãy kết nối lại.';
        await this.markBlocked(row.id, reason);
        return { evaluated: true, status: 'blocked', pauseReason: reason, notificationsSent: 0, checkedEvents };
      }
      const message = String(error?.message ?? 'Không thể kiểm tra lịch.');
      await this.pool.query(
        'UPDATE calendar_event_triggers SET last_checked_at = now(), last_error = $2, updated_at = now() WHERE id = $1',
        [row.id, message.slice(0, 400)],
      );
      return { evaluated: true, status: 'active', notificationsSent, checkedEvents };
    }
  }

  async evaluateAllActiveTriggers(signal?: AbortSignal): Promise<{ evaluated: number; notificationsSent: number }> {
    const active = await this.pool.query<{ id: string }>(
      "SELECT id FROM calendar_event_triggers WHERE status = 'active' ORDER BY updated_at ASC LIMIT 100",
    );
    let evaluated = 0;
    let notificationsSent = 0;
    for (const row of active.rows) {
      if (signal?.aborted) break;
      const res = await this.evaluateTriggerById(String(row.id), { signal });
      evaluated++;
      notificationsSent += res.notificationsSent;
    }
    return { evaluated, notificationsSent };
  }

  async handleWebhookNotification(
    headers: Record<string, string | string[] | undefined>,
    signal?: AbortSignal,
  ): Promise<{ accepted: boolean; resourceState: string; notificationsSent: number }> {
    const pick = (name: string): string => {
      const raw = headers[name] ?? headers[name.toLowerCase()];
      return typeof raw === 'string' ? raw.trim() : Array.isArray(raw) && typeof raw[0] === 'string' ? raw[0].trim() : '';
    };
    const channelId = pick('x-goog-channel-id');
    const token = pick('x-goog-channel-token');
    const resourceState = pick('x-goog-resource-state') || 'exists';
    const resourceId = pick('x-goog-resource-id');

    const verifiedTriggerId = verifyCalendarWatchToken(this.webhookSecret, channelId, token);
    if (!verifiedTriggerId) {
      throw new CalendarTriggerError('MYCALENDAR_WEBHOOK_UNAUTHORIZED', 'Webhook token không hợp lệ.', 401);
    }

    const rowRes = await this.pool.query<TriggerRow>(
      `SELECT id, user_id, watch_channel_id, watch_resource_id, status
       FROM calendar_event_triggers
       WHERE id = $1 AND watch_channel_id = $2`,
      [verifiedTriggerId, channelId],
    );
    const trigger = rowRes.rows[0];
    if (!trigger) {
      throw new CalendarTriggerError('MYCALENDAR_WEBHOOK_UNAUTHORIZED', 'Kênh webhook chưa được đăng ký.', 401);
    }
    if (trigger.watch_resource_id && resourceId && trigger.watch_resource_id !== resourceId) {
      throw new CalendarTriggerError('MYCALENDAR_WEBHOOK_UNAUTHORIZED', 'Resource ID không khớp.', 401);
    }
    if (resourceState === 'sync' || trigger.status !== 'active') {
      return { accepted: true, resourceState, notificationsSent: 0 };
    }

    const evalRes = await this.evaluateTriggerById(String(trigger.id), { signal });
    return { accepted: true, resourceState, notificationsSent: evalRes.notificationsSent };
  }

  start(intervalMs = 60_000): void {
    if (this.timer) return;
    const runTick = () => {
      if (this.inFlight) return;
      this.inFlight = this.evaluateAllActiveTriggers()
        .catch((err) => {
          console.warn('[chat-api] MyCalendar trigger poll error:', err instanceof Error ? err.message : err);
        })
        .finally(() => {
          this.inFlight = null;
        });
    };
    this.timer = setInterval(runTick, Math.max(5_000, intervalMs));
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.inFlight) {
      await this.inFlight.catch(() => {});
    }
  }
}

export function generateCalendarWatchChannelId(): string {
  return randomUUID();
}
