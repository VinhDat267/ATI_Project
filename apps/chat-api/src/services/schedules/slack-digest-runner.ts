import type pg from 'pg';
import { decryptCredentials, SlackAdapter } from '@wap/tool-adapters';
import type {
  SlackDigestConfig,
  SlackDigestDelivery,
} from '@wap/tool-schemas';
import type { CredentialRepo } from '../../db/repositories/credential-repo.js';
import type { AdapterContext } from '../adapter-factory.js';
import { localLabel } from './next-occurrence.js';
import {
  getDigestSourceDisabledReason,
  isJiraDigestSourceBinding,
  matchesSlackDigestCredentialOwner,
  READ_DIGEST_SOURCE_MAP,
  telegramNotionSource,
} from './multi-source-digest-candidate.js';
import {
  computeDigestSinceWindow,
  executeMultiDigestReadSources,
} from './multi-source-digest-reader.js';
import { computeSlackDigestConfigHash } from './slack-digest-candidate.js';
import {
  assertDigestScheduleLiveScopeAndAuth,
} from './digest-scope-guard.js';
import {
  assertGmailDigestBinding,
  validateTelegramDigestGmailConfig,
} from './gmail-digest-binding.js';
import { isSlackMessageTimestamp } from './slack-message-timestamp.js';
import { buildSlackDigestBlocks } from '../slack/slack-digest-blocks.js';
import { fetchSlackMentionIndexSafe, type SlackMentionIndex } from '../slack/slack-mention-resolver.js';
import { escapeSlackMrkdwn } from './github-digest-runner.js';
import { SLACK_DIGEST_DELIVERY_UNKNOWN } from './run-state.js';

export { SLACK_DIGEST_DELIVERY_UNKNOWN };

function isDefiniteSlackRejection(error: unknown): boolean {
  const details = (error as { details?: { requestSent?: unknown } } | null)?.details;
  if (details && details.requestSent === false) return true;
  return false;
}

export interface SlackDigestRunInput {
  runId: string;
  scheduleId: string;
  scheduleVersion: number;
  userId: string;
  name: string;
  request: string;
  dueAt: Date;
  trigger: 'scheduled' | 'manual' | 'replan';
  digestConfig: SlackDigestConfig | null;
  digestConfigHash: string | null;
  workspaceMode?: 'legacy' | 'personal' | 'organization';
  workspaceId?: string | null;
  beforeSendCheck?: () => Promise<boolean>;
}

export type SlackDigestRunOutcome =
  | { status: 'discarded' }
  | {
      status: 'digest_sent';
      digestText: string;
      delivery: SlackDigestDelivery;
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

export interface SlackDigestRunnerOptions {
  pool?: pg.Pool | Pick<pg.Pool, 'query'> | null;
  credentialRepo: Pick<CredentialRepo, 'getPersonalCredentials'>;
  encryptionKey: string;
  gmailOAuthClientId?: string;
  adapterFactory: {
    getAdapterForService(serviceName: string, context?: AdapterContext): Promise<any> | any;
  };
  timeZone: string;
  summarizeWithAi?: (prompt: string, signal: AbortSignal) => Promise<string | null>;
  aiTimeoutMs?: number;
  sendTimeoutMs?: number;
  resolveSlackMentions?: boolean;
}

export class SlackDigestRunner {
  constructor(private options: SlackDigestRunnerOptions) {}

  private allowsSlackChannel(config: string, channelId: string): boolean {
    const channels = decryptCredentials(config, this.options.encryptionKey)?.allowedScope?.channels;
    return Array.isArray(channels) && channels.includes(channelId);
  }

  private async verifyAuthorityAndMaybeClaim(
    run: SlackDigestRunInput,
    claimDelivery: boolean,
    gmailBinding: ReturnType<typeof validateTelegramDigestGmailConfig> extends infer V
      ? V extends { kind: 'gmail_bound'; binding: infer B } ? B | null : null
      : null,
    slackCredential: AdapterContext['expectedCredential'],
    signal: AbortSignal,
  ): Promise<{ allowed: true; claimedInDb: boolean } | { allowed: false; outcome: SlackDigestRunOutcome }> {
    const pool = this.options.pool;
    if (!pool) {
      if (gmailBinding) {
        return {
          allowed: false,
          outcome: {
            status: 'blocked',
            error: 'Lịch Gmail tự gửi cần kết nối PostgreSQL.',
            pauseSchedule: true,
          },
        };
      }
      if (claimDelivery && run.beforeSendCheck && !(await run.beforeSendCheck())) {
        return { allowed: false, outcome: { status: 'discarded' } };
      }
      return { allowed: true, claimedInDb: false };
    }

    if (typeof (pool as pg.Pool).connect !== 'function') {
      if (gmailBinding) {
        return {
          allowed: false,
          outcome: {
            status: 'blocked',
            error: 'Lịch Gmail tự gửi cần kết nối giao dịch PostgreSQL.',
            pauseSchedule: true,
          },
        };
      }
      if (claimDelivery) {
        const checkRes = await pool.query('SELECT version, status FROM schedules WHERE id = $1', [run.scheduleId]);
        const current = checkRes.rows?.[0];
        if (!current || current.version !== run.scheduleVersion || current.status === 'cancelled' || current.status === 'paused') {
          return { allowed: false, outcome: { status: 'discarded' } };
        }
        if (run.beforeSendCheck && !(await run.beforeSendCheck())) {
          return { allowed: false, outcome: { status: 'discarded' } };
        }
      }
      return { allowed: true, claimedInDb: false };
    }

    const client = await (pool as pg.Pool).connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '15s';");

      const userRow = (
        await client.query<{ status: string }>('SELECT status FROM users WHERE id = $1 FOR SHARE NOWAIT', [run.userId])
      ).rows[0];
      if (!userRow || userRow.status !== 'active') {
        await client.query('COMMIT');
        return {
          allowed: false,
          outcome: { status: 'blocked', error: 'Tài khoản không còn hoạt động.', pauseSchedule: true },
        };
      }

      if (gmailBinding) {
        const gmailCheck = await assertGmailDigestBinding(
          client,
          run.userId,
          gmailBinding,
          this.options.gmailOAuthClientId,
          { encryptionKey: this.options.encryptionKey, lock: 'share_nowait' },
        );
        if (!gmailCheck.allowed) {
          await client.query('COMMIT');
          return {
            allowed: false,
            outcome: { status: 'blocked', error: gmailCheck.reason, pauseSchedule: true },
          };
        }
      }

      const convRow = (
        await client.query(
          'SELECT id, user_id, workspace_id, workspace_mode FROM conversations WHERE id = (SELECT conv_id FROM schedules WHERE id = $1) FOR UPDATE NOWAIT',
          [run.scheduleId],
        )
      ).rows[0];
      const schedule = (
        await client.query('SELECT * FROM schedules WHERE id = $1 FOR UPDATE NOWAIT', [run.scheduleId])
      ).rows[0];
      const currentRun = (
        await client.query(
          'SELECT id, status, delivery_started_at FROM schedule_runs WHERE id = $1 AND schedule_id = $2 FOR UPDATE NOWAIT',
          [run.runId, run.scheduleId],
        )
      ).rows[0];

      signal.throwIfAborted();

      const validCompletedOnce =
        schedule?.status === 'completed' &&
        schedule?.recurrence?.type === 'once';
      if (
        !convRow ||
        !schedule ||
        currentRun?.status !== 'planning' ||
        currentRun.delivery_started_at != null ||
        schedule.user_id !== run.userId ||
        schedule.kind !== 'slack_digest' ||
        schedule.version !== run.scheduleVersion ||
        schedule.digest_config_hash !== run.digestConfigHash ||
        (!validCompletedOnce && schedule.status !== 'active')
      ) {
        await client.query('COMMIT');
        return { allowed: false, outcome: { status: 'discarded' } };
      }

      const hasJira = run.digestConfig?.sources.some((s) => s.service === 'myjira');
      const guard = await assertDigestScheduleLiveScopeAndAuth({
        pool: client,
        scheduleId: run.scheduleId,
        claimedWorkspaceId: run.workspaceId,
        encryptionKey: this.options.encryptionKey,
        gmailOAuthClientId: this.options.gmailOAuthClientId,
        lockTelegramJiraAuthority: hasJira,
      });
      if (!guard.allowed) {
        await client.query('COMMIT');
        return {
          allowed: false,
          outcome: {
            status: 'blocked',
            error: guard.pauseReason ?? 'Kết nối hoặc phạm vi lịch chạy không còn hợp lệ.',
            pauseSchedule: true,
          },
        };
      }

      if (claimDelivery) {
        const liveCredential = slackCredential && (
          await client.query<{ config: string }>(
            "SELECT config FROM service_credentials WHERE id = $1 AND status = 'active' FOR SHARE NOWAIT",
            [slackCredential.id],
          )
        ).rows[0];
        // The adapter is bound to the ciphertext checked before reading sources. Settings can
        // change that ciphertext without changing the credential ID or the schedule's version.
        if (!liveCredential || liveCredential.config !== slackCredential?.config) {
          let allowed = false;
          try {
            allowed = Boolean(liveCredential && this.allowsSlackChannel(liveCredential.config, run.digestConfig!.channelId));
          } catch {
            // Unreadable credentials cannot authorize a send.
          }
          await client.query('COMMIT');
          return {
            allowed: false,
            outcome: allowed
              ? { status: 'digest_failed', error: 'Kết nối hoặc phạm vi Slack vừa thay đổi trong lúc tổng hợp bản tin.' }
              : { status: 'blocked', error: 'Kênh Slack nhận bản tin không còn nằm trong phạm vi cho phép.', pauseSchedule: true },
          };
        }

        signal.throwIfAborted();
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
            schedule.digest_config ? JSON.stringify(schedule.digest_config) : null,
            schedule.digest_config_hash ?? null,
          ],
        );
        if (claimed.rowCount === 0) {
          await client.query('COMMIT');
          return { allowed: false, outcome: { status: 'discarded' } };
        }
      }

      await client.query('COMMIT');
      return { allowed: true, claimedInDb: claimDelivery };
    } catch (error: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (signal.aborted) throw error;
      if (error?.code === '55P03') {
        return {
          allowed: false,
          outcome: {
            status: 'digest_failed',
            error: 'Tài nguyên kết nối hoặc lịch đang bận cập nhật (chưa gửi bản tin).',
            pauseSchedule: false,
          },
        };
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async execute(run: SlackDigestRunInput, signal: AbortSignal): Promise<SlackDigestRunOutcome> {
    signal.throwIfAborted();
    const { userId, digestConfig, digestConfigHash } = run;

    if (!digestConfig || !digestConfigHash || digestConfig.destination !== 'slack') {
      return {
        status: 'blocked',
        error: 'Cấu hình bản tin Slack tự động không hợp lệ.',
        pauseSchedule: true,
      };
    }

    if (telegramNotionSource(digestConfig)) {
      return {
        status: 'blocked',
        error: 'Bản tin đa nguồn Slack chưa hỗ trợ nguồn Notion.',
        pauseSchedule: true,
      };
    }

    const gmailValidation = validateTelegramDigestGmailConfig(digestConfig);
    if (gmailValidation.kind === 'invalid') {
      return {
        status: 'blocked',
        error: gmailValidation.reason,
        pauseSchedule: true,
      };
    }
    if (gmailValidation.kind === 'gmail_legacy') {
      return {
        status: 'blocked',
        error: 'Cần xác nhận lại nguồn Gmail trước khi tiếp tục lịch.',
        pauseSchedule: true,
      };
    }

    let expectedHash: string;
    try {
      expectedHash = computeSlackDigestConfigHash(digestConfig);
    } catch {
      return {
        status: 'blocked',
        error: 'Cấu hình bản tin Slack tự động không hợp lệ.',
        pauseSchedule: true,
      };
    }
    if (expectedHash !== digestConfigHash) {
      return {
        status: 'blocked',
        error: 'Cấu hình bản tin Slack không khớp với bản đã xác nhận.',
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
      const disabledReason = getDigestSourceDisabledReason(source, {
        workspaceMode: run.workspaceMode,
        workspaceId: run.workspaceId,
      });
      if (disabledReason) {
        return {
          status: 'blocked',
          error: disabledReason,
          pauseSchedule: true,
        };
      }
      if (source.service === 'myjira' && !isJiraDigestSourceBinding(source.jiraBinding)) {
        return {
          status: 'blocked',
          error: 'Nguồn Jira trong bản tin Slack thiếu kết nối OAuth đã duyệt.',
          pauseSchedule: true,
        };
      }
    }

    // 1. Live workspace scope & pinned Slack credential verification
    const expectedWorkspaceId =
      digestConfig.workspaceMode === 'organization' ? (digestConfig.workspaceId ?? null) : null;
    let slackCredential: AdapterContext['expectedCredential'];
    if (this.options.pool) {
      const preGuard = await assertDigestScheduleLiveScopeAndAuth({
        pool: this.options.pool,
        scheduleId: run.scheduleId,
        claimedWorkspaceId: run.workspaceId,
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

      const credRes = await this.options.pool.query<{
        id: string;
        service: string;
        user_id: string | null;
        workspace_id: string | null;
        status: string;
        config: string;
      }>(
        `SELECT id, service, user_id, workspace_id, status, config FROM service_credentials
         WHERE id = $1`,
        [digestConfig.slackCredentialId],
      );
      const slackCred = credRes.rows[0];
      if (
        !slackCred ||
        slackCred.status !== 'active' ||
        !matchesSlackDigestCredentialOwner(slackCred, {
          userId,
          workspaceMode: digestConfig.workspaceMode,
          trustedWorkspaceId: expectedWorkspaceId,
        })
      ) {
        return {
          status: 'blocked',
          error: 'Kết nối Slack đã thay đổi hoặc bị ngắt. Hãy kết nối lại.',
          pauseSchedule: true,
        };
      }

      try {
        if (!this.allowsSlackChannel(slackCred.config, digestConfig.channelId)) {
          return {
            status: 'blocked',
            error: 'Kênh Slack nhận báo cáo đã bị gỡ khỏi phạm vi cho phép.',
            pauseSchedule: true,
          };
        }
      } catch {
        return {
          status: 'blocked',
          error: 'Không đọc được thông tin kết nối Slack. Hãy kết nối lại.',
          pauseSchedule: true,
        };
      }
      slackCredential = { id: slackCred.id, config: slackCred.config };
    }

    let slackAdapter: any;
    try {
      slackAdapter = await this.options.adapterFactory.getAdapterForService('slack', {
        userId,
        phase: 'execution',
        workspaceMode: digestConfig.workspaceMode,
        workspaceId: expectedWorkspaceId,
        expectedCredential: slackCredential,
      });
      if (!slackAdapter || typeof slackAdapter.execute !== 'function') {
        return { status: 'digest_failed', error: 'Không khởi tạo được bộ kết nối Slack.' };
      }
      const channels = await slackAdapter.execute(
        'slack.search_channels',
        { query: '', channelId: digestConfig.channelId },
        { signal },
      );
      if (!Array.isArray(channels) || !channels.some((c: any) => String(c?.id) === digestConfig.channelId)) {
        return {
          status: 'blocked',
          error: 'Kênh Slack nhận bản tin không còn nằm trong phạm vi cho phép.',
          pauseSchedule: true,
        };
      }
    } catch (err: any) {
      if (signal.aborted) throw err;
      if (err?.category === 'AUTH_ERROR' || err?.category === 'PERMISSION_DENIED' || err?.category === 'NOT_FOUND') {
        return {
          status: 'blocked',
          error: 'Kênh Slack nhận bản tin không còn nằm trong phạm vi cho phép.',
          pauseSchedule: true,
        };
      }
      return {
        status: 'digest_failed',
        error: err instanceof Error ? err.message : 'Không kiểm tra được kênh Slack trước khi gửi.',
      };
    }

    // Best-effort member directory lookup when any read source supports assignee mentions
    let mentionIndex: SlackMentionIndex | null = null;
    if (
      this.options.resolveSlackMentions !== false &&
      digestConfig.sources.some((s) => s.service === 'myjira' || s.service === 'trello')
    ) {
      mentionIndex = await fetchSlackMentionIndexSafe(slackAdapter, { signal });
    }

    // 2 & 3. Compute time window and execute read sources
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
      workspaceMode: run.workspaceMode ?? digestConfig.workspaceMode,
      workspaceId: run.workspaceId ?? expectedWorkspaceId,
      gmailBinding,
      credentialRepo: this.options.credentialRepo,
      encryptionKey: this.options.encryptionKey,
      gmailOAuthClientId: this.options.gmailOAuthClientId,
      pool: this.options.pool,
      adapterFactory: this.options.adapterFactory,
      signal,
      mentionIndex,
      escapeText: escapeSlackMrkdwn,
    });

    if (readOutcome.kind === 'notion_blocked') {
      return { status: 'blocked', error: 'Bản tin đa nguồn Slack chưa hỗ trợ nguồn Notion.', pauseSchedule: true };
    }
    if (readOutcome.kind === 'blocked') {
      return { status: 'blocked', error: readOutcome.error, pauseSchedule: true };
    }
    if (readOutcome.kind === 'digest_failed') {
      return { status: 'digest_failed', error: readOutcome.error };
    }

    const { sourceStatuses, sections, structuredSections, failedLabels } = readOutcome;

    // 4. Optional AI highlight summary
    let aiHighlight = '';
    if (this.options.summarizeWithAi && digestConfig.includeAiSummary !== false) {
      const auth = await this.verifyAuthorityAndMaybeClaim(run, false, gmailBinding, slackCredential, signal);
      if (!auth.allowed) return auth.outcome;

      const aiTimeoutMs = this.options.aiTimeoutMs ?? 10_000;
      const aiController = new AbortController();
      const onParentAbort = () => aiController.abort(signal.reason ?? new Error('Aborted'));
      signal.addEventListener('abort', onParentAbort, { once: true });
      const aiTimer = setTimeout(() => aiController.abort(new Error('AI_TIMEOUT')), aiTimeoutMs);
      aiTimer.unref?.();
      try {
        const rawSummary = await Promise.race([
          this.options.summarizeWithAi(sections.join('\n\n'), aiController.signal),
          new Promise<null>((resolve) => {
            if (aiController.signal.aborted) resolve(null);
            else aiController.signal.addEventListener('abort', () => resolve(null), { once: true });
          }),
        ]);
        if (typeof rawSummary === 'string' && rawSummary.trim()) {
          aiHighlight = escapeSlackMrkdwn(rawSummary.trim().slice(0, 400));
        }
      } catch (err) {
        if (signal.aborted) throw err;
        aiHighlight = '';
      } finally {
        clearTimeout(aiTimer);
        signal.removeEventListener('abort', onParentAbort);
      }
    }

    const safeChannelName = escapeSlackMrkdwn(digestConfig.channelName);
    const timeLabel = localLabel(run.dueAt, this.options.timeZone);
    const headerLine = `📋 *Bản tin tổng hợp định kỳ Planora* · ${escapeSlackMrkdwn(run.name)} · 🕒 ${timeLabel}`;
    const aiLine = aiHighlight ? `> 💡 *Điểm nổi bật:* ${aiHighlight}` : '';
    const footerText =
      failedLabels.length > 0
        ? `⚠️ Tạm thời chưa lấy được dữ liệu từ: ${failedLabels.map((l) => escapeSlackMrkdwn(l)).join(', ')}.`
        : `ℹ️ Bản tin đa nguồn tự động · #${safeChannelName}`;

    const fullTextParts = [headerLine, ...(aiLine ? [aiLine] : []), sections.join('\n\n'), footerText];
    let digestText = fullTextParts.join('\n\n');
    if (Array.from(digestText).length > 3500) {
      digestText = `${Array.from(digestText).slice(0, 3495).join('')}\n...`;
    }

    const blocks = buildSlackDigestBlocks({
      headerTitle: `📋 ${run.name}`,
      subtitle: `Bản tin đa nguồn Planora · 🕒 ${timeLabel} · #${safeChannelName}`,
      sections: [
        ...(aiHighlight ? [{ body: `> 💡 *Điểm nổi bật:* ${aiHighlight}` }] : []),
        ...structuredSections.map((s) => ({
          heading: s.count >= 0 ? `*• ${escapeSlackMrkdwn(s.label)} (${s.count})*` : `*• ${escapeSlackMrkdwn(s.label)}*`,
          body: s.body,
        })),
      ],
      footer: footerText,
    });

    // Claim immediately before the real transport dispatch, after its rate-limit wait.
    const sendTimeoutMs = this.options.sendTimeoutMs ?? 15_000;
    const sendController = new AbortController();
    const onParentSendAbort = () => sendController.abort(signal.reason ?? new Error('SEND_ABORTED'));
    signal.addEventListener('abort', onParentSendAbort, { once: true });
    if (signal.aborted) onParentSendAbort();
    const sendTimer = setTimeout(() => sendController.abort(new Error('EGRESS_TIMEOUT')), sendTimeoutMs);
    sendTimer.unref?.();

    let preventedOutcome: SlackDigestRunOutcome | undefined;
    let deliveryStarted = false;
    let dispatchApproved = false;
    let sendDispatched = false;
    const nativeSlack = slackAdapter instanceof SlackAdapter;
    const claimDelivery = async () => {
      sendController.signal.throwIfAborted();
      const claim = await this.verifyAuthorityAndMaybeClaim(run, true, gmailBinding, slackCredential, sendController.signal);
      if (!claim.allowed) {
        preventedOutcome = claim.outcome;
        throw new Error('Slack digest delivery was not claimed');
      }
      deliveryStarted = claim.claimedInDb;
      dispatchApproved = true;
    };
    try {
      if (!nativeSlack) await claimDelivery();
      const abortPromise = new Promise<never>((_, reject) => {
        const onAbort = () =>
          reject(sendController.signal.reason instanceof Error ? sendController.signal.reason : new Error('SEND_ABORTED'));
        if (sendController.signal.aborted) onAbort();
        else sendController.signal.addEventListener('abort', onAbort, { once: true });
      });
      sendDispatched = true;
      const sendRes = await Promise.race([
        slackAdapter.execute(
          'slack.send_message',
          { channel: digestConfig.channelId, text: digestText, blocks },
          { signal: sendController.signal, ...(nativeSlack ? { beforeDispatch: claimDelivery } : {}) },
        ),
        abortPromise,
      ]);

      if (!isSlackMessageTimestamp(sendRes?.ts)) {
        return {
          status: 'delivery_unknown',
          error: SLACK_DIGEST_DELIVERY_UNKNOWN,
        };
      }

      return {
        status: 'digest_sent',
        digestText,
        delivery: {
          destinationService: 'slack',
          channelId: digestConfig.channelId,
          channelName: digestConfig.channelName,
          ts: sendRes.ts.trim(),
          ...(typeof sendRes.permalink === 'string' && sendRes.permalink.trim()
            ? { permalink: sendRes.permalink.trim() }
            : {}),
          sentAt: new Date().toISOString(),
          sources: sourceStatuses,
        },
      };
    } catch (err: any) {
      if (preventedOutcome) return preventedOutcome;
      if (nativeSlack && !dispatchApproved && !signal.aborted) {
        return { status: 'digest_failed', error: 'Không gửi được bản tin tổng hợp tới Slack.' };
      }
      if (deliveryStarted && sendDispatched) {
        if (isDefiniteSlackRejection(err) && this.options.pool) {
          await this.options.pool
            .query(
              "UPDATE schedule_runs SET delivery_started_at = NULL, updated_at = now() WHERE id = $1 AND status = 'planning'",
              [run.runId],
            )
            .catch(() => undefined);
          return {
            status: 'digest_failed',
            error: 'Không gửi được bản tin tổng hợp tới Slack.',
          };
        }
        return {
          status: 'delivery_unknown',
          error: `${SLACK_DIGEST_DELIVERY_UNKNOWN} (${err instanceof Error ? err.message : String(err)})`,
        };
      }
      if (signal.aborted) throw err;
      if (!sendDispatched || isDefiniteSlackRejection(err)) {
        return {
          status: 'digest_failed',
          error: 'Không gửi được bản tin tổng hợp tới Slack.',
        };
      }
      return {
        status: 'delivery_unknown',
        error: `${SLACK_DIGEST_DELIVERY_UNKNOWN} (${err instanceof Error ? err.message : String(err)})`,
      };
    } finally {
      clearTimeout(sendTimer);
      signal.removeEventListener('abort', onParentSendAbort);
    }
  }
}
