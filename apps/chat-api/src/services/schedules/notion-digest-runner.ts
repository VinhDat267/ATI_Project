import type pg from 'pg';
import type { NotionDigestConfig, NotionDigestDelivery, ScheduleRecurrence } from '@wap/tool-schemas';
import { isUuid } from '../../db/repositories/uuid.js';
import { computeNotionDigestConfigHash } from './notion-digest-candidate.js';
import { escapeSlackMrkdwn } from './github-digest-runner.js';
import type { RunToPlan } from './schedule-runner.js';

export const NOTION_DELIVERY_UNKNOWN =
  'Chưa xác định bản tin Notion đã gửi hay chưa. Hãy kiểm tra kênh nhận trước khi gửi thêm; lượt này không tự gửi lại.';

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
  notionConnection?: (userId: string, scopeId?: string) => Promise<any>;
  telegramConnection?: (userId: string) => Promise<any>;
  getAdapter?: (serviceName: string, context?: any) => Promise<any> | any;
  summarizeDigest?: (
    input: {
      workspaceName: string;
      databases: Array<{ id: string; title: string; url?: string }>;
      pages: NotionPageDigestItem[];
    },
    signal: AbortSignal
  ) => Promise<string | null>;
  aiTimeoutMs?: number;
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
  pool: pg.Pool,
  run: NotionDigestRunInput,
  signal: AbortSignal,
): Promise<'claimed' | 'discarded'> {
  if (typeof pool.connect !== 'function') {
    const marked = await pool.query(
      `UPDATE schedule_runs r
          SET delivery_started_at = now(), updated_at = now()
         FROM schedules s
        WHERE r.id = $1
          AND r.schedule_id = s.id
          AND s.id = $2
          AND r.status = 'planning'
          AND r.delivery_started_at IS NULL
          AND s.version = $3
          AND s.status IN ('active', 'completed')
        RETURNING r.id`,
      [run.runId, run.scheduleId, run.scheduleVersion],
    );
    return marked.rowCount ? 'claimed' : 'discarded';
  }

  const client = await pool.connect();
  try {
    const found = await client.query('SELECT conv_id FROM schedules WHERE id = $1', [run.scheduleId]);
    if (!found.rowCount) {
      return 'discarded';
    }
    const scheduleConvId = found.rows[0].conv_id;

    for (;;) {
      signal.throwIfAborted();
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '10s'");
      await client.query('SELECT id FROM conversations WHERE id = $1 FOR UPDATE', [scheduleConvId]);
      const schedule = (
        await client.query(
          `SELECT s.id, s.user_id, s.kind, s.version, s.status, s.digest_config_hash
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
          await client.query(
            'SELECT id FROM schedule_runs WHERE id = $1 AND schedule_id = $2 FOR UPDATE',
            [run.runId, run.scheduleId],
          );
          continue;
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
            SET delivery_started_at = now(), updated_at = now()
          WHERE id = $1
            AND schedule_id = $2
            AND status = 'planning'
            AND delivery_started_at IS NULL
        RETURNING id`,
        [run.runId, run.scheduleId],
      );
      await client.query('COMMIT');
      return marked.rowCount ? 'claimed' : 'discarded';
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function createNotionDigestRunner(options: NotionDigestRunnerOptions): RunNotionDigest {
  const aiTimeoutMs = options.aiTimeoutMs ?? 10_000;

  return async (
    run: NotionDigestRunInput,
    _convId: string,
    signal: AbortSignal
  ): Promise<NotionDigestRunOutcome> => {
    signal.throwIfAborted();
    const config = run.digestConfig;
    const configHash = run.digestConfigHash;

    // 1. Pre-read config hash & permission verification
    if (!config || !configHash) {
      return {
        state: 'blocked',
        error: 'Cấu hình bản tin Notion đã thay đổi, cần xác nhận lại.',
        pauseReason: 'Cấu hình bản tin Notion đã thay đổi, cần xác nhận lại.',
      };
    }

    const expectedHash = computeNotionDigestConfigHash({
      config,
      recurrence: run.recurrence,
      userId: run.userId,
    });
    if (expectedHash !== configHash) {
      return {
        state: 'blocked',
        error: 'Cấu hình bản tin Notion đã thay đổi, cần xác nhận lại.',
        pauseReason: 'Cấu hình bản tin Notion đã thay đổi, cần xác nhận lại.',
      };
    }

    let notion: any;
    try {
      notion = await options.notionConnection?.(run.userId);
    } catch {
      notion = null;
    }

    if (
      !notion ||
      notion.status !== 'connected' ||
      !notion.connection ||
      notion.connection.credentialId !== config.credentialId ||
      notion.connection.identityVersion !== config.identityVersion
    ) {
      return {
        state: 'blocked',
        error: 'Kết nối Notion của chủ lịch không còn hợp lệ hoặc đã thay đổi.',
        pauseReason: 'Kết nối Notion của chủ lịch không còn hợp lệ hoặc đã thay đổi.',
      };
    }

    const allowedDbSet = new Set(
      ((notion.connection.databaseIds ?? []) as string[]).map((id) => id.toLowerCase())
    );
    if (!config.databases.every((d) => allowedDbSet.has(d.id.toLowerCase()))) {
      return {
        state: 'blocked',
        error: 'Chủ lịch không còn quyền truy cập đầy đủ các database Notion trong bản tin.',
        pauseReason: 'Chủ lịch không còn quyền truy cập đầy đủ các database Notion trong bản tin.',
      };
    }

    const isTelegramDest = Boolean(config.telegramChatId);
    let notionAdapter: any;
    let slackAdapter: any;
    let telegramAdapter: any;

    try {
      notionAdapter = await options.getAdapter?.('notion', {
        userId: run.userId,
        phase: 'execution',
        connections: {
          notion: {
            credentialId: config.credentialId,
            workspaceId: config.workspaceId,
            workspaceName: config.workspaceName,
            botId: config.botId,
            identityVersion: config.identityVersion,
            databaseIds: config.databases.map((d) => d.id.toLowerCase()),
            databases: config.databases,
          },
        },
      });
      if (isTelegramDest) {
        if (options.telegramConnection) {
          const tg = await options.telegramConnection(run.userId);
          const allowedChatIds = new Set(
            ((tg?.connection?.chatIds ?? []) as string[]).map((id) => String(id))
          );
          if (!tg || tg.status !== 'connected' || !allowedChatIds.has(String(config.telegramChatId))) {
            return {
              state: 'blocked',
              error: 'Cuộc trò chuyện Telegram nhận bản tin không còn nằm trong phạm vi cho phép.',
              pauseReason: 'Cuộc trò chuyện Telegram nhận bản tin không còn nằm trong phạm vi cho phép.',
            };
          }
        }
        telegramAdapter = await options.getAdapter?.('telegram', {
          userId: run.userId,
          phase: 'execution',
        });
      } else {
        slackAdapter = await options.getAdapter?.('slack', {
          userId: run.userId,
          phase: 'execution',
        });
      }
    } catch (err: any) {
      const msg = err?.message || 'Kết nối dịch vụ không khả dụng.';
      return { state: 'blocked', error: msg, pauseReason: msg };
    }

    if (!notionAdapter || (isTelegramDest ? !telegramAdapter : !slackAdapter)) {
      return {
        state: 'blocked',
        error: isTelegramDest
          ? 'Không khởi tạo được kết nối Notion hoặc Telegram.'
          : 'Không khởi tạo được kết nối Notion hoặc Slack.',
        pauseReason: isTelegramDest
          ? 'Không khởi tạo được kết nối Notion hoặc Telegram.'
          : 'Không khởi tạo được kết nối Notion hoặc Slack.',
      };
    }

    if (!isTelegramDest) {
      try {
        const channels = await slackAdapter.execute(
          'slack.search_channels',
          { query: config.channelName },
          { signal }
        );
        if (
          Array.isArray(channels) &&
          !channels.some((c: any) => String(c.id) === config.channelId)
        ) {
          return {
            state: 'blocked',
            error: 'Kênh Slack nhận bản tin không còn nằm trong phạm vi cho phép.',
            pauseReason: 'Kênh Slack nhận bản tin không còn nằm trong phạm vi cho phép.',
          };
        }
      } catch (err: any) {
        if (err?.category === 'AUTH_ERROR') {
          return {
            state: 'blocked',
            error: 'Kênh Slack nhận bản tin không còn nằm trong phạm vi cho phép.',
            pauseReason: 'Kênh Slack nhận bản tin không còn nằm trong phạm vi cho phép.',
          };
        }
      }
    }

    // 2. Query Notion databases
    const allPages: NotionPageDigestItem[] = [];
    const pagesByDb = new Map<string, NotionPageDigestItem[]>();

    try {
      for (const db of config.databases) {
        signal.throwIfAborted();
        const res = await notionAdapter.execute(
          'notion.query_database',
          { databaseId: db.id, limit: 20 },
          { signal, databaseId: db.id }
        );
        const rawPages = Array.isArray(res?.pages)
          ? res.pages
          : Array.isArray(res)
            ? res
            : [];
        const dbPages: NotionPageDigestItem[] = rawPages.map((p: any) => ({
          databaseId: db.id,
          databaseTitle: db.title,
          id: String(p?.id ?? ''),
          title: String(p?.title ?? p?.name ?? 'Trang không tiêu đề'),
          url: String(p?.url ?? ''),
          properties:
            p?.properties && typeof p.properties === 'object' ? p.properties : undefined,
          ...(typeof p?.lastEditedTime === 'string' ? { lastEditedTime: p.lastEditedTime } : {}),
        }));
        pagesByDb.set(db.id, dbPages);
        allPages.push(...dbPages);
      }
    } catch (err: any) {
      if (err?.category === 'AUTH_ERROR') {
        const msg = err.message || 'Không có quyền đọc database Notion.';
        return { state: 'blocked', error: msg, pauseReason: msg };
      }
      return {
        state: 'digest_failed',
        error: 'Không đọc được dữ liệu từ Notion lúc này. Hãy thử lại.',
      };
    }

    // 3. Optional AI summary with strict AbortSignal timeout
    let aiSummary: string | null = null;
    if (options.summarizeDigest) {
      const aiController = new AbortController();
      const onParentAbort = () => aiController.abort();
      signal.addEventListener('abort', onParentAbort, { once: true });
      const aiTimer = setTimeout(() => aiController.abort(), aiTimeoutMs);
      try {
        const abortPromise = new Promise<null>((resolve) => {
          aiController.signal.addEventListener('abort', () => resolve(null), { once: true });
        });
        const raw = await Promise.race([
          options.summarizeDigest(
            {
              workspaceName: config.workspaceName,
              databases: config.databases,
              pages: allPages,
            },
            aiController.signal
          ),
          abortPromise,
        ]);
        if (typeof raw === 'string' && raw.trim()) {
          aiSummary = escapeSlackMrkdwn(raw.trim().slice(0, 400));
        }
      } catch {
        aiSummary = null;
      } finally {
        clearTimeout(aiTimer);
        signal.removeEventListener('abort', onParentAbort);
      }
    }

    // 4. Build escaped message (<= 3,500 chars)
    const lines: string[] = [
      `*Bản tin Notion tự động của Planora* · Workspace: ${escapeSlackMrkdwn(config.workspaceName)}`,
    ];
    if (aiSummary) {
      lines.push(`> 💡 *Nhận xét AI:* ${aiSummary}`);
    }
    const nowMs = run.dueAt instanceof Date ? run.dueAt.getTime() : Date.now();
    for (const db of config.databases) {
      lines.push(...formatNotionDatabaseSection(db.title, pagesByDb.get(db.id) ?? [], nowMs));
    }

    const messageText = lines.join('\n').slice(0, 3500);

    // 5. Pre-send schedule version and status check + mark delivery_started_at
    signal.throwIfAborted();
    let deliveryStarted = false;
    if (isUuid(run.runId)) {
      const claimState = await claimNotionDigestDelivery(options.pool, run, signal);
      if (claimState !== 'claimed') {
        return { state: 'discarded' };
      }
      deliveryStarted = true;
    } else {
      const preSendCheck = await options.pool.query(
        'SELECT version, status FROM schedules WHERE id = $1',
        [run.scheduleId]
      );
      const currentSchedule = preSendCheck.rows[0];
      if (
        !currentSchedule ||
        currentSchedule.version !== run.scheduleVersion ||
        currentSchedule.status === 'cancelled' ||
        currentSchedule.status === 'paused'
      ) {
        return { state: 'discarded' };
      }
    }

    // 6. Send Slack or Telegram message (once called, never transition to discarded)
    if (isTelegramDest) {
      try {
        const sendRes = await telegramAdapter.execute(
          'telegram.send_message',
          { chatId: config.telegramChatId, text: messageText },
          { signal, chatId: config.telegramChatId }
        );
        const delivery: NotionDigestDelivery = {
          channelId: '',
          channelName: '',
          ts: null,
          telegramChatId: config.telegramChatId,
          telegramChatTitle: config.telegramChatTitle ?? '',
          messageId: typeof sendRes?.messageId === 'number' ? sendRes.messageId : null,
          counts: {
            databasesChecked: config.databases.length,
            totalPages: allPages.length,
          },
        };
        return { state: 'digest_sent', delivery, text: messageText };
      } catch (err: any) {
        if (!isDefiniteWriteRejection(err)) {
          return {
            state: 'delivery_unknown',
            error: NOTION_DELIVERY_UNKNOWN,
          };
        }
        if (deliveryStarted) {
          await options.pool.query(
            "UPDATE schedule_runs SET delivery_started_at = NULL WHERE id = $1 AND status = 'planning'",
            [run.runId],
          );
        }
        return {
          state: 'digest_failed',
          error: 'Không gửi được bản tin Notion lên Telegram. Hãy thử lại.',
        };
      }
    }

    try {
      const sendRes = await slackAdapter.execute(
        'slack.send_message',
        { channel: config.channelId, text: messageText },
        { signal }
      );
      const delivery: NotionDigestDelivery = {
        channelId: config.channelId,
        channelName: config.channelName,
        ts: typeof sendRes?.ts === 'string' ? sendRes.ts : null,
        counts: {
          databasesChecked: config.databases.length,
          totalPages: allPages.length,
        },
      };
      return { state: 'digest_sent', delivery, text: messageText };
    } catch (err: any) {
      if (!isDefiniteWriteRejection(err)) {
        return {
          state: 'delivery_unknown',
          error: NOTION_DELIVERY_UNKNOWN,
        };
      }
      if (deliveryStarted) {
        await options.pool.query(
          "UPDATE schedule_runs SET delivery_started_at = NULL WHERE id = $1 AND status = 'planning'",
          [run.runId],
        );
      }
      return {
        state: 'digest_failed',
        error: 'Không gửi được bản tin Notion lên Slack. Hãy thử lại.',
      };
    }
  };
}
