import type pg from 'pg';
import type { GithubDigestConfig, GithubDigestDelivery, ScheduleRecurrence } from '@wap/tool-schemas';
import { isUuid } from '../../db/repositories/uuid.js';
import { computeDigestConfigHash } from './github-digest-candidate.js';
import type { RunToPlan } from './schedule-runner.js';

export const GITHUB_DELIVERY_UNKNOWN =
  'Chưa xác định bản tin GitHub đã gửi hay chưa. Hãy kiểm tra kênh nhận trước khi gửi thêm; lượt này không tự gửi lại.';

export function escapeSlackMrkdwn(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@(channel|here|everyone)\b/gi, '@\u200b$1');
}

export interface DigestRunInput extends RunToPlan {
  recurrence: ScheduleRecurrence;
  digestConfig: GithubDigestConfig | null;
  digestConfigHash: string | null;
}

export type DigestRunOutcome =
  | { state: 'digest_sent'; delivery: GithubDigestDelivery; text: string }
  | { state: 'digest_failed'; error: string }
  | { state: 'delivery_unknown'; error: string }
  | { state: 'blocked'; error: string; pauseReason: string }
  | { state: 'discarded' };

export type RunGithubDigest = (
  run: DigestRunInput,
  convId: string,
  signal: AbortSignal,
) => Promise<DigestRunOutcome>;

export interface GithubDigestRunnerOptions {
  pool: pg.Pool;
  githubConnection?: (userId: string) => Promise<any>;
  telegramConnection?: (userId: string) => Promise<any>;
  getAdapter?: (serviceName: string, context?: any) => Promise<any> | any;
  summarizeDigest?: (
    input: {
      repos: string[];
      newIssues: Array<{ repo: string; number: number; title: string }>;
      stalePrs: Array<{ repo: string; number: number; title: string }>;
      unassignedIssues: Array<{ repo: string; number: number; title: string }>;
      staleDays: number;
    },
    signal: AbortSignal,
  ) => Promise<string | null>;
  aiTimeoutMs?: number;
}

function toUtcIsoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function formatSectionItems(
  items: Array<{ repo: string; number: number; title: string }>,
  kind: 'issues' | 'pull',
): string[] {
  if (items.length === 0) {
    return ['  - _(Không có mục nào)_'];
  }
  return items.map((item) => {
    const safeTitle = escapeSlackMrkdwn(String(item.title ?? '').slice(0, 120));
    const url = `https://github.com/${item.repo}/${kind}/${Number(item.number)}`;
    return `  - <${url}|${item.repo}#${Number(item.number)}>: ${safeTitle}`;
  });
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

async function claimGithubDigestDelivery(
  pool: pg.Pool,
  run: DigestRunInput,
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
      // Follow the exact canonical lock order of ScheduleRepo.ownedSchedule:
      // 1) schedule's conversation, 2) schedule row, 3) schedule_runs row.
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
        schedule.kind !== 'github_digest' ||
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
          // Another transaction holds the run row lock directly without holding c,s.
          // Release c,s before waiting on the run row lock to avoid blocking setStatus,
          // then re-acquire c -> s -> r with a fresh snapshot once the run lock is released.
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

export function createGithubDigestRunner(options: GithubDigestRunnerOptions): RunGithubDigest {
  const aiTimeoutMs = options.aiTimeoutMs ?? 10_000;

  return async (run: DigestRunInput, _convId: string, signal: AbortSignal): Promise<DigestRunOutcome> => {
    signal.throwIfAborted();
    const config = run.digestConfig;
    const configHash = run.digestConfigHash;

    // 1. Pre-read config hash & permission verification
    if (!config || !configHash) {
      return {
        state: 'blocked',
        error: 'Cấu hình bản tin đã thay đổi, cần xác nhận lại.',
        pauseReason: 'Cấu hình bản tin đã thay đổi, cần xác nhận lại.',
      };
    }

    const expectedHash = computeDigestConfigHash({
      config,
      recurrence: run.recurrence,
      userId: run.userId,
    });
    if (expectedHash !== configHash) {
      return {
        state: 'blocked',
        error: 'Cấu hình bản tin đã thay đổi, cần xác nhận lại.',
        pauseReason: 'Cấu hình bản tin đã thay đổi, cần xác nhận lại.',
      };
    }

    let gh: any;
    try {
      gh = await options.githubConnection?.(run.userId);
    } catch {
      gh = null;
    }

    if (
      !gh ||
      gh.status !== 'connected' ||
      !gh.connection ||
      gh.connection.credentialId !== config.credentialId
    ) {
      return {
        state: 'blocked',
        error: 'Kết nối GitHub của chủ lịch không còn hợp lệ hoặc đã thay đổi.',
        pauseReason: 'Kết nối GitHub của chủ lịch không còn hợp lệ hoặc đã thay đổi.',
      };
    }

    const memberSet = new Set(
      ((gh.connection.repos ?? []) as string[]).map((r: string) => r.toLowerCase()),
    );
    if (!config.repos.every((r) => memberSet.has(r.toLowerCase()))) {
      return {
        state: 'blocked',
        error: 'Chủ lịch không còn quyền truy cập đầy đủ các repository trong bản tin.',
        pauseReason: 'Chủ lịch không còn quyền truy cập đầy đủ các repository trong bản tin.',
      };
    }

    const isTelegramDest = Boolean(config.telegramChatId);
    let githubAdapter: any;
    let slackAdapter: any;
    let telegramAdapter: any;
    try {
      githubAdapter = await options.getAdapter?.('github', {
        userId: run.userId,
        phase: 'execution',
        connections: {
          github: {
            credentialId: config.credentialId,
            githubUserId: config.githubUserId,
            login: config.login,
            repos: config.repos,
          },
        },
      });
      if (isTelegramDest) {
        let tg: any = null;
        if (options.telegramConnection) {
          tg = await options.telegramConnection(run.userId);
          const allowedChatIds = new Set(
            ((tg?.connection?.chatIds ?? []) as string[]).map((id) => String(id)),
          );
          if (
            !tg ||
            tg.status !== 'connected' ||
            (config.telegramCredentialId && tg.connection?.credentialId !== config.telegramCredentialId) ||
            (config.telegramUserId && tg.connection?.telegramUserId !== config.telegramUserId) ||
            !allowedChatIds.has(String(config.telegramChatId))
          ) {
            return {
              state: 'blocked',
              error: 'Cuộc trò chuyện Telegram nhận bản tin không còn nằm trong phạm vi cho phép.',
              pauseReason: 'Cuộc trò chuyện Telegram nhận bản tin không còn nằm trong phạm vi cho phép.',
            };
          }
        }
        const telegramCredentialId = config.telegramCredentialId ?? tg?.connection?.credentialId ?? '';
        const telegramUserId = config.telegramUserId ?? tg?.connection?.telegramUserId ?? '';
        const telegramUsername = config.telegramUsername ?? tg?.connection?.username ?? '';
        telegramAdapter = await options.getAdapter?.('telegram', {
          userId: run.userId,
          phase: 'execution',
          connections: {
            telegram: {
              credentialId: telegramCredentialId,
              telegramUserId,
              username: telegramUsername,
              chatIds: [String(config.telegramChatId)],
            },
          },
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

    if (!githubAdapter || (isTelegramDest ? !telegramAdapter : !slackAdapter)) {
      return {
        state: 'blocked',
        error: isTelegramDest
          ? 'Không khởi tạo được kết nối GitHub hoặc Telegram.'
          : 'Không khởi tạo được kết nối GitHub hoặc Slack.',
        pauseReason: isTelegramDest
          ? 'Không khởi tạo được kết nối GitHub hoặc Telegram.'
          : 'Không khởi tạo được kết nối GitHub hoặc Slack.',
      };
    }

    if (!isTelegramDest) {
      // Verify Slack channel is still in allowedScope
      try {
        const channels = await slackAdapter.execute(
          'slack.search_channels',
          { query: config.channelName },
          { signal },
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

    // 2. Compute SINCE from the latest 'scheduled' digest_sent run's due_at
    const lastSentRes = await options.pool.query(
      `SELECT due_at FROM schedule_runs
       WHERE schedule_id = $1 AND trigger = 'scheduled' AND status = 'digest_sent'
       ORDER BY due_at DESC LIMIT 1`,
      [run.scheduleId],
    );
    const fallbackWindowMs =
      run.recurrence.type === 'weekly' ? 7 * 24 * 3600_000 : 24 * 3600_000;
    const sinceDate = lastSentRes.rowCount
      ? new Date(lastSentRes.rows[0].due_at)
      : new Date(run.dueAt.getTime() - fallbackWindowMs);
    const sinceIso = toUtcIsoSeconds(sinceDate);

    const staleDays = Math.min(14, Math.max(1, config.staleDays || 2));
    const staleBeforeDate = new Date(run.dueAt.getTime() - staleDays * 24 * 3600_000);
    const staleIso = toUtcIsoSeconds(staleBeforeDate);

    // 3. Read 3 sections from GitHub
    const newIssues: Array<{ repo: string; number: number; title: string }> = [];
    const stalePrs: Array<{ repo: string; number: number; title: string }> = [];
    const unassignedIssues: Array<{ repo: string; number: number; title: string }> = [];

    try {
      for (const repo of config.repos) {
        signal.throwIfAborted();
        const [newRes, prRes, unassignedRes] = await Promise.all([
          githubAdapter.execute(
            'github.search_issues',
            { repo, query: `is:issue created:>=${sinceIso}`, limit: 10 },
            { signal, repo },
          ),
          githubAdapter.execute(
            'github.search_issues',
            { repo, query: `is:pr is:open draft:false review:none created:<=${staleIso}`, limit: 10 },
            { signal, repo },
          ),
          githubAdapter.execute(
            'github.search_issues',
            { repo, query: 'is:issue is:open no:assignee', limit: 10 },
            { signal, repo },
          ),
        ]);

        if (Array.isArray(newRes)) {
          for (const item of newRes.slice(0, 10)) {
            newIssues.push({ repo, number: Number(item.number), title: String(item.title ?? '') });
          }
        }
        if (Array.isArray(prRes)) {
          for (const item of prRes.slice(0, 10)) {
            stalePrs.push({ repo, number: Number(item.number), title: String(item.title ?? '') });
          }
        }
        if (Array.isArray(unassignedRes)) {
          for (const item of unassignedRes.slice(0, 10)) {
            unassignedIssues.push({ repo, number: Number(item.number), title: String(item.title ?? '') });
          }
        }
      }
    } catch (err: any) {
      if (err?.category === 'AUTH_ERROR') {
        const msg = err.message || 'Không có quyền đọc repository GitHub.';
        return { state: 'blocked', error: msg, pauseReason: msg };
      }
      return {
        state: 'digest_failed',
        error: 'Không đọc được dữ liệu từ GitHub lúc này. Hãy thử lại.',
      };
    }

    // 4. Optional AI bottleneck summary with strict AbortSignal timeout
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
            { repos: config.repos, newIssues, stalePrs, unassignedIssues, staleDays },
            aiController.signal,
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

    // 5. Build escaped Slack message (<= 3,500 chars)
    const lines: string[] = [
      `*Bản tin GitHub tự động của Planora* · thiết lập bởi @${escapeSlackMrkdwn(config.login)}`,
    ];
    if (aiSummary) {
      lines.push(`> 💡 *Nhận xét AI:* ${aiSummary}`);
    }
    lines.push(
      `• *Issue mới (${newIssues.length}):*`,
      ...formatSectionItems(newIssues, 'issues'),
      `• *PR chờ review quá ${staleDays} ngày (${stalePrs.length}):*`,
      ...formatSectionItems(stalePrs, 'pull'),
      `• *Issue mở chưa ai nhận (${unassignedIssues.length}):*`,
      ...formatSectionItems(unassignedIssues, 'issues'),
    );

    const messageText = lines.join('\n').slice(0, 3500);

    // 6. Pre-send schedule version and status check + mark delivery_started_at
    signal.throwIfAborted();
    let deliveryStarted = false;
    if (isUuid(run.runId)) {
      const claimState = await claimGithubDigestDelivery(options.pool, run, signal);
      if (claimState !== 'claimed') {
        return { state: 'discarded' };
      }
      deliveryStarted = true;
    } else if (isUuid(run.scheduleId)) {
      const preSendCheck = await options.pool.query(
        'SELECT version, status FROM schedules WHERE id = $1',
        [run.scheduleId],
      );
      const currentSchedule = preSendCheck.rows[0];
      if (
        currentSchedule &&
        (currentSchedule.version !== run.scheduleVersion ||
          currentSchedule.status === 'cancelled' ||
          currentSchedule.status === 'paused')
      ) {
        return { state: 'discarded' };
      }
    }

    // 7. Send Slack or Telegram message (once called, never transition to discarded)
    if (isTelegramDest) {
      try {
        const sendRes = await telegramAdapter.execute(
          'telegram.send_message',
          { chatId: config.telegramChatId, text: messageText },
          { signal, chatId: config.telegramChatId },
        );
        const delivery: GithubDigestDelivery = {
          channelId: '',
          channelName: '',
          ts: null,
          telegramChatId: config.telegramChatId,
          telegramChatTitle: config.telegramChatTitle ?? '',
          messageId: typeof sendRes?.messageId === 'number' ? sendRes.messageId : null,
          counts: {
            newIssues: newIssues.length,
            stalePrs: stalePrs.length,
            unassignedIssues: unassignedIssues.length,
          },
        };
        return { state: 'digest_sent', delivery, text: messageText };
      } catch (err: any) {
        if (!isDefiniteWriteRejection(err)) {
          return {
            state: 'delivery_unknown',
            error: GITHUB_DELIVERY_UNKNOWN,
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
          error: 'Không gửi được bản tin lên Telegram. Hãy thử lại.',
        };
      }
    }

    try {
      const sendRes = await slackAdapter.execute(
        'slack.send_message',
        { channel: config.channelId, text: messageText },
        { signal },
      );
      const delivery: GithubDigestDelivery = {
        channelId: config.channelId,
        channelName: config.channelName,
        ts: typeof sendRes?.ts === 'string' ? sendRes.ts : null,
        counts: {
          newIssues: newIssues.length,
          stalePrs: stalePrs.length,
          unassignedIssues: unassignedIssues.length,
        },
      };
      return { state: 'digest_sent', delivery, text: messageText };
    } catch (err: any) {
      if (!isDefiniteWriteRejection(err)) {
        return {
          state: 'delivery_unknown',
          error: GITHUB_DELIVERY_UNKNOWN,
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
        error: 'Không gửi được bản tin lên Slack. Hãy thử lại.',
      };
    }
  };
}
