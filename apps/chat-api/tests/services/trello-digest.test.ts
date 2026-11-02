import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  evaluateTrelloDigestCandidate,
  computeTrelloDigestConfigHash,
} from '../../src/services/schedules/trello-digest-candidate.js';
import { createTrelloDigestRunner } from '../../src/services/schedules/trello-digest-runner.js';
import { summarizeSourceItems } from '../../src/services/schedules/telegram-digest-runner.js';
import { ScheduleService } from '../../src/services/schedules/schedule-service.js';
import { ScheduleRunner } from '../../src/services/schedules/schedule-runner.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

describe('Trello Automated Digest (Task 3: trello_digest & Telegram Trello enrichment)', () => {
  const userId = 'user-trello-1';
  const recurrence = { type: 'daily' as const, time: '08:30' };

  describe('1. evaluateTrelloDigestCandidate', () => {
    it('returns canAutoDigest: true when request reads Trello board and sends to an allowed Slack channel', async () => {
      const candidate = await evaluateTrelloDigestCandidate({
        userId,
        request: 'Mỗi sáng báo cáo các thẻ quá hạn trên bảng Frontend gửi vào kênh #dev',
        services: ['trello', 'slack'],
        recurrence,
        trelloConnection: async () => ({
          status: 'connected',
          connection: {
            credentialId: 'cred-trello-1',
            memberId: 'mem-1',
            username: 'alice_trello',
            boardIds: ['b1'],
          },
          memberBoards: [{ boardId: 'b1', boardName: 'Frontend' }],
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
        credentialId: 'cred-trello-1',
        trelloMemberId: 'mem-1',
        username: 'alice_trello',
        boards: [{ id: 'b1', name: 'Frontend' }],
        channelId: 'C_DEV',
        channelName: 'dev',
        dueSoonHours: 24,
      });
      expect(candidate.configHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects write-intent requests from auto_digest', async () => {
      const candidate = await evaluateTrelloDigestCandidate({
        userId,
        request: 'Mỗi sáng tạo thẻ mới trên bảng Frontend và báo vào kênh #dev',
        services: ['trello', 'slack'],
        recurrence,
        trelloConnection: async () => ({
          status: 'connected',
          connection: {
            credentialId: 'cred-trello-1',
            memberId: 'mem-1',
            username: 'alice_trello',
            boardIds: ['b1'],
          },
          memberBoards: [{ boardId: 'b1', boardName: 'Frontend' }],
        }),
      });

      expect(candidate.canAutoDigest).toBe(false);
      expect(candidate.disabledReason).toMatch(/không tự động tạo hoặc sửa/i);
    });
  });

  describe('2. createTrelloDigestRunner', () => {
    it('scans overdue, due-soon, and unassigned Trello cards, includes AI summary, and sends Slack digest', async () => {
      const config = {
        credentialId: 'cred-trello-1',
        trelloMemberId: 'mem-1',
        username: 'alice_trello',
        boards: [{ id: 'b1', name: 'Frontend' }],
        channelId: 'C_DEV',
        channelName: 'dev',
        dueSoonHours: 24,
      };
      const configHash = computeTrelloDigestConfigHash({ config, recurrence, userId });

      const slackSendSpy = vi.fn().mockResolvedValue({ ts: '1700000000.001' });
      const runner = createTrelloDigestRunner({
        pool: {
          query: vi.fn().mockResolvedValue({
            rowCount: 1,
            rows: [{ version: 1, status: 'active' }],
          }),
        } as any,
        trelloConnection: async () => ({
          status: 'connected',
          connection: {
            credentialId: 'cred-trello-1',
            memberId: 'mem-1',
            username: 'alice_trello',
            boardIds: ['b1'],
          },
        }),
        getAdapter: async (serviceName: string) => {
          if (serviceName === 'trello') {
            return {
              execute: vi.fn().mockResolvedValue([
                {
                  id: 'c_overdue',
                  name: 'Fix OAuth redirect bug',
                  url: 'https://trello.com/c/c_overdue',
                  listId: 'l1',
                  boardId: 'b1',
                  due: '2026-11-01T08:00:00.000Z',
                  dueComplete: false,
                  idMembers: ['m1'],
                },
                {
                  id: 'c_soon',
                  name: 'Release v3.2 staging',
                  url: 'https://trello.com/c/c_soon',
                  listId: 'l1',
                  boardId: 'b1',
                  due: '2026-11-02T18:00:00.000Z',
                  dueComplete: false,
                  idMembers: ['m2'],
                },
                {
                  id: 'c_unassigned',
                  name: 'Write user guide',
                  url: 'https://trello.com/c/c_unassigned',
                  listId: 'l2',
                  boardId: 'b1',
                  due: null,
                  dueComplete: false,
                  idMembers: [],
                },
              ]),
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
          return 'Cần ưu tiên xử lý thẻ Fix OAuth redirect bug đang quá hạn.';
        },
      });

      const outcome = await runner(
        {
          runId: 'run-1',
          scheduleId: 'sched-1',
          scheduleVersion: 1,
          userId,
          name: 'Báo cáo Trello sáng',
          request: 'Báo cáo Trello mỗi sáng',
          dueAt: new Date('2026-11-02T08:30:00.000Z'),
          trigger: 'scheduled',
          recurrence,
          digestConfig: config,
          digestConfigHash: configHash,
        },
        'conv-1',
        new AbortController().signal
      );

      expect(outcome.state).toBe('digest_sent');
      if (outcome.state === 'digest_sent') {
        expect(outcome.delivery).toEqual({
          channelId: 'C_DEV',
          channelName: 'dev',
          ts: '1700000000.001',
          counts: {
            overdueCards: 1,
            dueSoonCards: 1,
            unassignedCards: 1,
          },
        });
        expect(outcome.text).toContain('Bản tin Trello tự động của ATI');
        expect(outcome.text).toContain('Nhận xét AI:');
        expect(outcome.text).toContain('Fix OAuth redirect bug');
        expect(outcome.text).toContain('Release v3.2 staging');
        expect(outcome.text).toContain('Write user guide');
      }
      expect(slackSendSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('3. Telegram summarizeSourceItems for Trello', () => {
    it('formats Trello cards with overdue, due-soon, and unassigned badges', () => {
      const now = new Date('2026-11-02T08:30:00.000Z');
      const summary = summarizeSourceItems(
        'trello',
        [
          {
            id: 'c1',
            name: 'Sửa lỗi thanh toán',
            due: '2026-11-01T10:00:00.000Z',
            dueComplete: false,
            idMembers: ['m1'],
          },
          {
            id: 'c2',
            name: 'Chuẩn bị demo sprint',
            due: '2026-11-02T15:00:00.000Z',
            dueComplete: false,
            idMembers: [],
          },
        ],
        now
      );

      expect(summary.count).toBe(2);
      expect(summary.lines[0]).toContain('🚨 [Quá hạn]');
      expect(summary.lines[0]).toContain('Sửa lỗi thanh toán');
      expect(summary.lines[1]).toContain('⏰ [Sắp đến hạn]');
      expect(summary.lines[1]).toContain('(chưa gán)');
    });
  });

  describe('4. PostgreSQL ScheduleService + ScheduleRunner integration for trello_digest', () => {
    let db: Awaited<ReturnType<typeof createMigratedSchema>>;

    beforeAll(async () => {
      db = await createMigratedSchema('trello_digest_e2e');
    });

    afterAll(async () => {
      await db?.close();
    });

    it('confirms a trello_digest proposal in PostgreSQL and executes it on ScheduleRunner.tick()', async () => {
      const user = await db.person('TrelloDigestOwner');
      const convRes = await db.pool.query(
        "INSERT INTO conversations(user_id, status, title) VALUES($1, 'chatting', 'Lịch Trello') RETURNING id",
        [user.id]
      );
      const convId = convRes.rows[0].id as string;

      const config = {
        credentialId: 'cred-trello-1',
        trelloMemberId: 'mem-1',
        username: 'alice_trello',
        boards: [{ id: 'b1', name: 'Frontend' }],
        channelId: 'C_DEV',
        channelName: 'dev',
        dueSoonHours: 24,
      };
      const configHash = computeTrelloDigestConfigHash({
        config,
        recurrence,
        userId: user.id,
      });

      const proposalMeta = {
        type: 'schedule_proposal',
        proposal: {
          kind: 'schedule',
          action: 'create',
          name: 'Báo cáo Trello sáng',
          request: 'Mỗi sáng báo cáo các thẻ quá hạn trên bảng Frontend gửi vào kênh #dev',
          recurrence,
          summary: 'Tạo lịch báo cáo Trello mỗi sáng lúc 08:30',
        },
        scheduleId: null,
        baseVersion: null,
        services: ['trello', 'slack'],
        nextRuns: ['2026-11-03T01:30:00.000Z'],
        previous: null,
        digestCandidate: {
          canAutoDigest: true,
          config,
          configHash,
        },
      };

      const msgRes = await db.pool.query(
        "INSERT INTO messages(conv_id, role, content, metadata) VALUES($1, 'assistant', 'Đề xuất lịch', $2::jsonb) RETURNING id",
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
        now: new Date('2026-11-02T01:00:00.000Z'),
        approvalMode: 'auto_digest',
      });

      expect(confirmed.schedule.kind).toBe('trello_digest');
      expect(confirmed.schedule.approvalMode).toBe('auto_digest');
      expect(confirmed.schedule.digest).toEqual({
        config,
        approvedAt: '2026-11-02T01:00:00.000Z',
      });

      const runner = new ScheduleRunner({
        pool: db.pool,
        timeZone: 'Asia/Ho_Chi_Minh',
        now: () => new Date('2026-11-02T01:31:00.000Z'),
        planRun: async () => {
          throw new Error('Should not call planRun for trello_digest');
        },
        runTrelloDigest: createTrelloDigestRunner({
          pool: db.pool,
          trelloConnection: async () => ({
            status: 'connected',
            connection: {
              credentialId: 'cred-trello-1',
              memberId: 'mem-1',
              username: 'alice_trello',
              boardIds: ['b1'],
            },
          }),
          getAdapter: async (serviceName: string) => {
            if (serviceName === 'trello') {
              return {
                execute: vi.fn().mockResolvedValue([
                  {
                    id: 'c_overdue',
                    name: 'Sửa lỗi OAuth Trello',
                    url: 'https://trello.com/c/c_overdue',
                    listId: 'l1',
                    boardId: 'b1',
                    due: '2026-11-01T00:00:00.000Z',
                    dueComplete: false,
                    idMembers: [],
                  },
                ]),
              };
            }
            if (serviceName === 'slack') {
              return {
                execute: vi.fn().mockImplementation(async (tool: string) => {
                  if (tool === 'slack.search_channels') return [{ id: 'C_DEV', name: 'dev' }];
                  if (tool === 'slack.send_message') return { ts: '1700000009.001' };
                }),
              };
            }
            return null;
          },
        }),
        recordState: (client, row, now) => service.recordState(client, row, now),
      });

      await runner.tick();

      const runs = await service.listRuns(
        user.id,
        confirmed.schedule.id,
        5,
        new Date('2026-11-02T01:32:00.000Z')
      );
      expect(runs).toHaveLength(1);
      expect(runs[0]?.state).toBe('digest_sent');
      expect(runs[0]?.delivery).toEqual({
        channelId: 'C_DEV',
        channelName: 'dev',
        ts: '1700000009.001',
        counts: {
          overdueCards: 1,
          dueSoonCards: 0,
          unassignedCards: 1,
        },
      });
    });
  });
});
