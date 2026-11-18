import type pg from 'pg';
import { detectCalendarConflicts, GMAIL_DIGEST_READ_TOOL, quoteSheetTitle, StepError } from '@wap/tool-adapters';
import type {
  GmailDigestBinding,
  NotionDigestSourceBinding,
  ScheduleRecurrence,
  TelegramDigestSource,
} from '@wap/tool-schemas';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';
import type { AdapterContext } from '../adapter-factory.js';
import { GmailOAuthError } from '../gmail/oauth-client.js';
import { isGoogleConnectionChanged } from '../gmail/token-manager.js';
import { createMyCalendarConnectionLookup, createMySheetsConnectionLookup, type MySheetsConnectionLookupResult } from '../gmail/connection-reference.js';
import { matchesMyCalendarDigestBinding, MYCALENDAR_DIGEST_REAPPROVAL, readMyCalendarDigestBinding } from './mycalendar-digest-source.js';
import {
  matchesMySheetsDigestBinding,
  MYSHEETS_DIGEST_DEFAULT_RANGE,
  MYSHEETS_DIGEST_REAPPROVAL,
  MYSHEETS_DIGEST_ROW_LIMIT,
  readMySheetsDigestBinding,
} from './mysheets-digest-source.js';
import { analyzeSheetKpiMetrics } from './sheets-digest-runner.js';
import { buildTelegramDigestSourceArgs } from './multi-source-digest-candidate.js';
import { assertGmailDigestBinding, isValidGmailDigestQuery } from './gmail-digest-binding.js';
import { isNotionSourceDenied, type NotionDigestSourceAuthority } from '../notion/digest-source-authority.js';
import {
  formatAssigneeForSlack,
  type SlackMentionIndex,
} from '../slack/slack-mention-resolver.js';

export type DigestSourceRunStatus = {
  service: string;
  label: string;
  status: 'ok' | 'partial_error' | 'empty';
  truncated?: boolean;
  itemCount?: number;
  error?: string;
};

export function isGmailAuthOrBindingFailure(error: unknown): boolean {
  if (isGoogleConnectionChanged(error)) return true;
  if (error instanceof GmailOAuthError && error.kind === 'invalid_grant') return true;
  if (error instanceof StepError) {
    if (error.category === 'AUTH_ERROR' || error.statusCode === 401 || error.statusCode === 403) {
      return true;
    }
  }
  const anyErr = error as Record<string, unknown> | null | undefined;
  if (anyErr && typeof anyErr === 'object') {
    if (
      anyErr.category === 'AUTH_ERROR' ||
      anyErr.statusCode === 401 ||
      anyErr.statusCode === 403
    ) {
      return true;
    }
  }
  return false;
}

export function summarizeSourceItems(
  service: string,
  raw: unknown,
  now: Date = new Date(),
  options?: { mentionIndex?: SlackMentionIndex | null; escapeText?: (value: string) => string; timeZone?: string },
): { count: number; lines: string[]; truncated?: boolean } {
  const esc = options?.escapeText ?? ((v: string) => v);
  if (
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    Array.isArray((raw as any).multiSheets)
  ) {
    const rawObj = raw as Record<string, any>;
    const sheetEntries = rawObj.multiSheets as Array<Record<string, any>>;
    let totalRows = 0;
    const lines: string[] = [];
    const highlights: string[] = [];
    let anyTruncated = Boolean(rawObj.truncated);
    for (const entry of sheetEntries) {
      const values: string[][] = Array.isArray(entry.values) ? entry.values : [];
      const headers: string[] = Array.isArray(entry.headers)
        ? entry.headers
        : Array.isArray(values[0])
          ? values[0]
          : [];
      const records: Array<Record<string, string>> = Array.isArray(entry.records) ? entry.records : [];
      const kpi = analyzeSheetKpiMetrics(headers, records, values, now);
      if (entry.truncated === true) anyTruncated = true;
      totalRows += kpi.totalRows;
      const title =
        typeof entry.spreadsheetTitle === 'string' && entry.spreadsheetTitle.trim()
          ? esc(entry.spreadsheetTitle.trim())
          : 'Bảng tính';
      const scope = typeof entry.scannedRange === 'string' ? ` · Phạm vi quét: ${esc(entry.scannedRange)}` : '';
      lines.push(
        `  📊 📄 ${title}: ${kpi.totalRows} dòng (✅ Xong: ${kpi.doneCount} · 🔄 Đang làm: ${kpi.inProgressCount} · ⚠️ Chờ/Quá hạn: ${kpi.overdueOrPendingCount})${scope}`,
      );
      for (const h of kpi.highlights) {
        if (highlights.length < 6) highlights.push(`  [${title}] ${esc(h)}`);
      }
    }
    const allLines = [...lines, ...highlights];
    if (anyTruncated) {
      allLines.push('  ⚠️ (Dữ liệu bảng tính có thể chưa đầy đủ do chạm giới hạn tải/số bảng tính)');
    }
    return { count: totalRows, lines: allLines, ...(anyTruncated ? { truncated: true } : {}) };
  }
  if (
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    (Array.isArray((raw as any).records) || Array.isArray((raw as any).values))
  ) {
    const rawObj = raw as Record<string, any>;
    const values: string[][] = Array.isArray(rawObj.values) ? rawObj.values : [];
    const headers: string[] = Array.isArray(rawObj.headers)
      ? rawObj.headers
      : Array.isArray(values[0])
        ? values[0]
        : [];
    const records: Array<Record<string, string>> = Array.isArray(rawObj.records) ? rawObj.records : [];
    const kpi = analyzeSheetKpiMetrics(headers, records, values, now);
    const sheetTruncated = Boolean(rawObj.truncated);
    const sheetTitle =
      typeof rawObj.spreadsheetTitle === 'string' && rawObj.spreadsheetTitle.trim()
        ? `📄 ${esc(rawObj.spreadsheetTitle.trim())}: `
        : '';
    const sheetLines = kpi.totalRows === 0
      ? ['  (Không có mục mới)']
      : [
          `  📊 ${sheetTitle}${kpi.totalRows} dòng (✅ Xong: ${kpi.doneCount} · 🔄 Đang làm: ${kpi.inProgressCount} · ⚠️ Chờ/Quá hạn: ${kpi.overdueOrPendingCount})`,
          ...kpi.highlights.map((h) => `  ${esc(h)}`),
        ];
    if (typeof rawObj.scannedRange === 'string') {
      sheetLines.splice(1, 0, `  Phạm vi quét: ${esc(rawObj.scannedRange)}`);
    }
    if (sheetTruncated) {
      sheetLines.push('  ⚠️ (Dữ liệu bảng tính có thể chưa đầy đủ do chạm giới hạn tải/số bảng tính)');
    }
    return {
      count: kpi.totalRows,
      lines: sheetLines,
      ...(sheetTruncated ? { truncated: true } : {}),
    };
  }

  let items: any[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as any).items)
      ? (raw as any).items
      : raw && typeof raw === 'object' && Array.isArray((raw as any).events)
        ? (raw as any).events
        : raw && typeof raw === 'object' && Array.isArray((raw as any).issues)
          ? (raw as any).issues
          : raw && typeof raw === 'object' && Array.isArray((raw as any).cards)
            ? (raw as any).cards
            : raw && typeof raw === 'object' && Array.isArray((raw as any).threads)
              ? (raw as any).threads
              : raw && typeof raw === 'object' && Array.isArray((raw as any).rows)
                ? (raw as any).rows
                : raw && typeof raw === 'object' && Array.isArray((raw as any).pages)
                  ? (raw as any).pages
                  : raw && typeof raw === 'object' && Array.isArray((raw as any).databases)
                    ? (raw as any).databases
                    : [];

  if (
    items.length > 1 &&
    items.every((ev) => ev && typeof ev === 'object' && typeof ev.start === 'string' && typeof ev.end === 'string')
  ) {
    try {
      items = detectCalendarConflicts(
        items.map((ev, i) => ({
          id: String(ev.id ?? `ev_${i}`),
          title: String(ev.title ?? ev.summary ?? `Sự kiện #${i + 1}`),
          start: ev.start,
          end: ev.end,
          url: String(ev.url ?? ''),
          ...ev,
        })),
        { annotateConflicts: true, timeZone: options?.timeZone },
      );
    } catch {
      // Keep original items if date parsing fails
    }
  }

  const sourceTruncated =
    (service === 'notion' || service === 'mycalendar' || service === 'calendar') &&
    raw != null &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    (Boolean((raw as Record<string, unknown>).truncated) ||
      ((raw as any).coverage &&
        typeof (raw as any).coverage === 'object' &&
        (raw as any).coverage.complete === false));
  const truncation = sourceTruncated ? { truncated: true } : {};

  if (items.length === 0) {
    return { count: 0, lines: ['  (Không có mục mới)'], ...truncation };
  }

  const nowMs = now.getTime();
  const soonLimitMs = nowMs + 24 * 3600_000;
  const maxItems = service === 'gmail' ? 10 : 5;
  const mentionIndex = options?.mentionIndex ?? null;

  const lines = items.slice(0, maxItems).map((item, idx) => {
    if (typeof item === 'string') return `  ${idx + 1}. ${esc(item)}`;
    if (Array.isArray(item)) return `  ${idx + 1}. ${esc(item.join(' | '))}`;
    const title =
      item?.title ??
      item?.summary ??
      item?.name ??
      item?.subject ??
      item?.key ??
      item?.id ??
      `Mục #${idx + 1}`;
    const safeTitle = esc(String(title));
    if (item && typeof item === 'object' && ('dueComplete' in item || 'due' in item || Array.isArray(item.idMembers))) {
      const badges: string[] = [];
      if (item?.dueComplete !== true && typeof item?.due === 'string' && item.due) {
        const dueMs = Date.parse(item.due);
        if (!Number.isNaN(dueMs)) {
          if (dueMs < nowMs) badges.push('🚨 [Quá hạn]');
          else if (dueMs <= soonLimitMs) badges.push('⏰ [Sắp đến hạn]');
        }
      }
      const unassigned =
        Array.isArray(item?.idMembers) && item.idMembers.length === 0 ? ' (chưa gán)' : '';
      const badgePrefix = badges.length > 0 ? `${badges.join(' ')} ` : '';
      return `  - ${badgePrefix}${safeTitle}${unassigned}`;
    }
    if (service === 'gmail' && item && typeof item === 'object') {
      const from = typeof item.from === 'string' && item.from.trim() ? `[${esc(item.from.trim())}] ` : '';
      const attachmentNames = Array.isArray(item.attachmentNames) ? item.attachmentNames.filter((n: unknown) => typeof n === 'string' && n.trim()) : [];
      const attachmentBadge =
        attachmentNames.length > 0
          ? ` 📎 (${attachmentNames.slice(0, 2).map((n: string) => esc(n)).join(', ')})`
          : item.hasAttachment === true
            ? ' 📎'
            : '';
      const rawSnippet = typeof item.snippet === 'string' ? item.snippet.replace(/\s+/g, ' ').trim() : '';
      const snippetSuffix = rawSnippet ? ` — ${esc(rawSnippet.length > 80 ? `${rawSnippet.slice(0, 77)}...` : rawSnippet)}` : '';
      return `  - ${from}${safeTitle}${attachmentBadge}${snippetSuffix}`;
    }
    if (item && typeof item === 'object' && typeof item.start === 'string') {
      const timeRange =
        typeof item.start === 'string' && typeof item.end === 'string'
          ? ` (${esc(item.start)} → ${esc(item.end)})`
          : ` (${esc(item.start)})`;
      const conflictBadge =
        item.conflict === true && Array.isArray(item.conflictsWith) && item.conflictsWith.length > 0
          ? `⚠️ [Trùng lịch: ${item.conflictsWith.map((c: unknown) => esc(String(c))).join(', ')}] `
          : '';
      const extras: string[] = [];
      if (typeof item.meetLink === 'string' && item.meetLink) extras.push(`🎥 ${esc(item.meetLink)}`);
      if (typeof item.location === 'string' && item.location) extras.push(`📍 ${esc(item.location)}`);
      const extraSuffix = extras.length > 0 ? ` — ${extras.join(' | ')}` : '';
      return `  - ${conflictBadge}${safeTitle}${timeRange}${extraSuffix}`;
    }
    if (service === 'notion' && item && typeof item === 'object') {
      const propBadges: string[] = [];
      if (item.properties && typeof item.properties === 'object') {
        for (const [k, v] of Object.entries(item.properties as Record<string, unknown>)) {
          if (typeof v === 'string' && v.trim()) {
            propBadges.push(`${esc(k)}: ${esc(v.trim())}`);
          }
        }
      }
      const badgeSuffix = propBadges.length > 0 ? ` (${propBadges.slice(0, 3).join(' · ')})` : '';
      return `  - ${safeTitle}${badgeSuffix}`;
    }
    if (item && typeof item === 'object' && typeof item.repo === 'string' && typeof item.number === 'number') {
      const stateTag =
        typeof item.state === 'string' && item.state.trim()
          ? item.draft === true
            ? ` [${esc(item.state.trim())} · draft]`
            : ` [${esc(item.state.trim())}]`
          : '';
      const authorTag = typeof item.author === 'string' && item.author.trim() ? ` (@${esc(item.author.trim())})` : '';
      return `  - [${esc(item.repo)}#${item.number}] ${safeTitle}${stateTag}${authorTag}`;
    }
    if (service === 'myjira' && item && typeof item === 'object') {
      const key = typeof item.key === 'string' && item.key.trim() ? `[${esc(item.key.trim())}] ` : '';
      const status = typeof item.status === 'string' && item.status.trim() ? ` [${esc(item.status.trim())}]` : '';
      const priority = typeof item.priority === 'string' && item.priority.trim() ? ` ⚡${esc(item.priority.trim())}` : '';
      const due = typeof item.dueDate === 'string' && item.dueDate.trim() ? ` (hạn: ${esc(item.dueDate.trim())})` : '';
      const assigneeSuffix =
        typeof item.assignee === 'string' && item.assignee.trim() && mentionIndex !== null
          ? ` 👤 ${formatAssigneeForSlack({ displayName: item.assignee }, mentionIndex, esc)}`
          : typeof item.assignee === 'string' && item.assignee.trim()
            ? ` 👤 ${esc(item.assignee.trim())}`
            : '';
      const overdueBadge =
        typeof item.dueDate === 'string' &&
        item.dueDate.trim() &&
        !/^(done|closed|resolved|hoàn thành|đã xong)$/i.test(String(item.status ?? '').trim()) &&
        Date.parse(item.dueDate) < nowMs
          ? '🚨 '
          : '';
      return `  - ${overdueBadge}${key}${safeTitle}${status}${priority}${due}${assigneeSuffix}`;
    }
    const prefix = item?.number ? `#${esc(String(item.number))} ` : item?.key && item?.key !== title ? `${esc(String(item.key))}: ` : '';
    return `  - ${prefix}${safeTitle}`;
  });

  if (items.length > maxItems) {
    lines.push(`  ... và ${items.length - maxItems} mục khác`);
  }
  if (sourceTruncated && (service === 'mycalendar' || service === 'calendar')) {
    lines.push('  ⚠️ (Dữ liệu lịch có thể chưa đầy đủ do chạm giới hạn tải/số lịch)');
  }

  return { count: items.length, lines, ...truncation };
}

export async function computeDigestSinceWindow(
  pool: pg.Pool | Pick<pg.Pool, 'query'> | null | undefined,
  scheduleId: string,
  recurrence: ScheduleRecurrence | undefined,
  dueAt: Date,
): Promise<{ sinceIso: string; untilIso: string }> {
  const fallbackWindowMs = recurrence?.type === 'weekly' ? 7 * 24 * 3600_000 : 24 * 3600_000;
  let sinceDate = new Date(dueAt.getTime() - fallbackWindowMs);
  if (pool) {
    try {
      const lastSentRes = await pool.query(
        `SELECT due_at FROM schedule_runs
         WHERE schedule_id = $1 AND trigger = 'scheduled' AND status = 'digest_sent'
         ORDER BY due_at DESC LIMIT 1`,
        [scheduleId],
      );
      if (lastSentRes.rowCount && lastSentRes.rows[0]?.due_at) {
        sinceDate = new Date(lastSentRes.rows[0].due_at);
      }
    } catch {
      // Fallback to default window
    }
  }
  return {
    sinceIso: sinceDate.toISOString(),
    untilIso: new Date(dueAt.getTime() + 24 * 3600_000).toISOString(),
  };
}

export type MultiDigestReadResult =
  | {
      kind: 'ok';
      sourceStatuses: DigestSourceRunStatus[];
      sections: string[];
      structuredSections: Array<{ label: string; count: number; body: string }>;
      failedLabels: string[];
      okOrEmptyCount: number;
    }
  | { kind: 'blocked'; error: string; pauseSchedule: true }
  | { kind: 'notion_blocked' }
  | { kind: 'digest_failed'; error: string };

export async function executeMultiDigestReadSources(input: {
  sources: TelegramDigestSource[];
  userId: string;
  dueAt: Date;
  sinceIso: string;
  untilIso: string;
  timeZone?: string;
  workspaceMode?: 'legacy' | 'personal' | 'organization';
  workspaceId?: string | null;
  gmailBinding?: GmailDigestBinding | null;
  notionBinding?: NotionDigestSourceBinding | null;
  notionSources?: Pick<NotionDigestSourceAuthority, 'read' | 'withSource'>;
  credentialRepo: Pick<CredentialRepo, 'getPersonalCredentials'>;
  encryptionKey: string;
  gmailOAuthClientId?: string;
  mysheetsOAuthClientId?: string;
  pool?: pg.Pool | Pick<pg.Pool, 'query'> | null;
  adapterFactory: {
    getAdapterForService(serviceName: string, context?: AdapterContext): Promise<any> | any;
  };
  signal: AbortSignal;
  mentionIndex?: SlackMentionIndex | null;
  escapeText?: (value: string) => string;
}): Promise<MultiDigestReadResult> {
  const esc = input.escapeText ?? ((v: string) => v);
  const { sources, userId, dueAt, sinceIso, untilIso, gmailBinding, notionBinding, signal } = input;
  const mycalendar = readMyCalendarDigestBinding({ sources }, null);
  if (mycalendar.kind === 'invalid') {
    return { kind: 'blocked', error: MYCALENDAR_DIGEST_REAPPROVAL, pauseSchedule: true };
  }
  if (mycalendar.kind === 'bound') {
    signal.throwIfAborted();
    const lookup = createMyCalendarConnectionLookup(input.credentialRepo, input.encryptionKey);
    const live = await lookup(userId).catch(() => null);
    signal.throwIfAborted();
    if (!matchesMyCalendarDigestBinding(live, mycalendar.binding)) {
      return { kind: 'blocked', error: MYCALENDAR_DIGEST_REAPPROVAL, pauseSchedule: true };
    }
  }
  const mysheets = readMySheetsDigestBinding({ sources }, null);
  if (mysheets.kind === 'invalid') {
    return { kind: 'blocked', error: MYSHEETS_DIGEST_REAPPROVAL, pauseSchedule: true };
  }
  let mysheetsLive: MySheetsConnectionLookupResult | null = null;
  if (mysheets.kind === 'bound') {
    signal.throwIfAborted();
    const lookup = createMySheetsConnectionLookup(
      input.credentialRepo,
      input.encryptionKey,
      undefined,
      input.mysheetsOAuthClientId,
    );
    mysheetsLive = await lookup(userId).catch(() => null);
    signal.throwIfAborted();
    if (!matchesMySheetsDigestBinding(mysheetsLive, mysheets.binding)) {
      return { kind: 'blocked', error: MYSHEETS_DIGEST_REAPPROVAL, pauseSchedule: true };
    }
  }
  const sourceStatuses: DigestSourceRunStatus[] = [];
  const sections: string[] = [];
  const structuredSections: Array<{ label: string; count: number; body: string }> = [];
  const failedLabels: string[] = [];
  let okOrEmptyCount = 0;

  for (const source of sources) {
    signal.throwIfAborted();
    try {
      const sourceAdapterContext: AdapterContext = {
        userId,
        phase: 'planning',
        workspaceMode: input.workspaceMode,
        workspaceId: input.workspaceId,
      };
      if (source.service === 'gmail' && gmailBinding) {
        sourceAdapterContext.phase = 'execution';
        sourceAdapterContext.connections = {
          gmail: { credentialId: gmailBinding.credentialId, email: gmailBinding.email },
        };
      } else if (source.service === 'mycalendar' && mycalendar.kind === 'bound') {
        const { credentialId, email, calendarIds } = mycalendar.binding;
        sourceAdapterContext.phase = 'execution';
        sourceAdapterContext.connections = { mycalendar: { credentialId, email, allowedCalendars: calendarIds } };
      } else if (source.service === 'mysheets' && mysheets.kind === 'bound') {
        const { credentialId, email, spreadsheetIds } = mysheets.binding;
        sourceAdapterContext.phase = 'execution';
        sourceAdapterContext.connections = { mysheets: { credentialId, email, allowedSpreadsheets: spreadsheetIds } };
      } else if (source.service === 'myjira') {
        sourceAdapterContext.phase = 'execution';
        sourceAdapterContext.jiraDigestBinding = source.jiraBinding;
        sourceAdapterContext.signal = signal;
      }
      const adapter =
        source.service === 'notion'
          ? null
          : await input.adapterFactory.getAdapterForService(source.service, sourceAdapterContext);
      const { callArgs, repoSearchTool, sheetListTool, sheetReadTool } = buildTelegramDigestSourceArgs(source, {
        sinceIso,
        untilIso,
      });

      let rawResult: unknown;
      if (source.service === 'notion') {
        if (!notionBinding || !input.notionSources) return { kind: 'notion_blocked' };
        rawResult = await input.notionSources.read(userId, notionBinding, signal);
      } else if (source.service === 'gmail') {
        const rawQuery = (source.args as Record<string, unknown> | undefined)?.query;
        if (!isValidGmailDigestQuery(rawQuery)) {
          return { kind: 'blocked', error: 'Bộ lọc Gmail đã duyệt không hợp lệ.', pauseSchedule: true };
        }
        rawResult = await adapter.execute(
          GMAIL_DIGEST_READ_TOOL,
          { query: rawQuery.trim() },
          { signal },
        );
      } else if (source.service === 'mycalendar' && mycalendar.kind === 'bound') {
        const targetCalendars = mycalendar.binding.calendarIds;
        let anyTruncated = mycalendar.binding.truncated;
        const mergedEvents: any[] = [];
        for (const calId of targetCalendars) {
          const res = await adapter.execute(
            source.tool,
            { ...callArgs, calendarId: calId },
            { signal },
          );
          if (res && typeof res === 'object' && !Array.isArray(res)) {
            if ((res as any).truncated === true || (res as any).coverage?.complete === false) {
              anyTruncated = true;
            }
          }
          const evs = Array.isArray(res?.events) ? res.events : Array.isArray(res) ? res : [];
          mergedEvents.push(...evs);
        }
        rawResult = { events: mergedEvents, ...(anyTruncated ? { truncated: true } : {}) };
      } else if (source.service === 'mysheets' && mysheets.kind === 'bound') {
        const targetSheets = mysheets.binding.spreadsheetIds;
        const { sheetName, ...approvedArgs } = source.args ?? {};
        const explicitRange = typeof approvedArgs.range === 'string' ? approvedArgs.range : undefined;
        const scanRange = explicitRange ?? (typeof sheetName === 'string'
          ? `${quoteSheetTitle(sheetName)}!${MYSHEETS_DIGEST_DEFAULT_RANGE}`
          : MYSHEETS_DIGEST_DEFAULT_RANGE);
        const startingRow = /(?:^|!)[A-Z]{1,3}(\d+)(?::|$)/i.exec(scanRange)?.[1];
        let anyTruncated = mysheets.binding.truncated;
        const perSheet: Array<Record<string, unknown>> = [];
        for (const sheetId of targetSheets) {
          const readArgs = {
            headerAware: startingRow === undefined || startingRow === '1',
            ...approvedArgs,
            range: scanRange,
            spreadsheetId: sheetId,
          };
          const readRes = await adapter.execute('mysheets.read_range', readArgs, { signal });
          const titleFromLive = mysheetsLive?.selectedSpreadsheets?.find((s) => s.id === sheetId)?.title;
          const spreadsheetTitle =
            typeof readRes?.spreadsheetTitle === 'string' && readRes.spreadsheetTitle.trim()
              ? readRes.spreadsheetTitle.trim()
              : titleFromLive || sheetId;
          if (readRes && typeof readRes === 'object' && !Array.isArray(readRes)) {
            const scannedRange = typeof readRes.range === 'string' ? readRes.range : readArgs.range;
            const defaultWindowFilled = !explicitRange && Array.isArray(readRes.values) &&
              readRes.values.length === (approvedArgs.limit ?? MYSHEETS_DIGEST_ROW_LIMIT);
            if (readRes.truncated === true || defaultWindowFilled) anyTruncated = true;
            // A range starting below row 1 contains data. Reading a separate header would exceed the approved range.
            const rowsWithoutHeader = !readArgs.headerAware && Array.isArray(readRes.values)
              ? (readRes.values as string[][])
                  .filter((row) => row.some((cell) => cell.trim() !== ''))
                  .map((row) => Object.fromEntries(row.map((cell, index) => [`Cột ${index + 1}`, cell])))
              : undefined;
            perSheet.push({
              ...(readRes as Record<string, unknown>),
              ...(rowsWithoutHeader ? { records: rowsWithoutHeader } : {}),
              spreadsheetTitle,
              scannedRange,
            });
          }
        }
        if (perSheet.length === 1) {
          rawResult = {
            ...perSheet[0],
            ...(anyTruncated ? { truncated: true } : {}),
          };
        } else {
          rawResult = {
            multiSheets: perSheet,
            ...(anyTruncated ? { truncated: true } : {}),
          };
        }
      } else if (sheetReadTool) {
        const listRes = await adapter.execute(source.tool, callArgs, { signal });
        const sheets = Array.isArray(listRes)
          ? listRes
          : listRes && typeof listRes === 'object' && Array.isArray((listRes as any).spreadsheets)
            ? (listRes as any).spreadsheets
            : [];
        if (sheets.length > 0 && sheets[0]?.id) {
          try {
            const readRes = await adapter.execute(
              sheetReadTool,
              { spreadsheetId: String(sheets[0].id), range: 'A1:Z50' },
              { signal },
            );
            if (
              readRes &&
              typeof readRes === 'object' &&
              !Array.isArray(readRes) &&
              (Array.isArray((readRes as any).records) || Array.isArray((readRes as any).values))
            ) {
              rawResult = {
                ...(readRes as Record<string, unknown>),
                spreadsheetTitle: String(sheets[0].name ?? sheets[0].title ?? sheets[0].id),
              };
            } else {
              rawResult = listRes;
            }
          } catch {
            rawResult = listRes;
          }
        } else {
          rawResult = listRes;
        }
      } else {
        try {
          rawResult = await adapter.execute(source.tool, callArgs, { signal });
        } catch (innerErr: any) {
          if (repoSearchTool && !callArgs.repo && /repo/i.test(String(innerErr?.message ?? ''))) {
            const reposRes = await adapter.execute(repoSearchTool, { query: '' }, { signal });
            const repos = Array.isArray(reposRes) ? reposRes.slice(0, 3) : [];
            const mergedIssues: any[] = [];
            for (const r of repos) {
              const repoName = String(r?.fullName ?? r?.name ?? '').trim();
              if (!repoName) continue;
              const issues = await adapter.execute(
                source.tool,
                { ...callArgs, repo: repoName },
                { signal, repo: repoName },
              );
              if (Array.isArray(issues)) mergedIssues.push(...issues);
            }
            rawResult = mergedIssues;
          } else if (sheetListTool && !callArgs.spreadsheetId) {
            const sheetsRes = await adapter.execute(sheetListTool, { query: '' }, { signal });
            const sheets = Array.isArray(sheetsRes) ? sheetsRes : [];
            if (sheets.length > 0 && sheets[0]?.id) {
              const readRes = await adapter.execute(
                source.tool,
                { ...callArgs, spreadsheetId: String(sheets[0].id) },
                { signal },
              );
              rawResult =
                readRes && typeof readRes === 'object' && !Array.isArray(readRes)
                  ? {
                      ...(readRes as Record<string, unknown>),
                      spreadsheetTitle: String(sheets[0].name ?? sheets[0].title ?? sheets[0].id),
                    }
                  : readRes;
            } else {
              throw innerErr;
            }
          } else if (
            source.service === 'calendar' &&
            source.tool === 'calendar.list_events' &&
            !callArgs.calendarId &&
            /calendarId/i.test(String(innerErr?.message ?? ''))
          ) {
            const calsRes = await adapter.execute('calendar.list_calendars', { query: '' }, { signal });
            const cals = Array.isArray(calsRes) ? calsRes.slice(0, 5) : [];
            if (cals.length === 0) throw innerErr;
            const mergedOrgEvents: any[] = [];
            let orgTruncated = Array.isArray(calsRes) && calsRes.length > 5;
            for (const c of cals) {
              const calId = String(c?.id ?? '').trim();
              if (!calId) continue;
              const calRes = await adapter.execute(
                source.tool,
                { ...callArgs, calendarId: calId },
                { signal },
              );
              if (calRes && typeof calRes === 'object' && !Array.isArray(calRes)) {
                if ((calRes as any).truncated === true || (calRes as any).coverage?.complete === false) {
                  orgTruncated = true;
                }
              }
              const evs = Array.isArray(calRes?.events)
                ? calRes.events
                : Array.isArray(calRes)
                  ? calRes
                  : [];
              mergedOrgEvents.push(...evs);
            }
            rawResult = { events: mergedOrgEvents, ...(orgTruncated ? { truncated: true } : {}) };
          } else {
            throw innerErr;
          }
        }
      }

      const { count, lines, truncated } = summarizeSourceItems(source.service, rawResult, dueAt, {
        mentionIndex: input.mentionIndex,
        escapeText: input.escapeText,
        timeZone: input.timeZone,
      });
      okOrEmptyCount++;
      sourceStatuses.push({
        service: source.service,
        label: source.label,
        status: count > 0 ? 'ok' : 'empty',
        itemCount: count,
        ...(truncated ? { truncated: true } : {}),
      });
      const bodyText = lines.join('\n');
      sections.push(`• ${esc(source.label)} (${count}):\n${bodyText}`);
      structuredSections.push({ label: source.label, count, body: bodyText });
    } catch (err: any) {
      if (signal.aborted) {
        throw signal.reason instanceof Error ? signal.reason : err;
      }
      if (source.service === 'notion' && isNotionSourceDenied(err)) {
        return { kind: 'notion_blocked' };
      }
      if (source.service === 'mycalendar' && isGmailAuthOrBindingFailure(err)) {
        return {
          kind: 'blocked',
          error: MYCALENDAR_DIGEST_REAPPROVAL,
          pauseSchedule: true,
        };
      }
      if (source.service === 'mysheets' && isGmailAuthOrBindingFailure(err)) {
        return {
          kind: 'blocked',
          error: MYSHEETS_DIGEST_REAPPROVAL,
          pauseSchedule: true,
        };
      }
      if (source.service === 'gmail') {
        let bindingLost = isGmailAuthOrBindingFailure(err);
        if (!bindingLost && gmailBinding && input.pool) {
          const recheck = await assertGmailDigestBinding(
            input.pool,
            userId,
            gmailBinding,
            input.gmailOAuthClientId,
            { encryptionKey: input.encryptionKey },
          ).catch(() => null);
          if (recheck && !recheck.allowed) {
            bindingLost = true;
          }
        }
        if (bindingLost) {
          return {
            kind: 'blocked',
            error: 'Kết nối Gmail nguồn không còn hợp lệ hoặc đã thay đổi. Hãy kiểm tra và xác nhận lại lịch.',
            pauseSchedule: true,
          };
        }
      }
      failedLabels.push(source.label);
      sourceStatuses.push({
        service: source.service,
        label: source.label,
        status: 'partial_error',
        error: 'Không lấy được dữ liệu ở lượt chạy này.',
      });
      const bodyText = '  (Tạm thời chưa lấy được dữ liệu ở lượt chạy này)';
      sections.push(`• ${esc(source.label)}:\n${bodyText}`);
      structuredSections.push({ label: source.label, count: -1, body: bodyText });
    }
  }

  if (okOrEmptyCount === 0) {
    return {
      kind: 'digest_failed',
      error: 'Không đọc được dữ liệu từ các dịch vụ nguồn để tạo báo cáo.',
    };
  }

  return {
    kind: 'ok',
    sourceStatuses,
    sections,
    structuredSections,
    failedLabels,
    okOrEmptyCount,
  };
}
