import type pg from 'pg';
import type { GithubDigestConfig, GithubDigestDelivery, ScheduleRecurrence } from '@wap/tool-schemas';
import { isUuid } from '../../db/repositories/uuid.js';
import { computeDigestConfigHash } from './github-digest-candidate.js';
import type { RunToPlan } from './schedule-runner.js';
import { buildSlackMarkdownDigestBlocks } from '../slack/slack-digest-blocks.js';

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
  githubConnection?: (userId: string, scopeId?: string) => Promise<any>;
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

function isTransientDigestError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const cat = (err as { category?: unknown }).category;
  return typeof cat === 'string' && ['NETWORK', 'SERVER_ERROR', 'RATE_LIMIT', 'TIMEOUT'].includes(cat);
}

function toUtcIsoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const DIGEST_TEXT_LIMIT = 3500;
const DIGEST_SECTION_ITEM_LIMIT = 10;

type DigestItem = { repo: string; number: number; title: string };

function formatItemLine(
  item: DigestItem,
  kind: 'issues' | 'pull',
  format: 'slack' | 'telegram',
): string {
  const rawTitle = String(item.title ?? '').slice(0, 120);
  const url = `https://github.com/${item.repo}/${kind}/${Number(item.number)}`;
  const label = `${item.repo}#${Number(item.number)}`;
  if (format === 'telegram') {
    return `  - ${label}: ${rawTitle} — ${url}`;
  }
  return `  - <${url}|${label}>: ${escapeSlackMrkdwn(rawTitle)}`;
}

function formatGithubDigest(
  header: string,
  summary: string | null,
  sections: Array<{ label: string; items: DigestItem[]; kind: 'issues' | 'pull'; hitRepoCap: boolean }>,
  format: 'slack' | 'telegram',
): string {
  const rendered = sections.map(({ label, items, kind, hitRepoCap }) => {
    const heading = `${label} (${items.length}${hitRepoCap ? '+' : ''}):`;
    const footer = (shown: number): string | null => {
      if (items.length === 0) {
        return format === 'telegram' ? '  - (Không có mục nào)' : '  - _(Không có mục nào)_';
      }
      if (hitRepoCap) {
        return `  - ... còn thêm mục khác (giới hạn 20/repo, hiển thị ${shown}/${items.length}+)`;
      }
      return shown === items.length
        ? null
        : `  - ... còn ${items.length - shown} mục khác (hiển thị ${shown}/${items.length})`;
    };
    return {
      heading: format === 'telegram' ? `• ${heading}` : `• *${heading}*`,
      entries: items.slice(0, DIGEST_SECTION_ITEM_LIMIT).map((item) => formatItemLine(item, kind, format)),
      shown: [] as string[],
      footer,
    };
  });
  let summaryLine: string | null = null;
  const render = () => [
    header,
    summaryLine,
    ...rendered.flatMap(({ heading, shown, footer }) => [heading, ...shown, footer(shown.length)]),
  ].filter((line) => line !== null).join('\n');

  // Reserve every heading and overflow line. Offer one whole item per
  // section before the optional summary, then fill the remaining space evenly.
  let message = render();
  for (let index = 0; index < DIGEST_SECTION_ITEM_LIMIT; index += 1) {
    if (index === 1 && summary && message.length + 1 + summary.length <= DIGEST_TEXT_LIMIT) {
      summaryLine = summary;
      message = render();
    }
    for (const section of rendered) {
      const entry = section.entries[index];
      if (entry === undefined || section.shown.length !== index) continue;
      section.shown.push(entry);
      const candidate = render();
      if (candidate.length <= DIGEST_TEXT_LIMIT) {
        message = candidate;
      } else {
        section.shown.pop();
      }
    }
  }
  return message;
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
  const config = JSON.stringify(run.digestConfig);
  if (typeof pool.connect !== 'function') {
    const marked = await pool.query(
      `UPDATE schedule_runs r
          SET delivery_started_at = now(), updated_at = now(),
              dispatched_config = COALESCE(r.dispatched_config, $4::jsonb),
              dispatched_config_hash = COALESCE(r.dispatched_config_hash, $5)
         FROM schedules s
        WHERE r.id = $1
          AND r.schedule_id = s.id
          AND s.id = $2
          AND r.status = 'planning'
          AND r.delivery_started_at IS NULL
          AND r.schedule_version = $3
          AND s.version = $3
          AND s.kind = 'github_digest' AND s.user_id = $6
          AND s.digest_config = $4::jsonb AND s.digest_config_hash = $5
          AND (s.status = 'active' OR (s.status = 'completed' AND s.recurrence->>'type' = 'once'))
          AND (r.dispatched_config IS NULL OR r.dispatched_config = $4::jsonb)
          AND (r.dispatched_config_hash IS NULL OR r.dispatched_config_hash = $5)
        RETURNING r.id`,
      [run.runId, run.scheduleId, run.scheduleVersion, config, run.digestConfigHash, run.userId],
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
          `SELECT s.user_id, s.kind, s.version, s.status, s.recurrence, s.digest_config_hash
             FROM schedules s
             JOIN users u ON u.id = s.user_id AND u.status = 'active'
            WHERE s.id = $1 AND s.digest_config = $2::jsonb
              FOR UPDATE OF s`,
          [run.scheduleId, config],
        )
      ).rows[0];
      signal.throwIfAborted();
      if (
        !schedule ||
        schedule.user_id !== run.userId ||
        schedule.kind !== 'github_digest' ||
        schedule.version !== run.scheduleVersion ||
        schedule.digest_config_hash !== run.digestConfigHash ||
        (schedule.status !== 'active' && !(schedule.status === 'completed' && schedule.recurrence.type === 'once'))
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
            SET delivery_started_at = now(), updated_at = now(),
                dispatched_config = COALESCE(dispatched_config, $4::jsonb),
                dispatched_config_hash = COALESCE(dispatched_config_hash, $5)
          WHERE id = $1
            AND schedule_id = $2
            AND schedule_version = $3
            AND status = 'planning'
            AND delivery_started_at IS NULL
            AND (dispatched_config IS NULL OR dispatched_config = $4::jsonb)
            AND (dispatched_config_hash IS NULL OR dispatched_config_hash = $5)
        RETURNING id`,
        [run.runId, run.scheduleId, run.scheduleVersion, config, run.digestConfigHash],
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

    const githubScopeId =
      run.workspaceMode === 'organization' && run.workspaceId
        ? run.workspaceId
        : `personal:${run.userId}`;

    let gh: any;
    try {
      gh = await options.githubConnection?.(run.userId, githubScopeId);
    } catch (err) {
      signal.throwIfAborted();
      if (isTransientDigestError(err)) {
        return {
          state: 'digest_failed',
          error: 'GitHub tạm thời không phản hồi. Lịch sẽ tự thử lại ở kỳ tiếp theo.',
        };
      }
      gh = null;
    }

    if (gh?.status === 'unavailable') {
      return {
        state: 'digest_failed',
        error: 'GitHub tạm thời không phản hồi. Lịch sẽ tự thử lại ở kỳ tiếp theo.',
      };
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
    try {
      githubAdapter = await options.getAdapter?.('github', {
        userId: run.userId,
        ...(run.workspaceId !== undefined ? { workspaceId: run.workspaceId } : {}),
        ...(run.workspaceMode !== undefined ? { workspaceMode: run.workspaceMode } : {}),
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
    } catch (err: any) {
      signal.throwIfAborted();
      if (isTransientDigestError(err)) {
        return {
          state: 'digest_failed',
          error: 'GitHub tạm thời không phản hồi. Lịch sẽ tự thử lại ở kỳ tiếp theo.',
        };
      }
      const msg = err?.message || 'Kết nối dịch vụ không khả dụng.';
      return { state: 'blocked', error: msg, pauseReason: msg };
    }
    if (!githubAdapter) {
      const msg = isTelegramDest
        ? 'Không khởi tạo được kết nối GitHub hoặc Telegram.'
        : 'Không khởi tạo được kết nối GitHub hoặc Slack.';
      return { state: 'blocked', error: msg, pauseReason: msg };
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

    // 3. Read 3 sections from GitHub (up to 20 per repo to disclose '+' / truncation truthfully)
    const newIssues: Array<{ repo: string; number: number; title: string }> = [];
    const stalePrs: Array<{ repo: string; number: number; title: string }> = [];
    const unassignedIssues: Array<{ repo: string; number: number; title: string }> = [];
    let newHitCap = false;
    let staleHitCap = false;
    let unassignedHitCap = false;

    try {
      for (const repo of config.repos) {
        signal.throwIfAborted();
        const [newRes, prRes, unassignedRes] = await Promise.all([
          githubAdapter.execute(
            'github.search_issues',
            { repo, query: `is:issue created:>=${sinceIso}`, limit: 20 },
            { signal, repo },
          ),
          githubAdapter.execute(
            'github.search_issues',
            { repo, query: `is:pr is:open draft:false review:none created:<=${staleIso}`, limit: 20 },
            { signal, repo },
          ),
          githubAdapter.execute(
            'github.search_issues',
            { repo, query: 'is:issue is:open no:assignee', limit: 20 },
            { signal, repo },
          ),
        ]);

        if (Array.isArray(newRes)) {
          if (newRes.length >= 20) newHitCap = true;
          for (const item of newRes.slice(0, 20)) {
            newIssues.push({ repo, number: Number(item.number), title: String(item.title ?? '') });
          }
        }
        if (Array.isArray(prRes)) {
          if (prRes.length >= 20) staleHitCap = true;
          for (const item of prRes.slice(0, 20)) {
            stalePrs.push({ repo, number: Number(item.number), title: String(item.title ?? '') });
          }
        }
        if (Array.isArray(unassignedRes)) {
          if (unassignedRes.length >= 20) unassignedHitCap = true;
          for (const item of unassignedRes.slice(0, 20)) {
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
          const rawSummary = raw.trim().slice(0, 400);
          aiSummary = isTelegramDest ? rawSummary : escapeSlackMrkdwn(rawSummary);
        }
      } catch {
        aiSummary = null;
      } finally {
        clearTimeout(aiTimer);
        signal.removeEventListener('abort', onParentAbort);
      }
    }

    // 5. Build destination-appropriate digest message (<= 3,500 chars)
    const login = config.login.slice(0, 128);
    const header = isTelegramDest
      ? `Bản tin GitHub tự động của Planora · thiết lập bởi @${login}`
      : `*Bản tin GitHub tự động của Planora* · thiết lập bởi @${escapeSlackMrkdwn(login)}`;
    const summary = aiSummary && (isTelegramDest
      ? `💡 Nhận xét AI: ${aiSummary}`
      : `> 💡 *Nhận xét AI:* ${aiSummary}`);
    const messageText = formatGithubDigest(header, summary, [
      { label: 'Issue mới', items: newIssues, kind: 'issues', hitRepoCap: newHitCap },
      { label: `PR chờ review quá ${staleDays} ngày`, items: stalePrs, kind: 'pull', hitRepoCap: staleHitCap },
      { label: 'Issue mở chưa ai nhận', items: unassignedIssues, kind: 'issues', hitRepoCap: unassignedHitCap },
    ], isTelegramDest ? 'telegram' : 'slack');

    // Resolve the approved destination after source reads and AI work.
    signal.throwIfAborted();
    let slackAdapter: any;
    let telegramAdapter: any;
    try {
      if (isTelegramDest) {
        let tg: any = null;
        if (options.telegramConnection) {
          tg = await options.telegramConnection(run.userId);
          if (
            tg?.status === 'unavailable' ||
            (Array.isArray(tg?.unavailableChatIds) &&
              tg.unavailableChatIds.includes(String(config.telegramChatId)))
          ) {
            return {
              state: 'digest_failed',
              error: 'Telegram tạm thời không phản hồi. Lịch sẽ tự thử lại ở kỳ tiếp theo.',
            };
          }
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
          ...(run.workspaceId !== undefined ? { workspaceId: run.workspaceId } : {}),
          ...(run.workspaceMode !== undefined ? { workspaceMode: run.workspaceMode } : {}),
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
          ...(run.workspaceId !== undefined ? { workspaceId: run.workspaceId } : {}),
          ...(run.workspaceMode !== undefined ? { workspaceMode: run.workspaceMode } : {}),
          phase: 'execution',
        });
      }
    } catch (err: any) {
      signal.throwIfAborted();
      if (isTransientDigestError(err)) {
        return {
          state: 'digest_failed',
          error: 'Dịch vụ nhận bản tin tạm thời không phản hồi. Lịch sẽ tự thử lại ở kỳ tiếp theo.',
        };
      }
      const msg = err?.message || 'Kết nối dịch vụ không khả dụng.';
      return { state: 'blocked', error: msg, pauseReason: msg };
    }

    if (isTelegramDest ? !telegramAdapter : !slackAdapter) {
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
        const messageId =
          typeof sendRes?.messageId === 'number' &&
          Number.isInteger(sendRes.messageId) &&
          sendRes.messageId > 0
            ? sendRes.messageId
            : null;
        if (messageId === null) {
          return {
            state: 'delivery_unknown',
            error: GITHUB_DELIVERY_UNKNOWN,
          };
        }
        const delivery: GithubDigestDelivery = {
          channelId: '',
          channelName: '',
          ts: null,
          telegramChatId: config.telegramChatId,
          telegramChatTitle: config.telegramChatTitle ?? '',
          messageId,
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
      const blocks = buildSlackMarkdownDigestBlocks({
        headerTitle: 'Bản tin GitHub tự động của Planora',
        messageText,
      });
      const sendRes = await slackAdapter.execute(
        'slack.send_message',
        { channel: config.channelId, text: messageText, blocks },
        { signal },
      );
      const ts = typeof sendRes?.ts === 'string' && sendRes.ts.trim().length > 0 ? sendRes.ts.trim() : null;
      if (ts === null) {
        return {
          state: 'delivery_unknown',
          error: GITHUB_DELIVERY_UNKNOWN,
        };
      }
      const delivery: GithubDigestDelivery = {
        channelId: config.channelId,
        channelName: config.channelName,
        ts,
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
