import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ScheduleService } from '../../../src/services/schedules/schedule-service.js';
import { ChatService } from '../../../src/services/chat-service.js';
import { MessageRepo } from '../../../src/db/repositories/message-repo.js';
import { ConversationRepo } from '../../../src/db/repositories/conversation-repo.js';
import { CredentialRepo } from '../../../src/db/repositories/credential-repo.js';
import { encryptCredentials } from '@wap/tool-adapters';
import { GMAIL_MODIFY_SCOPE, type TelegramDigestConfig } from '@wap/tool-schemas';
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
      githubLookup: {
        status: 'connected',
        connection: { credentialId: 'gh-cred', githubUserId: '123', login: 'tester', repos: ['acme/ati'] },
      },
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

    // Ambiguous group target when multiple groups are selected and request says "gửi vào nhóm Telegram" without group name
    const multiGroupLookup = {
      status: 'connected' as const,
      selectedChats: [
        { chatId: '777888999', title: 'Telegram của tôi (Digest User)', type: 'private' as const },
        { chatId: '-100555666777', title: 'Đội Sản Phẩm', type: 'supergroup' as const },
        { chatId: '-100555666888', title: 'Kỹ thuật ATI', type: 'group' as const },
      ],
      connection: {
        credentialId: 'cred-tg-1',
        telegramUserId: '777888999',
        username: 'digestuser',
        chatIds: ['-100555666777', '-100555666888', '777888999'],
      },
    };
    const ambiguousGroupCandidate = evaluateTelegramDigestCandidate({
      proposal: {
        kind: 'schedule',
        action: 'create',
        name: 'Báo cáo nhóm',
        request: 'Tổng hợp issue GitHub gửi vào nhóm Telegram',
        recurrence: { type: 'daily', time: '08:00' },
        summary: 'Gửi báo cáo vào nhóm Telegram',
      },
      services: ['github', 'telegram'],
      timeZone: 'Asia/Ho_Chi_Minh',
      telegramLookup: multiGroupLookup,
    });
    expect(ambiguousGroupCandidate.canAutoDigest).toBe(false);
    expect(ambiguousGroupCandidate.disabledReason).toContain('Hãy nêu rõ tên nhóm Telegram');
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
      githubConnection: async () => ({
        status: 'connected',
        connection: { credentialId: 'gh-cred', githubUserId: '123', login: 'tester', repos: ['acme/ati'] },
        teamRepos: [], memberRepos: [],
      }),
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
      sources: [{ service: 'github', label: 'GitHub Issues đang mở (acme/ati)' }],
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

  describe('A01: Gmail source binding proposal & versioned hash contract', () => {
    const ENC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const GMAIL_CLIENT_ID = 'gmail-client-a1.apps.googleusercontent.com';
    const USER_ID = '00000000-0000-4000-8000-000000000001';

    it('A01-1: derives GmailDigestBinding and sourceBindingVersion=1 on the server at proposal time, includes binding in configHash, and never leaks tokens', async () => {
      const credRepo = new CredentialRepo(pool, ENC_KEY);
      const convRepo = new ConversationRepo(pool);
      const msgRepo = new MessageRepo(pool);
      const scheduleService = new ScheduleService({
        pool,
        timeZone: 'Asia/Ho_Chi_Minh',
        encryptionKey: ENC_KEY,
        gmailOAuthClientId: GMAIL_CLIENT_ID,
      } as any);
      const now = new Date('2026-11-02T00:00:00.000Z');

      await pool.query("DELETE FROM service_credentials WHERE user_id = $1 AND service IN ('gmail', 'telegram')", [USER_ID]);
      const tgCred = await credRepo.saveCredentials(
        'telegram',
        encryptCredentials(
          {
            telegramUserId: '777888999',
            username: 'digestuser',
            selectedChats: [{ chatId: '777888999', title: 'Telegram của tôi (Digest User)', type: 'private' }],
          },
          ENC_KEY,
        ),
        USER_ID,
      );
      const gmailCredA = await credRepo.saveCredentials(
        'gmail',
        encryptCredentials(
          {
            oauthClientId: GMAIL_CLIENT_ID,
            refreshToken: '1//secret-refresh-token-account-a',
            accessToken: 'ya29.secret-access-token-a',
            email: '  Alice.Owner@Example.Test ',
            scopes: [GMAIL_MODIFY_SCOPE],
            connectedAt: '2026-11-01T00:00:00.000Z',
          },
          ENC_KEY,
        ),
        USER_ID,
      );

      // Model/client attempts to spoof binding in proposal payload; server must ignore it and derive from DB.
      const tamperedProposal: any = {
        kind: 'schedule',
        action: 'create',
        name: 'Tóm tắt Gmail sáng',
        request: 'Tóm tắt email chưa đọc trong hộp thư đến gửi vào Telegram của tôi',
        recurrence: { type: 'daily', time: '08:00' },
        summary: 'Mỗi sáng 8h tóm tắt Gmail gửi Telegram',
        binding: {
          kind: 'gmail',
          credentialId: '00000000-0000-4000-8000-999999999999',
          email: 'spoofed@attacker.test',
          oauthClientId: 'spoofed-client.apps.googleusercontent.com',
        },
      };

      const emitted: any[] = [];
      const chatService = new ChatService({
        msgRepo,
        convRepo,
        planner: {
          processMessage: async () => structuredClone(tamperedProposal),
          routeSchedule: async () => ({ services: ['gmail', 'telegram'], unavailable: [] }),
        },
        eventEmitter: { emit: (event, payload) => emitted.push({ event, payload }) },
        telegramConnection: async () => ({
          status: 'connected' as const,
          selectedChats: [{ chatId: '777888999', title: 'Telegram của tôi (Digest User)', type: 'private' as const }],
          connection: {
            credentialId: tgCred.id,
            telegramUserId: '777888999',
            username: 'digestuser',
            chatIds: ['777888999'],
          },
        }),
        schedules: {
          repo: scheduleService.repo,
          pool,
          encryptionKey: ENC_KEY,
          gmailOAuthClientId: GMAIL_CLIENT_ID,
          timeZone: 'Asia/Ho_Chi_Minh',
          now: () => now,
        } as any,
      });

      const waitForProposal = async () => {
        for (let i = 0; i < 100 && !emitted.some((e) => e.event === 'schedule_proposal' || e.event === 'error'); i++) {
          await new Promise((r) => setTimeout(r, 15));
        }
        return emitted.find((e) => e.event === 'schedule_proposal');
      };

      const convA = await convRepo.createConversation(USER_ID);
      await chatService.handleUserMessage({
        conversationId: convA.id,
        userId: USER_ID,
        content: 'Mỗi sáng 8h tóm tắt email chưa đọc gửi vào Telegram của tôi',
      });

      const eventA = await waitForProposal();
      expect(eventA).toBeDefined();
      const candidateA = eventA.payload.metadata.digestCandidate;
      expect(candidateA?.canAutoDigest).toBe(true);
      expect(candidateA?.config?.sourceBindingVersion).toBe(1);
      const gmailSrcA = candidateA?.config?.sources?.find((s: any) => s.service === 'gmail');
      expect(gmailSrcA).toEqual({
        service: 'gmail',
        tool: 'gmail.search_threads',
        args: { query: 'in:inbox is:unread' },
        label: 'Email chưa đọc (alice.owner@example.test)',
        binding: {
          kind: 'gmail',
          credentialId: gmailCredA.id,
          email: 'alice.owner@example.test',
          oauthClientId: GMAIL_CLIENT_ID,
        },
      });
      expect(gmailSrcA.label).not.toContain(gmailCredA.id);
      const serializedA = JSON.stringify(eventA.payload);
      expect(serializedA).not.toContain('1//secret-refresh-token-account-a');
      expect(serializedA).not.toContain('ya29.secret-access-token-a');
      expect(serializedA).not.toContain('spoofed@attacker.test');

      // Replace personal Gmail with Account B and verify proposal hash changes deterministically
      const gmailCredB = await credRepo.saveCredentials(
        'gmail',
        encryptCredentials(
          {
            oauthClientId: GMAIL_CLIENT_ID,
            refreshToken: '1//secret-refresh-token-account-b',
            email: 'bob.other@example.test',
            scopes: [GMAIL_MODIFY_SCOPE],
            connectedAt: '2026-11-01T01:00:00.000Z',
          },
          ENC_KEY,
        ),
        USER_ID,
      );
      emitted.length = 0;
      const convB = await convRepo.createConversation(USER_ID);
      await chatService.handleUserMessage({
        conversationId: convB.id,
        userId: USER_ID,
        content: 'Mỗi sáng 8h tóm tắt email chưa đọc gửi vào Telegram của tôi',
      });
      const eventB = await waitForProposal();
      const candidateB = eventB.payload.metadata.digestCandidate;
      expect(candidateB?.canAutoDigest).toBe(true);
      expect(candidateB?.config?.sources?.[0]?.label).toBe('Email chưa đọc (bob.other@example.test)');
      expect(candidateB?.config?.sources?.[0]?.binding).toEqual({
        kind: 'gmail',
        credentialId: gmailCredB.id,
        email: 'bob.other@example.test',
        oauthClientId: GMAIL_CLIENT_ID,
      });
      expect(candidateB?.configHash).not.toBe(candidateA?.configHash);
      expect(candidateA?.configHash).toBe(computeTelegramDigestConfigHash(candidateA.config));
      expect(candidateB?.configHash).toBe(computeTelegramDigestConfigHash(candidateB.config));
    });

    it('A01-2: marks auto_digest ineligible when Gmail credential is absent, reconnect_required, wrong oauthClientId, or missing gmail.modify scope', async () => {
      const credRepo = new CredentialRepo(pool, ENC_KEY);
      const convRepo = new ConversationRepo(pool);
      const msgRepo = new MessageRepo(pool);
      const scheduleService = new ScheduleService({
        pool,
        timeZone: 'Asia/Ho_Chi_Minh',
        encryptionKey: ENC_KEY,
        gmailOAuthClientId: GMAIL_CLIENT_ID,
      } as any);
      const now = new Date('2026-11-02T00:00:00.000Z');

      await pool.query("DELETE FROM service_credentials WHERE user_id = $1 AND service IN ('gmail', 'telegram')", [USER_ID]);
      const tgCred = await credRepo.saveCredentials(
        'telegram',
        encryptCredentials(
          {
            telegramUserId: '777888999',
            username: 'digestuser',
            selectedChats: [{ chatId: '777888999', title: 'Telegram của tôi (Digest User)', type: 'private' }],
          },
          ENC_KEY,
        ),
        USER_ID,
      );

      const proposeOnce = async () => {
        const emitted: any[] = [];
        const chatService = new ChatService({
          msgRepo,
          convRepo,
          planner: {
            processMessage: async () => ({
              kind: 'schedule',
              action: 'create',
              name: 'Tóm tắt Gmail sáng',
              request: 'Tóm tắt email chưa đọc gửi vào Telegram của tôi',
              recurrence: { type: 'daily', time: '08:00' },
              summary: 'Mỗi sáng 8h tóm tắt Gmail gửi Telegram',
            }),
            routeSchedule: async () => ({ services: ['gmail', 'telegram'], unavailable: [] }),
          },
          eventEmitter: { emit: (event, payload) => emitted.push({ event, payload }) },
          telegramConnection: async () => ({
            status: 'connected' as const,
            selectedChats: [{ chatId: '777888999', title: 'Telegram của tôi (Digest User)', type: 'private' as const }],
            connection: {
              credentialId: tgCred.id,
              telegramUserId: '777888999',
              username: 'digestuser',
              chatIds: ['777888999'],
            },
          }),
          schedules: {
            repo: scheduleService.repo,
            pool,
            encryptionKey: ENC_KEY,
            gmailOAuthClientId: GMAIL_CLIENT_ID,
            timeZone: 'Asia/Ho_Chi_Minh',
            now: () => now,
          } as any,
        });
        const conv = await convRepo.createConversation(USER_ID);
        await chatService.handleUserMessage({
          conversationId: conv.id,
          userId: USER_ID,
          content: 'Mỗi sáng 8h tóm tắt email chưa đọc gửi vào Telegram của tôi',
        });
        for (let i = 0; i < 100 && !emitted.some((e) => e.event === 'schedule_proposal' || e.event === 'error'); i++) {
          await new Promise((r) => setTimeout(r, 15));
        }
        return emitted.find((e) => e.event === 'schedule_proposal')?.payload?.metadata?.digestCandidate;
      };

      // 1. Absent Gmail credential -> ineligible
      expect((await proposeOnce())?.canAutoDigest).toBe(false);

      // 2. Wrong oauthClientId -> ineligible
      await credRepo.saveCredentials(
        'gmail',
        encryptCredentials(
          {
            oauthClientId: 'other-project-client.apps.googleusercontent.com',
            refreshToken: '1//rt',
            email: 'alice@example.test',
            scopes: [GMAIL_MODIFY_SCOPE],
          },
          ENC_KEY,
        ),
        USER_ID,
      );
      expect((await proposeOnce())?.canAutoDigest).toBe(false);

      // 3. Missing gmail.modify scope -> ineligible
      await credRepo.saveCredentials(
        'gmail',
        encryptCredentials(
          {
            oauthClientId: GMAIL_CLIENT_ID,
            refreshToken: '1//rt',
            email: 'alice@example.test',
            scopes: ['openid', 'email'],
          },
          ENC_KEY,
        ),
        USER_ID,
      );
      expect((await proposeOnce())?.canAutoDigest).toBe(false);

      // 4. Reconnect required -> ineligible
      const activeCred = await credRepo.saveCredentials(
        'gmail',
        encryptCredentials(
          {
            oauthClientId: GMAIL_CLIENT_ID,
            refreshToken: '1//rt',
            email: 'alice@example.test',
            scopes: [GMAIL_MODIFY_SCOPE],
          },
          ENC_KEY,
        ),
        USER_ID,
      );
      await credRepo.markReconnectRequired('gmail', USER_ID, activeCred.id);
      expect((await proposeOnce())?.canAutoDigest).toBe(false);
    });

    it('A01-3: preserves exact legacy non-Gmail config hash bytes and rejects malformed, duplicate, non-Gmail-bound, or non-fixed-query Gmail configs', async () => {
      const legacyNonGmail: TelegramDigestConfig = {
        credentialId: '00000000-0000-4000-8000-000000000099',
        telegramUserId: '777888999',
        username: 'digestuser',
        chatId: '777888999',
        chatTitle: 'Telegram của tôi',
        sources: [
          { service: 'github', tool: 'github.search_issues', args: { repo: 'acme/ati', query: 'open' }, label: 'GitHub Issues' },
          { service: 'calendar', tool: 'calendar.list_events', label: 'Lịch hôm nay' },
        ],
        recurrence: { type: 'daily', time: '08:00' },
        timeZone: 'Asia/Ho_Chi_Minh',
      };
      // Precomputed canonical SHA-256 of baseline non-Gmail TelegramDigestConfig
      expect(computeTelegramDigestConfigHash(legacyNonGmail)).toBe(
        '3d42466d8ce4fe8fd249c83b55c3f9bfb0fd432cd825b8598bdeb110a521cccd',
      );

      const credRepo = new CredentialRepo(pool, ENC_KEY);
      const convRepo = new ConversationRepo(pool);
      const msgRepo = new MessageRepo(pool);
      const scheduleService = new ScheduleService({
        pool,
        timeZone: 'Asia/Ho_Chi_Minh',
        encryptionKey: ENC_KEY,
        gmailOAuthClientId: GMAIL_CLIENT_ID,
      } as any);
      const now = new Date('2026-11-02T00:00:00.000Z');

      await pool.query("DELETE FROM service_credentials WHERE user_id = $1 AND service IN ('gmail', 'telegram')", [USER_ID]);
      const tgCred = await credRepo.saveCredentials(
        'telegram',
        encryptCredentials(
          {
            telegramUserId: '777888999',
            username: 'digestuser',
            selectedChats: [{ chatId: '777888999', title: 'Telegram của tôi', type: 'private' }],
          },
          ENC_KEY,
        ),
        USER_ID,
      );
      const gmailCred = await credRepo.saveCredentials(
        'gmail',
        encryptCredentials(
          {
            oauthClientId: GMAIL_CLIENT_ID,
            refreshToken: '1//rt-valid',
            email: 'alice@example.test',
            scopes: [GMAIL_MODIFY_SCOPE],
          },
          ENC_KEY,
        ),
        USER_ID,
      );
      const validBinding = {
        kind: 'gmail' as const,
        credentialId: gmailCred.id,
        email: 'alice@example.test',
        oauthClientId: GMAIL_CLIENT_ID,
      };

      const badConfigs: Array<{ label: string; config: any }> = [
        {
          label: 'duplicate gmail sources',
          config: {
            ...legacyNonGmail,
            credentialId: tgCred.id,
            sourceBindingVersion: 1,
            sources: [
              { service: 'gmail', tool: 'gmail.search_threads', args: { query: 'in:inbox is:unread' }, label: 'Email 1', binding: validBinding },
              { service: 'gmail', tool: 'gmail.search_threads', args: { query: 'in:inbox is:unread' }, label: 'Email 2', binding: validBinding },
            ],
          },
        },
        {
          label: 'binding attached to non-gmail source',
          config: {
            ...legacyNonGmail,
            credentialId: tgCred.id,
            sourceBindingVersion: 1,
            sources: [
              { service: 'github', tool: 'github.search_issues', args: { repo: 'acme/ati', query: 'open' }, label: 'GH', binding: validBinding },
            ],
          },
        },
        {
          label: 'non-fixed gmail query args',
          config: {
            ...legacyNonGmail,
            credentialId: tgCred.id,
            sourceBindingVersion: 1,
            sources: [
              { service: 'gmail', tool: 'gmail.search_threads', args: { query: 'from:ceo@acme.com' }, label: 'Email', binding: validBinding },
            ],
          },
        },
        {
          label: 'unexpected gmail read tool',
          config: {
            ...legacyNonGmail,
            credentialId: tgCred.id,
            sourceBindingVersion: 1,
            sources: [
              { service: 'gmail', tool: 'gmail.read_thread', args: { query: 'in:inbox is:unread' }, label: 'Email', binding: validBinding },
            ],
          },
        },
        {
          label: 'secret refreshToken smuggled inside binding',
          config: {
            ...legacyNonGmail,
            credentialId: tgCred.id,
            sourceBindingVersion: 1,
            sources: [
              {
                service: 'gmail',
                tool: 'gmail.search_threads',
                args: { query: 'in:inbox is:unread' },
                label: 'Email',
                binding: { ...validBinding, refreshToken: '1//leaked' },
              },
            ],
          },
        },
      ];

      for (const bad of badConfigs) {
        const conv = await convRepo.createConversation(USER_ID);
        let configHash = 'invalid-hash';
        try {
          configHash = computeTelegramDigestConfigHash(bad.config);
        } catch {
          // Hash helper itself rejecting malformed config is also acceptable
        }
        const msg = await msgRepo.createMessage(conv.id, 'assistant', 'Bad proposal', {
          type: 'schedule_proposal',
          proposal: {
            kind: 'schedule',
            action: 'create',
            name: `Bad ${bad.label}`,
            request: 'Tóm tắt email chưa đọc gửi vào Telegram của tôi',
            recurrence: { type: 'daily', time: '08:00' },
            summary: 'Bad',
          },
          services: ['gmail', 'telegram'],
          nextRuns: ['2026-11-03T01:00:00.000Z'],
          digestCandidate: {
            canAutoDigest: true,
            config: bad.config,
            configHash,
          },
        } as any);

        await expect(
          scheduleService.confirmProposal({
            userId: USER_ID,
            convId: conv.id,
            messageId: msg.id,
            approvalMode: 'auto_digest',
            now,
          }),
          `Expected confirmProposal to reject: ${bad.label}`,
        ).rejects.toThrow();
      }
    });

    it('A01-4: derives Gmail human source label from trusted server binding (never model-supplied label/account), hides credentialId in UI label projection, and preserves fixed query/pin/hash & non-Gmail hash', () => {
      const trustedCredId = '00000000-0000-4000-8000-000000000777';
      const tgCredId = '00000000-0000-4000-8000-000000000888';

      // Model/client supplies spoofed label, account, email, and sources on the ScheduleResponse object.
      const modelSpoofedProposal: any = {
        kind: 'schedule',
        action: 'create',
        name: 'Bản tin sáng',
        request: 'Tổng hợp issue GitHub đang mở và email chưa đọc gửi vào Telegram của tôi',
        recurrence: { type: 'daily', time: '08:00' },
        summary: 'Mỗi sáng 8h gửi bản tin',
        label: 'Email chưa đọc (spoofed-model@attacker.test)',
        account: 'spoofed-model@attacker.test',
        email: 'spoofed-model@attacker.test',
        sources: [
          {
            service: 'gmail',
            tool: 'gmail.search_threads',
            args: { query: 'from:secret@attacker.test' },
            label: 'Email chưa đọc (spoofed-source@attacker.test)',
            account: 'spoofed-source@attacker.test',
          },
        ],
      };

      const candidate = evaluateTelegramDigestCandidate({
        proposal: modelSpoofedProposal,
        services: ['github', 'gmail', 'telegram'],
        timeZone: 'Asia/Ho_Chi_Minh',
        telegramLookup: {
          status: 'connected',
          selectedChats: [
            { chatId: '777888999', title: 'Telegram của tôi (Digest User)', type: 'private' },
          ],
          connection: {
            credentialId: tgCredId,
            telegramUserId: '777888999',
            username: 'digestuser',
            chatIds: ['777888999'],
          },
        },
        githubLookup: {
          status: 'connected',
          connection: {
            credentialId: '00000000-0000-4000-8000-000000000666',
            githubUserId: '123',
            login: 'tester',
            repos: ['acme/ati'],
          },
        },
        gmailBinding: {
          kind: 'gmail',
          credentialId: trustedCredId,
          email: 'alice.trusted@example.test',
          oauthClientId: GMAIL_CLIENT_ID,
        },
      });

      expect(candidate.canAutoDigest).toBe(true);
      expect(candidate.config).toBeDefined();
      expect(candidate.config!.sourceBindingVersion).toBe(1);

      const gmailSource = candidate.config!.sources.find((s) => s.service === 'gmail');
      expect(gmailSource).toEqual({
        service: 'gmail',
        tool: 'gmail.search_threads',
        args: { query: 'in:inbox is:unread' },
        label: 'Email chưa đọc (alice.trusted@example.test)',
        binding: {
          kind: 'gmail',
          credentialId: trustedCredId,
          email: 'alice.trusted@example.test',
          oauthClientId: GMAIL_CLIENT_ID,
        },
      });

      // ScheduleMoment.tsx renders `config.sources.map((s) => s.label || s.service).join(', ')`
      const renderedUiSources = candidate.config!.sources.map((s) => s.label || s.service).join(', ');
      expect(renderedUiSources).toBe(
        'GitHub Issues đang mở (acme/ati), Email chưa đọc (alice.trusted@example.test)',
      );
      expect(renderedUiSources).not.toContain(trustedCredId);
      expect(renderedUiSources).not.toContain(tgCredId);
      expect(renderedUiSources).not.toContain(GMAIL_CLIENT_ID);
      expect(renderedUiSources).not.toContain('attacker.test');

      // Label is covered by canonical config hash
      expect(candidate.configHash).toBe(computeTelegramDigestConfigHash(candidate.config!));
      const tamperedLabelConfig: TelegramDigestConfig = {
        ...candidate.config!,
        sources: candidate.config!.sources.map((s) =>
          s.service === 'gmail' ? { ...s, label: 'Email chưa đọc (other@example.test)' } : s,
        ),
      };
      expect(computeTelegramDigestConfigHash(tamperedLabelConfig)).not.toBe(candidate.configHash);

      // Legacy non-Gmail config hash bytes remain unchanged
      const nonGmailConfig: TelegramDigestConfig = {
        credentialId: '00000000-0000-4000-8000-000000000099',
        telegramUserId: '777888999',
        username: 'digestuser',
        chatId: '777888999',
        chatTitle: 'Telegram của tôi',
        sources: [
          { service: 'github', tool: 'github.search_issues', args: { repo: 'acme/ati', query: 'open' }, label: 'GitHub Issues' },
          { service: 'calendar', tool: 'calendar.list_events', label: 'Lịch hôm nay' },
        ],
        recurrence: { type: 'daily', time: '08:00' },
        timeZone: 'Asia/Ho_Chi_Minh',
      };
      expect(computeTelegramDigestConfigHash(nonGmailConfig)).toBe(
        '3d42466d8ce4fe8fd249c83b55c3f9bfb0fd432cd825b8598bdeb110a521cccd',
      );
    });
  });
});
