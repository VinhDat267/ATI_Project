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
import { NotionDigestSourceAuthority } from '../../../src/services/notion/digest-source-authority.js';
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

    it('uses the end date of multi-day date ranges (start → end) and computes midnight in the schedule timezone', () => {
      // 2026-11-09T18:00:00.000Z is 2026-11-10 01:00:00 in Asia/Ho_Chi_Minh (already Nov 10 locally)
      const nowMs = Date.parse('2026-11-09T18:00:00.000Z');
      const analysis = analyzeNotionDigestPages(
        [
          {
            databaseId: dbId1,
            databaseTitle: 'Sprint',
            id: 'p-multiday-active',
            title: 'Multi-day task still active through Nov 12',
            url: 'https://www.notion.so/p-multiday-active',
            properties: { Status: 'Todo', Due: '2026-11-05 → 2026-11-12' },
          },
          {
            databaseId: dbId1,
            databaseTitle: 'Sprint',
            id: 'p-yesterday-ict',
            title: 'Task due Nov 9 (yesterday in ICT, but still Nov 9 in UTC)',
            url: 'https://www.notion.so/p-yesterday-ict',
            properties: { Status: 'Todo', Due: '2026-11-09' },
          },
          {
            databaseId: dbId1,
            databaseTitle: 'Sprint',
            id: 'p-today-ict',
            title: 'Task due Nov 10 (today in ICT)',
            url: 'https://www.notion.so/p-today-ict',
            properties: { Status: 'Todo', Due: '2026-11-10' },
          },
        ],
        nowMs,
        'Asia/Ho_Chi_Minh',
      );

      const byId = new Map(analysis.sortedPages.map((item) => [item.page.id, item.bucket]));
      expect(byId.get('p-multiday-active')).toBe('todo');
      expect(byId.get('p-yesterday-ict')).toBe('overdue_blocked');
      expect(byId.get('p-today-ict')).toBe('todo');
      expect(analysis.stats.overdueOrBlocked).toBe(1);
    });

    it('propagates truncated from NotionDigestSourceAuthority.read into the digest message and delivery', async () => {
      const validUserId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
      const notionBinding = bindingFor(validUserId);
      const config = {
        notionBinding,
        credentialId,
        workspaceId: 'ws-notion-1',
        workspaceName: 'ATI Notion',
        botId: 'bot-notion-1',
        identityVersion: 1,
        databases: [{ id: dbId1, title: 'Kế hoạch Sprint' }],
        channelId: 'C_DEV',
        channelName: 'dev',
      };
      const configHash = computeNotionDigestConfigHash({ config, recurrence, userId: validUserId });
      const sentTexts: string[] = [];
      const runner = createNotionDigestRunner({
        pool: { query: vi.fn() } as any,
        notionSources: {
          read: async () => ({
            pages: [{ id: 'p1', title: 'Trang 1', url: 'https://www.notion.so/p1' }],
            pagesByDatabase: new Map([[dbId1, [{ id: 'p1', title: 'Trang 1', url: 'https://www.notion.so/p1' }]]]),
            truncated: true,
            truncatedByDatabase: new Map([[dbId1, true]]),
            databases: [{ databaseId: dbId1, pages: [{ id: 'p1', title: 'Trang 1', url: 'https://www.notion.so/p1' }], truncated: true }],
          }),
          withSource: async (_ownerId, _binding, _signal, dispatch) => {
            const fakeClient = {
              query: vi.fn(async (sql: string) => {
                if (sql.includes('SELECT conv_id FROM schedules')) return { rowCount: 1, rows: [{ conv_id: 'conv-1' }] };
                if (sql.includes('FROM schedules s')) {
                  return {
                    rowCount: 1,
                    rows: [{
                      id: 'sched-1',
                      user_id: validUserId,
                      kind: 'notion_digest',
                      version: 1,
                      status: 'active',
                      digest_config: config,
                      digest_config_hash: configHash,
                    }],
                  };
                }
                if (sql.includes('FROM schedule_runs')) {
                  return { rowCount: 1, rows: [{ status: 'planning', delivery_started_at: null }] };
                }
                if (sql.includes('UPDATE schedule_runs')) return { rowCount: 1, rows: [{ id: 'run-1' }] };
                return { rowCount: 1, rows: [] };
              }),
            } as any;
            return dispatch(fakeClient);
          },
        },
        getAdapter: async () => ({
          execute: async (tool: string, args: any) => {
            if (tool === 'slack.search_channels') return [{ id: 'C_DEV', name: 'dev' }];
            sentTexts.push(args.text);
            return { ts: '1700000001.001' };
          },
        }),
      });

      const outcome = await runner(
        {
          runId: 'run-1',
          scheduleId: 'sched-1',
          scheduleVersion: 1,
          userId: validUserId,
          name: 'Báo cáo Notion',
          request: 'Báo cáo Notion',
          dueAt: new Date('2026-11-10T01:30:00.000Z'),
          trigger: 'scheduled',
          recurrence,
          digestConfig: config,
          digestConfigHash: configHash,
        },
        'conv-1',
        AbortSignal.timeout(2000),
      );

      expect(outcome.state).toBe('digest_sent');
      if (outcome.state === 'digest_sent') {
        expect(outcome.text).toContain('rút gọn');
        expect((outcome.delivery as any).truncated).toBe(true);
      }
      expect(sentTexts[0]).toContain('rút gọn');
    });

    it('NotionDigestSourceAuthority.read preserves truncated on returned database entries', async () => {
      const validOwnerId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
      const dsId = 'ffffffff-6666-4666-8666-ffffffffffff';
      const pageId = '22222222-3333-4444-5555-666666666666';
      const binding = bindingFor(validOwnerId);
      const fakeFetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes(`/databases/${dbId1}`)) {
          return new Response(
            JSON.stringify({
              object: 'database',
              id: dbId1,
              title: [{ plain_text: 'Kế hoạch Sprint' }],
              url: 'https://www.notion.so/' + dbId1.replaceAll('-', ''),
              data_sources: [{ id: dsId }],
            }),
          );
        }
        if (url.includes(`/data_sources/${dsId}/query`)) {
          return new Response(
            JSON.stringify({
              object: 'list',
              results: Array.from({ length: 20 }, (_, i) => ({
                object: 'page',
                id: `22222222-3333-4444-5555-${String(i + 1).padStart(12, '0')}`,
                parent: { type: 'data_source_id', data_source_id: dsId },
                url: 'https://www.notion.so/' + pageId.replaceAll('-', ''),
                properties: { Name: { type: 'title', title: [{ plain_text: `Trang ${i + 1}` }] } },
              })),
              has_more: true,
              next_cursor: 'cursor-next',
            }),
          );
        }
        return new Response(
          JSON.stringify({
            object: 'data_source',
            id: dsId,
            parent: { type: 'database_id', database_id: dbId1 },
            properties: { Name: { type: 'title' } },
          }),
        );
      }) as unknown as typeof fetch;

      vi.stubGlobal('fetch', fakeFetch);
      try {
        const authority = new NotionDigestSourceAuthority(
          {
            get: async () => ({
              id: credentialId,
              user_id: validOwnerId,
              app_id: 'notion-app',
              workspace_id: 'ws-notion-1',
              workspace_name: 'ATI Notion',
              actor_id: 'actor-notion-1',
              bot_id: 'bot-notion-1',
              identity_version: 1,
              status: 'active',
              config: 'cipher',
              refresh_in_flight: false,
              allowed_databases: [dbId1],
            }),
          } as any,
          {
            execute: async (_u: string, _c: string, _v: number, fn: any) => fn('tok-1', 'bot-notion-1', {}),
          } as any,
          { appId: 'notion-app', apiBaseUrl: 'https://api.notion.com/v1' } as any,
          '0123456789abcdef0123456789abcdef',
        );
        const readResult = await authority.read(validOwnerId, binding, AbortSignal.timeout(2000));
        expect(readResult.truncated).toBe(true);
        expect(readResult.truncatedByDatabase?.get(dbId1)).toBe(true);
        expect(readResult.databases).toEqual([
          expect.objectContaining({
            databaseId: dbId1,
            truncated: true,
          }),
        ]);
      } finally {
        vi.unstubAllGlobals();
      }
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
      expect(runNotionDigest.mock.calls[0]?.[0]?.timeZone).toBe('Asia/Ho_Chi_Minh');
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

    it('preserves truncation warning in long Slack Notion digests and Telegram summarizeSourceItems', async () => {
      const validUserId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
      const longTitle = 'Việc rất dài '.repeat(30);
      const manyPages = Array.from({ length: 20 }, (_, i) => ({
        id: `p-${i}`,
        title: `${longTitle} #${i}`,
        url: `https://www.notion.so/p-${i}`,
        properties: { Status: 'In Progress' },
      }));
      const config = {
        notionBinding: bindingFor(validUserId),
        credentialId, workspaceId: 'ws-notion-1', workspaceName: 'ATI Notion',
        botId: 'bot-notion-1', identityVersion: 1,
        databases: [{ id: dbId1, title: 'Kế hoạch Sprint' }], channelId: 'C_DEV', channelName: 'dev',
      };
      const configHash = computeNotionDigestConfigHash({ config, recurrence, userId: validUserId });
      let postedText = '';
      const runner = createNotionDigestRunner({
        pool: { query: vi.fn() } as any,
        timeZone: 'America/New_York',
        notionSources: {
          read: async () => ({
            pages: manyPages,
            pagesByDatabase: new Map([[dbId1, manyPages]]),
            truncated: true,
            truncatedByDatabase: new Map([[dbId1, true]]),
            databases: [{ databaseId: dbId1, pages: manyPages, truncated: true }],
          }),
          withSource: async (_ownerId, _binding, _signal, action) => action({
            query: async (sql: string) => {
              if (sql.includes('SELECT conv_id FROM schedules')) return { rowCount: 1, rows: [{ conv_id: 'conv-trunc-1' }] };
              if (sql.includes('FROM schedules s')) {
                return {
                  rowCount: 1,
                  rows: [{ id: 'sched-trunc-1', user_id: validUserId, kind: 'notion_digest', version: 1, digest_config: config, digest_config_hash: configHash, status: 'active' }],
                };
              }
              if (sql.includes('FROM schedule_runs')) return { rowCount: 1, rows: [{ status: 'planning', delivery_started_at: null }] };
              return { rowCount: 1, rows: [{ id: 'run-trunc-1' }] };
            },
          } as any),
        },
        getAdapter: async (serviceName) => {
          if (serviceName === 'slack') {
            return {
              execute: vi.fn().mockImplementation(async (tool: string, args: any) => {
                if (tool === 'slack.search_channels') return [{ id: 'C_DEV', name: 'dev' }];
                if (tool === 'slack.send_message') {
                  postedText = args.text;
                  return { ts: '1700000123.001' };
                }
              }),
            };
          }
          return null;
        },
      });
      const outcome = await runner({
        runId: 'run-trunc-1', scheduleId: 'sched-trunc-1', scheduleVersion: 1, userId: validUserId,
        name: 'Notion Digest', request: 'Tóm tắt Notion',
        dueAt: new Date('2026-11-03T12:00:00.000Z'), trigger: 'scheduled',
        recurrence, digestConfig: config,
        digestConfigHash: configHash,
      }, 'conv-trunc-1', AbortSignal.timeout(2000));
      expect(outcome.state).toBe('digest_sent');
      expect(postedText.length).toBeLessThanOrEqual(3500);
      expect(postedText).toContain('Dữ liệu Notion đã được rút gọn');

      const tgSummary = summarizeSourceItems(
        'notion',
        { pages: manyPages.slice(0, 3), truncated: true },
        new Date('2026-11-03T12:00:00.000Z'),
      );
      expect(tgSummary.lines.join('\n')).toContain('Dữ liệu đã được rút gọn');
    });
  });
});
