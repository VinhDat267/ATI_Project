import type pg from 'pg';
import { decryptCredentials, detectCalendarConflicts } from '@wap/tool-adapters';
import {
  normalizeTelegramChatId,
  TELEGRAM_CHAT_ID_PATTERN,
  type TelegramDigestConfig,
  type TelegramDigestDelivery,
} from '@wap/tool-schemas';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';
import type { AdapterContext } from '../adapter-factory.js';
import type { TelegramBotClient } from '../telegram/bot-client.js';
import { localLabel } from './next-occurrence.js';
import { analyzeSheetKpiMetrics } from './sheets-digest-runner.js';
import {
  buildTelegramDigestSourceArgs,
  computeTelegramDigestConfigHash,
  READ_DIGEST_SOURCE_MAP,
} from './telegram-digest-candidate.js';

export interface DigestRunInput {
  runId: string;
  scheduleId: string;
  scheduleVersion: number;
  userId: string;
  name: string;
  request: string;
  dueAt: Date;
  trigger: 'scheduled' | 'manual' | 'replan';
  digestConfig: TelegramDigestConfig | null;
  digestConfigHash: string | null;
  beforeSendCheck?: () => Promise<boolean>;
}

export type DigestRunOutcome =
  | { status: 'discarded' }
  | {
      status: 'digest_sent';
      digestText: string;
      delivery: TelegramDigestDelivery;
    }
  | {
      status: 'blocked';
      error: string;
      pauseSchedule?: boolean;
    }
  | {
      status: 'discarded';
    }
  | {
      status: 'digest_failed';
      error: string;
      pauseSchedule?: boolean;
    };

export interface TelegramDigestRunnerOptions {
  pool?: pg.Pool | Pick<pg.Pool, 'query'> | null;
  credentialRepo: Pick<CredentialRepo, 'getPersonalCredentials'>;
  encryptionKey: string;
  adapterFactory: {
    getAdapterForService(serviceName: string, context?: AdapterContext): Promise<any> | any;
  };
  botClient?: Pick<TelegramBotClient, 'getChatMember'>;
  timeZone: string;
  summarizeWithAi?: (prompt: string, signal: AbortSignal) => Promise<string | null>;
  aiTimeoutMs?: number;
}

export function summarizeSourceItems(
  service: string,
  raw: unknown,
  now: Date = new Date()
): { count: number; lines: string[] } {
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
    const kpi = analyzeSheetKpiMetrics(headers, records, values);
    if (kpi.totalRows === 0) {
      return { count: 0, lines: ['  (Không có mục mới)'] };
    }
    const sheetTitle =
      typeof rawObj.spreadsheetTitle === 'string' && rawObj.spreadsheetTitle.trim()
        ? `📄 ${rawObj.spreadsheetTitle.trim()}: `
        : '';
    return {
      count: kpi.totalRows,
      lines: [
        `  📊 ${sheetTitle}${kpi.totalRows} dòng (✅ Xong: ${kpi.doneCount} · 🔄 Đang làm: ${kpi.inProgressCount} · ⚠️ Chờ/Quá hạn: ${kpi.overdueOrPendingCount})`,
        ...kpi.highlights.map((h) => `  ${h}`),
      ],
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
      );
    } catch {
      // Keep original items if date parsing fails
    }
  }

  if (items.length === 0) {
    return { count: 0, lines: ['  (Không có mục mới)'] };
  }

  const nowMs = now.getTime();
  const soonLimitMs = nowMs + 24 * 3600_000;

  const lines = items.slice(0, 5).map((item, idx) => {
    if (typeof item === 'string') return `  ${idx + 1}. ${item}`;
    if (Array.isArray(item)) return `  ${idx + 1}. ${item.join(' | ')}`;
    const title =
      item?.title ??
      item?.summary ??
      item?.name ??
      item?.subject ??
      item?.key ??
      item?.id ??
      `Mục #${idx + 1}`;
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
      return `  - ${badgePrefix}${String(title)}${unassigned}`;
    }
    if (service === 'gmail' && item && typeof item === 'object') {
      const from = typeof item.from === 'string' && item.from.trim() ? `[${item.from.trim()}] ` : '';
      const attachmentNames = Array.isArray(item.attachmentNames) ? item.attachmentNames.filter((n: unknown) => typeof n === 'string' && n.trim()) : [];
      const attachmentBadge =
        attachmentNames.length > 0
          ? ` 📎 (${attachmentNames.slice(0, 2).join(', ')})`
          : item.hasAttachment === true
            ? ' 📎'
            : '';
      const rawSnippet = typeof item.snippet === 'string' ? item.snippet.replace(/\s+/g, ' ').trim() : '';
      const snippetSuffix = rawSnippet ? ` — ${rawSnippet.length > 80 ? `${rawSnippet.slice(0, 77)}...` : rawSnippet}` : '';
      return `  - ${from}${String(title)}${attachmentBadge}${snippetSuffix}`;
    }
    if (item && typeof item === 'object' && typeof item.start === 'string') {
      const timeRange =
        typeof item.start === 'string' && typeof item.end === 'string'
          ? ` (${item.start} → ${item.end})`
          : ` (${item.start})`;
      const conflictBadge =
        item.conflict === true && Array.isArray(item.conflictsWith) && item.conflictsWith.length > 0
          ? `⚠️ [Trùng lịch: ${item.conflictsWith.join(', ')}] `
          : '';
      const extras: string[] = [];
      if (typeof item.meetLink === 'string' && item.meetLink) extras.push(`🎥 ${item.meetLink}`);
      if (typeof item.location === 'string' && item.location) extras.push(`📍 ${item.location}`);
      const extraSuffix = extras.length > 0 ? ` — ${extras.join(' | ')}` : '';
      return `  - ${conflictBadge}${String(title)}${timeRange}${extraSuffix}`;
    }
    if (service === 'notion' && item && typeof item === 'object') {
      const propBadges: string[] = [];
      if (item.properties && typeof item.properties === 'object') {
        for (const [k, v] of Object.entries(item.properties as Record<string, unknown>)) {
          if (typeof v === 'string' && v.trim()) {
            propBadges.push(`${k}: ${v.trim()}`);
          }
        }
      }
      const badgeSuffix = propBadges.length > 0 ? ` (${propBadges.slice(0, 3).join(' · ')})` : '';
      return `  - ${String(title)}${badgeSuffix}`;
    }
    const prefix = item?.number ? `#${item.number} ` : item?.key && item?.key !== title ? `${item.key}: ` : '';
    return `  - ${prefix}${String(title)}`;
  });

  if (items.length > 5) {
    lines.push(`  ... và ${items.length - 5} mục khác`);
  }

  return { count: items.length, lines };
}

export class TelegramDigestRunner {
  constructor(private options: TelegramDigestRunnerOptions) {}

  private async dispatch(
    run: DigestRunInput,
    signal: AbortSignal,
    send: () => Promise<DigestRunOutcome>,
  ): Promise<DigestRunOutcome> {
    if (!this.options.pool) {
      return { status: 'digest_failed', error: 'Lịch tự gửi cần kết nối PostgreSQL.', pauseSchedule: true };
    }
    if (typeof (this.options.pool as any).connect !== 'function') {
      return send();
    }
    const client = await (this.options.pool as pg.Pool).connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '10s'");
      // Use the same conversation/schedule lock as schedule management. A cancellation
      // that commits first prevents dispatch; a later cancellation waits for this send.
      const schedule = (await client.query(
        `SELECT s.* FROM schedules s JOIN conversations c ON c.id=s.conv_id
         JOIN users u ON u.id=s.user_id AND u.status='active'
         WHERE s.id=$1 FOR UPDATE OF c,s`,
        [run.scheduleId],
      )).rows[0];
      const currentRun = (await client.query(
        'SELECT status FROM schedule_runs WHERE id=$1 AND schedule_id=$2 FOR UPDATE',
        [run.runId, run.scheduleId],
      )).rows[0];
      signal.throwIfAborted();
      if (!schedule || currentRun?.status !== 'planning' ||
        schedule.user_id !== run.userId || schedule.kind !== 'telegram_digest' ||
        schedule.version !== run.scheduleVersion || schedule.digest_config_hash !== run.digestConfigHash ||
        schedule.status === 'cancelled' || schedule.status === 'paused') {
        await client.query('COMMIT');
        return { status: 'discarded' };
      }
      const outcome = await send();
      await client.query('COMMIT');
      return outcome;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async execute(run: DigestRunInput, signal: AbortSignal): Promise<DigestRunOutcome> {
    signal.throwIfAborted();
    const { digestConfig, digestConfigHash, userId } = run;

    if (!digestConfig || !digestConfigHash) {
      return {
        status: 'blocked',
        error: 'Cấu hình báo cáo tự động bị thiếu hoặc không hợp lệ.',
        pauseSchedule: true,
      };
    }

    const computedHash = computeTelegramDigestConfigHash(digestConfig);
    if (computedHash !== digestConfigHash) {
      return {
        status: 'blocked',
        error: 'Cấu hình báo cáo tự động không khớp chữ ký toàn vẹn.',
        pauseSchedule: true,
      };
    }

    // 1. Verify current personal Telegram connection and scope
    const record = await this.options.credentialRepo.getPersonalCredentials('telegram', userId);
    if (!record || record.status !== 'active' || record.id !== digestConfig.credentialId) {
      return {
        status: 'blocked',
        error: 'Kết nối Telegram đã thay đổi hoặc bị ngắt. Hãy kết nối lại.',
        pauseSchedule: true,
      };
    }

    let telegramUserId: string | undefined;
    let selectedChatIds = new Set<string>();
    try {
      const decrypted = decryptCredentials(record.config, this.options.encryptionKey);
      telegramUserId =
        typeof decrypted.telegramUserId === 'string' && decrypted.telegramUserId.trim()
          ? normalizeTelegramChatId(decrypted.telegramUserId.trim())
          : undefined;
      if (Array.isArray(decrypted.selectedChats)) {
        for (const c of decrypted.selectedChats) {
          if (c && typeof c.chatId === 'string' && TELEGRAM_CHAT_ID_PATTERN.test(c.chatId.trim())) {
            selectedChatIds.add(normalizeTelegramChatId(c.chatId));
          }
        }
      }
    } catch {
      return {
        status: 'blocked',
        error: 'Không đọc được thông tin kết nối Telegram. Hãy kết nối lại.',
        pauseSchedule: true,
      };
    }

    const targetChatId = normalizeTelegramChatId(digestConfig.chatId);
    if (!telegramUserId || telegramUserId !== digestConfig.telegramUserId || !selectedChatIds.has(targetChatId)) {
      return {
        status: 'blocked',
        error: 'Cuộc trò chuyện nhận báo cáo đã bị gỡ khỏi phạm vi cho phép.',
        pauseSchedule: true,
      };
    }

    if (targetChatId !== telegramUserId && targetChatId.startsWith('-') && this.options.botClient) {
      const isMember = await this.options.botClient.getChatMember(targetChatId, telegramUserId, signal);
      if (!isMember) {
        return {
          status: 'blocked',
          error: 'Bạn không còn là thành viên của nhóm Telegram nhận báo cáo.',
          pauseSchedule: true,
        };
      }
    }

    // 2. Verify all sources are in strict read-only allowlist
    if (!Array.isArray(digestConfig.sources) || digestConfig.sources.length === 0) {
      return {
        status: 'blocked',
        error: 'Không có dịch vụ nguồn dữ liệu hợp lệ trong cấu hình báo cáo.',
        pauseSchedule: true,
      };
    }

    for (const source of digestConfig.sources) {
      const allowed = READ_DIGEST_SOURCE_MAP[source.service];
      if (!allowed || allowed.tool !== source.tool) {
        return {
          status: 'blocked',
          error: `Công cụ nguồn "${source.tool}" không nằm trong danh sách chỉ đọc được phép.`,
          pauseSchedule: true,
        };
      }
    }

    // 2b. Compute SINCE window from the last 'scheduled' digest_sent run's due_at
    const fallbackWindowMs =
      digestConfig.recurrence?.type === 'weekly' ? 7 * 24 * 3600_000 : 24 * 3600_000;
    let sinceDate = new Date(run.dueAt.getTime() - fallbackWindowMs);
    if (this.options.pool) {
      try {
        const lastSentRes = await this.options.pool.query(
          `SELECT due_at FROM schedule_runs
           WHERE schedule_id = $1 AND trigger = 'scheduled' AND status = 'digest_sent'
           ORDER BY due_at DESC LIMIT 1`,
          [run.scheduleId],
        );
        if (lastSentRes.rowCount && lastSentRes.rows[0]?.due_at) {
          sinceDate = new Date(lastSentRes.rows[0].due_at);
        }
      } catch {
        // Fallback to default window
      }
    }
    const sinceIso = sinceDate.toISOString();
    const untilIso = new Date(run.dueAt.getTime() + 24 * 3600_000).toISOString();

    // 3. Execute read sources
    const sourceStatuses: TelegramDigestDelivery['sources'] = [];
    const sections: string[] = [];
    const failedLabels: string[] = [];
    let okOrEmptyCount = 0;

    for (const source of digestConfig.sources) {
      signal.throwIfAborted();
      try {
        const adapter = await this.options.adapterFactory.getAdapterForService(source.service, {
          userId,
          phase: 'planning',
        });
        const { callArgs, repoSearchTool, sheetListTool, sheetReadTool } = buildTelegramDigestSourceArgs(source, {
          sinceIso,
          untilIso,
        });

        let rawResult: unknown;
        if (source.service === 'mycalendar' && source.tool === 'mycalendar.list_events') {
          let allowedCalendars: string[] = [];
          try {
            const mycalRec = await this.options.credentialRepo.getPersonalCredentials('mycalendar', userId);
            if (mycalRec && mycalRec.status === 'active') {
              const dec = decryptCredentials(mycalRec.config, this.options.encryptionKey);
              allowedCalendars = Array.isArray(dec.allowedScope?.calendars)
                ? dec.allowedScope.calendars.filter((id: unknown) => typeof id === 'string' && id)
                : Array.isArray(dec.selectedCalendars)
                  ? dec.selectedCalendars.map((c: any) => String(c?.id ?? '')).filter(Boolean)
                  : [];
            }
          } catch {
            // fallback to callArgs.calendarId if credential lookup is not available
          }
          if (allowedCalendars.length > 0) {
            const mergedEvents: any[] = [];
            for (const calId of allowedCalendars.slice(0, 5)) {
              const res = await adapter.execute(
                source.tool,
                { ...callArgs, calendarId: calId },
                { signal },
              );
              const evs = Array.isArray(res?.events) ? res.events : Array.isArray(res) ? res : [];
              mergedEvents.push(...evs);
            }
            rawResult = { events: mergedEvents };
          } else {
            rawResult = await adapter.execute(source.tool, callArgs, { signal });
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
            if (
              repoSearchTool &&
              !callArgs.repo &&
              /repo/i.test(String(innerErr?.message ?? ''))
            ) {
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
            } else if (source.service === 'notion') {
              const dbsRes = await adapter.execute('notion.search_databases', { query: '' }, { signal });
              const dbs = Array.isArray(dbsRes?.databases)
                ? dbsRes.databases
                : Array.isArray(dbsRes)
                  ? dbsRes
                  : [];
              const mergedPages: any[] = [];
              for (const db of dbs.slice(0, 3)) {
                const dbId = String(db?.id ?? '').trim();
                if (!dbId) continue;
                const pageRes = await adapter.execute(
                  'notion.query_database',
                  { databaseId: dbId, limit: 10 },
                  { signal, databaseId: dbId },
                );
                const pages = Array.isArray(pageRes?.pages)
                  ? pageRes.pages
                  : Array.isArray(pageRes)
                    ? pageRes
                    : [];
                mergedPages.push(...pages);
              }
              rawResult = { pages: mergedPages };
            } else {
              throw innerErr;
            }
          }
        }

        const { count, lines } = summarizeSourceItems(source.service, rawResult, run.dueAt);
        okOrEmptyCount++;
        sourceStatuses.push({
          service: source.service,
          label: source.label,
          status: count > 0 ? 'ok' : 'empty',
          itemCount: count,
        });
        sections.push(`• ${source.label} (${count}):\n${lines.join('\n')}`);
      } catch (err: any) {
        failedLabels.push(source.label);
        sourceStatuses.push({
          service: source.service,
          label: source.label,
          status: 'partial_error',
          error: 'Không lấy được dữ liệu ở lượt chạy này.',
        });
        sections.push(`• ${source.label}:\n  (Tạm thời chưa lấy được dữ liệu ở lượt chạy này)`);
      }
    }

    if (okOrEmptyCount === 0) {
      return {
        status: 'digest_failed',
        error: 'Không đọc được dữ liệu từ các dịch vụ nguồn để tạo báo cáo.',
      };
    }

    // 4. Optional AI highlight summary (10s timeout via AbortSignal) & format plain-text digest (max 4000 chars)
    let aiHighlight = '';
    if (this.options.summarizeWithAi) {
      const aiController = new AbortController();
      const onParentAbort = () => aiController.abort();
      signal.addEventListener('abort', onParentAbort, { once: true });
      const aiTimer = setTimeout(() => aiController.abort(), this.options.aiTimeoutMs ?? 10_000);
      try {
        const abortPromise = new Promise<null>((resolve) =>
          aiController.signal.addEventListener('abort', () => resolve(null), { once: true }),
        );
        const rawSummary = await Promise.race([
          this.options.summarizeWithAi(sections.join('\n\n'), aiController.signal),
          abortPromise,
        ]);
        if (typeof rawSummary === 'string' && rawSummary.trim()) {
          aiHighlight = `💡 Điểm nổi bật: ${rawSummary.trim().slice(0, 400)}\n\n`;
        }
      } catch {
        aiHighlight = '';
      } finally {
        clearTimeout(aiTimer);
        signal.removeEventListener('abort', onParentAbort);
      }
    }

    const timeLabel = localLabel(run.dueAt, this.options.timeZone);
    const header = `📋 Bản tin tự động của ATI · thiết lập bởi @${digestConfig.username}\n📌 ${run.name} · 🕒 ${timeLabel}\n\n`;
    const footer =
      failedLabels.length > 0
        ? `\n\n⚠️ Tạm thời chưa lấy được dữ liệu từ: ${failedLabels.join(', ')}.`
        : '';
    let digestText = `${header}${aiHighlight}${sections.join('\n\n')}${footer}`;
    const codepoints = Array.from(digestText);
    if (codepoints.length > 4000) {
      digestText = codepoints.slice(0, 3994).join('') + '\n...';
    }

    // 5. Pre-send schedule version and status check immediately before calling telegram.send_message
    signal.throwIfAborted();
    if (run.beforeSendCheck) {
      const stillValid = await run.beforeSendCheck();
      if (!stillValid) {
        return { status: 'discarded' };
      }
    } else if (this.options.pool) {
      const preSendCheck = await this.options.pool.query(
        'SELECT version, status FROM schedules WHERE id = $1',
        [run.scheduleId],
      );
      const currentSchedule = preSendCheck.rows[0];
      if (
        !currentSchedule ||
        currentSchedule.version !== run.scheduleVersion ||
        currentSchedule.status === 'cancelled' ||
        currentSchedule.status === 'paused'
      ) {
        return { status: 'discarded' };
      }
    }

    // 6. Send via Telegram adapter with execution context (once sent, never transition to discarded)
    signal.throwIfAborted();
    try {
      const telegramAdapter = await this.options.adapterFactory.getAdapterForService('telegram', {
        userId,
        phase: 'execution',
        connections: {
          telegram: {
            credentialId: digestConfig.credentialId,
            telegramUserId: digestConfig.telegramUserId,
            username: digestConfig.username,
            chatIds: [targetChatId],
          },
        },
      });
      return await this.dispatch(run, signal, async () => {
        const sendRes = await telegramAdapter.execute(
          'telegram.send_message',
          { chatId: targetChatId, text: digestText },
          { signal, chatId: targetChatId },
        );
        return {
          status: 'digest_sent',
          digestText,
          delivery: {
            chatId: targetChatId,
            chatTitle: digestConfig.chatTitle,
            ...(typeof sendRes?.messageId === 'number' ? { messageId: sendRes.messageId } : {}),
            sentAt: new Date().toISOString(),
            sources: sourceStatuses,
          },
        };
      });
    } catch {
      return {
        status: 'digest_failed',
        error: 'Không gửi được tin nhắn báo cáo tới Telegram.',
      };
    }
  }
}
