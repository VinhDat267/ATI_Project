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

  describe('1. evaluateNotionDigestCandidate', () => {
    it('returns canAutoDigest: true when request reads Notion database and sends to an allowed Slack channel', async () => {
      const candidate = await evaluateNotionDigestCandidate({
        userId,
        request: 'Mỗi sáng tổng hợp các trang trên database Kế hoạch Sprint gửi vào kênh #dev',
        services: ['notion', 'slack'],
        recurrence,
        notionConnection: async () => ({
          status: 'connected',
          connection: {
            credentialId: 'cred-notion-1',
            workspaceId: 'ws-notion-1',
            workspaceName: 'ATI Notion',
            botId: 'bot-notion-1',
            identityVersion: 2,
            databaseIds: [dbId1],
          },
          selectedDatabases: [
            { id: dbId1, title: 'Kế hoạch Sprint', url: 'https://www.notion.so/aabbccdd11223344556677889900aabb' },
          ],
        }),
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
      expect(candidate.config).toEqual({
        credentialId: 'cred-notion-1',
        workspaceId: 'ws-notion-1',
        workspaceName: 'ATI Notion',
        botId: 'bot-notion-1',
        identityVersion: 2,
        databases: [
          { id: dbId1, title: 'Kế hoạch Sprint', url: 'https://www.notion.so/aabbccdd11223344556677889900aabb' },
        ],
        channelId: 'C_DEV',
        channelName: 'dev',
      });
      expect(candidate.configHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects write-intent requests from auto_digest', async () => {
      const candidate = await evaluateNotionDigestCandidate({
        userId,
        request: 'Mỗi sáng tạo trang mới trong database Kế hoạch Sprint và báo vào kênh #dev',
        services: ['notion', 'slack'],
        recurrence,
        notionConnection: async () => ({
          status: 'connected',
          connection: {
            credentialId: 'cred-notion-1',
            workspaceId: 'ws-notion-1',
            workspaceName: 'ATI Notion',
            botId: 'bot-notion-1',
            identityVersion: 2,
            databaseIds: [dbId1],
          },
          selectedDatabases: [{ id: dbId1, title: 'Kế hoạch Sprint' }],
        }),
      });

      expect(candidate.canAutoDigest).toBe(false);
      expect(candidate.disabledReason).toMatch(/không tự động tạo hoặc sửa/i);
    });
  });

  describe('2. createNotionDigestRunner', () => {
    it('queries Notion databases, includes AI summary with AbortSignal, and sends Slack digest', async () => {
      const config = {
        credentialId: 'cred-notion-1',
        workspaceId: 'ws-notion-1',
        workspaceName: 'ATI Notion',
        botId: 'bot-notion-1',
        identityVersion: 2,
        databases: [
          { id: dbId1, title: 'Kế hoạch Sprint', url: 'https://www.notion.so/aabbccdd11223344556677889900aabb' },
        ],
        channelId: 'C_DEV',
        channelName: 'dev',
      };
      const configHash = computeNotionDigestConfigHash({ config, recurrence, userId });

      const slackSendSpy = vi.fn().mockResolvedValue({ ts: '1700000000.009' });
      const runner = createNotionDigestRunner({
        pool: {
          query: vi.fn().mockResolvedValue({
            rowCount: 1,
            rows: [{ version: 1, status: 'active' }],
          }),
        } as any,
        notionConnection: async () => ({
          status: 'connected',
          connection: {
            credentialId: 'cred-notion-1',
            workspaceId: 'ws-notion-1',
            workspaceName: 'ATI Notion',
            botId: 'bot-notion-1',
            identityVersion: 2,
            databaseIds: [dbId1],
          },
        }),
        getAdapter: async (serviceName: string) => {
          if (serviceName === 'notion') {
            return {
              execute: vi.fn().mockResolvedValue({
                databaseId: dbId1,
                pages: [
                  {
                    id: 'page-1',
                    title: 'Thiết kế kiến trúc OAuth Notion',
                    url: 'https://www.notion.so/page-1',
                    properties: { Status: 'In Progress', Priority: 'High' },
                  },
                  {
                    id: 'page-2',
                    title: 'Viết kiểm thử E2E',
                    url: 'https://www.notion.so/page-2',
                    properties: { Status: 'Todo', Priority: 'Medium' },
                  },
                ],
              }),
            };
          }
          if (serviceName === 'slack') {
            return {
              execute: vi.fn().mockImplementation(async (tool: string, args: any) => {
                if (tool === 'slack.search_channels') {
                  return [{ id: 'C_DEV', name: 'dev' }];
                }
                if (tool === 'slack.send_message') {
                  return slackSendSpy(args);
                }
              }),
            };
          }
          return null;
        },
        summarizeDigest: async (_input, signal) => {
          expect(signal).toBeInstanceOf(AbortSignal);
          return 'Trang Thiết kế kiến trúc OAuth Notion đang ở trạng thái In Progress (High).';
        },
      });

      const outcome = await runner(
        {
          runId: 'run-n-1',
          scheduleId: 'sched-n-1',
          scheduleVersion: 1,
          userId,
          name: 'Báo cáo Notion sáng',
          request: 'Báo cáo Notion mỗi sáng',
          dueAt: new Date('2026-11-03T08:30:00.000Z'),
          trigger: 'scheduled',
          recurrence,
          digestConfig: config,
          digestConfigHash: configHash,
        },
        'conv-n-1',
        new AbortController().signal
      );

      expect(outcome.state).toBe('digest_sent');
      if (outcome.state === 'digest_sent') {
        expect(outcome.delivery).toEqual({
          channelId: 'C_DEV',
          channelName: 'dev',
          ts: '1700000000.009',
          counts: {
            databasesChecked: 1,
            totalPages: 2,
          },
        });
        expect(outcome.text).toContain('Bản tin Notion tự động của ATI');
        expect(outcome.text).toContain('Nhận xét AI:');
        expect(outcome.text).toContain('Thiết kế kiến trúc OAuth Notion');
        expect(outcome.text).toContain('Viết kiểm thử E2E');
      }
      expect(slackSendSpy).toHaveBeenCalledTimes(1);
    });

    it('blocks when identityVersion or databaseIds scope changed since approval', async () => {
      const config = {
        credentialId: 'cred-notion-1',
        workspaceId: 'ws-notion-1',
        workspaceName: 'ATI Notion',
        botId: 'bot-notion-1',
        identityVersion: 2,
        databases: [{ id: dbId1, title: 'Kế hoạch Sprint' }],
        channelId: 'C_DEV',
        channelName: 'dev',
      };
      const configHash = computeNotionDigestConfigHash({ config, recurrence, userId });

      const runner = createNotionDigestRunner({
        pool: { query: vi.fn() } as any,
        notionConnection: async () => ({
          status: 'connected',
          connection: {
            credentialId: 'cred-notion-1',
            workspaceId: 'ws-notion-1',
            workspaceName: 'ATI Notion',
            botId: 'bot-notion-1',
            identityVersion: 3, // Reconnected!
            databaseIds: [dbId1],
          },
        }),
      });

      const outcome = await runner(
        {
          runId: 'run-n-2',
          scheduleId: 'sched-n-1',
          scheduleVersion: 1,
          userId,
          name: 'Báo cáo Notion sáng',
          request: 'Báo cáo Notion mỗi sáng',
          dueAt: new Date('2026-11-03T08:30:00.000Z'),
          trigger: 'scheduled',
          recurrence,
          digestConfig: config,
          digestConfigHash: configHash,
        },
        'conv-n-1',
        new AbortController().signal
      );

      expect(outcome.state).toBe('blocked');
    });
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

    it('confirms a notion_digest proposal in PostgreSQL and executes it on ScheduleRunner.tick()', async () => {
      const user = await db.person('NotionDigestOwner');
      const convRes = await db.pool.query(
        "INSERT INTO conversations(user_id, status, title) VALUES($1, 'chatting', 'Lịch Notion') RETURNING id",
        [user.id]
      );
      const convId = convRes.rows[0].id as string;

      const config = {
        credentialId: 'cred-notion-1',
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

      const runNotionDigest = vi.fn().mockResolvedValue({
        state: 'digest_sent',
        delivery: {
          channelId: 'C_DEV',
          channelName: 'dev',
          ts: '1700000000.009',
          counts: { databasesChecked: 1, totalPages: 3 },
        },
        text: '*Bản tin Notion tự động của ATI*',
      });

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
        counts: { databasesChecked: 1, totalPages: 3 },
      });
    });

    it('marks run as needs_attention on ambiguous delivery failure and discards when schedule is cancelled before delivery', async () => {
      const user = await db.person('NotionDigestSafetyOwner');
      const convRes = await db.pool.query(
        "INSERT INTO conversations(user_id, status, title) VALUES($1, 'chatting', 'Lịch Notion Safety') RETURNING id",
        [user.id]
      );
      const convId = convRes.rows[0].id as string;

      const config = {
        credentialId: 'cred-notion-1',
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
          notionConnection: async () => ({
            status: 'connected',
            connection: {
              credentialId: 'cred-notion-1',
              workspaceId: 'ws-notion-1',
              workspaceName: 'ATI Notion',
              botId: 'bot-notion-1',
              identityVersion: 1,
              databaseIds: [dbId1],
            },
          }),
          getAdapter: async (serviceName: string) => {
            if (serviceName === 'notion') {
              return {
                execute: vi.fn().mockImplementation(async () => {
                  await service.setStatus({
                    userId: user.id,
                    scheduleId: confirmed.schedule.id,
                    action: 'cancel',
                    version: confirmed.schedule.version,
                    now: new Date('2026-11-03T01:31:05.000Z'),
                  });
                  return { pages: [] };
                }),
              };
            }
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
