import type pg from 'pg';
import { decryptCredentials, detectCalendarConflicts, StepError } from '@wap/tool-adapters';
import {
  normalizeTelegramChatId,
  TELEGRAM_CHAT_ID_PATTERN,
  type GmailDigestBinding,
  type TelegramDigestConfig,
  type TelegramDigestDelivery,
} from '@wap/tool-schemas';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';
import type { AdapterContext } from '../adapter-factory.js';
import { GmailOAuthError } from '../gmail/oauth-client.js';
import { isGoogleConnectionChanged } from '../gmail/token-manager.js';
import type { TelegramBotClient } from '../telegram/bot-client.js';
import { localLabel } from './next-occurrence.js';
import { analyzeSheetKpiMetrics } from './sheets-digest-runner.js';
import {
  buildTelegramDigestSourceArgs,
  computeTelegramDigestConfigHash,
  getDigestSourceDisabledReason,
  READ_DIGEST_SOURCE_MAP,
} from './telegram-digest-candidate.js';
import {
  assertDigestScheduleLiveScopeAndAuth,
  buildPinnedTelegramAdapterContext,
} from './digest-scope-guard.js';
import {
  assertGmailDigestBinding,
  validateTelegramDigestGmailConfig,
} from './gmail-digest-binding.js';

export const TELEGRAM_DELIVERY_UNKNOWN =
  'TELEGRAM_DELIVERY_UNKNOWN: Đã bắt đầu gửi bản tin Telegram nhưng mất kết nối hoặc thiếu biên nhận hợp lệ từ dịch vụ đích. Hệ thống tạm dừng tự động gửi lại để tránh trùng lặp.';

function isDefiniteWriteRejection(error: unknown): boolean {
  const details = (error as { details?: { requestSent?: unknown } } | null)?.details;
  if (details && details.requestSent === false) return true;
  return false;
}

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
  workspaceMode?: 'legacy' | 'personal' | 'organization';
  workspaceId?: string | null;
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
      status: 'delivery_unknown';
      error: string;
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
  gmailOAuthClientId?: string;
  adapterFactory: {
    getAdapterForService(serviceName: string, context?: AdapterContext): Promise<any> | any;
  };
  botClient?: Pick<TelegramBotClient, 'getChatMember'>;
  timeZone: string;
  summarizeWithAi?: (prompt: string, signal: AbortSignal) => Promise<string | null>;
  aiTimeoutMs?: number;
  sendTimeoutMs?: number;
}

function isGmailAuthOrBindingFailure(error: unknown): boolean {
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

  private async withBoundedEgressAuthority<T>(
    run: DigestRunInput,
    gmailBinding: GmailDigestBinding | null,
    targetChatId: string,
    expectedTelegram: { credentialId: string; telegramUserId: string },
    signal: AbortSignal,
    timeoutMs: number,
    action: (callSignal: AbortSignal) => Promise<T>,
    options?: { claimDelivery?: boolean; onBeforeClaimSql?: () => void },
  ): Promise<{ kind: 'ok'; value: T } | { kind: 'outcome'; outcome: DigestRunOutcome }> {
    signal.throwIfAborted();
    if (!this.options.pool) {
      return {
        kind: 'outcome',
        outcome: {
          status: gmailBinding ? 'blocked' : 'digest_failed',
          error: 'Lịch tự gửi cần kết nối PostgreSQL.',
          pauseSchedule: true,
        },
      };
    }

    const safeTimeoutMs = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 0;
    const deadlineAt = Date.now() + safeTimeoutMs;
    const callController = new AbortController();
    const toError = (reason: unknown, fallback: string): Error =>
      reason instanceof Error ? reason : new Error(typeof reason === 'string' && reason ? reason : fallback);
    const getAbortOrTimeoutError = (): Error =>
      signal.aborted
        ? toError(signal.reason, 'Aborted')
        : toError(callController.signal.reason, 'EGRESS_TIMEOUT');
    const throwIfAbortedOrExpired = (): void => {
      if (signal.aborted) {
        if (!callController.signal.aborted) {
          callController.abort(signal.reason ?? new Error('Aborted'));
        }
        throw getAbortOrTimeoutError();
      }
      if (Date.now() >= deadlineAt && !callController.signal.aborted) {
        callController.abort(new Error('EGRESS_TIMEOUT'));
      }
      if (callController.signal.aborted) {
        throw getAbortOrTimeoutError();
      }
    };

    const onParentAbort = () => {
      callController.abort(signal.reason ?? new Error('Aborted'));
    };
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      signal.addEventListener('abort', onParentAbort, { once: true });
      if (signal.aborted) {
        onParentAbort();
        throw getAbortOrTimeoutError();
      }
      if (safeTimeoutMs <= 0) {
        callController.abort(new Error('EGRESS_TIMEOUT'));
        throw getAbortOrTimeoutError();
      }
      timer = setTimeout(() => {
        callController.abort(new Error('EGRESS_TIMEOUT'));
      }, safeTimeoutMs);

      if (typeof (this.options.pool as any).connect !== 'function') {
        if (gmailBinding) {
          return {
            kind: 'outcome',
            outcome: {
              status: 'blocked',
              error: 'Lịch Gmail tự gửi cần kết nối giao dịch PostgreSQL.',
              pauseSchedule: true,
            },
          };
        }
        if (options?.claimDelivery) {
          const preSendCheck = await this.options.pool.query(
            'SELECT version, status FROM schedules WHERE id = $1',
            [run.scheduleId],
          );
          const currentSchedule = preSendCheck.rows?.[0];
          if (
            !currentSchedule ||
            currentSchedule.version !== run.scheduleVersion ||
            currentSchedule.status === 'cancelled' ||
            currentSchedule.status === 'paused'
          ) {
            return { kind: 'outcome', outcome: { status: 'discarded' } };
          }
        }
        if (run.beforeSendCheck && !(await run.beforeSendCheck())) {
          return { kind: 'outcome', outcome: { status: 'discarded' } };
        }
        throwIfAbortedOrExpired();
        const value = await action(callController.signal);
        signal.throwIfAborted();
        return { kind: 'ok', value };
      }

      // Verify live Telegram group membership and optional pre-send hook OUTSIDE any PostgreSQL
      // transaction so zero PostgreSQL connections or locks are ever held across external network I/O.
      if (
        targetChatId !== expectedTelegram.telegramUserId &&
        targetChatId.startsWith('-') &&
        this.options.botClient
      ) {
        throwIfAbortedOrExpired();
        let onMemberAbort: (() => void) | undefined;
        const memberAbortPromise = new Promise<never>((_, reject) => {
          onMemberAbort = () => reject(getAbortOrTimeoutError());
          if (callController.signal.aborted) onMemberAbort();
          else callController.signal.addEventListener('abort', onMemberAbort, { once: true });
        });
        let isMember: boolean;
        try {
          isMember = await Promise.race([
            this.options.botClient.getChatMember(
              targetChatId,
              expectedTelegram.telegramUserId,
              callController.signal,
            ),
            memberAbortPromise,
          ]);
        } finally {
          if (onMemberAbort) {
            callController.signal.removeEventListener('abort', onMemberAbort);
          }
        }
        if (!isMember) {
          return {
            kind: 'outcome',
            outcome: {
              status: 'blocked',
              error: 'Bạn không còn là thành viên của nhóm Telegram nhận báo cáo.',
              pauseSchedule: true,
            },
          };
        }
      }

      if (options?.claimDelivery && run.beforeSendCheck) {
        throwIfAbortedOrExpired();
        if (!(await run.beforeSendCheck())) {
          return { kind: 'outcome', outcome: { status: 'discarded' } };
        }
      }

      throwIfAbortedOrExpired();
      const connectPromise = (this.options.pool as pg.Pool).connect();
      let checkoutHandedOff = false;
      let checkoutAbandoned = false;
      const guardedConnect = connectPromise.then((acquired) => {
        if (
          checkoutAbandoned ||
          callController.signal.aborted ||
          signal.aborted ||
          Date.now() >= deadlineAt
        ) {
          checkoutAbandoned = true;
          try {
            acquired.release();
          } catch {
            // Ignore release error on abandoned late-acquired client.
          }
          throw getAbortOrTimeoutError();
        }
        checkoutHandedOff = true;
        return acquired;
      });
      guardedConnect.catch(() => undefined);

      let onCheckoutAbort: (() => void) | undefined;
      const checkoutAbortPromise = new Promise<never>((_, reject) => {
        onCheckoutAbort = () => {
          if (!checkoutHandedOff) {
            checkoutAbandoned = true;
          }
          reject(getAbortOrTimeoutError());
        };
        if (callController.signal.aborted) {
          onCheckoutAbort();
        } else {
          callController.signal.addEventListener('abort', onCheckoutAbort, { once: true });
        }
      });

      let client: pg.PoolClient;
      try {
        client = await Promise.race([guardedConnect, checkoutAbortPromise]);
      } finally {
        if (onCheckoutAbort) {
          callController.signal.removeEventListener('abort', onCheckoutAbort);
        }
      }

      let txDirty = false;
      let releaseError: Error | undefined;
      const swallowTerminatedClientError = () => undefined;
      const onCheckedOutClientError = (clientErr: unknown) => {
        if (!releaseError) {
          releaseError = toError(clientErr, 'CLIENT_CONNECTION_ERROR');
        }
      };
      try {
        if (typeof (client as any)?.on === 'function') {
          (client as any).on('error', onCheckedOutClientError);
        }
      } catch {
        // Ignore listener attachment errors on custom/mocked clients.
      }
      const sessionState: { terminated: boolean; promise: Promise<void> | null } = {
        terminated: false,
        promise: null,
      };

      const terminateClientSession = (): Promise<void> => {
        sessionState.terminated = true;
        if (!releaseError) {
          releaseError = new Error('PostgreSQL backend session terminated on abort');
        }
        if (!sessionState.promise) {
          sessionState.promise = (async () => {
            const rawClient = client as any;
            try {
              if (typeof rawClient?.on === 'function') {
                rawClient.on('error', swallowTerminatedClientError);
              }
            } catch {
              // Ignore listener attachment errors on custom/mocked clients.
            }
            const destroyStream = () => {
              try {
                rawClient?.connection?.stream?.destroy?.();
              } catch {
                // Ignore stream destroy errors.
              }
            };
            const forceDestroyTimer = setTimeout(destroyStream, 50);
            forceDestroyTimer.unref?.();
            try {
              if (typeof rawClient?.end === 'function') {
                await rawClient.end();
              } else {
                destroyStream();
              }
            } catch {
              destroyStream();
            } finally {
              clearTimeout(forceDestroyTimer);
            }
          })();
        }
        return sessionState.promise;
      };

      const runBoundedSql = async <R extends pg.QueryResultRow = any>(
        text: string,
        values?: unknown[],
      ): Promise<pg.QueryResult<R>> => {
        throwIfAbortedOrExpired();
        const onSqlAbort = () => {
          void terminateClientSession();
        };
        callController.signal.addEventListener('abort', onSqlAbort, { once: true });
        if (callController.signal.aborted) {
          callController.signal.removeEventListener('abort', onSqlAbort);
          throw getAbortOrTimeoutError();
        }
        try {
          const res =
            values === undefined
              ? await client.query<R>(text)
              : await client.query<R>(text, values);
          throwIfAbortedOrExpired();
          return res;
        } finally {
          callController.signal.removeEventListener('abort', onSqlAbort);
          if (sessionState.promise) {
            await sessionState.promise;
          }
        }
      };

      const txQueryable = {
        query: (text: string, values?: unknown[]) => runBoundedSql(text, values),
      } as unknown as pg.PoolClient;

      try {
        throwIfAbortedOrExpired();
        txDirty = true;
        await runBoundedSql('BEGIN');
        const remainingMs = Math.max(1, Math.ceil(deadlineAt - Date.now()));
        const lockTimeoutMs = Math.min(5_000, remainingMs);
        const statementTimeoutMs = Math.min(15_000, remainingMs);
        await runBoundedSql(
          `SET LOCAL lock_timeout = '${lockTimeoutMs}ms'; SET LOCAL statement_timeout = '${statementTimeoutMs}ms'; DO $$ BEGIN PERFORM set_config('client_connection_check_interval', '1ms', true); EXCEPTION WHEN OTHERS THEN NULL; END $$`,
        );

        // Canonical lock order matching GmailConnectionRepo (users -> service_credentials)
        // followed by schedule lifecycle rows (conversations -> schedules -> schedule_runs), all NOWAIT.
        const userRow = (
          await runBoundedSql<{ id: string; status: string }>(
            'SELECT id, status FROM users WHERE id = $1 FOR SHARE NOWAIT',
            [run.userId],
          )
        ).rows[0];
        if (!userRow || userRow.status !== 'active') {
          await runBoundedSql('COMMIT');
          txDirty = false;
          return {
            kind: 'outcome',
            outcome: {
              status: 'blocked',
              error: 'Tài khoản không còn hoạt động.',
              pauseSchedule: true,
            },
          };
        }

        if (gmailBinding) {
          const gmailCheck = await assertGmailDigestBinding(
            txQueryable,
            run.userId,
            gmailBinding,
            this.options.gmailOAuthClientId,
            {
              encryptionKey: this.options.encryptionKey,
              lock: 'share_nowait',
            },
          );
          if (!gmailCheck.allowed) {
            await runBoundedSql('COMMIT');
            txDirty = false;
            return {
              kind: 'outcome',
              outcome: {
                status: 'blocked',
                error: gmailCheck.reason,
                pauseSchedule: true,
              },
            };
          }
        }

        const convRow = (
          await runBoundedSql(
            'SELECT id, user_id, workspace_id, workspace_mode FROM conversations WHERE id = (SELECT conv_id FROM schedules WHERE id = $1) FOR UPDATE NOWAIT',
            [run.scheduleId],
          )
        ).rows[0];
        const schedule = (
          await runBoundedSql('SELECT * FROM schedules WHERE id = $1 FOR UPDATE NOWAIT', [run.scheduleId])
        ).rows[0];
        const currentRun = (
          await runBoundedSql(
            'SELECT id, status, schedule_version, delivery_started_at FROM schedule_runs WHERE id = $1 AND schedule_id = $2 FOR UPDATE NOWAIT',
            [run.runId, run.scheduleId],
          )
        ).rows[0];

        throwIfAbortedOrExpired();

        if (
          !convRow ||
          !schedule ||
          currentRun?.status !== 'planning' ||
          currentRun.delivery_started_at != null ||
          schedule.user_id !== run.userId ||
          schedule.kind !== 'telegram_digest' ||
          schedule.version !== run.scheduleVersion ||
          schedule.digest_config_hash !== run.digestConfigHash ||
          schedule.status === 'cancelled' ||
          schedule.status === 'paused'
        ) {
          await runBoundedSql('COMMIT');
          txDirty = false;
          return { kind: 'outcome', outcome: { status: 'discarded' } };
        }

        // Re-verify live workspace/member/Telegram/Gmail scope using the SAME transaction client (never pool!).
        const pinnedCtx = await buildPinnedTelegramAdapterContext({
          pool: txQueryable,
          scheduleId: run.scheduleId,
          encryptionKey: this.options.encryptionKey,
          gmailOAuthClientId: this.options.gmailOAuthClientId,
        });
        if (
          !pinnedCtx.allowed ||
          pinnedCtx.chatId !== targetChatId ||
          pinnedCtx.credentialId !== expectedTelegram.credentialId ||
          pinnedCtx.telegramUserId !== expectedTelegram.telegramUserId
        ) {
          await runBoundedSql('COMMIT');
          txDirty = false;
          return {
            kind: 'outcome',
            outcome: {
              status: 'blocked',
              error: 'Kết nối hoặc phạm vi Telegram của lịch chạy không còn hợp lệ.',
              pauseSchedule: true,
            },
          };
        }

        if (options?.claimDelivery) {
          options.onBeforeClaimSql?.();
          const claimed = await runBoundedSql<{ id: string }>(
            `UPDATE schedule_runs
             SET delivery_started_at = now(), updated_at = now()
             WHERE id = $1 AND schedule_id = $2 AND status = 'planning' AND delivery_started_at IS NULL
             RETURNING id`,
            [run.runId, run.scheduleId],
          );
          if (claimed.rowCount === 0) {
            await runBoundedSql('COMMIT');
            txDirty = false;
            return { kind: 'outcome', outcome: { status: 'discarded' } };
          }
        }

        throwIfAbortedOrExpired();
        const value = await action(callController.signal);
        await runBoundedSql('COMMIT');
        txDirty = false;
        return { kind: 'ok', value };
      } catch (error: any) {
        if (txDirty && !sessionState.terminated) {
          const rollbackGuardMs = callController.signal.aborted
            ? 100
            : Math.max(50, Math.min(250, deadlineAt - Date.now()));
          const rollbackGuardTimer = setTimeout(() => {
            void terminateClientSession();
          }, rollbackGuardMs);
          rollbackGuardTimer.unref?.();
          const onRollbackAbort = () => {
            void terminateClientSession();
          };
          if (!callController.signal.aborted) {
            callController.signal.addEventListener('abort', onRollbackAbort, { once: true });
          }
          try {
            await client.query('ROLLBACK');
            if (!sessionState.terminated) {
              txDirty = false;
            }
          } catch (rbErr: any) {
            releaseError = toError(rbErr, 'ROLLBACK_FAILED');
          } finally {
            clearTimeout(rollbackGuardTimer);
            callController.signal.removeEventListener('abort', onRollbackAbort);
            if (sessionState.promise) {
              await sessionState.promise;
            }
          }
        }
        if (signal.aborted) {
          throw getAbortOrTimeoutError();
        }
        if (
          callController.signal.aborted ||
          Date.now() >= deadlineAt ||
          /lock timeout|statement timeout/i.test(String(error?.message ?? ''))
        ) {
          if (!callController.signal.aborted) {
            callController.abort(new Error('EGRESS_TIMEOUT'));
          }
          throw getAbortOrTimeoutError();
        }
        if (error?.code === '55P03') {
          return {
            kind: 'outcome',
            outcome: {
              status: 'digest_failed',
              error: 'Tài nguyên kết nối hoặc lịch đang bận cập nhật (chưa gửi bản tin).',
              pauseSchedule: false,
            },
          };
        }
        throw error;
      } finally {
        const aborted = signal.aborted || callController.signal.aborted;
        const rawTxStatus = (client as any)._txStatus;
        const mustNotReuse =
          Boolean(releaseError) ||
          aborted ||
          sessionState.terminated ||
          txDirty ||
          Boolean(rawTxStatus && rawTxStatus !== 'I');
        if (mustNotReuse && !sessionState.terminated) {
          await terminateClientSession();
        }
        if (!releaseError && mustNotReuse) {
          releaseError = new Error(
            aborted ? 'Client released after abort' : 'Client still in transaction at release',
          );
        }
        if (sessionState.promise) {
          await sessionState.promise;
        }
        try {
          if (typeof (client as any)?.removeListener === 'function') {
            (client as any).removeListener('error', onCheckedOutClientError);
          }
        } catch {
          // Ignore listener removal errors on custom/mocked clients.
        }
        client.release(releaseError);
        if (sessionState.terminated && txDirty) {
          await new Promise<void>((resolve) => {
            const drainTimer = setTimeout(resolve, 40);
            drainTimer.unref?.();
          });
        }
      }
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      signal.removeEventListener('abort', onParentAbort);
    }
  }

  private async claimOrVerifyAuthorityWithRetry<T>(
    run: DigestRunInput,
    gmailBinding: GmailDigestBinding | null,
    targetChatId: string,
    expectedTelegram: { credentialId: string; telegramUserId: string },
    signal: AbortSignal,
    deadlineAt: number,
    action: (callSignal: AbortSignal) => Promise<T>,
    options?: { claimDelivery?: boolean; onBeforeClaimSql?: () => void },
  ): Promise<{ kind: 'ok'; value: T } | { kind: 'outcome'; outcome: DigestRunOutcome }> {
    const backoffStepsMs = [20, 35, 50];
    let lastResult: { kind: 'ok'; value: T } | { kind: 'outcome'; outcome: DigestRunOutcome } | undefined;
    for (let attempt = 0; attempt <= backoffStepsMs.length; attempt++) {
      const remainingMs = Math.max(0, deadlineAt - Date.now());
      lastResult = await this.withBoundedEgressAuthority(
        run,
        gmailBinding,
        targetChatId,
        expectedTelegram,
        signal,
        remainingMs,
        action,
        options,
      );
      const isNowaitContention =
        lastResult.kind === 'outcome' &&
        lastResult.outcome.status === 'digest_failed' &&
        lastResult.outcome.error === 'Tài nguyên kết nối hoặc lịch đang bận cập nhật (chưa gửi bản tin).';
      if (!isNowaitContention || attempt === backoffStepsMs.length) {
        return lastResult;
      }
      const waitMs = Math.min(backoffStepsMs[attempt]!, Math.max(0, deadlineAt - Date.now() - 10));
      if (waitMs <= 0) {
        return lastResult;
      }
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(t);
          reject(
            signal.reason instanceof Error
              ? signal.reason
              : new Error(String(signal.reason ?? 'Aborted')),
          );
        };
        const t = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, waitMs);
        t.unref?.();
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      });
    }
    return lastResult!;
  }

  async execute(run: DigestRunInput, signal: AbortSignal): Promise<DigestRunOutcome> {
    signal.throwIfAborted();
    const { digestConfig, digestConfigHash, userId } = run;

    // Legacy schedules remain unchanged. Reject the whole run before even
    // reading another source: per-source errors deliberately allow partial delivery.
    const disabledSourceReason = Array.isArray(digestConfig?.sources)
      ? digestConfig.sources.map(getDigestSourceDisabledReason).find((reason) => reason !== undefined)
      : undefined;
    if (disabledSourceReason) {
      return { status: 'blocked', error: disabledSourceReason };
    }

    if (run.workspaceMode === 'organization' && (!run.workspaceId || !run.workspaceId.trim())) {
      return {
        status: 'blocked',
        error: 'Thiếu thông tin không gian làm việc tổ chức (workspaceId) hợp lệ.',
        pauseSchedule: true,
      };
    }

    if (!digestConfig || !digestConfigHash) {
      return {
        status: 'blocked',
        error: 'Cấu hình báo cáo tự động bị thiếu hoặc không hợp lệ.',
        pauseSchedule: true,
      };
    }

    const gmailValidation = validateTelegramDigestGmailConfig(digestConfig);
    if (gmailValidation.kind === 'gmail_legacy' || gmailValidation.kind === 'invalid') {
      return {
        status: 'blocked',
        error: gmailValidation.reason,
        pauseSchedule: true,
      };
    }

    let computedHash: string;
    try {
      computedHash = computeTelegramDigestConfigHash(digestConfig);
    } catch (err) {
      return {
        status: 'blocked',
        error: err instanceof Error ? err.message : 'Cấu hình báo cáo tự động không hợp lệ.',
        pauseSchedule: true,
      };
    }
    if (computedHash !== digestConfigHash) {
      return {
        status: 'blocked',
        error: 'Cấu hình báo cáo tự động không khớp chữ ký toàn vẹn.',
        pauseSchedule: true,
      };
    }

    const gmailBinding = gmailValidation.kind === 'gmail_bound' ? gmailValidation.binding : null;
    if (gmailBinding && !this.options.pool) {
      return {
        status: 'blocked',
        error: 'Lịch Gmail tự gửi cần kết nối PostgreSQL.',
        pauseSchedule: true,
      };
    }

    if (this.options.pool) {
      const preGuard = await assertDigestScheduleLiveScopeAndAuth({
        pool: this.options.pool,
        scheduleId: run.scheduleId,
        encryptionKey: this.options.encryptionKey,
        gmailOAuthClientId: this.options.gmailOAuthClientId,
      });
      if (!preGuard.allowed) {
        return {
          status: 'blocked',
          error: preGuard.pauseReason ?? 'Kết nối hoặc phạm vi lịch chạy không còn hợp lệ.',
          pauseSchedule: true,
        };
      }
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
        const sourceAdapterContext: AdapterContext =
          source.service === 'gmail' && gmailBinding
            ? {
                userId,
                phase: 'execution',
                workspaceMode: run.workspaceMode,
                workspaceId: run.workspaceId,
                connections: {
                  gmail: {
                    credentialId: gmailBinding.credentialId,
                    email: gmailBinding.email,
                  },
                },
              }
            : {
                userId,
                phase: 'planning',
                workspaceMode: run.workspaceMode,
                workspaceId: run.workspaceId,
              };
        const adapter = await this.options.adapterFactory.getAdapterForService(
          source.service,
          sourceAdapterContext,
        );
        const { callArgs, repoSearchTool, sheetListTool, sheetReadTool } = buildTelegramDigestSourceArgs(source, {
          sinceIso,
          untilIso,
        });

        let rawResult: unknown;
        if (source.service === 'gmail') {
          rawResult = await adapter.execute(
            'gmail.search_threads',
            { query: 'in:inbox is:unread' },
            { signal },
          );
        } else if (source.service === 'mycalendar' && source.tool === 'mycalendar.list_events') {
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
        if (signal.aborted) {
          throw signal.reason instanceof Error ? signal.reason : err;
        }
        if (source.service === 'gmail') {
          let bindingLost = isGmailAuthOrBindingFailure(err);
          if (!bindingLost && gmailBinding && this.options.pool) {
            const recheck = await assertGmailDigestBinding(
              this.options.pool,
              userId,
              gmailBinding,
              this.options.gmailOAuthClientId,
              { encryptionKey: this.options.encryptionKey },
            ).catch(() => null);
            if (recheck && !recheck.allowed) {
              bindingLost = true;
            }
          }
          if (bindingLost) {
            return {
              status: 'blocked',
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
        sections.push(`• ${source.label}:\n  (Tạm thời chưa lấy được dữ liệu ở lượt chạy này)`);
      }
    }

    if (okOrEmptyCount === 0) {
      return {
        status: 'digest_failed',
        error: 'Không đọc được dữ liệu từ các dịch vụ nguồn để tạo báo cáo.',
      };
    }

    // 4. Optional AI highlight summary: verify bounded PostgreSQL egress authority first (and commit/release
    // all PostgreSQL locks BEFORE external LLM HTTP I/O), then execute summarizeWithAi under remaining budget.
    let aiHighlight = '';
    if (this.options.summarizeWithAi) {
      const aiTimeoutMs = this.options.aiTimeoutMs ?? 10_000;
      const aiDeadlineAt = Date.now() + (Number.isFinite(aiTimeoutMs) ? Math.max(0, aiTimeoutMs) : 0);
      let aiAuth: { kind: 'ok'; value: true } | { kind: 'outcome'; outcome: DigestRunOutcome };
      try {
        aiAuth = await this.claimOrVerifyAuthorityWithRetry(
          run,
          gmailBinding,
          targetChatId,
          { credentialId: record.id, telegramUserId },
          signal,
          aiDeadlineAt,
          async () => true as const,
        );
      } catch (err) {
        if (signal.aborted) {
          throw signal.reason instanceof Error ? signal.reason : err;
        }
        return {
          status: 'digest_failed',
          error: 'Không gửi được báo cáo tự động lúc này.',
          pauseSchedule: false,
        };
      }
      if (aiAuth.kind === 'outcome') {
        return aiAuth.outcome;
      }

      const remainingAiMs = Math.max(0, aiDeadlineAt - Date.now());
      if (remainingAiMs > 0) {
        const aiController = new AbortController();
        const onParentAbort = () =>
          aiController.abort(signal.reason ?? new Error('Aborted'));
        signal.addEventListener('abort', onParentAbort, { once: true });
        if (signal.aborted) {
          signal.removeEventListener('abort', onParentAbort);
          throw signal.reason instanceof Error
            ? signal.reason
            : new Error(String(signal.reason ?? 'Aborted'));
        }
        const aiTimer = setTimeout(() => aiController.abort(new Error('AI_TIMEOUT')), remainingAiMs);
        aiTimer.unref?.();
        let onAiAbort: (() => void) | undefined;
        try {
          const abortPromise = new Promise<null>((resolve, reject) => {
            onAiAbort = () => {
              if (signal.aborted) {
                reject(
                  signal.reason instanceof Error
                    ? signal.reason
                    : new Error(String(signal.reason ?? 'Aborted')),
                );
              } else {
                resolve(null);
              }
            };
            if (aiController.signal.aborted) onAiAbort();
            else aiController.signal.addEventListener('abort', onAiAbort, { once: true });
          });
          const rawSummary = await Promise.race([
            this.options.summarizeWithAi(sections.join('\n\n'), aiController.signal),
            abortPromise,
          ]);
          if (typeof rawSummary === 'string' && rawSummary.trim()) {
            aiHighlight = `💡 Điểm nổi bật: ${rawSummary.trim().slice(0, 400)}\n\n`;
          }
        } catch (err) {
          if (signal.aborted) {
            throw signal.reason instanceof Error ? signal.reason : err;
          }
          aiHighlight = '';
        } finally {
          clearTimeout(aiTimer);
          if (onAiAbort) {
            aiController.signal.removeEventListener('abort', onAiAbort);
          }
          signal.removeEventListener('abort', onParentAbort);
        }
      }
    }

    const timeLabel = localLabel(run.dueAt, this.options.timeZone);
    const header = `📋 Bản tin tự động của Planora · thiết lập bởi @${digestConfig.username}\n📌 ${run.name} · 🕒 ${timeLabel}\n\n`;
    const footer =
      failedLabels.length > 0
        ? `\n\n⚠️ Tạm thời chưa lấy được dữ liệu từ: ${failedLabels.join(', ')}.`
        : '';
    let digestText = `${header}${aiHighlight}${sections.join('\n\n')}${footer}`;
    const codepoints = Array.from(digestText);
    if (codepoints.length > 4000) {
      digestText = codepoints.slice(0, 3994).join('') + '\n...';
    }

    // 5 & 6. Prepare Telegram adapter outside transaction (zero recursive pool checkout), atomically verify
    // bounded PostgreSQL authority + durably commit schedule_runs.delivery_started_at BEFORE outbound HTTP,
    // release all PostgreSQL locks, then execute telegram.send_message.
    signal.throwIfAborted();
    if (!this.options.pool && run.beforeSendCheck) {
      const stillValid = await run.beforeSendCheck();
      if (!stillValid) {
        return { status: 'discarded' };
      }
    }

    const sendTimeoutMs = this.options.sendTimeoutMs ?? 15_000;
    const sendDeadlineAt = Date.now() + (Number.isFinite(sendTimeoutMs) ? Math.max(0, sendTimeoutMs) : 0);
    let deliveryStarted = false;
    let sendDispatched = false;

    try {
      const telegramAdapter = await this.options.adapterFactory.getAdapterForService('telegram', {
        userId,
        phase: 'execution',
        workspaceMode: run.workspaceMode,
        workspaceId: run.workspaceId,
        connections: {
          telegram: {
            credentialId: record.id,
            telegramUserId,
            username: digestConfig.username,
            chatIds: [targetChatId],
          },
        },
      });

      let sendClaim:
        | { kind: 'ok'; value: { claimedInDb: boolean } }
        | { kind: 'outcome'; outcome: DigestRunOutcome };
      let claimSqlIssued = false;
      try {
        sendClaim = await this.claimOrVerifyAuthorityWithRetry(
          run,
          gmailBinding,
          targetChatId,
          { credentialId: record.id, telegramUserId },
          signal,
          sendDeadlineAt,
          async () => ({
            claimedInDb: typeof (this.options.pool as any)?.connect === 'function',
          }),
          {
            claimDelivery: true,
            onBeforeClaimSql: () => {
              claimSqlIssued = true;
            },
          },
        );
      } catch (claimErr) {
        // Outbound Telegram HTTP has NOT been initiated yet. Best-effort clear any orphaned
        // delivery_started_at that may have committed on the wire if COMMIT acknowledgement was lost.
        if (claimSqlIssued && this.options.pool && typeof (this.options.pool as any).connect === 'function') {
          await this.options.pool
            .query(
              "UPDATE schedule_runs SET delivery_started_at = NULL, updated_at = now() WHERE id = $1 AND schedule_id = $2 AND status = 'planning'",
              [run.runId, run.scheduleId],
            )
            .catch(() => undefined);
        }
        if (signal.aborted) {
          throw signal.reason instanceof Error ? signal.reason : claimErr;
        }
        return {
          status: 'digest_failed',
          error: 'Không gửi được tin nhắn báo cáo tới Telegram.',
        };
      }

      if (sendClaim.kind === 'outcome') {
        return sendClaim.outcome;
      }
      deliveryStarted = sendClaim.value.claimedInDb;

      const remainingSendMs = Math.max(1, sendDeadlineAt - Date.now());
      const sendController = new AbortController();
      const onParentSendAbort = () =>
        sendController.abort(signal.reason ?? new Error('SEND_ABORTED'));
      signal.addEventListener('abort', onParentSendAbort, { once: true });
      if (signal.aborted) {
        onParentSendAbort();
      }
      const sendTimer = setTimeout(
        () => sendController.abort(new Error('EGRESS_TIMEOUT')),
        remainingSendMs,
      );
      sendTimer.unref?.();
      let onSendAbort: (() => void) | undefined;
      let sendRes: any;
      try {
        const abortPromise = new Promise<never>((_, reject) => {
          onSendAbort = () =>
            reject(
              sendController.signal.reason instanceof Error
                ? sendController.signal.reason
                : new Error(String(sendController.signal.reason ?? 'SEND_ABORTED')),
            );
          if (sendController.signal.aborted) onSendAbort();
          else sendController.signal.addEventListener('abort', onSendAbort, { once: true });
        });
        sendDispatched = true;
        sendRes = await Promise.race([
          telegramAdapter.execute(
            'telegram.send_message',
            { chatId: targetChatId, text: digestText },
            { signal: sendController.signal, chatId: targetChatId },
          ),
          abortPromise,
        ]);
      } finally {
        clearTimeout(sendTimer);
        if (onSendAbort) {
          sendController.signal.removeEventListener('abort', onSendAbort);
        }
        signal.removeEventListener('abort', onParentSendAbort);
      }

      const validMessageId =
        typeof sendRes?.messageId === 'number' &&
        Number.isInteger(sendRes.messageId) &&
        sendRes.messageId > 0;
      if (!validMessageId) {
        return {
          status: 'delivery_unknown',
          error: TELEGRAM_DELIVERY_UNKNOWN,
        };
      }

      return {
        status: 'digest_sent',
        digestText,
        delivery: {
          chatId: targetChatId,
          chatTitle: digestConfig.chatTitle,
          messageId: sendRes.messageId,
          sentAt: new Date().toISOString(),
          sources: sourceStatuses,
        },
      };
    } catch (err: any) {
      if (deliveryStarted && sendDispatched) {
        if (isDefiniteWriteRejection(err) && this.options.pool) {
          await this.options.pool
            .query(
              "UPDATE schedule_runs SET delivery_started_at = NULL, updated_at = now() WHERE id = $1 AND status = 'planning'",
              [run.runId],
            )
            .catch(() => undefined);
          return {
            status: 'digest_failed',
            error: 'Không gửi được tin nhắn báo cáo tới Telegram.',
          };
        }
        return {
          status: 'delivery_unknown',
          error: `${TELEGRAM_DELIVERY_UNKNOWN} (${err instanceof Error ? err.message : String(err)})`,
        };
      }
      if (signal.aborted) {
        throw signal.reason instanceof Error ? signal.reason : err;
      }
      if (!sendDispatched || isDefiniteWriteRejection(err)) {
        return {
          status: 'digest_failed',
          error: 'Không gửi được tin nhắn báo cáo tới Telegram.',
        };
      }
      return {
        status: 'delivery_unknown',
        error: `${TELEGRAM_DELIVERY_UNKNOWN} (${err instanceof Error ? err.message : String(err)})`,
      };
    }
  }
}
