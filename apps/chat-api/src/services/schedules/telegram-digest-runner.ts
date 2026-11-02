import { decryptCredentials } from '@wap/tool-adapters';
import type pg from 'pg';
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
import { computeTelegramDigestConfigHash, READ_DIGEST_SOURCE_MAP } from './telegram-digest-candidate.js';

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
}

export type DigestRunOutcome =
  | { status: 'discarded' }
  | {
      status: 'digest_sent';
      digestText: string;
      delivery: TelegramDigestDelivery;
    }
  | {
      status: 'digest_failed';
      error: string;
      pauseSchedule?: boolean;
    };

export interface TelegramDigestRunnerOptions {
  pool: pg.Pool | null;
  credentialRepo: Pick<CredentialRepo, 'getPersonalCredentials'>;
  encryptionKey: string;
  adapterFactory: {
    getAdapterForService(serviceName: string, context?: AdapterContext): Promise<any> | any;
  };
  botClient?: Pick<TelegramBotClient, 'getChatMember'>;
  timeZone: string;
}

function summarizeSourceItems(service: string, raw: unknown): { count: number; lines: string[] } {
  const items: any[] = Array.isArray(raw)
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
                : [];

  if (items.length === 0) {
    return { count: 0, lines: ['  (Không có mục mới)'] };
  }

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
    const client = await this.options.pool.connect();
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
        status: 'digest_failed',
        error: 'Cấu hình báo cáo tự động bị thiếu hoặc không hợp lệ.',
        pauseSchedule: true,
      };
    }

    const computedHash = computeTelegramDigestConfigHash(digestConfig);
    if (computedHash !== digestConfigHash) {
      return {
        status: 'digest_failed',
        error: 'Cấu hình báo cáo tự động không khớp chữ ký toàn vẹn.',
        pauseSchedule: true,
      };
    }

    // 1. Verify current personal Telegram connection and scope
    const record = await this.options.credentialRepo.getPersonalCredentials('telegram', userId);
    if (!record || record.status !== 'active' || record.id !== digestConfig.credentialId) {
      return {
        status: 'digest_failed',
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
        status: 'digest_failed',
        error: 'Không đọc được thông tin kết nối Telegram. Hãy kết nối lại.',
        pauseSchedule: true,
      };
    }

    const targetChatId = normalizeTelegramChatId(digestConfig.chatId);
    if (!telegramUserId || telegramUserId !== digestConfig.telegramUserId || !selectedChatIds.has(targetChatId)) {
      return {
        status: 'digest_failed',
        error: 'Cuộc trò chuyện nhận báo cáo đã bị gỡ khỏi phạm vi cho phép.',
        pauseSchedule: true,
      };
    }

    if (targetChatId !== telegramUserId && targetChatId.startsWith('-') && this.options.botClient) {
      const isMember = await this.options.botClient.getChatMember(targetChatId, telegramUserId, signal);
      if (!isMember) {
        return {
          status: 'digest_failed',
          error: 'Bạn không còn là thành viên của nhóm Telegram nhận báo cáo.',
          pauseSchedule: true,
        };
      }
    }

    // 2. Verify all sources are in strict read-only allowlist
    if (!Array.isArray(digestConfig.sources) || digestConfig.sources.length === 0) {
      return {
        status: 'digest_failed',
        error: 'Không có dịch vụ nguồn dữ liệu hợp lệ trong cấu hình báo cáo.',
        pauseSchedule: true,
      };
    }

    for (const source of digestConfig.sources) {
      const allowed = READ_DIGEST_SOURCE_MAP[source.service];
      if (!allowed || allowed.tool !== source.tool) {
        return {
          status: 'digest_failed',
          error: `Công cụ nguồn "${source.tool}" không nằm trong danh sách chỉ đọc được phép.`,
          pauseSchedule: true,
        };
      }
    }

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
        const rawResult = await adapter.execute(source.tool, source.args ?? {}, { signal });
        const { count, lines } = summarizeSourceItems(source.service, rawResult);
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

    // 4. Format plain-text digest (max 4096 codepoints)
    const timeLabel = localLabel(run.dueAt, this.options.timeZone);
    const header = `📋 Báo cáo tự động: ${run.name}\n🕒 ${timeLabel}\n\n`;
    const footer =
      failedLabels.length > 0
        ? `\n\n⚠️ Tạm thời chưa lấy được dữ liệu từ: ${failedLabels.join(', ')}.`
        : '';
    let digestText = `${header}${sections.join('\n\n')}${footer}`;
    const codepoints = Array.from(digestText);
    if (codepoints.length > 4096) {
      digestText = codepoints.slice(0, 4090).join('') + '\n...';
    }

    // 5. Send via Telegram adapter with execution context
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
