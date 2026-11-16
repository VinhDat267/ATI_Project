import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  evaluateNotionDigestCandidate,
  computeNotionDigestConfigHash,
} from '../../../src/services/schedules/notion-digest-candidate.js';
import {
  analyzeNotionDigestPages,
  createNotionDigestRunner,
  NOTION_DELIVERY_UNKNOWN,
} from '../../../src/services/schedules/notion-digest-runner.js';
import { summarizeSourceItems } from '../../../src/services/schedules/telegram-digest-runner.js';
import { CALENDAR_DELIVERY_UNKNOWN } from '../../../src/services/schedules/calendar-digest-runner.js';
import { GITHUB_DELIVERY_UNKNOWN } from '../../../src/services/schedules/github-digest-runner.js';
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
        dueSoon: 0,
        unassigned: 0,
        recentlyUpdated: 1,
      });
      expect(analysis.sortedPages.map((p) => p.page.id)).toEqual([
        'p-overdue',
        'p-inprog',
        'p-done',
      ]);
      expect(analysis.sortedPages[1]?.isRecent24h).toBe(true);
    });

    it.each([
      ['2026-11-10T08:00:00+07:00', 1, 0],
      ['2026-11-10T18:00:00+07:00', 0, 1],
      ['2026-11-10', 0, 1],
      ['10/11/2026', 0, 1],
      ['2026-11-09T09:00:00+07:00 → 2026-11-10T08:00:00+07:00', 1, 0],
      ['2026-11-09T09:00:00+07:00 → 2026-11-10', 0, 1],
    ])('classifies Notion due date %s at 18:00 local time', (due, overdueOrBlocked, dueSoon) => {
      const { stats } = analyzeNotionDigestPages([{
        databaseId: dbId1,
        databaseTitle: 'Sprint',
        id: 'p-due',
        title: 'Sprint task',
        url: 'https://www.notion.so/p-due',
        properties: { Status: 'Todo', Due: due },
      }], Date.parse('2026-11-10T18:00:00+07:00'), 'Asia/Ho_Chi_Minh');

      expect(stats).toMatchObject({ overdueOrBlocked, dueSoon });
    });

    it('tracks dueSoon (48h), unassigned active pages, end-of-range dates, timezone boundaries, and Telegram truncation metadata', () => {
      // 2026-11-10T00:30:00+07:00 = 2026-11-09T17:30:00.000Z
      const nowMs = Date.parse('2026-11-09T17:30:00.000Z');
      const analysis = analyzeNotionDigestPages(
        [
          {
            databaseId: dbId1,
            databaseTitle: 'Sprint',
            id: 'p-soon',
            title: 'Task đến hạn trong 24h',
            url: 'https://www.notion.so/p-soon',
            properties: { Status: 'Todo', Due: '2026-11-10', Assignee: '' },
          },
          {
            databaseId: dbId1,
            databaseTitle: 'Sprint',
            id: 'p-range-ok',
            title: 'Task đang chạy trong khoảng ngày',
            url: 'https://www.notion.so/p-range-ok',
            properties: { Status: 'In progress', Due: '2026-11-09 → 2026-11-15', Assignee: 'Minh' },
          },
          {
            databaseId: dbId1,
            databaseTitle: 'Sprint',
            id: 'p-done-no-owner',
            title: 'Task xong không tính chưa phân công',
            url: 'https://www.notion.so/p-done-no-owner',
            properties: { Status: 'Done', Due: '2026-11-01', Assignee: '' },
          },
        ],
        nowMs,
        'Asia/Ho_Chi_Minh',
      );

      expect(analysis.stats).toEqual({
        total: 3,
        done: 1,
        inProgress: 1,
        overdueOrBlocked: 0,
        dueSoon: 1,
        unassigned: 1,
        recentlyUpdated: 0,
      });

      const truncatedTg = summarizeSourceItems('notion', {
        databaseId: dbId1,
        pages: [{ id: 'p1', title: 'Mục 1', properties: { Status: 'Open' } }],
        truncated: true,
      });
      expect(truncatedTg.truncated).toBe(true);
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
      const sendSlack = vi.fn(async () => ({ ts: '1700000000.000009' }));
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
        ts: '1700000000.000009',
        counts: { databasesChecked: 1, totalPages: 1, dueSoon: 0, unassigned: 0 },
      });
    });

    it.each(['cancelled', 'run-locked'] as const)('does not dispatch when the Slack delivery claim is %s', async (reason) => {
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
      let lockedRun: pg.PoolClient | undefined;
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
              if (reason === 'cancelled') {
                await service.setStatus({
                  userId: user.id, scheduleId: confirmed.schedule.id, action: 'cancel',
                  version: confirmed.schedule.version, now: new Date('2026-11-03T01:31:05.000Z'),
                });
              } else {
                lockedRun = await db.pool.connect();
                await lockedRun.query('BEGIN');
                const locked = await lockedRun.query(
                  "SELECT id FROM schedule_runs WHERE schedule_id=$1 AND status='planning' FOR UPDATE",
                  [confirmed.schedule.id],
                );
                expect(locked.rowCount).toBe(1);
              }
              return { pages: [], pagesByDatabase: new Map() };
            },
            withSource: async (ownerId, binding, signal, action) => {
              try {
                return await withSource(ownerId, binding, signal, action);
              } finally {
                if (lockedRun) {
                  await lockedRun.query('ROLLBACK');
                  lockedRun.release();
                  lockedRun = undefined;
                }
              }
            },
          },
          getAdapter: async (serviceName: string) => {
            if (serviceName === 'slack') {
              return {
                execute: vi.fn().mockImplementation(async (tool: string) => {
                  if (tool === 'slack.search_channels') return [{ id: 'C_DEV', name: 'dev' }];
                  if (tool === 'slack.send_message') {
                    slackSendCallsAfterCancel++;
                    return { ts: '1700000099.000009' };
                  }
                }),
              };
            }
            return null;
          },
        }),
        recordState: (client, row, now) => service.recordState(client, row, now),
      });

      try {
        await runner.tick();
        expect(slackSendCallsAfterCancel).toBe(0);
        const runs = await service.listRuns(user.id, confirmed.schedule.id, 5, new Date('2026-11-03T01:32:00.000Z'));
        expect(runs[0]?.state).toBe(reason === 'cancelled' ? 'discarded' : 'digest_failed');
      } finally {
        if (lockedRun) {
          await lockedRun.query('ROLLBACK');
          lockedRun.release();
        }
      }
    });

    it('preserves truncation footer within 3500-char Slack budget and sets delivery.truncated', async () => {
      const user = await db.person('NotionDigestTruncOwner');
      const convRes = await db.pool.query(
        "INSERT INTO conversations(user_id, status, title) VALUES($1, 'chatting', 'Lịch Notion Trunc') RETURNING id",
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
      const msgRes = await db.pool.query(
        "INSERT INTO messages(conv_id, role, content, metadata) VALUES($1, 'assistant', 'Đề xuất lịch Notion', $2::jsonb) RETURNING id",
        [
          convId,
          JSON.stringify({
            type: 'schedule_proposal',
            proposal: {
              kind: 'schedule',
              action: 'create',
              name: 'Báo cáo Notion Trunc',
              request: 'Mỗi sáng tổng hợp Sprint',
              recurrence,
              summary: 'Tạo lịch báo cáo Notion',
            },
            scheduleId: null,
            baseVersion: null,
            services: ['notion', 'slack'],
            nextRuns: ['2026-11-03T01:30:00.000Z'],
            previous: null,
            digestCandidate: { canAutoDigest: true, config, configHash },
          }),
        ]
      );
      const service = new ScheduleService({ pool: db.pool, timeZone: 'Asia/Ho_Chi_Minh' });
      const confirmed = await service.confirmProposal({
        userId: user.id,
        convId,
        messageId: msgRes.rows[0].id as string,
        now: new Date('2026-11-02T10:00:00.000Z'),
        approvalMode: 'auto_digest',
      });

      const longPages = Array.from({ length: 20 }, (_, i) => ({
        id: `page-long-${i}`,
        title: `Trang dài số ${i} ` + 'A'.repeat(110),
        url: `https://www.notion.so/page-long-${i}`,
        properties: { Status: 'In Progress', Assignee: '' },
      }));
      let postedText = '';
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
            read: async () => ({
              pages: longPages,
              pagesByDatabase: new Map([[dbId1, longPages]]),
              truncated: true,
              truncatedByDatabase: new Map([[dbId1, true]]),
              databases: [{ databaseId: dbId1, truncated: true }],
            }),
            withSource,
          },
          getAdapter: async () => ({
            execute: async (tool: string, args: any) => {
              if (tool === 'slack.search_channels') return [{ id: 'C_DEV', name: 'dev' }];
              postedText = args.text;
              return { ts: '1700000123.000001' };
            },
          }),
        }),
        recordState: (client, row, now) => service.recordState(client, row, now),
      });

      await runner.tick();
      expect(postedText.length).toBeLessThanOrEqual(3500);
      expect(postedText).toContain('giới hạn tải 20 trang/database mỗi lượt');

      const runs = await service.listRuns(user.id, confirmed.schedule.id, 5, new Date('2026-11-03T01:32:00.000Z'));
      expect(runs[0]?.state).toBe('digest_sent');
      expect(runs[0]?.delivery).toMatchObject({
        channelId: 'C_DEV',
        ts: '1700000123.000001',
        truncated: true,
        counts: { databasesChecked: 1, totalPages: 20, unassigned: 20 },
      });
    });

    it.each([
      { label: 'Notion delivery error', storedError: null },
      { label: 'legacy Calendar fallback without a snapshot', storedError: CALENDAR_DELIVERY_UNKNOWN, omitSnapshot: true },
      { label: 'legacy GitHub fallback', storedError: GITHUB_DELIVERY_UNKNOWN },
    ])('recovers $label via mark_sent and retry_new_run after a malformed Slack receipt', async ({ storedError, omitSnapshot }) => {
      const createBadTsSchedule = async (suffix: string) => {
        const user = await db.person(`NotionRecovery_${suffix}`);
        const convRes = await db.pool.query(
          "INSERT INTO conversations(user_id, status, title) VALUES($1, 'chatting', 'Lịch Notion Recovery') RETURNING id",
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
        const msgRes = await db.pool.query(
          "INSERT INTO messages(conv_id, role, content, metadata) VALUES($1, 'assistant', 'Đề xuất lịch Notion', $2::jsonb) RETURNING id",
          [
            convId,
            JSON.stringify({
              type: 'schedule_proposal',
              proposal: {
                kind: 'schedule',
                action: 'create',
                name: `Báo cáo Notion Recovery ${suffix}`,
                request: 'Mỗi sáng tổng hợp Sprint',
                recurrence,
                summary: 'Tạo lịch báo cáo Notion',
              },
              scheduleId: null,
              baseVersion: null,
              services: ['notion', 'slack'],
              nextRuns: ['2026-11-03T01:30:00.000Z'],
              previous: null,
              digestCandidate: { canAutoDigest: true, config, configHash },
            }),
          ]
        );
        const service = new ScheduleService({ pool: db.pool, timeZone: 'Asia/Ho_Chi_Minh' });
        const confirmed = await service.confirmProposal({
          userId: user.id,
          convId,
          messageId: msgRes.rows[0].id as string,
          now: new Date('2026-11-02T10:00:00.000Z'),
          approvalMode: 'auto_digest',
        });

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
              read: async () => ({ pages: [], pagesByDatabase: new Map([[dbId1, []]]) }),
              withSource,
            },
            getAdapter: async () => ({
              execute: async (tool: string) =>
                tool === 'slack.search_channels' ? [{ id: 'C_DEV', name: 'dev' }] : { ts: 'invalid-ts' },
            }),
          }),
          recordState: (client, row, now) => service.recordState(client, row, now),
        });
        await runner.tick();
        if (storedError) {
          const updated = await db.pool.query(
            `UPDATE schedule_runs
             SET error = $2,
                 dispatched_config = CASE WHEN $3 THEN NULL ELSE dispatched_config END,
                 dispatched_config_hash = CASE WHEN $3 THEN NULL ELSE dispatched_config_hash END
             WHERE schedule_id = $1 AND status = 'needs_attention' AND delivery_started_at IS NOT NULL`,
            [confirmed.schedule.id, storedError, omitSnapshot ?? false],
          );
          expect(updated.rowCount).toBe(1);
        }
        return { user, service, schedule: confirmed.schedule };
      };

      // Case A: mark_sent resolution + replan blocked on needs_attention
      const caseA = await createBadTsSchedule('mark');
      const runsA = await caseA.service.listRuns(caseA.user.id, caseA.schedule.id, 5, new Date('2026-11-03T01:32:00.000Z'));
      expect(runsA[0]?.state).toBe('needs_attention');
      expect(runsA[0]?.error).toBe(NOTION_DELIVERY_UNKNOWN);
      const scheduleViews = await caseA.service.list(caseA.user.id, new Date('2026-11-03T01:32:00.000Z'));
      expect(scheduleViews[0]?.lastRun?.error).toBe(NOTION_DELIVERY_UNKNOWN);
      if (omitSnapshot) {
        await db.pool.query('UPDATE schedules SET version = version + 1 WHERE id = $1', [caseA.schedule.id]);
        await expect(caseA.service.resolveRunDelivery({
          userId: caseA.user.id,
          runId: runsA[0]!.id,
          resolution: 'mark_sent',
        })).rejects.toMatchObject({ code: 'RUN_NOT_AWAITING_DELIVERY_RESOLUTION' });
        await db.pool.query('UPDATE schedules SET version = $2 WHERE id = $1', [caseA.schedule.id, caseA.schedule.version]);
      }
      await expect(
        caseA.service.startRun({ runId: runsA[0]!.id, trigger: 'replan', userId: caseA.user.id, now: new Date('2026-11-03T01:33:00.000Z') })
      ).rejects.toThrow();

      const marked = await caseA.service.resolveRunDelivery({
        userId: caseA.user.id,
        runId: runsA[0]!.id,
        resolution: 'mark_sent',
        now: new Date('2026-11-03T01:34:00.000Z'),
      });
      expect(marked.run.state).toBe('digest_sent');
      expect(marked.run.delivery).toMatchObject({
        channelId: 'C_DEV',
        channelName: 'dev',
        manualResolution: { status: 'confirmed_sent' },
      });

      // Case B: retry_new_run creates a follow-up planning run
      const caseB = await createBadTsSchedule('retry');
      const runsB = await caseB.service.listRuns(caseB.user.id, caseB.schedule.id, 5, new Date('2026-11-03T01:32:00.000Z'));
      const retried = await caseB.service.resolveRunDelivery({
        userId: caseB.user.id,
        runId: runsB[0]!.id,
        resolution: 'retry_new_run',
        confirmDuplicateRisk: true,
        now: new Date('2026-11-03T01:34:00.000Z'),
      });
      expect(retried.followUpRun?.state).toBe('planning');
      expect(retried.run.deliveryResolution).toBe('retried_new_run');
    });
  });
});
