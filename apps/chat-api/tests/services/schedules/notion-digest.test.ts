import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  evaluateNotionDigestCandidate,
  computeNotionDigestConfigHash,
} from '../../../src/services/schedules/notion-digest-candidate.js';
import {
  analyzeNotionDigestPages,
  createNotionDigestRunner,
} from '../../../src/services/schedules/notion-digest-runner.js';
import { summarizeSourceItems } from '../../../src/services/schedules/telegram-digest-runner.js';
import { ScheduleService } from '../../../src/services/schedules/schedule-service.js';
import { ScheduleRunner } from '../../../src/services/schedules/schedule-runner.js';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';

describe('Notion Automated Digest (Task 4: notion_digest & Telegram Notion enrichment)', () => {
  const userId = 'user-notion-1';
  const recurrence = { type: 'daily' as const, time: '08:30' };
  const dbId1 = 'aabbccdd-1122-3344-5566-77889900aabb';

  const credentialId = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
  const bindingFor = (ownerId: string, id = credentialId) => ({
    version: 1 as const, ownerId, credentialId: id, workspaceId: 'ws-notion-1',
    workspaceName: 'ATI Notion', appId: 'notion-app', actorId: 'actor-notion-1',
    botId: 'bot-notion-1', identityVersion: 1,
    databases: [{ databaseId: dbId1, dataSourceId: 'ffffffff-6666-4666-8666-ffffffffffff', title: 'Kế hoạch Sprint' }],
  });

  describe('1. evaluateNotionDigestCandidate', () => {
    it('returns canAutoDigest: true when request reads Notion database and sends to an allowed Slack channel', async () => {
      const candidate = await evaluateNotionDigestCandidate({
        userId,
        request: 'Mỗi sáng tổng hợp các trang trên database Kế hoạch Sprint gửi vào kênh #dev',
        services: ['notion', 'slack'],
        recurrence,
        notionSources: { prepare: async () => bindingFor(userId) },
        getAdapter: async (serviceName: string) => {
          if (serviceName === 'slack') {
            return {
              execute: vi.fn().mockResolvedValue([{ id: 'C_DEV', name: 'dev' }]),
            };
          }
          return null;
        },
      });

      expect(candidate.canAutoDigest).toBe(true);
      expect(candidate.config).toMatchObject({
        notionBinding: bindingFor(userId),
        credentialId,
        databases: [{ id: dbId1, title: 'Kế hoạch Sprint' }],
        channelId: 'C_DEV',
      });
      expect(candidate.configHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects write-intent requests from auto_digest', async () => {
      const candidate = await evaluateNotionDigestCandidate({
        userId,
        request: 'Mỗi sáng tạo trang mới trong database Kế hoạch Sprint và báo vào kênh #dev',
        services: ['notion', 'slack'],
        recurrence,
      });

      expect(candidate.canAutoDigest).toBe(false);
      expect(candidate.disabledReason).toMatch(/không tự động tạo hoặc sửa/i);
    });
  });

  it('blocks an older Slack Notion digest before reading or looking up the destination', async () => {
    const config = {
      credentialId, workspaceId: 'ws-notion-1', workspaceName: 'ATI Notion',
      botId: 'bot-notion-1', identityVersion: 1,
      databases: [{ id: dbId1, title: 'Kế hoạch Sprint' }], channelId: 'C_DEV', channelName: 'dev',
    };
    const getAdapter = vi.fn();
    const runner = createNotionDigestRunner({ pool: { query: vi.fn() } as any, getAdapter });
    const outcome = await runner({
      runId: 'run-n-1', scheduleId: 'sched-n-1', scheduleVersion: 1, userId,
      name: 'Báo cáo Notion', request: 'Báo cáo Notion mỗi sáng',
      dueAt: new Date('2026-11-03T08:30:00.000Z'), trigger: 'scheduled',
      recurrence, digestConfig: config, digestConfigHash: computeNotionDigestConfigHash({ config, recurrence, userId }),
    }, 'conv-n-1', AbortSignal.timeout(1000));
    expect(outcome.state).toBe('blocked');
    expect(getAdapter).not.toHaveBeenCalled();
  });

  describe('3. Telegram summarizeSourceItems for Notion', () => {
    it('extracts pages from Notion query_database output and formats status/priority metadata', () => {
      const summary = summarizeSourceItems('notion', {
        databaseId: dbId1,
        pages: [
          {
            id: 'p1',
            title: 'Tích hợp Notion OAuth',
            properties: { Status: 'In Progress', Priority: 'High' },
          },
          {
            id: 'p2',
            title: 'Cập nhật tài liệu Handoff',
            properties: { Status: 'Done' },
          },
        ],
      });

      expect(summary.count).toBe(2);
      expect(summary.lines[0]).toContain('Tích hợp Notion OAuth');
      expect(summary.lines[0]).toContain('In Progress');
      expect(summary.lines[1]).toContain('Cập nhật tài liệu Handoff');
    });

    it('categorizes and prioritizes overdue/blocked, in-progress, recently updated (24h), and done pages', () => {
      const nowMs = Date.parse('2026-11-10T08:00:00.000Z');
      const analysis = analyzeNotionDigestPages(
        [
          {
            databaseId: dbId1,
            databaseTitle: 'Sprint',
            id: 'p-done',
            title: 'Task đã xong',
            url: 'https://www.notion.so/p-done',
            properties: { Status: 'Done', Due: '2026-11-01' },
            lastEditedTime: '2026-11-01T10:00:00.000Z',
          },
          {
            databaseId: dbId1,
            databaseTitle: 'Sprint',
            id: 'p-inprog',
            title: 'Task đang làm mới cập nhật',
            url: 'https://www.notion.so/p-inprog',
            properties: { Status: 'In progress', Due: '2026-11-15' },
            lastEditedTime: '2026-11-09T20:00:00.000Z',
          },
          {
            databaseId: dbId1,
            databaseTitle: 'Sprint',
            id: 'p-overdue',
            title: 'Task trễ hạn',
            url: 'https://www.notion.so/p-overdue',
            properties: { Status: 'Not started', Due: '2026-11-05' },
            lastEditedTime: '2026-11-04T10:00:00.000Z',
          },
        ],
        nowMs,
      );

      expect(analysis.stats).toEqual({
        total: 3,
        done: 1,
        inProgress: 1,
        overdueOrBlocked: 1,
        recentlyUpdated: 1,
      });
      expect(analysis.sortedPages.map((p) => p.page.id)).toEqual([
        'p-overdue',
        'p-inprog',
        'p-done',
      ]);
      expect(analysis.sortedPages[1]?.isRecent24h).toBe(true);
    });
  });

  describe('4. PostgreSQL ScheduleService + ScheduleRunner integration for notion_digest', () => {
    let db: Awaited<ReturnType<typeof createMigratedSchema>>;

    beforeAll(async () => {
      db = await createMigratedSchema('notion_digest_e2e');
    });

    afterAll(async () => {
      await db?.close();
    });

    async function withSource<T>(
      _ownerId: string, _binding: unknown, _signal: AbortSignal, action: (client: pg.PoolClient) => Promise<T>,
    ): Promise<T> {
      const client = await db.pool.connect();
      try { return await action(client); }
      finally { client.release(); }
    }

    async function sourceFor(ownerId: string) {
      const row = (await db.pool.query(
        `INSERT INTO notion_connections(user_id,app_id,workspace_id,workspace_name,actor_id,bot_id,config,allowed_databases)
         VALUES($1,'notion-app','ws-notion-1','ATI Notion',$3,'bot-notion-1','fixture-ciphertext',$2)
         RETURNING id`, [ownerId, [dbId1], ownerId],
      )).rows[0];
      return { ...bindingFor(ownerId, row.id), actorId: ownerId };
    }

    it('confirms a notion_digest proposal in PostgreSQL and executes it on ScheduleRunner.tick()', async () => {
      const user = await db.person('NotionDigestOwner');
      const convRes = await db.pool.query(
        "INSERT INTO conversations(user_id, status, title) VALUES($1, 'chatting', 'Lịch Notion') RETURNING id",
        [user.id]
      );
      const convId = convRes.rows[0].id as string;

      const notionBinding = await sourceFor(user.id);
      const config = {
        notionBinding,
        credentialId: notionBinding.credentialId,
        workspaceId: 'ws-notion-1',
        workspaceName: 'ATI Notion',
        botId: 'bot-notion-1',
        identityVersion: 1,
        databases: [{ id: dbId1, title: 'Kế hoạch Sprint' }],
        channelId: 'C_DEV',
        channelName: 'dev',
      };
      const configHash = computeNotionDigestConfigHash({
        config,
        recurrence,
        userId: user.id,
      });

      const proposalMeta = {
        type: 'schedule_proposal',
        proposal: {
          kind: 'schedule',
          action: 'create',
          name: 'Báo cáo Notion sáng',
          request: 'Mỗi sáng tổng hợp database Kế hoạch Sprint gửi vào kênh #dev',
          recurrence,
          summary: 'Tạo lịch báo cáo Notion mỗi sáng lúc 08:30',
        },
        scheduleId: null,
        baseVersion: null,
        services: ['notion', 'slack'],
        nextRuns: ['2026-11-03T01:30:00.000Z'],
        previous: null,
        digestCandidate: {
          canAutoDigest: true,
          config,
          configHash,
        },
      };

      const msgRes = await db.pool.query(
        "INSERT INTO messages(conv_id, role, content, metadata) VALUES($1, 'assistant', 'Đề xuất lịch Notion', $2::jsonb) RETURNING id",
        [convId, JSON.stringify(proposalMeta)]
      );
      const messageId = msgRes.rows[0].id as string;

      const service = new ScheduleService({
        pool: db.pool,
        timeZone: 'Asia/Ho_Chi_Minh',
      });

      const confirmed = await service.confirmProposal({
        userId: user.id,
        convId,
        messageId,
        now: new Date('2026-11-02T10:00:00.000Z'),
        approvalMode: 'auto_digest',
      });

      expect(confirmed.schedule.kind).toBe('notion_digest');
      expect(confirmed.schedule.approvalMode).toBe('auto_digest');
      expect(confirmed.schedule.digest).toEqual({
        config,
        approvedAt: '2026-11-02T10:00:00.000Z',
      });

      const pages = [{ id: 'page1', title: 'Trang Sprint', url: 'https://www.notion.so/page1' }];
      const sendSlack = vi.fn(async () => ({ ts: '1700000000.009' }));
      const runNotionDigest = vi.fn(createNotionDigestRunner({
        pool: db.pool,
        notionSources: {
          read: async () => ({ pages, pagesByDatabase: new Map([[dbId1, pages]]) }),
          withSource,
        },
        getAdapter: async () => ({ execute: async (tool: string) => tool === 'slack.search_channels'
          ? [{ id: 'C_DEV', name: 'dev' }]
          : sendSlack() }),
      }));

      const runner = new ScheduleRunner({
        pool: db.pool,
        timeZone: 'Asia/Ho_Chi_Minh',
        now: () => new Date('2026-11-03T01:31:00.000Z'),
        planRun: async () => {
          throw new Error('Should not call planRun for notion_digest');
        },
        runNotionDigest,
        recordState: (client, row, now) => service.recordState(client, row, now),
      });

      await runner.tick();

      expect(runNotionDigest).toHaveBeenCalledTimes(1);
      expect(sendSlack).toHaveBeenCalledTimes(1);
      const runs = await service.listRuns(
        user.id,
        confirmed.schedule.id,
        5,
        new Date('2026-11-03T01:32:00.000Z')
      );
      expect(runs).toHaveLength(1);
      expect(runs[0]!.state).toBe('digest_sent');
      expect(runs[0]!.delivery).toEqual({
        channelId: 'C_DEV',
        channelName: 'dev',
        ts: '1700000000.009',
        counts: { databasesChecked: 1, totalPages: 1 },
      });
    });

    it('discards when the schedule is cancelled before the Slack delivery claim', async () => {
      const user = await db.person('NotionDigestSafetyOwner');
      const convRes = await db.pool.query(
        "INSERT INTO conversations(user_id, status, title) VALUES($1, 'chatting', 'Lịch Notion Safety') RETURNING id",
        [user.id]
      );
      const convId = convRes.rows[0].id as string;

      const notionBinding = await sourceFor(user.id);
      const config = {
        notionBinding,
        credentialId: notionBinding.credentialId,
        workspaceId: 'ws-notion-1',
        workspaceName: 'ATI Notion',
        botId: 'bot-notion-1',
        identityVersion: 1,
        databases: [{ id: dbId1, title: 'Kế hoạch Sprint' }],
        channelId: 'C_DEV',
        channelName: 'dev',
      };
      const configHash = computeNotionDigestConfigHash({ config, recurrence, userId: user.id });
      const proposalMeta = {
        type: 'schedule_proposal',
        proposal: {
          kind: 'schedule',
          action: 'create',
          name: 'Báo cáo Notion Safety',
          request: 'Mỗi sáng tổng hợp database Kế hoạch Sprint gửi vào kênh #dev',
          recurrence,
          summary: 'Tạo lịch báo cáo Notion mỗi sáng lúc 08:30',
        },
        scheduleId: null,
        baseVersion: null,
        services: ['notion', 'slack'],
        nextRuns: ['2026-11-03T01:30:00.000Z'],
        previous: null,
        digestCandidate: { canAutoDigest: true, config, configHash },
      };

      const msgRes = await db.pool.query(
        "INSERT INTO messages(conv_id, role, content, metadata) VALUES($1, 'assistant', 'Đề xuất lịch Notion', $2::jsonb) RETURNING id",
        [convId, JSON.stringify(proposalMeta)]
      );
      const service = new ScheduleService({ pool: db.pool, timeZone: 'Asia/Ho_Chi_Minh' });
      const confirmed = await service.confirmProposal({
        userId: user.id,
        convId,
        messageId: msgRes.rows[0].id as string,
        now: new Date('2026-11-02T10:00:00.000Z'),
        approvalMode: 'auto_digest',
      });

      let slackSendCallsAfterCancel = 0;
      const runner = new ScheduleRunner({
        pool: db.pool,
        timeZone: 'Asia/Ho_Chi_Minh',
        now: () => new Date('2026-11-03T01:31:00.000Z'),
        planRun: async () => {
          throw new Error('Should not call planRun');
        },
        runNotionDigest: createNotionDigestRunner({
          pool: db.pool,
          notionSources: {
            read: async () => {
              await service.setStatus({
                userId: user.id, scheduleId: confirmed.schedule.id, action: 'cancel',
                version: confirmed.schedule.version, now: new Date('2026-11-03T01:31:05.000Z'),
              });
              return { pages: [], pagesByDatabase: new Map() };
            },
            withSource,
          },
          getAdapter: async (serviceName: string) => {
            if (serviceName === 'slack') {
              return {
                execute: vi.fn().mockImplementation(async (tool: string) => {
                  if (tool === 'slack.search_channels') return [{ id: 'C_DEV', name: 'dev' }];
                  if (tool === 'slack.send_message') {
                    slackSendCallsAfterCancel++;
                    return { ts: '1700000099.009' };
                  }
                }),
              };
            }
            return null;
          },
        }),
        recordState: (client, row, now) => service.recordState(client, row, now),
      });

      await runner.tick();
      expect(slackSendCallsAfterCancel).toBe(0);
    });
  });
});
