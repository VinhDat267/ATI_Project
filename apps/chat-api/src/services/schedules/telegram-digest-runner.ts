import type pg from 'pg';
import { decryptCredentials, TelegramAdapter } from '@wap/tool-adapters';
import {
  normalizeTelegramChatId,
  TELEGRAM_CHAT_ID_PATTERN,
  type GmailDigestBinding,
  type TelegramDigestConfig,
  type TelegramDigestDelivery,
} from '@wap/tool-schemas';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';
import type { AdapterContext } from '../adapter-factory.js';
import type { TelegramBotClient } from '../telegram/bot-client.js';
import { localLabel } from './next-occurrence.js';
import { assertGmailDigestBinding } from './gmail-digest-binding.js';
import { MYCALENDAR_DIGEST_REAPPROVAL, readMyCalendarDigestBinding } from './mycalendar-digest-source.js';
import { MYSHEETS_DIGEST_REAPPROVAL, readMySheetsDigestBinding } from './mysheets-digest-source.js';
import { isNotionSourceDenied } from '../notion/digest-source-authority.js';
import {
  approvedTelegramNotionBinding,
  telegramNotionSource,
  computeTelegramDigestConfigHash,
  getDigestSourceDisabledReason,
  isJiraDigestSourceBinding,
  READ_DIGEST_SOURCE_MAP,
} from './telegram-digest-candidate.js';
import {
  computeDigestSinceWindow,
  executeMultiDigestReadSources,
  summarizeSourceItems,
} from './multi-source-digest-reader.js';
import {
  assertDigestScheduleLiveScopeAndAuth,
  buildPinnedTelegramAdapterContext,
} from './digest-scope-guard.js';
import {
  validateTelegramDigestGmailConfig,
} from './gmail-digest-binding.js';
import {
  NOTION_DIGEST_REAPPROVAL,
  type NotionDigestSourceAuthority,
} from '../notion/digest-source-authority.js';

export { summarizeSourceItems };

const notionBlocked = (): DigestRunOutcome => ({
  status: 'blocked',
  error: NOTION_DIGEST_REAPPROVAL,
  pauseSchedule: true,
});

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
  mycalendarOAuthClientId?: string;
  mysheetsOAuthClientId?: string;
  adapterFactory: {
    getAdapterForService(serviceName: string, context?: AdapterContext): Promise<any> | any;
  };
  botClient?: Pick<TelegramBotClient, 'getChatMember'>;
  timeZone: string;
  summarizeWithAi?: (prompt: string, signal: AbortSignal, config: TelegramDigestConfig) => Promise<string | null>;
  aiTimeoutMs?: number;
  sendTimeoutMs?: number;
  notionSources?: Pick<NotionDigestSourceAuthority, 'read' | 'withSource'>;
}

interface TelegramEgressOptions {
  delivery?: 'claim' | 'recheck';
  onBeforeClaimSql?: () => void;
}

export class TelegramDigestRunner {
  constructor(private options: TelegramDigestRunnerOptions) {}

  private async claimTelegramDigestDelivery(
    run: DigestRunInput,
    pinnedCredentialId: string,
    signal: AbortSignal,
    ownerClient?: pg.PoolClient,
  ): Promise<
    | { allowed: true; claimedInDb: boolean }
    | { allowed: false; outcome: DigestRunOutcome }
  > {
    if (!this.options.pool) {
      return {
        allowed: false,
        outcome: {
          status: 'digest_failed',
          error: 'Lịch tự gửi cần kết nối PostgreSQL.',
          pauseSchedule: true,
        },
      };
    }
    if (typeof (this.options.pool as any).connect !== 'function') {
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
        return { allowed: false, outcome: { status: 'discarded' } };
      }
      return { allowed: true, claimedInDb: false };
    }
    const client = ownerClient ?? await (this.options.pool as pg.Pool).connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '10s'");
      const schedule = (
        await client.query(
          `SELECT s.* FROM schedules s JOIN conversations c ON c.id=s.conv_id
           JOIN users u ON u.id=s.user_id AND u.status='active'
           WHERE s.id=$1 FOR UPDATE OF c,s`,
          [run.scheduleId],
        )
      ).rows[0];
      const currentRun = (
        await client.query(
          'SELECT status, delivery_started_at FROM schedule_runs WHERE id=$1 AND schedule_id=$2 FOR UPDATE',
          [run.runId, run.scheduleId],
        )
      ).rows[0];
      signal.throwIfAborted();
      if (
        !schedule ||
        currentRun?.status !== 'planning' ||
        currentRun.delivery_started_at !== null ||
        schedule.user_id !== run.userId ||
        schedule.kind !== 'telegram_digest' ||
        schedule.version !== run.scheduleVersion ||
        schedule.digest_config_hash !== run.digestConfigHash ||
        schedule.status === 'cancelled' ||
        schedule.status === 'paused'
      ) {
        await client.query('COMMIT');
        return { allowed: false, outcome: { status: 'discarded' } };
      }

      if (schedule.workspace_mode === 'organization') {
        if (!schedule.workspace_id) {
          await client.query('COMMIT');
          return {
            allowed: false,
            outcome: {
              status: 'blocked',
              error: 'Lịch Tổ chức thiếu định danh không gian làm việc hợp lệ.',
              pauseSchedule: true,
            },
          };
        }
        const memberRes = await client.query(
          'SELECT status FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
          [schedule.workspace_id, run.userId],
        );
        if (memberRes.rows[0]?.status !== 'active') {
          await client.query('COMMIT');
          return {
            allowed: false,
            outcome: {
              status: 'blocked',
              error: 'Quyền thành viên trong không gian làm việc tổ chức không còn hiệu lực.',
              pauseSchedule: true,
            },
          };
        }
      }

      const credRes = await client.query(
        `SELECT status FROM service_credentials
         WHERE id = $1 AND user_id = $2 AND service = 'telegram'`,
        [pinnedCredentialId, run.userId],
      );
      if (credRes.rows[0]?.status !== 'active') {
        await client.query('COMMIT');
        return {
          allowed: false,
          outcome: {
            status: 'blocked',
            error: 'Kết nối Telegram đã thay đổi hoặc bị ngắt. Hãy kết nối lại.',
            pauseSchedule: true,
          },
        };
      }

      const claimed = await client.query(
        `UPDATE schedule_runs
         SET delivery_started_at = now(), updated_at = now(),
             dispatched_config = COALESCE($3::jsonb, dispatched_config),
             dispatched_config_hash = COALESCE($4, dispatched_config_hash)
         WHERE id = $1 AND schedule_id = $2 AND status = 'planning' AND delivery_started_at IS NULL
         RETURNING id`,
        [
          run.runId,
          run.scheduleId,
          ownerClient ? JSON.stringify(schedule.digest_config) : null,
          ownerClient ? schedule.digest_config_hash : null,
        ],
      );
      await client.query('COMMIT');
      if (claimed.rowCount === 0) {
        return { allowed: false, outcome: { status: 'discarded' } };
      }
      return { allowed: true, claimedInDb: true };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      if (!ownerClient) client.release();
    }
  }

  private async withBoundedEgressAuthority<T>(
    run: DigestRunInput,
    gmailBinding: GmailDigestBinding | null,
    targetChatId: string,
    expectedTelegram: { credentialId: string; telegramUserId: string },
    signal: AbortSignal,
    timeoutMs: number,
    action: (callSignal: AbortSignal) => Promise<T>,
    options?: TelegramEgressOptions,
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
        if (options?.delivery) {
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

      if (options?.delivery && run.beforeSendCheck) {
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
          (currentRun.delivery_started_at != null) !== (options?.delivery === 'recheck') ||
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

        // Re-verify live workspace and source authority using the same transaction client.
        const lockJiraAuthority = run.digestConfig?.sources.some((source) => source.service === 'myjira');
        const pinnedCtx = await buildPinnedTelegramAdapterContext({
          pool: txQueryable,
          scheduleId: run.scheduleId,
          encryptionKey: this.options.encryptionKey,
          gmailOAuthClientId: this.options.gmailOAuthClientId,
          mycalendarOAuthClientId: this.options.mycalendarOAuthClientId,
          mysheetsOAuthClientId: this.options.mysheetsOAuthClientId,
          lockTelegramJiraAuthority: lockJiraAuthority,
          lockMyCalendarAuthority: 'nowait',
          lockMySheetsAuthority: 'nowait',
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
              error: pinnedCtx.pauseReason ??
                'Kết nối hoặc phạm vi Telegram của lịch chạy không còn hợp lệ.',
              pauseSchedule: true,
            },
          };
        }

        if (options?.delivery === 'claim') {
          options.onBeforeClaimSql?.();
          const claimed = await runBoundedSql<{ id: string }>(
            `UPDATE schedule_runs
             SET delivery_started_at = now(), updated_at = now(),
                 dispatched_config = $3::jsonb, dispatched_config_hash = $4
             WHERE id = $1 AND schedule_id = $2 AND status = 'planning' AND delivery_started_at IS NULL
             RETURNING id`,
            [run.runId, run.scheduleId, JSON.stringify(schedule.digest_config), schedule.digest_config_hash],
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
    options?: TelegramEgressOptions,
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

    // Verify all sources against read-only allowlist & tenant rules before reading anything.
    const disabledSourceReason = Array.isArray(digestConfig?.sources)
      ? digestConfig.sources
          .map((src) =>
            getDigestSourceDisabledReason(src, {
              workspaceMode: run.workspaceMode,
              workspaceId: run.workspaceId,
              destination: 'telegram',
            }),
          )
          .find((reason) => reason !== undefined)
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

    if (!digestConfig || !digestConfigHash || !Array.isArray(digestConfig.sources)) {
      return {
        status: 'blocked',
        error: 'Cấu hình báo cáo tự động bị thiếu hoặc không hợp lệ.',
        pauseSchedule: true,
      };
    }

    const mycalendar = readMyCalendarDigestBinding(digestConfig, null);
    if (mycalendar.kind === 'invalid') {
      return { status: 'blocked', error: MYCALENDAR_DIGEST_REAPPROVAL, pauseSchedule: true };
    }
    if (mycalendar.kind === 'bound' && typeof (this.options.pool as pg.Pool | undefined)?.connect !== 'function') {
      return { status: 'blocked', error: 'Bản tin Google Calendar cần kết nối PostgreSQL.', pauseSchedule: true };
    }
    const mysheets = readMySheetsDigestBinding(digestConfig, null);
    if (mysheets.kind === 'invalid') {
      return { status: 'blocked', error: MYSHEETS_DIGEST_REAPPROVAL, pauseSchedule: true };
    }
    if (mysheets.kind === 'bound' && typeof (this.options.pool as pg.Pool | undefined)?.connect !== 'function') {
      return { status: 'blocked', error: 'Bản tin Google Sheets cần kết nối PostgreSQL.', pauseSchedule: true };
    }

    const jiraSources = digestConfig.sources.filter((source) => source?.service === 'myjira');
    const hasJiraSources = jiraSources.length > 0;
    if (
      hasJiraSources &&
      (typeof (this.options.pool as pg.Pool | null | undefined)?.connect !== 'function' ||
        jiraSources.some((source) => !isJiraDigestSourceBinding(source.jiraBinding)))
    ) {
      return {
        status: 'blocked',
        error: 'Nguồn Jira trong bản tin Telegram thiếu kết nối OAuth đã duyệt. Hãy xác nhận lại lịch.',
        pauseSchedule: true,
      };
    }

    const notionBinding = approvedTelegramNotionBinding(digestConfig);
    if (
      telegramNotionSource(digestConfig) &&
      (!notionBinding ||
        !this.options.notionSources ||
        notionBinding.ownerId !== userId ||
        run.workspaceMode === 'organization')
    ) {
      return notionBlocked();
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
    if (telegramNotionSource(digestConfig) && (gmailBinding || digestConfig.sources.some((s) => s?.service === 'gmail'))) {
      return notionBlocked();
    }
    if (gmailBinding && !this.options.pool) {
      return {
        status: 'blocked',
        error: 'Lịch Gmail tự gửi cần kết nối PostgreSQL.',
        pauseSchedule: true,
      };
    }

    if (this.options.pool && !notionBinding) {
      const preGuard = await assertDigestScheduleLiveScopeAndAuth({
        pool: this.options.pool,
        scheduleId: run.scheduleId,
        encryptionKey: this.options.encryptionKey,
        gmailOAuthClientId: this.options.gmailOAuthClientId,
        mycalendarOAuthClientId: this.options.mycalendarOAuthClientId,
        mysheetsOAuthClientId: this.options.mysheetsOAuthClientId,
        expectedTelegramDigestConfigHash: hasJiraSources ? digestConfigHash : undefined,
      });
      if (
        !preGuard.allowed ||
        (hasJiraSources &&
          (preGuard.trustedWorkspaceId !== run.workspaceId || preGuard.trustedWorkspaceMode !== run.workspaceMode))
      ) {
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
      if (!allowed || (allowed.tool !== source.tool && !(source.service === 'mysheets' && source.tool === 'mysheets.read_range'))) {
        return {
          status: 'blocked',
          error: `Công cụ nguồn "${source.tool}" không nằm trong danh sách chỉ đọc được phép.`,
          pauseSchedule: true,
        };
      }
    }

    // 2b. Compute SINCE window and execute read sources via shared multi-source reader
    const { sinceIso, untilIso } = await computeDigestSinceWindow(
      this.options.pool,
      run.scheduleId,
      digestConfig.recurrence,
      run.dueAt,
    );

    const readOutcome = await executeMultiDigestReadSources({
      sources: digestConfig.sources,
      userId,
      dueAt: run.dueAt,
      sinceIso,
      untilIso,
      timeZone: digestConfig.timeZone ?? this.options.timeZone,
      workspaceMode: run.workspaceMode,
      workspaceId: run.workspaceId,
      gmailBinding,
      notionBinding,
      notionSources: this.options.notionSources,
      credentialRepo: this.options.credentialRepo,
      encryptionKey: this.options.encryptionKey,
      gmailOAuthClientId: this.options.gmailOAuthClientId,
      mycalendarOAuthClientId: this.options.mycalendarOAuthClientId,
      mysheetsOAuthClientId: this.options.mysheetsOAuthClientId,
      pool: this.options.pool,
      adapterFactory: this.options.adapterFactory,
      signal,
    });

    if (readOutcome.kind === 'notion_blocked') {
      return notionBlocked();
    }
    if (readOutcome.kind === 'blocked') {
      return { status: 'blocked', error: readOutcome.error, pauseSchedule: true };
    }
    if (readOutcome.kind === 'digest_failed') {
      return { status: 'digest_failed', error: readOutcome.error };
    }
    const { sourceStatuses, sections, failedLabels } = readOutcome;

    // 4. Optional AI highlight summary: verify bounded PostgreSQL egress authority first (and commit/release
    // all PostgreSQL locks BEFORE external LLM HTTP I/O), then execute summarizeWithAi under remaining budget.
    let aiHighlight = '';
    if (!notionBinding && this.options.summarizeWithAi && digestConfig.includeAiSummary !== false) {
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
            this.options.summarizeWithAi(sections.join('\n\n'), aiController.signal, digestConfig),
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
    const notionFooter = sourceStatuses.some(({ service, truncated }) => service === 'notion' && truncated)
      ? '\n  (Còn mục khác trên Notion chưa hiển thị hết — giới hạn 20 trang/database)'
      : '';
    let digestText = `${header}${aiHighlight}${sections.join('\n\n')}${footer}${notionFooter}`;
    const codepoints = Array.from(digestText);
    if (codepoints.length > 4000) {
      const bodyLimit = 3994 - Array.from(notionFooter).length;
      digestText = codepoints.slice(0, bodyLimit).join('') + '\n...' + notionFooter;
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
    let preventedOutcome: DigestRunOutcome | undefined;

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

      let sendRes: any;
      if (notionBinding && this.options.notionSources) {
        const sent = await this.options.notionSources.withSource(
          userId,
          notionBinding,
          signal,
          async (ownerClient) => {
            const claim = await this.claimTelegramDigestDelivery(run, record.id, signal, ownerClient);
            if (!claim.allowed) return claim;
            deliveryStarted = claim.claimedInDb;
            sendDispatched = true;
            const receipt = await telegramAdapter.execute(
              'telegram.send_message',
              { chatId: targetChatId, text: digestText },
              { signal, chatId: targetChatId },
            );
            return { allowed: true as const, receipt };
          },
        );
        if (!sent.allowed) return sent.outcome;
        sendRes = sent.receipt;
      } else {
        const nativeCalendarDelivery = mycalendar.kind === 'bound' && telegramAdapter instanceof TelegramAdapter;
        const claimDelivery = async (claimSignal: AbortSignal) => {
          const recheck = deliveryStarted;
          let claimSqlIssued = false;
          try {
            const claim = await this.claimOrVerifyAuthorityWithRetry(
              run,
              gmailBinding,
              targetChatId,
              { credentialId: record.id, telegramUserId },
              claimSignal,
              sendDeadlineAt,
              async () => typeof (this.options.pool as pg.Pool | undefined)?.connect === 'function',
              {
                delivery: recheck ? 'recheck' : 'claim',
                onBeforeClaimSql: () => { claimSqlIssued = true; },
              },
            );
            if (claim.kind === 'outcome') {
              preventedOutcome = claim.outcome;
              throw new Error('Telegram digest dispatch was not authorized');
            }
            claimSignal.throwIfAborted();
            deliveryStarted = claim.value;
          } catch (error) {
            // A retry reaches this callback only after Telegram definitively rejects the previous request.
            if ((claimSqlIssued || recheck) && this.options.pool) {
              await this.options.pool.query(
                `UPDATE schedule_runs
                 SET delivery_started_at = NULL, dispatched_config = NULL, dispatched_config_hash = NULL, updated_at = now()
                 WHERE id = $1 AND schedule_id = $2 AND status = 'planning'`,
                [run.runId, run.scheduleId],
              ).catch(() => undefined);
            }
            deliveryStarted = false;
            throw error;
          }
        };
        if (!nativeCalendarDelivery) await claimDelivery(signal);

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
          const beforeDispatch = async () => {
            sendDispatched = false;
            await claimDelivery(sendController.signal);
            sendDispatched = true;
          };
          sendDispatched = !nativeCalendarDelivery;
          sendRes = await Promise.race([
            telegramAdapter.execute(
              'telegram.send_message',
              { chatId: targetChatId, text: digestText },
              {
                signal: sendController.signal,
                chatId: targetChatId,
                ...(nativeCalendarDelivery ? { beforeDispatch } : {}),
              },
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
      if (preventedOutcome) return preventedOutcome;
      if (!deliveryStarted && notionBinding && isNotionSourceDenied(err)) {
        return notionBlocked();
      }
      if (deliveryStarted && sendDispatched) {
        if (isDefiniteWriteRejection(err) && this.options.pool) {
          await this.options.pool
            .query(
              `UPDATE schedule_runs
               SET delivery_started_at = NULL, dispatched_config = NULL, dispatched_config_hash = NULL, updated_at = now()
               WHERE id = $1 AND schedule_id = $2 AND status = 'planning'`,
              [run.runId, run.scheduleId],
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
