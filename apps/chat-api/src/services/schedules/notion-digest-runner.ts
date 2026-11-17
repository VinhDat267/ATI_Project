import type pg from 'pg';
import type { NotionDigestConfig, NotionDigestDelivery, ScheduleRecurrence } from '@wap/tool-schemas';
import { approvedSlackNotionBinding, computeNotionDigestConfigHash } from './notion-digest-candidate.js';
import { escapeSlackMrkdwn } from './github-digest-runner.js';
import { isSlackMessageTimestamp } from './slack-message-timestamp.js';
import { buildSlackMarkdownDigestBlocks } from '../slack/slack-digest-blocks.js';
import { NOTION_DIGEST_REAPPROVAL, isNotionSourceDenied, type NotionDigestSourceAuthority } from '../notion/digest-source-authority.js';
import type { RunToPlan } from './schedule-runner.js';

export const NOTION_DELIVERY_UNKNOWN =
  'NOTION_DELIVERY_UNKNOWN: Chưa xác định bản tin Notion đã gửi hay chưa. Hãy kiểm tra kênh nhận trước khi gửi thêm; lượt này không tự gửi lại.';

export interface NotionDigestRunInput extends RunToPlan {
  recurrence: ScheduleRecurrence;
  digestConfig: NotionDigestConfig | null;
  digestConfigHash: string | null;
}

export type NotionDigestRunOutcome =
  | { state: 'digest_sent'; delivery: NotionDigestDelivery; text: string }
  | { state: 'digest_failed'; error: string }
  | { state: 'delivery_unknown'; error: string }
  | { state: 'blocked'; error: string; pauseReason: string }
  | { state: 'discarded' };

export type RunNotionDigest = (
  run: NotionDigestRunInput,
  convId: string,
  signal: AbortSignal
) => Promise<NotionDigestRunOutcome>;

export interface NotionPageDigestItem {
  databaseId: string;
  databaseTitle: string;
  id: string;
  title: string;
  url: string;
  properties?: Record<string, string | null>;
  lastEditedTime?: string;
}

export interface NotionDigestStats {
  total: number;
  done: number;
  inProgress: number;
  overdueOrBlocked: number;
  dueSoon: number;
  unassigned: number;
  recentlyUpdated: number;
}

function resolveTimeZone(tz?: string): string {
  if (tz) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0);
      return tz;
    } catch {
      // fall through
    }
  }
  return 'Asia/Ho_Chi_Minh';
}

function startOfCalendarDateInTimeZoneMs(year: number, month: number, day: number, timeZone?: string): number {
  const tz = resolveTimeZone(timeZone);
  const utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'shortOffset',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(utcMidnight));
  const offsetStr = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(offsetStr);
  if (!match) {
    return tz === 'Asia/Ho_Chi_Minh' ? utcMidnight - 7 * 3600_000 : utcMidnight;
  }
  const sign = match[1] === '-' ? -1 : 1;
  const offsetMin = sign * (Number(match[2]) * 60 + Number(match[3] ?? '0'));
  return utcMidnight - offsetMin * 60_000;
}

function startOfDayInTimeZoneMs(ms: number, timeZone?: string): number {
  const tz = resolveTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  const d = Number(parts.find((p) => p.type === 'day')?.value);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return new Date(ms).setUTCHours(0, 0, 0, 0);
  }
  return startOfCalendarDateInTimeZoneMs(y, m, d, tz);
}

function parseNotionDueDate(raw: string, timeZone?: string): { ms: number; dateOnly: boolean } | null {
  const segments = raw.split('→').map((s) => s.trim()).filter(Boolean);
  const target = segments.length > 1 ? segments[segments.length - 1]! : (segments[0] ?? '');
  if (!target) return null;
  const isoDateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(target);
  if (isoDateOnly) {
    return {
      ms: startOfCalendarDateInTimeZoneMs(Number(isoDateOnly[1]), Number(isoDateOnly[2]), Number(isoDateOnly[3]), timeZone),
      dateOnly: true,
    };
  }
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(target);
  if (dmy) {
    return {
      ms: startOfCalendarDateInTimeZoneMs(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]), timeZone),
      dateOnly: true,
    };
  }
  const parsed = Date.parse(target);
  return Number.isFinite(parsed) ? { ms: parsed, dateOnly: false } : null;
}

export function analyzeNotionDigestPages(
  pages: NotionPageDigestItem[],
  nowMs: number = Date.now(),
  timeZone?: string,
): {
  stats: NotionDigestStats;
  sortedPages: Array<{
    page: NotionPageDigestItem;
    bucket: 'overdue_blocked' | 'in_progress' | 'todo' | 'done';
    isRecent24h: boolean;
    isDueSoon: boolean;
    isUnassigned: boolean;
  }>;
} {
  const tz = resolveTimeZone(timeZone);
  const todayStartMs = startOfDayInTimeZoneMs(nowMs, tz);
  const soonLimitMs = nowMs + 48 * 3600_000;
  const stats: NotionDigestStats = {
    total: pages.length,
    done: 0,
    inProgress: 0,
    overdueOrBlocked: 0,
    dueSoon: 0,
    unassigned: 0,
    recentlyUpdated: 0,
  };

  const enriched = pages.map((page) => {
    const props = page.properties ?? {};
    let statusVal = '';
    let dueVal = '';
    let hasAssigneeField = false;
    let hasAssigneeValue = false;
    for (const [k, v] of Object.entries(props)) {
      const kl = k.toLowerCase();
      if (kl.includes('assignee') || kl.includes('assign') || kl.includes('owner') || kl.includes('phụ trách') || kl.includes('thực hiện')) {
        hasAssigneeField = true;
        if (typeof v === 'string' && v.trim().length > 0) {
          hasAssigneeValue = true;
        }
      }
      if (!v || typeof v !== 'string') continue;
      if (!statusVal && (kl.includes('status') || kl.includes('trạng thái') || kl.includes('stage') || kl.includes('tình trạng'))) {
        statusVal = v.trim().toLowerCase();
      }
      if (!dueVal && (kl.includes('due') || kl.includes('hạn') || kl.includes('deadline') || kl === 'date' || kl === 'ngày')) {
        dueVal = v.trim();
      }
    }

    const isDone = /^(done|completed|complete|hoàn thành|đã xong|closed)$/i.test(statusVal);
    const isBlocked = /(blocked|bị chặn|quá hạn|overdue|stuck|khẩn)/i.test(statusVal);
    const isInProgress = /(in progress|in-progress|doing|đang làm|đang thực hiện|review|active)/i.test(statusVal);
    const due = dueVal ? parseNotionDueDate(dueVal, tz) : null;
    const isPastDue = !isDone && due !== null && due.ms < (due.dateOnly ? todayStartMs : nowMs);
    const isDueSoon = !isDone && !isBlocked && !isPastDue && due !== null && due.ms <= soonLimitMs;
    const isUnassigned = !isDone && hasAssigneeField && !hasAssigneeValue;

    const editedMs = page.lastEditedTime ? Date.parse(page.lastEditedTime) : NaN;
    const isRecent24h = Number.isFinite(editedMs) && nowMs - editedMs >= 0 && nowMs - editedMs <= 24 * 3600_000;
    if (isRecent24h) stats.recentlyUpdated++;
    if (isDueSoon) stats.dueSoon++;
    if (isUnassigned) stats.unassigned++;

    let bucket: 'overdue_blocked' | 'in_progress' | 'todo' | 'done' = 'todo';
    if (isDone) {
      bucket = 'done';
      stats.done++;
    } else if (isBlocked || isPastDue) {
      bucket = 'overdue_blocked';
      stats.overdueOrBlocked++;
    } else if (isInProgress) {
      bucket = 'in_progress';
      stats.inProgress++;
    }

    return { page, bucket, isRecent24h, isDueSoon, isUnassigned };
  });

  const priorityOrder: Record<typeof enriched[number]['bucket'], number> = {
    overdue_blocked: 0,
    in_progress: 1,
    todo: 2,
    done: 3,
  };
  enriched.sort((a, b) => {
    const diff = priorityOrder[a.bucket] - priorityOrder[b.bucket];
    if (diff !== 0) return diff;
    if (a.isDueSoon !== b.isDueSoon) return a.isDueSoon ? -1 : 1;
    if (a.isRecent24h !== b.isRecent24h) return a.isRecent24h ? -1 : 1;
    return 0;
  });

  return { stats, sortedPages: enriched };
}

export interface NotionDigestRunnerOptions {
  pool: pg.Pool;
  notionSources?: Pick<NotionDigestSourceAuthority, 'read' | 'withSource'>;
  getAdapter?: (serviceName: string, context?: any) => Promise<any> | any;
  timeZone?: string;
}

function formatNotionPropertyBadges(props?: Record<string, string | null>): string {
  if (!props || typeof props !== 'object') return '';
  const badges: string[] = [];
  for (const [k, v] of Object.entries(props)) {
    if (!v || typeof v !== 'string') continue;
    const keyLower = k.toLowerCase();
    if (
      keyLower.includes('status') ||
      keyLower.includes('trạng thái') ||
      keyLower.includes('priority') ||
      keyLower.includes('ưu tiên') ||
      keyLower.includes('due') ||
      keyLower.includes('hạn')
    ) {
      badges.push(`${escapeSlackMrkdwn(k)}: ${escapeSlackMrkdwn(v.slice(0, 40))}`);
    }
  }
  return badges.length > 0 ? ` _(${badges.slice(0, 3).join(' · ')})_` : '';
}

function formatNotionDatabaseSection(
  dbTitle: string,
  pages: NotionPageDigestItem[],
  nowMs: number = Date.now(),
  sectionOptions?: { timeZone?: string; truncated?: boolean },
): { lines: string[]; stats: NotionDigestStats } {
  const safeDb = escapeSlackMrkdwn(dbTitle);
  const { stats, sortedPages } = analyzeNotionDigestPages(pages, nowMs, sectionOptions?.timeZone);
  const kpiParts: string[] = [`${stats.total} trang`];
  if (stats.overdueOrBlocked > 0) kpiParts.push(`🚨 ${stats.overdueOrBlocked} quá hạn/chặn`);
  if (stats.dueSoon > 0) kpiParts.push(`⏰ ${stats.dueSoon} sắp đến hạn (48h)`);
  if (stats.inProgress > 0) kpiParts.push(`🔄 ${stats.inProgress} đang làm`);
  if (stats.unassigned > 0) kpiParts.push(`👤 ${stats.unassigned} chưa phân công`);
  if (stats.done > 0) kpiParts.push(`✅ ${stats.done} hoàn thành`);
  if (stats.recentlyUpdated > 0) kpiParts.push(`✨ ${stats.recentlyUpdated} mới sửa 24h`);

  const truncBadge = sectionOptions?.truncated ? ' · ⚠️ Chưa tải hết trang (giới hạn 20 trang)' : '';
  const header = `• *📒 ${safeDb} (${kpiParts.join(' · ')}${truncBadge}):*`;
  if (pages.length === 0) {
    return { lines: [header, '  - _(Chưa có trang nào)_'], stats };
  }
  const itemLines = sortedPages.slice(0, 10).map(({ page: item, bucket, isRecent24h, isDueSoon, isUnassigned }) => {
    const safeTitle = escapeSlackMrkdwn(String(item.title || 'Trang không tiêu đề').slice(0, 120));
    const prefix =
      bucket === 'overdue_blocked'
        ? '🚨 [Cần chú ý] '
        : isDueSoon
          ? '⏰ [Sắp đến hạn] '
          : bucket === 'in_progress'
            ? '🔄 '
            : bucket === 'done'
              ? '✅ '
              : '';
    const unassignedBadge = isUnassigned ? ' · [Chưa phân công]' : '';
    const recentBadge = isRecent24h ? ' · ✨ Mới cập nhật 24h' : '';
    const badges = formatNotionPropertyBadges(item.properties);
    if (item.url) {
      return `  - ${prefix}<${item.url}|${safeTitle}>${badges}${unassignedBadge}${recentBadge}`;
    }
    return `  - ${prefix}${safeTitle}${badges}${unassignedBadge}${recentBadge}`;
  });
  if (pages.length > 10 || sectionOptions?.truncated) {
    itemLines.push(
      sectionOptions?.truncated
        ? `  - _... còn trang khác chưa hiển thị hết (giới hạn tải 20 trang/database)_`
        : `  - _... và ${pages.length - 10} trang khác_`,
    );
  }
  return { lines: [header, ...itemLines], stats };
}

function isDefiniteWriteRejection(err: any): boolean {
  if (!err || typeof err !== 'object') return false;
  if (err.details && typeof err.details === 'object' && err.details.requestSent === false) {
    return true;
  }
  return (
    typeof err.category === 'string' &&
    ['AUTH_ERROR', 'NOT_FOUND', 'VALIDATION', 'RATE_LIMIT'].includes(err.category)
  );
}

async function claimNotionDigestDelivery(
  client: pg.PoolClient,
  run: NotionDigestRunInput,
  signal: AbortSignal,
): Promise<'claimed' | 'discarded' | 'busy'> {
  try {
    const found = await client.query('SELECT conv_id FROM schedules WHERE id = $1', [run.scheduleId]);
    if (!found.rowCount) {
      return 'discarded';
    }
    const scheduleConvId = found.rows[0].conv_id;

    signal.throwIfAborted();
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query('SELECT id FROM conversations WHERE id = $1 FOR UPDATE', [scheduleConvId]);
    const schedule = (
      await client.query(
        `SELECT s.id, s.user_id, s.kind, s.version, s.status, s.digest_config, s.digest_config_hash
           FROM schedules s
           JOIN users u ON u.id = s.user_id AND u.status = 'active'
          WHERE s.id = $1
            FOR UPDATE OF s`,
        [run.scheduleId],
      )
    ).rows[0];
    signal.throwIfAborted();
    if (
      !schedule ||
      schedule.user_id !== run.userId ||
      schedule.kind !== 'notion_digest' ||
      schedule.version !== run.scheduleVersion ||
      schedule.digest_config_hash !== run.digestConfigHash ||
      (schedule.status !== 'active' && schedule.status !== 'completed')
    ) {
      await client.query('COMMIT');
      return 'discarded';
    }

    let currentRun: { status: string; delivery_started_at: Date | null } | undefined;
    try {
      currentRun = (
        await client.query(
          'SELECT status, delivery_started_at FROM schedule_runs WHERE id = $1 AND schedule_id = $2 FOR UPDATE NOWAIT',
          [run.runId, run.scheduleId],
        )
      ).rows[0];
    } catch (err: any) {
      if (err?.code === '55P03') {
        await client.query('ROLLBACK');
        return 'busy';
      }
      throw err;
    }

    signal.throwIfAborted();
    if (!currentRun || currentRun.status !== 'planning' || currentRun.delivery_started_at !== null) {
      await client.query('COMMIT');
      return 'discarded';
    }

    const marked = await client.query(
      `UPDATE schedule_runs
          SET delivery_started_at = now(), updated_at = now(),
              dispatched_config = $3::jsonb, dispatched_config_hash = $4
        WHERE id = $1
          AND schedule_id = $2
          AND status = 'planning'
          AND delivery_started_at IS NULL
      RETURNING id`,
      [run.runId, run.scheduleId, JSON.stringify(schedule.digest_config), schedule.digest_config_hash],
    );
    await client.query('COMMIT');
    return marked.rowCount ? 'claimed' : 'discarded';
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export function createNotionDigestRunner(options: NotionDigestRunnerOptions): RunNotionDigest {
  const blocked = (error = NOTION_DIGEST_REAPPROVAL): NotionDigestRunOutcome =>
    ({ state: 'blocked', error, pauseReason: error });

  return async (run, _convId, signal) => {
    signal.throwIfAborted();
    const config = run.digestConfig;
    const binding = config && approvedSlackNotionBinding(config);
    const sources = options.notionSources;
    if (!config || !binding || !sources || binding.ownerId !== run.userId || run.workspaceMode === 'organization') {
      return blocked();
    }
    if (computeNotionDigestConfigHash({ config, recurrence: run.recurrence, userId: run.userId }) !== run.digestConfigHash) {
      return blocked();
    }

    let slackAdapter: any;
    try {
      slackAdapter = await options.getAdapter?.('slack', {
        userId: run.userId, phase: 'execution',
        workspaceMode: run.workspaceMode, workspaceId: run.workspaceId,
      });
      if (!slackAdapter) return blocked('Không khởi tạo được kết nối Slack.');
      const channels = await slackAdapter.execute('slack.search_channels', { query: config.channelName }, { signal });
      if (!Array.isArray(channels) || !channels.some((channel) => String(channel.id) === config.channelId)) {
        return blocked('Kênh Slack nhận bản tin không còn nằm trong phạm vi cho phép.');
      }
    } catch {
      return blocked('Không xác minh được kênh Slack nhận bản tin.');
    }

    let sourceData: Awaited<ReturnType<NotionDigestSourceAuthority['read']>>;
    try {
      sourceData = await sources.read(run.userId, binding, signal);
    } catch (error) {
      if (isNotionSourceDenied(error)) return blocked();
      return { state: 'digest_failed', error: 'Không đọc được dữ liệu từ Notion lúc này. Hãy thử lại.' };
    }
    const effectiveTimeZone = run.timeZone ?? options.timeZone;
    const lines = [
      `*Bản tin Notion tự động của Planora* · Workspace: ${escapeSlackMrkdwn(config.workspaceName)}`,
    ];
    let totalDueSoon = 0;
    let totalUnassigned = 0;
    for (const db of config.databases) {
      const pages = (sourceData.pagesByDatabase.get(db.id) ?? []).map((page: any): NotionPageDigestItem => ({
        databaseId: db.id,
        databaseTitle: db.title,
        id: String(page.id ?? ''),
        title: String(page.title ?? 'Trang không tiêu đề'),
        url: String(page.url ?? ''),
        properties: page.properties,
        lastEditedTime: page.lastEditedTime,
      }));
      const dbTruncated = Boolean(sourceData.truncatedByDatabase?.get(db.id));
      const section = formatNotionDatabaseSection(db.title, pages, run.dueAt.getTime(), {
        timeZone: effectiveTimeZone,
        truncated: dbTruncated,
      });
      totalDueSoon += section.stats.dueSoon;
      totalUnassigned += section.stats.unassigned;
      lines.push(...section.lines);
    }
    const truncated = Boolean(sourceData.truncated);
    const truncFooter = truncated
      ? '\n_⚠️ Lưu ý: Một số database còn trang chưa hiển thị hết (giới hạn tải 20 trang/database mỗi lượt); số liệu chỉ phản ánh phần đã tải._'
      : '';
    const joinedBody = lines.join('\n');
    const maxBodyLen = Math.max(0, 3500 - truncFooter.length);
    const text = `${joinedBody.length > maxBodyLen ? joinedBody.slice(0, maxBodyLen) : joinedBody}${truncFooter}`;

    let deliveryStarted = false;
    try {
      return await sources.withSource(run.userId, binding, signal, async (client) => {
        const claim = await claimNotionDigestDelivery(client, run, signal);
        if (claim === 'busy') {
          return { state: 'digest_failed', error: 'Lượt gửi Notion đang được xử lý. Chưa có bản tin nào được gửi từ lượt thử này.' };
        }
        if (claim === 'discarded') return { state: 'discarded' };
        deliveryStarted = true;
        const blocks = buildSlackMarkdownDigestBlocks({
          headerTitle: 'Bản tin Notion tự động của Planora',
          messageText: text,
        });
        const receipt = await slackAdapter.execute('slack.send_message', { channel: config.channelId, text, blocks }, { signal });
        if (!isSlackMessageTimestamp(receipt?.ts)) {
          return { state: 'delivery_unknown', error: NOTION_DELIVERY_UNKNOWN };
        }
        const delivery: NotionDigestDelivery = {
          channelId: config.channelId,
          channelName: config.channelName,
          ts: receipt.ts.trim(),
          counts: {
            databasesChecked: config.databases.length,
            totalPages: sourceData.pages.length,
            dueSoon: totalDueSoon,
            unassigned: totalUnassigned,
          },
          ...(truncated ? { truncated: true } : {}),
        };
        return { state: 'digest_sent', delivery, text };
      });
    } catch (error) {
      if (!deliveryStarted && isNotionSourceDenied(error)) return blocked();
      if (deliveryStarted && !isDefiniteWriteRejection(error)) {
        return { state: 'delivery_unknown', error: NOTION_DELIVERY_UNKNOWN };
      }
      if (deliveryStarted) {
        await options.pool.query(
          "UPDATE schedule_runs SET delivery_started_at = NULL WHERE id = $1 AND status = 'planning'",
          [run.runId],
        );
      }
      return { state: 'digest_failed', error: 'Không gửi được bản tin Notion lên Slack. Hãy thử lại.' };
    }
  };
}
