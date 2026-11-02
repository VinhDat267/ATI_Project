import type pg from 'pg';
import type { TrelloDigestConfig, TrelloDigestDelivery, ScheduleRecurrence } from '@wap/tool-schemas';
import { computeTrelloDigestConfigHash } from './trello-digest-candidate.js';
import { escapeSlackMrkdwn } from './github-digest-runner.js';
import type { RunToPlan } from './schedule-runner.js';

export interface TrelloDigestRunInput extends RunToPlan {
  recurrence: ScheduleRecurrence;
  digestConfig: TrelloDigestConfig | null;
  digestConfigHash: string | null;
}

export type TrelloDigestRunOutcome =
  | { state: 'digest_sent'; delivery: TrelloDigestDelivery; text: string }
  | { state: 'digest_failed'; error: string }
  | { state: 'blocked'; error: string; pauseReason: string }
  | { state: 'discarded' };

export type RunTrelloDigest = (
  run: TrelloDigestRunInput,
  convId: string,
  signal: AbortSignal
) => Promise<TrelloDigestRunOutcome>;

export interface TrelloCardDigestItem {
  boardName: string;
  id: string;
  name: string;
  url: string;
  due?: string | null;
}

export interface TrelloDigestRunnerOptions {
  pool: pg.Pool;
  trelloConnection?: (userId: string, scopeId?: string) => Promise<any>;
  telegramConnection?: (userId: string) => Promise<any>;
  getAdapter?: (serviceName: string, context?: any) => Promise<any> | any;
  summarizeDigest?: (
    input: {
      boards: Array<{ id: string; name: string }>;
      overdueCards: TrelloCardDigestItem[];
      dueSoonCards: TrelloCardDigestItem[];
      unassignedCards: TrelloCardDigestItem[];
      dueSoonHours: number;
    },
    signal: AbortSignal
  ) => Promise<string | null>;
  aiTimeoutMs?: number;
}

function formatTrelloSectionItems(items: TrelloCardDigestItem[]): string[] {
  if (items.length === 0) {
    return ['  - _(Không có thẻ nào)_'];
  }
  return items.map((item) => {
    const safeTitle = escapeSlackMrkdwn(String(item.name ?? '').slice(0, 120));
    const safeBoard = escapeSlackMrkdwn(String(item.boardName ?? ''));
    const dueSuffix = item.due ? ` _(hạn: ${item.due.slice(0, 16).replace('T', ' ')})_` : '';
    if (item.url) {
      return `  - [${safeBoard}] <${item.url}|${safeTitle}>${dueSuffix}`;
    }
    return `  - [${safeBoard}] ${safeTitle}${dueSuffix}`;
  });
}

export function createTrelloDigestRunner(options: TrelloDigestRunnerOptions): RunTrelloDigest {
  const aiTimeoutMs = options.aiTimeoutMs ?? 10_000;

  return async (
    run: TrelloDigestRunInput,
    _convId: string,
    signal: AbortSignal
  ): Promise<TrelloDigestRunOutcome> => {
    signal.throwIfAborted();
    const config = run.digestConfig;
    const configHash = run.digestConfigHash;

    // 1. Pre-read config hash & permission verification
    if (!config || !configHash) {
      return {
        state: 'blocked',
        error: 'Cấu hình bản tin Trello đã thay đổi, cần xác nhận lại.',
        pauseReason: 'Cấu hình bản tin Trello đã thay đổi, cần xác nhận lại.',
      };
    }

    const expectedHash = computeTrelloDigestConfigHash({
      config,
      recurrence: run.recurrence,
      userId: run.userId,
    });
    if (expectedHash !== configHash) {
      return {
        state: 'blocked',
        error: 'Cấu hình bản tin Trello đã thay đổi, cần xác nhận lại.',
        pauseReason: 'Cấu hình bản tin Trello đã thay đổi, cần xác nhận lại.',
      };
    }

    let trello: any;
    try {
      trello = await options.trelloConnection?.(run.userId);
    } catch {
      trello = null;
    }

    if (
      !trello ||
      trello.status !== 'connected' ||
      !trello.connection ||
      trello.connection.credentialId !== config.credentialId
    ) {
      return {
        state: 'blocked',
        error: 'Kết nối Trello của chủ lịch không còn hợp lệ hoặc đã thay đổi.',
        pauseReason: 'Kết nối Trello của chủ lịch không còn hợp lệ hoặc đã thay đổi.',
      };
    }

    const memberBoardSet = new Set((trello.connection.boardIds ?? []) as string[]);
    if (!config.boards.every((b) => memberBoardSet.has(b.id))) {
      return {
        state: 'blocked',
        error: 'Chủ lịch không còn quyền truy cập đầy đủ các bảng Trello trong bản tin.',
        pauseReason: 'Chủ lịch không còn quyền truy cập đầy đủ các bảng Trello trong bản tin.',
      };
    }

    const isTelegramDest = Boolean(config.telegramChatId);
    let trelloAdapter: any;
    let slackAdapter: any;
    let telegramAdapter: any;

    try {
      trelloAdapter = await options.getAdapter?.('trello', {
        userId: run.userId,
        phase: 'execution',
        connections: {
          trello: {
            credentialId: config.credentialId,
            memberId: config.trelloMemberId,
            username: config.username,
            boardIds: config.boards.map((b) => b.id),
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

    if (!trelloAdapter || (isTelegramDest ? !telegramAdapter : !slackAdapter)) {
      return {
        state: 'blocked',
        error: isTelegramDest
          ? 'Không khởi tạo được kết nối Trello hoặc Telegram.'
          : 'Không khởi tạo được kết nối Trello hoặc Slack.',
        pauseReason: isTelegramDest
          ? 'Không khởi tạo được kết nối Trello hoặc Telegram.'
          : 'Không khởi tạo được kết nối Trello hoặc Slack.',
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

    // 2. Scan Trello boards for Overdue, Due-Soon, and Unassigned cards
    const nowMs = run.dueAt.getTime();
    const dueSoonHours = Math.min(168, Math.max(1, config.dueSoonHours || 24));
    const dueSoonLimitMs = nowMs + dueSoonHours * 3600_000;

    const overdueCards: TrelloCardDigestItem[] = [];
    const dueSoonCards: TrelloCardDigestItem[] = [];
    const unassignedCards: TrelloCardDigestItem[] = [];

    try {
      for (const board of config.boards) {
        signal.throwIfAborted();
        const cards = await trelloAdapter.execute(
          'trello.search_cards',
          { query: '', boardId: board.id, limit: 50 },
          { signal, boardId: board.id }
        );
        if (!Array.isArray(cards)) continue;

        for (const c of cards) {
          if (c?.dueComplete === true) continue;
          const item: TrelloCardDigestItem = {
            boardName: board.name,
            id: String(c.id),
            name: String(c.name ?? ''),
            url: String(c.url ?? ''),
            due: typeof c.due === 'string' ? c.due : null,
          };

          if (typeof c.due === 'string' && c.due) {
            const dueMs = Date.parse(c.due);
            if (!Number.isNaN(dueMs)) {
              if (dueMs < nowMs) {
                if (overdueCards.length < 15) overdueCards.push(item);
              } else if (dueMs <= dueSoonLimitMs) {
                if (dueSoonCards.length < 15) dueSoonCards.push(item);
              }
            }
          }

          const members = Array.isArray(c.idMembers) ? c.idMembers : [];
          if (members.length === 0) {
            if (unassignedCards.length < 15) unassignedCards.push(item);
          }
        }
      }
    } catch (err: any) {
      if (err?.category === 'AUTH_ERROR') {
        const msg = err.message || 'Không có quyền đọc bảng Trello.';
        return { state: 'blocked', error: msg, pauseReason: msg };
      }
      return {
        state: 'digest_failed',
        error: 'Không đọc được dữ liệu từ Trello lúc này. Hãy thử lại.',
      };
    }

    // 3. Optional AI bottleneck summary with strict AbortSignal timeout
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
              boards: config.boards,
              overdueCards,
              dueSoonCards,
              unassignedCards,
              dueSoonHours,
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
      `*Bản tin Trello tự động của ATI* · thiết lập bởi @${escapeSlackMrkdwn(config.username)}`,
    ];
    if (aiSummary) {
      lines.push(`> 💡 *Nhận xét AI:* ${aiSummary}`);
    }
    lines.push(
      `• *🚨 Thẻ quá hạn (${overdueCards.length}):*`,
      ...formatTrelloSectionItems(overdueCards),
      `• *⏰ Thẻ sắp đến hạn trong ${dueSoonHours}h tới (${dueSoonCards.length}):*`,
      ...formatTrelloSectionItems(dueSoonCards),
      `• *👤 Thẻ chưa gán người phụ trách (${unassignedCards.length}):*`,
      ...formatTrelloSectionItems(unassignedCards)
    );

    const messageText = lines.join('\n').slice(0, 3500);

    // 5. Pre-send schedule version and status check
    signal.throwIfAborted();
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

    // 6. Send Slack or Telegram message
    if (isTelegramDest) {
      try {
        const sendRes = await telegramAdapter.execute(
          'telegram.send_message',
          { chatId: config.telegramChatId, text: messageText },
          { signal, chatId: config.telegramChatId }
        );
        const delivery: TrelloDigestDelivery = {
          channelId: '',
          channelName: '',
          ts: null,
          telegramChatId: config.telegramChatId,
          telegramChatTitle: config.telegramChatTitle ?? '',
          messageId: typeof sendRes?.messageId === 'number' ? sendRes.messageId : null,
          counts: {
            overdueCards: overdueCards.length,
            dueSoonCards: dueSoonCards.length,
            unassignedCards: unassignedCards.length,
          },
        };
        return { state: 'digest_sent', delivery, text: messageText };
      } catch {
        return {
          state: 'digest_failed',
          error: 'Không gửi được bản tin Trello lên Telegram. Hãy thử lại.',
        };
      }
    }

    try {
      const sendRes = await slackAdapter.execute(
        'slack.send_message',
        { channel: config.channelId, text: messageText },
        { signal }
      );
      const delivery: TrelloDigestDelivery = {
        channelId: config.channelId,
        channelName: config.channelName,
        ts: typeof sendRes?.ts === 'string' ? sendRes.ts : null,
        counts: {
          overdueCards: overdueCards.length,
          dueSoonCards: dueSoonCards.length,
          unassignedCards: unassignedCards.length,
        },
      };
      return { state: 'digest_sent', delivery, text: messageText };
    } catch {
      return {
        state: 'digest_failed',
        error: 'Không gửi được bản tin Trello lên Slack. Hãy thử lại.',
      };
    }
  };
}
