import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type pg from 'pg';
import { decryptCredentials, StepError } from '@wap/tool-adapters';
import { CALENDAR_ID_PATTERN } from '@wap/tool-schemas';
import { isUuid } from '../../db/repositories/uuid.js';
import { hasGoogleCredentialOrigin } from '../gmail/credential-origin.js';
import { CalendarTriggerWatchRegistry, parseCalendarWatchCallbackUrl, type CalendarTriggerWatchOptions } from './calendar-trigger-watch.js';
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
  needsAttention: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarTriggerDispatchDto {
  id: string;
  triggerId: string;
  dedupeKey: string;
  eventId: string | null;
  deliveryStatus: 'pending' | 'sent' | 'failed' | 'needs_attention';
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
  approved_config_hash: string | null;
  version: string;
  watch_expiration?: Date | null;
  needs_attention?: boolean;
  last_checked_at: Date | string | null;
  last_error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TriggerConfig {
  name: string;
  triggerType: CalendarTriggerType;
  calendarIds: string[];
  leadMinutes?: number;
  destination: CalendarTriggerDestination;
}

type TriggerPatch = Partial<Omit<TriggerConfig, 'triggerType'>> & { status?: 'active' | 'paused' };
type TriggerApproval = { id: string; expiresAt: Date };
const APPROVAL_TTL_MS = 10 * 60_000;

export interface CalendarTriggerServiceOptions {
  pool: pg.Pool;
  encryptionKey?: string;
  mycalendarOAuthClientId?: string;
  timeZone?: string;
  clock?: () => Date;
  webhookSecret?: string;
  watch?: CalendarTriggerWatchOptions;
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
      beforeDispatch: () => Promise<void>;
    },
  ) => Promise<void>;
}

const VALID_TRIGGER_TYPES = new Set<CalendarTriggerType>(['pre_meeting_reminder', 'event_change_watch']);
const EVALUATION_TIMEOUT_MS = 2 * 60_000;
const DELIVERY_TIMEOUT_MS = 45_000;
const DELIVERY_UNKNOWN = 'Chưa xác định cảnh báo đã được gửi. Kiểm tra kênh nhận trước khi gửi lại bằng tay.';
const DELIVERY_FAILED = 'Không gửi được cảnh báo đến kênh nhận.';
const CHECK_FAILED = 'Không thể kiểm tra lịch.';
const PARTIAL_READ = 'Google Calendar chỉ trả về một phần sự kiện trong phạm vi theo dõi.';
const SAFE_EVALUATION_ERRORS = new Set([DELIVERY_UNKNOWN, DELIVERY_FAILED, CHECK_FAILED, PARTIAL_READ]);

class EvaluationInvalidated extends Error {}

interface TriggerEvaluation {
  row: TriggerRow;
  token: string;
  credentialConfig: string;
  deliveryError: string | null;
}

function toIsoOrNull(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toDto(row: TriggerRow): CalendarEventTriggerDto {
  const watchExpIso = row.status === 'active' ? toIsoOrNull(row.watch_expiration) : null;
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
    watchActive: row.status === 'active' && Boolean(watchExpIso),
    watchExpiration: watchExpIso,
    lastCheckedAt: toIsoOrNull(row.last_checked_at),
    lastError: row.last_error ? (SAFE_EVALUATION_ERRORS.has(row.last_error) ? row.last_error : CHECK_FAILED) : null,
    needsAttention: row.needs_attention ?? false,
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
  private readonly mycalendarOAuthClientId?: string;
  private readonly webhookSecret: string;
  private readonly approvalSecret: string;
  private readonly watch?: CalendarTriggerWatchRegistry;
  private readonly getAdapter: CalendarTriggerServiceOptions['getAdapter'];
  private readonly verifyDestination: CalendarTriggerServiceOptions['verifyDestination'];
  private readonly listDestinationsFn: CalendarTriggerServiceOptions['listDestinations'];
  private readonly deliverNotification: CalendarTriggerServiceOptions['deliverNotification'];
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<unknown> | null = null;

  constructor(options: CalendarTriggerServiceOptions) {
    this.pool = options.pool;
    this.encryptionKey = options.encryptionKey;
    this.mycalendarOAuthClientId = options.mycalendarOAuthClientId;
    this.timeZone = options.timeZone ?? 'Asia/Ho_Chi_Minh';
    this.clock = options.clock ?? (() => new Date());
    this.webhookSecret =
      options.webhookSecret ||
      createHash('sha256').update(`mycalendar-watch:${options.encryptionKey ?? 'default-dev'}`).digest('hex');
    this.approvalSecret = options.encryptionKey ?? randomUUID();
    const callbackUrl = parseCalendarWatchCallbackUrl(options.watch?.callbackUrl);
    if (options.watch && callbackUrl) {
      this.watch = new CalendarTriggerWatchRegistry(this.pool, { ...options.watch, callbackUrl },
        (channelId, triggerId) => signCalendarWatchToken(this.webhookSecret, channelId, triggerId), this.clock, this.encryptionKey);
    }
    this.getAdapter = options.getAdapter;
    this.verifyDestination = options.verifyDestination;
    this.listDestinationsFn = options.listDestinations;
    this.deliverNotification = options.deliverNotification;
  }

  private async getAuthorizedMyCalendarScope(
    userId: string,
  ): Promise<{ ok: true; credentialId: string; config: string; email: string; allowedCalendars: Set<string>; refreshToken: string } | { ok: false; reason: string }> {
    const row = (
      await this.pool.query(
        `SELECT sc.id, sc.config, sc.status FROM service_credentials sc
         JOIN users u ON u.id = sc.user_id AND u.status = 'active'
         WHERE sc.service = 'mycalendar' AND sc.user_id = $1 AND sc.workspace_id IS NULL LIMIT 1`,
        [userId],
      )
    ).rows[0];
    if (!row || row.status !== 'active') {
      return { ok: false, reason: 'Kết nối Google Calendar cá nhân chưa sẵn sàng hoặc cần kết nối lại.' };
    }
    if (
      this.mycalendarOAuthClientId &&
      this.encryptionKey &&
      !hasGoogleCredentialOrigin(row.config, this.encryptionKey, this.mycalendarOAuthClientId)
    ) {
      return { ok: false, reason: 'Kết nối Google Calendar cá nhân không khớp cấu hình OAuth hiện tại. Hãy kết nối lại.' };
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
        config: row.config,
        email: typeof dec?.email === 'string' ? dec.email : '',
        refreshToken: typeof dec?.refreshToken === 'string' ? dec.refreshToken : '',
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
      `SELECT t.id, t.user_id, t.name, t.trigger_type, t.credential_id, t.calendar_ids, t.lead_minutes, t.destination,
              t.status, t.pause_reason, t.last_checked_at, t.last_error, t.created_at, t.updated_at,
              (SELECT min(expires_at) FROM (
                 SELECT max(w.expires_at) AS expires_at FROM calendar_trigger_watch_channels w
                 WHERE w.trigger_id = t.id AND w.credential_id = t.credential_id AND t.calendar_ids ? w.calendar_id
                   AND w.callback_url = $2 AND w.registered_at IS NOT NULL AND w.expires_at > $3 AND w.retire_at IS NULL
                 GROUP BY w.calendar_id
               ) live_channels HAVING count(*) = jsonb_array_length(t.calendar_ids)) AS watch_expiration,
              EXISTS (SELECT 1 FROM calendar_trigger_dispatches d WHERE d.trigger_id = t.id AND
                (d.delivery_status = 'needs_attention' OR
                  (d.delivery_status = 'pending' AND d.created_at <= now() - interval '5 minutes'))) AS needs_attention
       FROM calendar_event_triggers t
       WHERE t.user_id = $1
       ORDER BY t.created_at DESC`,
      [userId, this.watch?.callbackUrl ?? null, this.clock()],
    );
    return res.rows.map(toDto);
  }

  private approvalIdentity(userId: string, config: TriggerConfig,
    source: { credentialId: string; refreshToken: string }, destination: VerifiedCalendarTriggerDestination): string {
    return createHmac('sha256', this.approvalSecret).update(JSON.stringify([
      'calendar-trigger-config', userId, config.name, config.triggerType, config.calendarIds, config.leadMinutes,
      source.credentialId, source.refreshToken, destination.service, destination.channelId, destination.credentialId,
      destination.credentialConfig,
    ])).digest('hex');
  }

  private issuePlanHash(approvalHash: string, target: string) {
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS);
    const payload = `${id}.${expiresAt.getTime()}`;
    const signature = createHmac('sha256', this.approvalSecret)
      .update(`calendar-trigger-preview:${target}:${payload}:${approvalHash}`).digest('hex');
    return { planHash: `${payload}.${signature}`, expiresAt: expiresAt.toISOString() };
  }

  private approvalRequired(): CalendarTriggerError {
    return new CalendarTriggerError('CALENDAR_TRIGGER_APPROVAL_REQUIRED', 'Hãy xem trước và xác nhận quy tắc cảnh báo lịch.', 409);
  }

  private verifyPlanHash(planHash: unknown, approvalHash: string, target: string): TriggerApproval {
    if (typeof planHash !== 'string' || planHash.length > 132) throw this.approvalRequired();
    const [id, expiry, signature, extra] = planHash.split('.');
    if (extra !== undefined || !id || !isUuid(id) || !expiry || !/^\d{13}$/.test(expiry) ||
        !signature || !/^[0-9a-f]{64}$/.test(signature)) throw this.approvalRequired();
    const expiresAt = new Date(Number(expiry));
    if (expiresAt.getTime() <= Date.now()) throw this.approvalRequired();
    const expected = createHmac('sha256', this.approvalSecret)
      .update(`calendar-trigger-preview:${target}:${id}.${expiry}:${approvalHash}`).digest('hex');
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))) throw this.approvalRequired();
    return { id, expiresAt };
  }

  private async prepareConfig(userId: string, input: TriggerConfig) {
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

    const trigger = { name: cleanName, triggerType: input.triggerType, calendarIds: calIds.sort(), leadMinutes, destination: safeDest };
    return {
      trigger, credentialId: calAuth.credentialId, sourceEmail: calAuth.email,
      approvalHash: this.approvalIdentity(userId, trigger, calAuth, destCheck.verified),
    };
  }

  async previewTrigger(userId: string, input: TriggerConfig) {
    const { trigger, approvalHash, sourceEmail } = await this.prepareConfig(userId, input);
    return { trigger, sourceEmail, ...this.issuePlanHash(approvalHash, 'create') };
  }

  async createTrigger(userId: string, input: TriggerConfig & { planHash?: unknown }): Promise<CalendarEventTriggerDto> {
    const { trigger, credentialId, approvalHash } = await this.prepareConfig(userId, input);
    const approval = this.verifyPlanHash(input.planHash, approvalHash, 'create');
    // Consumption and cleanup use the same per-nonce lock. Check expiry after acquiring it.
    const inserted = await this.pool.query<TriggerRow>(
      `WITH preview_lock AS MATERIALIZED (
         SELECT pg_advisory_xact_lock(hashtext('calendar-trigger-preview'), hashtext($9::uuid::text)),
                $10::timestamptz AS expires_at
       ), consumed AS (
         INSERT INTO calendar_trigger_consumed_previews (id, expires_at)
         SELECT $9::uuid, expires_at FROM preview_lock WHERE expires_at > clock_timestamp()
         ON CONFLICT DO NOTHING RETURNING id
       ) INSERT INTO calendar_event_triggers(
         user_id, name, trigger_type, credential_id, calendar_ids, lead_minutes, destination, approved_config_hash, status
       ) SELECT $1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8, 'active' FROM consumed
       RETURNING *`,
      [userId, trigger.name, trigger.triggerType, credentialId, JSON.stringify(trigger.calendarIds), trigger.leadMinutes,
        JSON.stringify(trigger.destination), approvalHash, approval.id, approval.expiresAt],
    );
    if (!inserted.rowCount) throw this.approvalRequired();
    return toDto(inserted.rows[0]!);
  }

  private async getTriggerRow(userId: string, triggerId: string): Promise<TriggerRow | undefined> {
    const res = await this.pool.query<TriggerRow>(
      'SELECT * FROM calendar_event_triggers WHERE id = $1 AND user_id = $2', [triggerId, userId],
    );
    return res.rows[0];
  }

  private preparePatch(row: TriggerRow, patch: TriggerPatch) {
    // Re-resolve the existing channel so a new connection can be approved by the owner.
    return this.prepareConfig(row.user_id, {
      name: patch.name === undefined ? row.name : patch.name,
      triggerType: row.trigger_type,
      calendarIds: patch.calendarIds === undefined ? row.calendar_ids : patch.calendarIds,
      leadMinutes: patch.leadMinutes === undefined ? row.lead_minutes : patch.leadMinutes,
      destination: patch.destination === undefined
        ? { service: row.destination.service, channelId: row.destination.channelId, channelName: row.destination.channelName }
        : patch.destination,
    });
  }

  async previewTriggerUpdate(userId: string, triggerId: string, patch: TriggerPatch) {
    const row = await this.getTriggerRow(userId, triggerId);
    if (!row) return null;
    const { trigger, approvalHash, sourceEmail } = await this.preparePatch(row, patch);
    return { trigger, sourceEmail, ...this.issuePlanHash(approvalHash, `${row.id}:${row.version}:${patch.status ?? row.status}`) };
  }

  async updateTrigger(
    userId: string, triggerId: string, patch: TriggerPatch & { planHash?: unknown },
  ): Promise<CalendarEventTriggerDto | null> {
    const row = await this.getTriggerRow(userId, triggerId);
    if (!row) return null;
    if (patch.status !== undefined && patch.status !== 'active' && patch.status !== 'paused') {
      throw new CalendarTriggerError('CALENDAR_TRIGGER_INVALID', 'Trạng thái cập nhật chỉ hỗ trợ active hoặc paused.', 400);
    }

    const changesConfig = [patch.name, patch.leadMinutes, patch.calendarIds, patch.destination].some((value) => value !== undefined);
    const activating = patch.status === 'active';
    const next = changesConfig || activating ? await this.preparePatch(row, patch) : null;
    const status = patch.status ?? row.status;
    const approval = next && (changesConfig || next.approvalHash !== row.approved_config_hash)
      ? this.verifyPlanHash(patch.planHash, next.approvalHash, `${row.id}:${row.version}:${status}`)
      : null;
    const updated = await this.pool.query(
      `WITH eligible AS (
         SELECT id FROM calendar_event_triggers WHERE id = $1 AND user_id = $2 AND version = $11
         FOR UPDATE
       ), preview_lock AS MATERIALIZED (
         SELECT pg_advisory_xact_lock(hashtext('calendar-trigger-preview'), hashtext($12::uuid::text)),
                $13::timestamptz AS expires_at
         FROM eligible WHERE $12::uuid IS NOT NULL
       ), consumed AS (
         INSERT INTO calendar_trigger_consumed_previews (id, expires_at)
         SELECT $12::uuid, expires_at FROM preview_lock WHERE expires_at > clock_timestamp()
         ON CONFLICT DO NOTHING RETURNING id
       ) UPDATE calendar_event_triggers t
       SET name = $3, lead_minutes = $4, calendar_ids = $5::jsonb, credential_id = $6, destination = $7::jsonb,
           status = $8, pause_reason = CASE WHEN $9 THEN NULL ELSE pause_reason END,
           last_error = CASE WHEN $9 THEN NULL ELSE last_error END,
           snapshot = CASE WHEN t.approved_config_hash IS DISTINCT FROM $10 THEN NULL ELSE snapshot END,
           approved_config_hash = $10, version = version + 1, updated_at = now()
       FROM eligible WHERE t.id = eligible.id AND ($12::uuid IS NULL OR EXISTS (SELECT 1 FROM consumed))
       RETURNING t.id`,
      [triggerId, userId, next?.trigger.name ?? row.name, next?.trigger.leadMinutes ?? row.lead_minutes,
        JSON.stringify(next?.trigger.calendarIds ?? row.calendar_ids), next?.credentialId ?? row.credential_id,
        JSON.stringify(next?.trigger.destination ?? row.destination), status, activating, next?.approvalHash ?? row.approved_config_hash,
        row.version, approval?.id ?? null, approval?.expiresAt ?? null],
    );
    if (!updated.rowCount) {
      if (approval) throw this.approvalRequired();
      throw new CalendarTriggerError('CALENDAR_TRIGGER_CHANGED', 'Quy tắc cảnh báo vừa thay đổi. Vui lòng tải lại.', 409);
    }
    return (await this.listTriggers(userId)).find((trigger) => trigger.id === triggerId) ?? null;
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
      `SELECT id, trigger_id, dedupe_key, event_id, summary, created_at, sent_at,
              CASE WHEN delivery_status = 'pending' AND created_at <= now() - interval '5 minutes'
                THEN 'needs_attention' ELSE delivery_status END AS delivery_status
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

  private async markBlocked(row: TriggerRow, token: string, reason: string) {
    const blocked = await this.pool.query(
      `UPDATE calendar_event_triggers t
       SET status = 'blocked', pause_reason = $4, updated_at = now(), version = version + 1
       FROM users u WHERE t.id = $1 AND t.version = $2 AND t.evaluation_id = $3
         AND t.status = 'active' AND t.user_id = u.id AND u.status = 'active'`,
      [row.id, row.version, token, reason],
    );
    if (!blocked.rowCount) throw new EvaluationInvalidated();
    return { evaluated: true, status: 'blocked' as const, pauseReason: reason, notificationsSent: 0, checkedEvents: 0 };
  }

  private async claimAndDeliver(input: {
    evaluation: TriggerEvaluation;
    dedupeKey: string;
    eventId: string;
    summary: string;
    headerTitle: string;
    messageText: string;
    verifiedDest: VerifiedCalendarTriggerDestination;
    signal?: AbortSignal;
  }): Promise<boolean> {
    const { row, token, credentialConfig } = input.evaluation;
    const { credentialId, credentialConfig: destinationConfig } = input.verifiedDest;
    const dedupeKey = input.dedupeKey.length <= 256 ? input.dedupeKey
      : `sha256:${createHash('sha256').update(input.dedupeKey).digest('hex')}`;
    const deadline = AbortSignal.timeout(DELIVERY_TIMEOUT_MS);
    const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
    let dispatchId: string | null = null;
    let duplicate = false;
    const claim = async () => {
      signal.throwIfAborted();
      const result = await this.pool.query<{ id: string | null }>(
        `WITH eligible AS (
           SELECT t.id, t.user_id FROM users u
           JOIN calendar_event_triggers t ON t.user_id = u.id
           JOIN service_credentials sc ON sc.id = t.credential_id AND sc.user_id = u.id
           JOIN service_credentials dest ON dest.id = $9 AND dest.status = 'active' AND dest.config = $10
           WHERE t.id = $1 AND t.version = $2 AND t.evaluation_id = $3 AND t.evaluation_expires_at > now()
             AND t.status = 'active' AND u.status = 'active' AND sc.service = 'mycalendar'
             AND sc.status = 'active' AND sc.config = $4
           FOR SHARE OF u, sc, dest, t
         ), claimed AS (
           INSERT INTO calendar_trigger_dispatches(trigger_id, user_id, dedupe_key, event_id, delivery_status, summary)
           SELECT id, user_id, $5, $6, 'pending', $7 FROM eligible WHERE $8::uuid IS NULL
           ON CONFLICT (trigger_id, dedupe_key) DO NOTHING RETURNING id
         ) SELECT COALESCE($8::uuid, claimed.id) AS id FROM eligible LEFT JOIN claimed ON true`,
        [row.id, row.version, token, credentialConfig, dedupeKey, input.eventId,
          input.summary.slice(0, 200), dispatchId, credentialId, destinationConfig],
      );
      if (!result.rowCount) throw new EvaluationInvalidated();
      dispatchId = result.rows[0]!.id;
      if (!dispatchId) {
        duplicate = true;
        throw new EvaluationInvalidated();
      }
    };
    // Most evaluations see events already dispatched by an earlier tick.
    const existing = await this.pool.query('SELECT 1 FROM calendar_trigger_dispatches WHERE trigger_id = $1 AND dedupe_key IN ($2, $3)',
      [row.id, dedupeKey, input.dedupeKey.slice(0, 256)]);
    if (existing.rowCount) return false;
    try {
      await this.deliverNotification(
        { getAdapter: this.getAdapter },
        {
          userId: row.user_id,
          verified: input.verifiedDest,
          headerTitle: input.headerTitle,
          messageText: input.messageText,
          signal,
          beforeDispatch: claim,
        },
      );
    } catch (error) {
      if (duplicate) return false;
      const invalidated = error instanceof EvaluationInvalidated;
      const unknown = dispatchId !== null && !invalidated && !(error instanceof StepError &&
        (error.details?.requestSent === false || (error.details?.requestSent !== true &&
          ['AUTH_ERROR', 'NOT_FOUND', 'VALIDATION', 'RATE_LIMIT'].includes(error.category))));
      if (dispatchId) {
        await this.pool.query('UPDATE calendar_trigger_dispatches SET delivery_status = $2 WHERE id = $1',
          [dispatchId, unknown ? 'needs_attention' : 'failed']);
      }
      if (invalidated || input.signal?.aborted) throw error;
      if (unknown || input.evaluation.deliveryError === null) {
        input.evaluation.deliveryError = unknown ? DELIVERY_UNKNOWN : DELIVERY_FAILED;
      }
      return false;
    }
    await this.pool.query(
      "UPDATE calendar_trigger_dispatches SET delivery_status = 'sent', sent_at = now() WHERE id = $1",
      [dispatchId],
    );
    return true;
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

    const token = randomUUID();
    const leased = await this.pool.query<TriggerRow>(
      `UPDATE calendar_event_triggers t
       SET evaluation_id = $3, evaluation_expires_at = now() + interval '3 minutes'
       FROM users u WHERE t.id = $1 AND t.version = $2 AND t.user_id = u.id
         AND t.status = 'active' AND u.status = 'active'
         AND (t.evaluation_id IS NULL OR t.evaluation_expires_at <= now())
       RETURNING t.*`,
      [row.id, row.version, token],
    );
    if (!leased.rowCount) {
      return { evaluated: false, status: row.status, pauseReason: row.pause_reason, notificationsSent: 0, checkedEvents: 0 };
    }

    const deadline = AbortSignal.timeout(EVALUATION_TIMEOUT_MS);
    const signal = opts?.signal ? AbortSignal.any([opts.signal, deadline]) : deadline;
    try {
      return await this.evaluate(leased.rows[0]!, token, signal);
    } catch (error) {
      if (!(error instanceof EvaluationInvalidated)) throw error;
      const state = (await this.pool.query<Pick<TriggerRow, 'status' | 'pause_reason'>>(
        'SELECT status, pause_reason FROM calendar_event_triggers WHERE id = $1', [row.id],
      )).rows[0];
      return { evaluated: false, status: state?.status ?? row.status, pauseReason: state?.pause_reason,
        notificationsSent: 0, checkedEvents: 0 };
    } finally {
      await this.pool.query(
        'UPDATE calendar_event_triggers SET evaluation_id = NULL, evaluation_expires_at = NULL WHERE id = $1 AND evaluation_id = $2',
        [row.id, token],
      );
    }
  }

  private async saveEvaluation(
    { row, token, credentialConfig }: TriggerEvaluation,
    error: string | null,
    snapshot?: NonNullable<TriggerRow['snapshot']>,
  ): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE calendar_event_triggers t
       SET snapshot = COALESCE($5::jsonb, snapshot), last_checked_at = now(), last_error = $6, updated_at = now()
       FROM users u, service_credentials sc
       WHERE t.id = $1 AND t.version = $2 AND t.evaluation_id = $3 AND t.evaluation_expires_at > now()
         AND t.status = 'active' AND t.user_id = u.id AND u.status = 'active' AND sc.id = t.credential_id
         AND sc.user_id = u.id AND sc.status = 'active' AND sc.config = $4`,
      [row.id, row.version, token, credentialConfig, snapshot ? JSON.stringify(snapshot) : null, error],
    );
    return Boolean(res.rowCount);
  }

  private async evaluate(row: TriggerRow, token: string, signal: AbortSignal) {
    const approvalReason = 'Quy tắc chưa được duyệt với lịch và đích gửi hiện tại. Hãy xem trước và xác nhận lại.';
    if (!row.approved_config_hash) return this.markBlocked(row, token, approvalReason);
    const calAuth = await this.getAuthorizedMyCalendarScope(row.user_id);
    if (!calAuth.ok) {
      return this.markBlocked(row, token, calAuth.reason);
    }
    if (calAuth.credentialId !== String(row.credential_id)) {
      const reason = 'Kết nối Google Calendar cá nhân đã thay đổi hoặc cần kết nối lại.';
      return this.markBlocked(row, token, reason);
    }
    if (!Array.isArray(row.calendar_ids) || row.calendar_ids.some((c) => !calAuth.allowedCalendars.has(c))) {
      const reason = 'Danh sách lịch Google Calendar được cấp quyền đã thay đổi.';
      return this.markBlocked(row, token, reason);
    }

    const destCheck = await this.verifyDestination(this.pool, row.user_id, row.destination, this.encryptionKey);
    if (!destCheck.ok) {
      return this.markBlocked(row, token, destCheck.pauseReason);
    }
    const currentConfig: TriggerConfig = { name: row.name, triggerType: row.trigger_type, calendarIds: row.calendar_ids,
      leadMinutes: row.lead_minutes, destination: row.destination };
    if (row.approved_config_hash !== this.approvalIdentity(row.user_id, currentConfig, calAuth, destCheck.verified)) {
      return this.markBlocked(row, token, approvalReason);
    }

    const now = this.clock();
    const nowMs = now.getTime();
    let notificationsSent = 0;
    let checkedEvents = 0;
    const evaluation: TriggerEvaluation = { row, token, credentialConfig: calAuth.config, deliveryError: null };

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
        return this.markBlocked(row, token, reason);
      }

      if (row.trigger_type === 'pre_meeting_reminder') {
        const timeMin = new Date(nowMs - 60_000).toISOString();
        const leadMs = Math.max(2, row.lead_minutes) * 60_000;
        const timeMax = new Date(nowMs + leadMs).toISOString();

        for (const calendarId of row.calendar_ids) {
          const listed = await mycalAdapter.execute(
            'mycalendar.list_events',
            { calendarId, timeMin, timeMax, limit: 20 },
            { signal },
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
              evaluation,
              dedupeKey,
              eventId: String(ev.id),
              summary: String(ev.title || ''),
              headerTitle: 'Nhắc lịch họp sắp diễn ra',
              messageText: lines.join('\n'),
              verifiedDest: destCheck.verified,
              signal,
            });
            if (sent) notificationsSent++;
          }
        }

        signal.throwIfAborted();
        const evaluated = await this.saveEvaluation(evaluation, evaluation.deliveryError);
        return { evaluated, status: 'active' as const, notificationsSent, checkedEvents };
      }

      // event_change_watch
      const timeMin = new Date(nowMs - 60_000).toISOString();
      const timeMax = new Date(nowMs + 14 * 86_400_000).toISOString();
      const prevSnapshot = row.snapshot ?? null;
      const nextSnapshot = Object.create(null) as NonNullable<TriggerRow['snapshot']>;
      let partialRead = false;
      const todayIso = now.toISOString().slice(0, 10);

      for (const calendarId of row.calendar_ids) {
        const listed = await mycalAdapter.execute(
          'mycalendar.list_events',
          { calendarId, timeMin, timeMax, limit: 20 },
          { signal },
        );
        const events = Array.isArray(listed?.events) ? listed.events : [];
        checkedEvents += events.length;
        const complete = listed?.coverage?.complete === true;
        partialRead ||= !complete;

        const currMap = Object.create(null) as Record<string, StoredEventSnapshot>;
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

        const prevMap = prevSnapshot && Object.hasOwn(prevSnapshot, calendarId) ? prevSnapshot[calendarId] : undefined;
        nextSnapshot[calendarId] = !complete && prevMap ? { ...prevMap, ...currMap } : currMap;

        if (prevMap) {
          for (const [evId, curr] of Object.entries(currMap)) {
            const prev = Object.hasOwn(prevMap, evId) ? prevMap[evId] : undefined;
            if (!prev) {
              const titleSafe = escapeDigestText(curr.title);
              const msg = [
                `📅 *Sự kiện vừa được phát hiện trên lịch*: *${titleSafe}*`,
                `🕒 Thời gian: ${formatLocalRange(curr.start, curr.end, this.timeZone)}`,
                ...(curr.meetLink ? [`🎥 Meet: ${curr.meetLink}`] : []),
              ].join('\n');
              const sent = await this.claimAndDeliver({
                evaluation,
                dedupeKey: `chg:add:${calendarId}:${evId}:${curr.start}`,
                eventId: evId,
                summary: curr.title,
                headerTitle: 'Sự kiện vừa được phát hiện trên Google Calendar',
                messageText: msg,
                verifiedDest: destCheck.verified,
                signal,
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
                evaluation,
                dedupeKey: `chg:upd:${calendarId}:${evId}:${curr.start}:${curr.end}:${curr.title.slice(0, 60)}`,
                eventId: evId,
                summary: curr.title,
                headerTitle: 'Cập nhật lịch họp trên Google Calendar',
                messageText: msg,
                verifiedDest: destCheck.verified,
                signal,
              });
              if (sent) notificationsSent++;
            }
          }

          for (const [prevId, prev] of complete ? Object.entries(prevMap) : []) {
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
              evaluation,
              dedupeKey: `chg:del:${calendarId}:${prevId}:${prev.start}`,
              eventId: prevId,
              summary: prev.title,
              headerTitle: 'Lịch họp bị huỷ trên Google Calendar',
              messageText: msg,
              verifiedDest: destCheck.verified,
              signal,
            });
            if (sent) notificationsSent++;
          }
        }
      }

      signal.throwIfAborted();
      const evaluated = await this.saveEvaluation(evaluation,
        evaluation.deliveryError ?? (partialRead ? PARTIAL_READ : null),
        nextSnapshot);
      if (evaluated) {
        await this.watch?.ensure({ triggerId: row.id, version: row.version, evaluationId: token,
          userId: row.user_id, credentialId: calAuth.credentialId, credentialConfig: calAuth.config,
          calendarIds: row.calendar_ids, refreshToken: calAuth.refreshToken }, signal);
      }
      return {
        evaluated,
        status: 'active' as const,
        notificationsSent,
        ...(prevSnapshot === null ? { baselineSeeded: true } : {}),
        checkedEvents,
      };
    } catch (error) {
      if (error instanceof EvaluationInvalidated) {
        if (!notificationsSent) throw error;
        return { evaluated: false, status: 'active' as const, notificationsSent, checkedEvents };
      }
      if (error instanceof StepError && error.category === 'AUTH_ERROR') {
        const reason = 'Quyền truy cập Google Calendar đã hết hạn hoặc bị thu hồi. Hãy kết nối lại.';
        return { ...await this.markBlocked(row, token, reason), notificationsSent, checkedEvents };
      }
      const evaluated = await this.saveEvaluation(evaluation, evaluation.deliveryError ?? CHECK_FAILED);
      return { evaluated, status: 'active' as const, notificationsSent, checkedEvents };
    }
  }

  async evaluateAllActiveTriggers(signal?: AbortSignal): Promise<{ evaluated: number; notificationsSent: number }> {
    await this.pool.query(
      `WITH expired_previews AS (
           DELETE FROM calendar_trigger_consumed_previews
           WHERE CASE WHEN expires_at <= clock_timestamp()
             THEN pg_try_advisory_xact_lock(hashtext('calendar-trigger-preview'), hashtext(id::text)) ELSE false END
         ),
            expired_channels AS (DELETE FROM calendar_trigger_watch_channels WHERE expires_at <= $1)
       UPDATE calendar_trigger_dispatches SET delivery_status = 'needs_attention'
       WHERE delivery_status = 'pending' AND created_at <= now() - interval '5 minutes'`,
      [this.clock()],
    );
    const active = await this.pool.query<{ id: string }>(
      `SELECT t.id FROM calendar_event_triggers t JOIN users u ON u.id = t.user_id
       WHERE t.status = 'active' AND u.status = 'active' ORDER BY t.updated_at ASC LIMIT 100`,
    );
    let evaluated = 0;
    let notificationsSent = 0;
    for (const row of active.rows) {
      if (signal?.aborted) break;
      try {
        const res = await this.evaluateTriggerById(String(row.id), { signal });
        if (res.evaluated) evaluated++;
        notificationsSent += res.notificationsSent;
      } catch (error) {
        if (!(error instanceof CalendarTriggerError && error.statusCode === 404)) throw error;
      }
    }
    await this.watch?.clean({ signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
    return { evaluated, notificationsSent };
  }

  async stopUserWatchChannels(userId: string): Promise<void> {
    await this.watch?.clean({ userId, signal: AbortSignal.timeout(10_000) });
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
    const resourceState = pick('x-goog-resource-state');
    const resourceId = pick('x-goog-resource-id');

    const verifiedTriggerId = verifyCalendarWatchToken(this.webhookSecret, channelId, token);
    if (!this.watch || !verifiedTriggerId || !isUuid(verifiedTriggerId) || !isUuid(channelId) ||
        !resourceId || resourceId.length > 512 || !['sync', 'exists', 'not_exists'].includes(resourceState)) {
      throw new CalendarTriggerError('MYCALENDAR_WEBHOOK_UNAUTHORIZED', 'Webhook token không hợp lệ.', 401);
    }

    if (resourceState === 'sync') {
      // Google can send sync before events.watch returns its resource ID.
      const synced = await this.pool.query(
        `UPDATE calendar_trigger_watch_channels SET resource_id = $4
         WHERE channel_id = $1 AND trigger_id = $2 AND callback_url = $3
           AND expires_at > $5 AND (resource_id IS NULL OR resource_id = $4)`,
        [channelId, verifiedTriggerId, this.watch.callbackUrl, resourceId, this.clock()],
      );
      if (!synced.rowCount) throw new CalendarTriggerError('MYCALENDAR_WEBHOOK_UNAUTHORIZED', 'Kênh webhook chưa được đăng ký.', 401);
      return { accepted: true, resourceState, notificationsSent: 0 };
    }

    const rowRes = await this.pool.query<{ eligible: boolean }>(
      `SELECT COALESCE(t.status = 'active' AND u.status = 'active' AND sc.status = 'active'
          AND t.credential_id = w.credential_id AND t.calendar_ids ? w.calendar_id
          AND w.registered_at IS NOT NULL AND w.expires_at > $5 AND w.retire_at IS NULL, false) AS eligible
       FROM calendar_trigger_watch_channels w
       LEFT JOIN calendar_event_triggers t ON t.id = w.trigger_id
       JOIN users u ON u.id = w.user_id
       LEFT JOIN service_credentials sc ON sc.id = w.credential_id AND sc.user_id = w.user_id AND sc.service = 'mycalendar'
       WHERE w.channel_id = $1 AND w.trigger_id = $2 AND w.callback_url = $3 AND w.resource_id = $4`,
      [channelId, verifiedTriggerId, this.watch.callbackUrl, resourceId, this.clock()],
    );
    const channel = rowRes.rows[0];
    if (!channel) {
      throw new CalendarTriggerError('MYCALENDAR_WEBHOOK_UNAUTHORIZED', 'Kênh webhook chưa được đăng ký.', 401);
    }
    if (!channel.eligible) {
      return { accepted: true, resourceState, notificationsSent: 0 };
    }

    const evalRes = await this.evaluateTriggerById(verifiedTriggerId, { signal });
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
    runTick();
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
