import type pg from 'pg';
import type { MyCalendarDigestSourceBinding, PlanConnections, TelegramDigestSource } from '@wap/tool-schemas';
import { isUuid } from '../../db/repositories/uuid.js';
import { createMyCalendarConnectionLookup } from '../gmail/connection-reference.js';

export type MyCalendarDigestConnection = NonNullable<PlanConnections['mycalendar']>;
export const MYCALENDAR_DIGEST_CALENDAR_LIMIT = 5;
export const MYCALENDAR_DIGEST_REAPPROVAL =
  'Kết nối hoặc phạm vi Google Calendar của bản tin đã thay đổi. Hãy cấp quyền lại và xác nhận bản xem trước mới.';

export type MyCalendarDigestConfig = { sources?: TelegramDigestSource[] };

function isCalendarId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id === id.trim();
}

export function isMyCalendarDigestSource(source: TelegramDigestSource | null | undefined): boolean {
  return source?.service === 'mycalendar' || (typeof source?.tool === 'string' && source.tool.startsWith('mycalendar.')) ||
    source?.mycalendarBinding !== undefined;
}

export function approvedMyCalendarDigestBinding(source: TelegramDigestSource): MyCalendarDigestSourceBinding | null {
  const binding = source.mycalendarBinding;
  if (
    source.service !== 'mycalendar' || source.tool !== 'mycalendar.list_events' ||
    !binding || typeof binding.credentialId !== 'string' || !isUuid(binding.credentialId) ||
    typeof binding.email !== 'string' || !binding.email.trim() ||
    typeof binding.truncated !== 'boolean' || !Array.isArray(binding.calendarIds) ||
    binding.calendarIds.length === 0 || binding.calendarIds.length > MYCALENDAR_DIGEST_CALENDAR_LIMIT ||
    !binding.calendarIds.every(isCalendarId) || new Set(binding.calendarIds).size !== binding.calendarIds.length
  ) return null;
  const explicitId = source.args?.calendarId;
  if (explicitId !== undefined && (binding.calendarIds.length !== 1 || binding.calendarIds[0] !== explicitId)) return null;
  return binding;
}

export function readMyCalendarDigestBinding(config: MyCalendarDigestConfig | null | undefined, services: readonly string[] | null):
  { kind: 'none' } | { kind: 'invalid' } | { kind: 'bound'; binding: MyCalendarDigestSourceBinding } {
  const sources = Array.isArray(config?.sources) ? config.sources.filter(isMyCalendarDigestSource) : [];
  if (sources.length === 0) return { kind: services?.includes('mycalendar') ? 'invalid' : 'none' };
  const binding = sources.length === 1 ? approvedMyCalendarDigestBinding(sources[0]!) : null;
  return binding ? { kind: 'bound', binding } : { kind: 'invalid' };
}

export function matchesMyCalendarDigestBinding(
  live: MyCalendarDigestConnection | null | undefined,
  binding: MyCalendarDigestSourceBinding,
): boolean {
  return Boolean(live && live.credentialId === binding.credentialId && live.email === binding.email &&
    binding.calendarIds.every(id => live.allowedCalendars.includes(id)));
}

export function bindMyCalendarDigestSource(
  source: TelegramDigestSource,
  live: MyCalendarDigestConnection | null | undefined,
  previous: TelegramDigestSource | undefined,
  reauthorize: boolean,
): TelegramDigestSource | null {
  if (!live || !isUuid(live.credentialId) || !live.email.trim()) return null;

  if (previous && !reauthorize) {
    const binding = approvedMyCalendarDigestBinding(previous);
    return binding && matchesMyCalendarDigestBinding(live, binding) ? previous : null;
  }

  const selected = [...new Set(live.allowedCalendars.filter(isCalendarId))];
  const explicitId = previous?.args?.calendarId;
  if (explicitId !== undefined && (!isCalendarId(explicitId) || !selected.includes(explicitId))) return null;
  const calendarIds = explicitId !== undefined ? [explicitId] : selected.slice(0, MYCALENDAR_DIGEST_CALENDAR_LIMIT);
  if (calendarIds.length === 0) return null;
  const truncated = explicitId === undefined && selected.length > calendarIds.length;
  return {
    ...source,
    ...(previous?.args ? { args: previous.args } : {}),
    mycalendarBinding: { credentialId: live.credentialId, email: live.email, calendarIds, truncated },
  };
}

export async function loadLiveMyCalendarDigestConnection(
  pool: Pick<pg.Pool, 'query'>,
  userId: string,
  encryptionKey?: string,
  options?: { oauthClientId?: string; lock?: 'share' | 'nowait' },
): Promise<MyCalendarDigestConnection | null> {
  if (!encryptionKey) return null;
  const lockClause = options?.lock === 'nowait' ? 'FOR SHARE NOWAIT' : options?.lock === 'share' ? 'FOR SHARE' : '';
  const lookup = createMyCalendarConnectionLookup({
    async getPersonalCredentials(service, ownerId) {
      const { rows } = await pool.query(
        `SELECT * FROM service_credentials
         WHERE service = $1 AND user_id = $2 AND workspace_id IS NULL AND status = 'active' ${lockClause}`,
        [service, ownerId],
      );
      return rows[0] ?? null;
    },
  }, encryptionKey, options?.oauthClientId);
  return lookup(userId);
}
