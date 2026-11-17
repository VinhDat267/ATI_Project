import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type pg from 'pg';
import { decryptCredentials } from '@wap/tool-adapters';
import type { GmailTokenManager } from '../gmail/token-manager.js';

const WATCH_TTL_SECONDS = 60 * 60;
const RENEW_BEFORE_MS = 10 * 60_000;
const RETRY_AFTER_MS = 5 * 60_000;
const GOOGLE_DEADLINE_MS = 10_000;

export interface CalendarTriggerWatchOptions {
  callbackUrl: string;
  apiBaseUrl: string;
  tokens: Pick<GmailTokenManager, 'forConnection'>;
  fetchFn?: typeof fetch;
}

export function parseCalendarWatchCallbackUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        url.pathname !== '/api/connections/mycalendar/webhook' || !url.hostname.includes('.') ||
        isIP(url.hostname) || /\.(?:localhost|local|internal)\.?$/i.test(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

interface WatchSource {
  triggerId: string;
  version: string;
  evaluationId: string;
  userId: string;
  credentialId: string;
  credentialConfig: string;
  calendarIds: string[];
  refreshToken: string;
}

interface WatchToStop {
  channel_id: string;
  resource_id: string;
  user_id: string;
  credential_id: string;
  config: string;
}

export class CalendarTriggerWatchRegistry {
  constructor(
    private readonly pool: pg.Pool,
    private readonly options: CalendarTriggerWatchOptions,
    private readonly sign: (channelId: string, triggerId: string) => string,
    private readonly clock: () => Date,
    private readonly encryptionKey?: string,
  ) {}

  get callbackUrl(): string {
    return this.options.callbackUrl;
  }

  private async googlePost(path: string, accessToken: string, body: object, signal: AbortSignal): Promise<Response> {
    return (this.options.fetchFn ?? fetch)(new URL(path, this.options.apiBaseUrl), {
      method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async ensure(source: WatchSource, signal: AbortSignal): Promise<void> {
    if (!source.refreshToken) return;
    const provider = this.options.tokens.forConnection(source.userId, source.credentialId, source.refreshToken);
    for (const calendarId of source.calendarIds) {
      if (signal.aborted) break;
      const now = this.clock();
      const renewAt = new Date(now.getTime() + RENEW_BEFORE_MS);
      const retryAfter = new Date(now.getTime() - RETRY_AFTER_MS);
      const expiresAt = new Date(now.getTime() + WATCH_TTL_SECONDS * 1000);
      const channelId = randomUUID();
      const reserved = await this.pool.query(
        `INSERT INTO calendar_trigger_watch_channels
           (channel_id, trigger_id, user_id, credential_id, calendar_id, callback_url, requested_at, expires_at)
         SELECT $1, t.id, t.user_id, t.credential_id, $6, $7, $8, $9
         FROM users u
         JOIN calendar_event_triggers t ON t.user_id = u.id
         JOIN service_credentials sc ON sc.id = t.credential_id AND sc.user_id = u.id
         WHERE t.id = $2 AND t.version = $3 AND t.evaluation_id = $4 AND t.evaluation_expires_at > now()
           AND t.status = 'active' AND u.status = 'active' AND sc.status = 'active' AND sc.service = 'mycalendar'
           AND sc.config = $5 AND t.calendar_ids ? $6
           AND NOT EXISTS (
             SELECT 1 FROM calendar_trigger_watch_channels w
             WHERE w.trigger_id = t.id AND w.calendar_id = $6 AND w.credential_id = t.credential_id
               AND w.callback_url = $7 AND w.retire_at IS NULL AND
               ((w.registered_at IS NOT NULL AND w.expires_at > $10) OR
                (w.registered_at IS NULL AND w.requested_at > $11))
           )
         FOR SHARE OF u, sc, t`,
        [channelId, source.triggerId, source.version, source.evaluationId, source.credentialConfig, calendarId,
          this.callbackUrl, now, expiresAt, renewAt, retryAfter],
      );
      if (!reserved.rowCount) continue;
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(GOOGLE_DEADLINE_MS)]);
      try {
        const accessToken = await provider.getAccessToken({ signal: requestSignal });
        const current = await this.pool.query(
          `SELECT 1 FROM users u JOIN calendar_event_triggers t ON t.user_id = u.id
           JOIN service_credentials sc ON sc.id = t.credential_id AND sc.user_id = u.id
           JOIN calendar_trigger_watch_channels w ON w.trigger_id = t.id AND w.channel_id = $6
           WHERE t.id = $1 AND t.version = $2 AND t.evaluation_id = $3 AND t.evaluation_expires_at > now()
             AND t.status = 'active' AND u.status = 'active' AND sc.status = 'active' AND sc.service = 'mycalendar'
             AND sc.config = $4 AND t.calendar_ids ? $5 AND w.retire_at IS NULL
           FOR SHARE OF u, sc, t, w`,
          [source.triggerId, source.version, source.evaluationId, source.credentialConfig, calendarId, channelId],
        );
        if (!current.rowCount) continue;
        requestSignal.throwIfAborted();
        const response = await this.googlePost(`/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/watch`, accessToken, {
          id: channelId,
          type: 'web_hook',
          address: this.callbackUrl,
          token: this.sign(channelId, source.triggerId),
          params: { ttl: String(WATCH_TTL_SECONDS) },
        }, requestSignal);
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          continue;
        }
        const { id, resourceId, expiration } = await response.json();
        if (id !== channelId || typeof resourceId !== 'string' || !resourceId || resourceId.length > 512) continue;
        const returnedExpiry = expiration == null ? expiresAt.getTime() : Number(expiration);
        if (!Number.isSafeInteger(returnedExpiry) || returnedExpiry <= now.getTime()) continue;
        const registered = await this.pool.query(
          `UPDATE calendar_trigger_watch_channels SET resource_id = $2, registered_at = $3, expires_at = $4
           WHERE channel_id = $1 AND (resource_id IS NULL OR resource_id = $2) AND retire_at IS NULL`,
          [channelId, resourceId, now, new Date(Math.min(returnedExpiry, expiresAt.getTime()))],
        );
        if (!registered.rowCount) continue;
        await this.pool.query(
          `UPDATE calendar_trigger_watch_channels SET retire_at = $4
           WHERE trigger_id = $1 AND calendar_id = $2 AND channel_id <> $3 AND requested_at <= $4`,
          [source.triggerId, calendarId, channelId, now],
        );
      } catch {
        // Polling remains available. The reservation backs off the next registration attempt.
      }
    }
  }

  async clean({ userId, signal }: { userId?: string; signal?: AbortSignal } = {}): Promise<void> {
    const now = this.clock();
    if (userId) {
      await this.pool.query('UPDATE calendar_trigger_watch_channels SET retire_at = $2 WHERE user_id = $1 AND retire_at IS NULL', [userId, now]);
    }
    const rows = await this.pool.query<WatchToStop>(
      `SELECT w.channel_id, w.user_id, w.credential_id, w.resource_id, sc.config
       FROM calendar_trigger_watch_channels w
       LEFT JOIN calendar_event_triggers t ON t.id = w.trigger_id
       JOIN users u ON u.id = w.user_id
       JOIN service_credentials sc ON sc.id = w.credential_id AND sc.user_id = w.user_id
       WHERE w.resource_id IS NOT NULL AND sc.service = 'mycalendar' AND sc.status = 'active'
         AND ($2::uuid IS NULL OR w.user_id = $2) AND w.expires_at > $3
         AND (w.retire_at IS NOT NULL OR t.id IS NULL OR t.status <> 'active' OR u.status <> 'active' OR
           t.credential_id <> w.credential_id OR NOT (t.calendar_ids ? w.calendar_id) OR w.callback_url <> $1)
       ORDER BY w.expires_at LIMIT 25`,
      [this.callbackUrl, userId ?? null, now],
    );
    for (const row of rows.rows) {
      if (signal?.aborted) break;
      const deadline = AbortSignal.timeout(GOOGLE_DEADLINE_MS);
      const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
      try {
        const config = this.encryptionKey ? decryptCredentials(row.config, this.encryptionKey) : JSON.parse(row.config);
        if (typeof config?.refreshToken !== 'string' || !config.refreshToken) continue;
        const provider = this.options.tokens.forConnection(row.user_id, row.credential_id, config.refreshToken);
        const accessToken = await provider.getAccessToken({ signal: requestSignal });
        const response = await this.googlePost('/calendar/v3/channels/stop', accessToken, {
          id: row.channel_id, resourceId: row.resource_id,
        }, requestSignal);
        await response.body?.cancel().catch(() => {});
        if (response.ok || response.status === 404 || response.status === 410) {
          await this.pool.query('DELETE FROM calendar_trigger_watch_channels WHERE channel_id = $1', [row.channel_id]);
        }
      } catch {
        // An unavailable grant or network can leave a channel at Google until its short TTL expires.
      }
    }
  }
}
