import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ScheduleService } from '../../../src/services/schedules/schedule-service.js';
import { ChatService } from '../../../src/services/chat-service.js';
import { MessageRepo } from '../../../src/db/repositories/message-repo.js';
import { ConversationRepo } from '../../../src/db/repositories/conversation-repo.js';
import {
  computeTelegramDigestConfigHash,
  evaluateTelegramDigestCandidate,
} from '../../../src/services/schedules/telegram-digest-candidate.js';

const directory = fileURLToPath(new URL('../../../../../db/v3/', import.meta.url));

async function connectAdmin(): Promise<{ admin: pg.Pool; databaseUrl: string }> {
  const candidates = [
    process.env.DATABASE_URL,
    'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3',
    'postgresql://ati_v3:ati_v3_local_only@127.0.0.1:56533/ati_v3',
  ].filter(Boolean) as string[];

  for (const url of candidates) {
    try {
      const p = new pg.Pool({ connectionString: url });
      await p.query('SELECT 1');
      return { admin: p, databaseUrl: url };
    } catch {
      // try next candidate
    }
  }
  throw new Error('Cannot connect to PostgreSQL');
}

describe('Telegram auto_digest schedule proposal & confirmation on PostgreSQL (Task 7)', () => {
  const schema = `tg_digest_prop_${randomUUID().replaceAll('-', '')}`;
  let admin: pg.Pool;
  let pool: pg.Pool;

  beforeAll(async () => {
    const conn = await connectAdmin();
    admin = conn.admin;
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({
      connectionString: conn.databaseUrl,
      options: `-c search_path=${schema},public`,
    });

    const files = (await readdir(directory)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      await pool.query(await readFile(new URL(file, `file://${directory}`), 'utf8'));
    }

    await pool.query(`
      INSERT INTO users (id, email, password, name)
      VALUES ('00000000-0000-4000-8000-000000000001', 'digest@example.com', 'hash', 'Digest User')
    `);
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });

  it('evaluates read-only multi-service Telegram schedule as canAutoDigest === true and rejects write-intent or Slack schedules', () => {
    const telegramLookup = {
      status: 'connected' as const,
      selectedChats: [
        { chatId: '777888999', title: 'Telegram của tôi (Digest User)', type: 'private' as const },
        { chatId: '-100555666777', title: 'Đội Sản Phẩm', type: 'supergroup' as const },
      ],
      connection: {
        credentialId: 'cred-tg-1',
        telegramUserId: '777888999',
        username: 'digestuser',
        chatIds: ['-100555666777', '777888999'],
      },
    };

    const validCandidate = evaluateTelegramDigestCandidate({
      proposal: {
        kind: 'schedule',
        action: 'create',
        name: 'Báo cáo sáng',
        request: 'Tóm tắt lịch họp hôm nay, issue GitHub đang mở và thẻ Trello gửi vào nhóm Đội Sản Phẩm trên Telegram',
        recurrence: { type: 'daily', time: '08:00' },
        summary: 'Mỗi ngày lúc 08:00 gửi báo cáo sáng vào Telegram',
      },
      services: ['calendar', 'github', 'trello', 'telegram'],
      timeZone: 'Asia/Ho_Chi_Minh',
      telegramLookup,
    });

    expect(validCandidate.canAutoDigest).toBe(true);
    expect(validCandidate.config).toBeDefined();
    expect(validCandidate.config!.chatId).toBe('-100555666777');
    expect(validCandidate.config!.chatTitle).toBe('Đội Sản Phẩm');
    expect(validCandidate.config!.sources.map((s) => s.service)).toEqual(['calendar', 'github', 'trello']);
    expect(validCandidate.configHash).toBe(computeTelegramDigestConfigHash(validCandidate.config!));

    // Write intent should disable auto_digest
    const writeCandidate = evaluateTelegramDigestCandidate({
      proposal: {
        kind: 'schedule',
        action: 'create',
        name: 'Tạo thẻ Trello mỗi sáng',
        request: 'Tạo thẻ Trello mới cho việc cần làm rồi gửi báo cáo vào Telegram của tôi',
        recurrence: { type: 'daily', time: '08:00' },
        summary: 'Tạo thẻ Trello và báo Telegram',
      },
      services: ['trello', 'telegram'],
      timeZone: 'Asia/Ho_Chi_Minh',
      telegramLookup,
    });
    expect(writeCandidate.canAutoDigest).toBe(false);
    expect(writeCandidate.disabledReason).toContain('ghi');

    // Slack destination should disable auto_digest
    const slackCandidate = evaluateTelegramDigestCandidate({
      proposal: {
        kind: 'schedule',
        action: 'create',
        name: 'Báo cáo Slack và Telegram',
        request: 'Đọc GitHub issue gửi vào Slack và Telegram',
        recurrence: { type: 'daily', time: '08:00' },
        summary: 'Gửi Slack và Telegram',
      },
      services: ['github', 'slack', 'telegram'],
      timeZone: 'Asia/Ho_Chi_Minh',
      telegramLookup,
    });
    expect(slackCandidate.canAutoDigest).toBe(false);
  });

  it('persists kind = telegram_digest, digest_config, digest_config_hash on confirmProposal(auto_digest), recomputes hash on update, and rejects auto_digest when canAutoDigest is false', async () => {
    const scheduleService = new ScheduleService({
      pool,
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    const convRepo = new ConversationRepo(pool);
    const msgRepo = new MessageRepo(pool);
    const now = new Date('2026-11-02T00:00:00.000Z');

    const telegramLookup = async () => ({
      status: 'connected' as const,
      selectedChats: [
        { chatId: '777888999', title: 'Telegram của tôi (Digest User)', type: 'private' as const },
      ],
      connection: {
        credentialId: '00000000-0000-4000-8000-000000000099',
        telegramUserId: '777888999',
        username: 'digestuser',
        chatIds: ['777888999'],
      },
    });

    let nextProposal: any = {
      kind: 'schedule',
      action: 'create',
      name: 'Báo cáo sáng GitHub',
      request: 'Tổng hợp issue GitHub đang mở gửi vào Telegram của tôi',
      recurrence: { type: 'daily', time: '07:30' },
      summary: 'Mỗi ngày 07:30 gửi báo cáo GitHub vào Telegram',
    };

    const emitted: any[] = [];
    const chatService = new ChatService({
      msgRepo,
      convRepo,
      planner: {
        processMessage: async () => structuredClone(nextProposal),
        routeSchedule: async () => ({ services: ['github', 'telegram'], unavailable: [] }),
      },
      eventEmitter: { emit: (event, payload) => emitted.push({ event, payload }) },
      telegramConnection: telegramLookup,
      schedules: { repo: scheduleService.repo, timeZone: 'Asia/Ho_Chi_Minh', now: () => now },
    });

    const waitForProposal = async () => {
      for (let i = 0; i < 100 && !emitted.some((e) => e.event === 'schedule_proposal' || e.event === 'error'); i++) {
        await new Promise((r) => setTimeout(r, 15));
      }
      return emitted.find((e) => e.event === 'schedule_proposal');
    };

    const conv = await convRepo.createConversation('00000000-0000-4000-8000-000000000001');
    await chatService.handleUserMessage({
      conversationId: conv.id,
      userId: '00000000-0000-4000-8000-000000000001',
      content: 'Mỗi sáng 7h30 gửi báo cáo GitHub vào Telegram của tôi',
    });

    const proposalEvent = await waitForProposal();
    expect(proposalEvent).toBeDefined();
    expect(proposalEvent.payload.metadata.digestCandidate?.canAutoDigest).toBe(true);

    const confirmed = await scheduleService.confirmProposal({
      userId: '00000000-0000-4000-8000-000000000001',
      convId: conv.id,
      messageId: proposalEvent.payload.messageId,
      approvalMode: 'auto_digest',
      now,
    });

    expect(confirmed.schedule.kind).toBe('telegram_digest');
    expect(confirmed.schedule.approvalMode).toBe('auto_digest');
    expect(confirmed.schedule.digest).toMatchObject({
      chatId: '777888999',
      chatTitle: 'Telegram của tôi (Digest User)',
      sources: [{ service: 'github', label: 'GitHub Issues đang mở' }],
    });

    // Now test update proposal changing recurrence to 08:15 -> recomputes digest_config_hash
    emitted.length = 0;
    nextProposal = {
      kind: 'schedule',
      action: 'update',
      name: 'Báo cáo sáng GitHub',
      request: 'Tổng hợp issue GitHub đang mở gửi vào Telegram của tôi',
      recurrence: { type: 'daily', time: '08:15' },
      summary: 'Đổi giờ sang 08:15 mỗi ngày',
    };
    await chatService.handleUserMessage({
      conversationId: conv.id,
      userId: '00000000-0000-4000-8000-000000000001',
      content: 'Đổi sang 8h15 sáng mỗi ngày',
    });

    const updateEvent = await waitForProposal();
    expect(updateEvent).toBeDefined();
    const updated = await scheduleService.confirmProposal({
      userId: '00000000-0000-4000-8000-000000000001',
      convId: conv.id,
      messageId: updateEvent.payload.messageId,
      approvalMode: 'auto_digest',
      now,
    });
    expect(updated.schedule.kind).toBe('telegram_digest');
    expect(updated.schedule.recurrence).toEqual({ type: 'daily', time: '08:15' });

    const dbRow = await pool.query('SELECT kind, digest_config, digest_config_hash FROM schedules WHERE id = $1', [
      updated.schedule.id,
    ]);
    expect(dbRow.rows[0].kind).toBe('telegram_digest');
    expect(dbRow.rows[0].digest_config.recurrence).toEqual({ type: 'daily', time: '08:15' });
    expect(dbRow.rows[0].digest_config_hash).toBe(
      computeTelegramDigestConfigHash(dbRow.rows[0].digest_config),
    );

    // Reject auto_digest when proposal has canAutoDigest === false
    const conv2 = await convRepo.createConversation('00000000-0000-4000-8000-000000000001');
    emitted.length = 0;
    nextProposal = {
      kind: 'schedule',
      action: 'create',
      name: 'Tạo issue GitHub',
      request: 'Tạo issue GitHub mới rồi báo Telegram',
      recurrence: { type: 'daily', time: '09:00' },
      summary: 'Mỗi ngày tạo issue',
    };
    await chatService.handleUserMessage({
      conversationId: conv2.id,
      userId: '00000000-0000-4000-8000-000000000001',
      content: 'Mỗi ngày 9h tạo issue GitHub rồi báo Telegram',
    });
    const writeProposalEvent = await waitForProposal();
    expect(writeProposalEvent.payload.metadata.digestCandidate?.canAutoDigest).toBe(false);

    await expect(
      scheduleService.confirmProposal({
        userId: '00000000-0000-4000-8000-000000000001',
        convId: conv2.id,
        messageId: writeProposalEvent.payload.messageId,
        approvalMode: 'auto_digest',
        now,
      }),
    ).rejects.toMatchObject({ code: 'AUTO_DIGEST_NOT_ALLOWED' });
  });
});
