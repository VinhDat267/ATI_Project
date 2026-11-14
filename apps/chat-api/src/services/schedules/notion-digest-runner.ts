import { isSlackMessageTimestamp } from './slack-message-timestamp.js';
import type pg from 'pg';
import type { NotionDigestConfig, NotionDigestDelivery, ScheduleRecurrence } from '@wap/tool-schemas';
import { approvedSlackNotionBinding, computeNotionDigestConfigHash } from './notion-digest-candidate.js';
import { escapeSlackMrkdwn } from './github-digest-runner.js';
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
  recentlyUpdated: number;
}

function parseNotionDateMs(raw: string): number | null {
  const firstPart = raw.split('→')[0]?.trim() ?? '';
  if (!firstPart) return null;
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(firstPart);
  if (dmy) {
    const dt = Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    return Number.isFinite(dt) ? dt : null;
  }
  const parsed = Date.parse(firstPart);
  return Number.isFinite(parsed) ? parsed : null;
}

export function analyzeNotionDigestPages(
  pages: NotionPageDigestItem[],
  nowMs: number = Date.now(),
): {
  stats: NotionDigestStats;
  sortedPages: Array<{
    page: NotionPageDigestItem;
    bucket: 'overdue_blocked' | 'in_progress' | 'todo' | 'done';
    isRecent24h: boolean;
  }>;
} {
  const todayStartMs = new Date(nowMs).setUTCHours(0, 0, 0, 0);
  const stats: NotionDigestStats = {
    total: pages.length,
    done: 0,
    inProgress: 0,
    overdueOrBlocked: 0,
    recentlyUpdated: 0,
  };

  const enriched = pages.map((page) => {
    const props = page.properties ?? {};
    let statusVal = '';
    let dueVal = '';
    for (const [k, v] of Object.entries(props)) {
      if (!v || typeof v !== 'string') continue;
      const kl = k.toLowerCase();
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
    const dueMs = dueVal ? parseNotionDateMs(dueVal) : null;
    const isPastDue = !isDone && dueMs !== null && dueMs < todayStartMs;

    const editedMs = page.lastEditedTime ? Date.parse(page.lastEditedTime) : NaN;
    const isRecent24h = Number.isFinite(editedMs) && nowMs - editedMs >= 0 && nowMs - editedMs <= 24 * 3600_000;
    if (isRecent24h) stats.recentlyUpdated++;

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

    return { page, bucket, isRecent24h };
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
    if (a.isRecent24h !== b.isRecent24h) return a.isRecent24h ? -1 : 1;
    return 0;
  });

  return { stats, sortedPages: enriched };
}

export interface NotionDigestRunnerOptions {
  pool: pg.Pool;
  notionSources?: Pick<NotionDigestSourceAuthority, 'read' | 'withSource'>;
  getAdapter?: (serviceName: string, context?: any) => Promise<any> | any;
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
): string[] {
  const safeDb = escapeSlackMrkdwn(dbTitle);
  const { stats, sortedPages } = analyzeNotionDigestPages(pages, nowMs);
  const kpiParts: string[] = [`${stats.total} trang`];
  if (stats.overdueOrBlocked > 0) kpiParts.push(`🚨 ${stats.overdueOrBlocked} quá hạn/chặn`);
  if (stats.inProgress > 0) kpiParts.push(`🔄 ${stats.inProgress} đang làm`);
  if (stats.done > 0) kpiParts.push(`✅ ${stats.done} hoàn thành`);
  if (stats.recentlyUpdated > 0) kpiParts.push(`✨ ${stats.recentlyUpdated} mới sửa 24h`);

  const header = `• *📒 ${safeDb} (${kpiParts.join(' · ')}):*`;
  if (pages.length === 0) {
    return [header, '  - _(Chưa có trang nào)_'];
  }
  const itemLines = sortedPages.slice(0, 10).map(({ page: item, bucket, isRecent24h }) => {
    const safeTitle = escapeSlackMrkdwn(String(item.title || 'Trang không tiêu đề').slice(0, 120));
    const prefix =
      bucket === 'overdue_blocked'
        ? '🚨 [Cần chú ý] '
        : bucket === 'in_progress'
          ? '🔄 '
          : bucket === 'done'
            ? '✅ '
            : '';
    const recentBadge = isRecent24h ? ' · ✨ Mới cập nhật 24h' : '';
    const badges = formatNotionPropertyBadges(item.properties);
    if (item.url) {
      return `  - ${prefix}<${item.url}|${safeTitle}>${badges}${recentBadge}`;
    }
    return `  - ${prefix}${safeTitle}${badges}${recentBadge}`;
  });
  if (pages.length > 10) {
    itemLines.push(`  - _... và ${pages.length - 10} trang khác_`);
  }
  return [header, ...itemLines];
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
    const lines = [
      `*Bản tin Notion tự động của Planora* · Workspace: ${escapeSlackMrkdwn(config.workspaceName)}`,
    ];
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
      lines.push(...formatNotionDatabaseSection(db.title, pages, run.dueAt.getTime()));
    }
    const text = lines.join('\n').slice(0, 3500);

    let deliveryStarted = false;
    try {
      return await sources.withSource(run.userId, binding, signal, async (client) => {
        const claim = await claimNotionDigestDelivery(client, run, signal);
        if (claim === 'busy') {
          return { state: 'digest_failed', error: 'Lượt gửi Notion đang được xử lý. Chưa có bản tin nào được gửi từ lượt thử này.' };
        }
        if (claim === 'discarded') return { state: 'discarded' };
        deliveryStarted = true;
        const receipt = await slackAdapter.execute('slack.send_message', { channel: config.channelId, text }, { signal });
        if (
          !isSlackMessageTimestamp(receipt?.ts)
        ) {
          return { state: 'delivery_unknown', error: NOTION_DELIVERY_UNKNOWN };
        }
        const delivery: NotionDigestDelivery = {
          channelId: config.channelId, channelName: config.channelName, ts: receipt.ts.trim(),
          counts: { databasesChecked: config.databases.length, totalPages: sourceData.pages.length },
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
