import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ALL_TOOLS, GITHUB_TOOLS } from '@wap/tool-schemas';
import { AIPlanner, MockLLMProvider } from '@wap/planner';
import { createApp } from '../../../src/app.js';
import { generateAccessToken } from '../../../src/auth/jwt.js';
import { ChatService } from '../../../src/services/chat-service.js';
import { ConversationRepo } from '../../../src/db/repositories/conversation-repo.js';
import { MessageRepo } from '../../../src/db/repositories/message-repo.js';
import { PlanRepo } from '../../../src/db/repositories/plan-repo.js';
import { ScheduleRepo } from '../../../src/db/repositories/schedule-repo.js';
import { ScheduleService } from '../../../src/services/schedules/schedule-service.js';
import { computeDigestConfigHash } from '../../../src/services/schedules/github-digest-candidate.js';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';

const VN = 'Asia/Ho_Chi_Minh';
const NOW = new Date('2026-10-25T02:00:00.000Z');
const secret = 'github_digest_proposal_test_secret_at_least_32_characters';

type Db = Awaited<ReturnType<typeof createMigratedSchema>>;
type Person = Awaited<ReturnType<Db['person']>>;

const TERMINAL = ['schedule_proposal', 'plan_preview', 'refusal', 'clarification', 'answer', 'error'];

describe('Task 7: GitHub digest schedule proposal and approvalMode confirmation on PostgreSQL', () => {
  let db: Db;
  let owner: Person;
  let provider: MockLLMProvider;
  let events: Array<{ event: string; payload: any }>;
  let messages: MessageRepo;
  let conversations: ConversationRepo;
  let plans: PlanRepo;
  let schedules: ScheduleService;
  let app: ReturnType<typeof createApp>;

  const bearer = (who: Person) => `Bearer ${generateAccessToken(who, secret, who.sid).accessToken}`;

  const createChat = () =>
    new ChatService({
      msgRepo: messages,
      convRepo: conversations,
      planRepo: plans,
      eventEmitter: { emit: (event, payload) => events.push({ event, payload }) },
      planner: new AIPlanner({
        provider,
        toolCatalog: [...ALL_TOOLS.filter((t) => t.service !== 'github'), ...GITHUB_TOOLS],
        schedules: true,
        now: () => NOW,
        timeZone: VN,
        requireGroundedResources: false,
        searchMode: 'regex',
        gatherSearch: async ({ tool }) => {
          if (tool === 'slack.search_channels') {
            return [{ id: 'C0123456789', name: 'team' }];
          }
          if (tool === 'github.search_repos') {
            return [{ id: '101', fullName: 'nhom/ati', name: 'ati' }];
          }
          return [];
        },
      }),
      githubConnection: async () => ({
        status: 'connected',
        connection: {
          credentialId: 'cred-gh-1',
          githubUserId: '1001',
          login: 'octocat',
          repos: ['nhom/ati'],
        },
        teamRepos: [{ repoId: '101', fullName: 'nhom/ati', name: 'ati' }],
        memberRepos: [{ repoId: '101', fullName: 'nhom/ati', name: 'ati' }],
      }),
      getAdapter: async (serviceName: string) => {
        if (serviceName === 'slack') {
          return {
            execute: async (tool: string) => {
              if (tool === 'slack.search_channels') {
                return [{ id: 'C0123456789', name: 'team' }];
              }
              return [];
            },
          };
        }
        return null;
      },
      schedules: { repo: new ScheduleRepo(db.pool, VN), timeZone: VN, now: () => NOW },
    });

  const send = async (convId: string, text: string, service = createChat()) => {
    const before = events.filter((e) => TERMINAL.includes(e.event)).length;
    await service.handleUserMessage({ conversationId: convId, userId: owner.id, content: text });
    for (let i = 0; i < 200 && events.filter((e) => TERMINAL.includes(e.event)).length === before; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    return events.filter((e) => TERMINAL.includes(e.event)).at(-1)!;
  };

  const latestProposal = async (convId: string) =>
    (
      await db.pool.query(
        "SELECT id, role, content, metadata FROM messages WHERE conv_id=$1 AND metadata->>'type'=$2 ORDER BY created_at DESC, id DESC LIMIT 1",
        [convId, 'schedule_proposal'],
      )
    ).rows[0];

  beforeAll(async () => {
    db = await createMigratedSchema('github_digest_proposal');
    messages = new MessageRepo(db.pool);
    conversations = new ConversationRepo(db.pool);
    plans = new PlanRepo(db.pool);
    schedules = new ScheduleService({ pool: db.pool, timeZone: VN });
  });

  beforeEach(async () => {
    owner = await db.person('Chủ lịch');
    provider = new MockLLMProvider();
    events = [];
    app = createApp({
      jwtSecret: secret,
      userRepo: db.users,
      schedules: {
        service: schedules,
        clock: () => NOW,
      },
    } as any);
  });

  afterAll(async () => {
    await db?.close();
  });

  it('marks digestCandidate.canAutoDigest=true for a read-only GitHub -> Slack digest schedule and confirms auto_digest vs manual', async () => {
    const convAuto = (await conversations.createConversation(owner.id)).id;
    provider.setPlanResponses([
      {
        kind: 'schedule',
        action: 'create',
        name: 'Bản tin GitHub sáng',
        request: 'Gửi bản tin GitHub repo nhom/ati lên Slack #team',
        recurrence: { type: 'daily', time: '08:00' },
        summary: 'Mỗi sáng 8 giờ, gửi bản tin GitHub repo nhom/ati lên Slack #team.',
      },
    ]);

    await send(convAuto, 'Mỗi sáng 8 giờ, gửi bản tin GitHub repo nhom/ati lên Slack #team');
    const proposalAuto = await latestProposal(convAuto);
    expect(proposalAuto.metadata.digestCandidate).toMatchObject({
      canAutoDigest: true,
      config: {
        credentialId: 'cred-gh-1',
        githubUserId: '1001',
        login: 'octocat',
        repos: ['nhom/ati'],
        channelId: 'C0123456789',
        channelName: 'team',
        staleDays: 2,
      },
    });
    expect(typeof proposalAuto.metadata.digestCandidate.configHash).toBe('string');

    // Confirm with approvalMode: 'auto_digest'
    const confirmAutoRes = await request(app)
      .post(`/api/conversations/${convAuto}/schedule-proposals/${proposalAuto.id}/confirm`)
      .set('Authorization', bearer(owner))
      .send({ approvalMode: 'auto_digest' });
    expect(confirmAutoRes.status).toBe(200);
    expect(confirmAutoRes.body.schedule.kind).toBe('github_digest');
    expect(confirmAutoRes.body.schedule.digest.config).toEqual(proposalAuto.metadata.digestCandidate.config);

    const dbRowAuto = (await db.pool.query('SELECT kind, digest_config, digest_config_hash, digest_approved_at FROM schedules WHERE id=$1', [confirmAutoRes.body.schedule.id])).rows[0];
    expect(dbRowAuto.kind).toBe('github_digest');
    expect(dbRowAuto.digest_config_hash).toBe(proposalAuto.metadata.digestCandidate.configHash);
    expect(dbRowAuto.digest_approved_at).toBeTruthy();

    // Confirm another identical proposal with approvalMode: 'manual' (default)
    const convManual = (await conversations.createConversation(owner.id)).id;
    provider.setPlanResponses([
      {
        kind: 'schedule',
        action: 'create',
        name: 'Bản tin GitHub duyệt tay',
        request: 'Gửi bản tin GitHub repo nhom/ati lên Slack #team',
        recurrence: { type: 'daily', time: '08:00' },
        summary: 'Mỗi sáng 8 giờ, gửi bản tin GitHub repo nhom/ati lên Slack #team.',
      },
    ]);
    await send(convManual, 'Mỗi sáng 8 giờ, gửi bản tin GitHub repo nhom/ati lên Slack #team');
    const proposalManual = await latestProposal(convManual);
    const confirmManualRes = await request(app)
      .post(`/api/conversations/${convManual}/schedule-proposals/${proposalManual.id}/confirm`)
      .set('Authorization', bearer(owner))
      .send({ approvalMode: 'manual' });
    expect(confirmManualRes.status).toBe(200);
    expect([undefined, 'plan']).toContain(confirmManualRes.body.schedule.kind);
    const dbRowManual = (await db.pool.query('SELECT kind, digest_config, digest_config_hash, digest_approved_at FROM schedules WHERE id=$1', [confirmManualRes.body.schedule.id])).rows[0];
    expect(dbRowManual.kind).toBe('plan');
    expect(dbRowManual.digest_config).toBeNull();
  });

  it('sets canAutoDigest=false with Vietnamese disabledReason and returns 409 AUTO_DIGEST_NOT_ALLOWED when schedule writes to Trello or GitHub', async () => {
    const convId = (await conversations.createConversation(owner.id)).id;
    provider.setPlanResponses([
      {
        kind: 'schedule',
        action: 'create',
        name: 'Đồng bộ issue sang Trello',
        request: 'Tìm issue mới trên repo nhom/ati, tạo thẻ Trello và báo Slack #team',
        recurrence: { type: 'daily', time: '08:00' },
        summary: 'Mỗi sáng 8 giờ, tìm issue mới trên repo nhom/ati, tạo thẻ Trello và báo Slack #team.',
      },
    ]);

    await send(convId, 'Mỗi sáng 8 giờ, tìm issue mới trên repo nhom/ati, tạo thẻ Trello và báo Slack #team');
    const proposal = await latestProposal(convId);
    expect(proposal.metadata.digestCandidate).toMatchObject({
      canAutoDigest: false,
    });
    expect(proposal.metadata.digestCandidate.disabledReason).toContain('Chỉ bật được khi lịch chỉ đọc GitHub');

    const confirmRes = await request(app)
      .post(`/api/conversations/${convId}/schedule-proposals/${proposal.id}/confirm`)
      .set('Authorization', bearer(owner))
      .send({ approvalMode: 'auto_digest' });
    expect(confirmRes.status).toBe(409);
    expect(confirmRes.body.error.code).toBe('AUTO_DIGEST_NOT_ALLOWED');
  });

  it('recomputes digest_config_hash when updating recurrence on an existing github_digest schedule', async () => {
    const convId = (await conversations.createConversation(owner.id)).id;
    provider.setPlanResponses([
      {
        kind: 'schedule',
        action: 'create',
        name: 'Bản tin GitHub sáng',
        request: 'Gửi bản tin GitHub repo nhom/ati lên Slack #team',
        recurrence: { type: 'daily', time: '08:00' },
        summary: 'Mỗi sáng 8 giờ, gửi bản tin GitHub repo nhom/ati lên Slack #team.',
      },
    ]);
    await send(convId, 'Mỗi sáng 8 giờ, gửi bản tin GitHub repo nhom/ati lên Slack #team');
    const firstProposal = await latestProposal(convId);
    const createdRes = await request(app)
      .post(`/api/conversations/${convId}/schedule-proposals/${firstProposal.id}/confirm`)
      .set('Authorization', bearer(owner))
      .send({ approvalMode: 'auto_digest' });
    expect(createdRes.status).toBe(200);
    const scheduleId = createdRes.body.schedule.id;

    // Update recurrence to 08:30
    provider.setPlanResponses([
      {
        kind: 'schedule',
        action: 'update',
        name: 'Bản tin GitHub sáng',
        request: 'Gửi bản tin GitHub repo nhom/ati lên Slack #team',
        recurrence: { type: 'daily', time: '08:30' },
        summary: 'Đổi sang 8 giờ 30 sáng mỗi ngày.',
      },
    ]);
    await send(convId, 'Đổi sang 8 giờ 30');
    const updateProposal = await latestProposal(convId);
    const updatedRes = await request(app)
      .post(`/api/conversations/${convId}/schedule-proposals/${updateProposal.id}/confirm`)
      .set('Authorization', bearer(owner))
      .send({ approvalMode: 'auto_digest' });
    expect(updatedRes.status).toBe(200);
    expect(updatedRes.body.schedule.version).toBe(2);
    expect(updatedRes.body.schedule.kind).toBe('github_digest');

    const dbRow = (await db.pool.query('SELECT kind, digest_config, digest_config_hash, recurrence FROM schedules WHERE id=$1', [scheduleId])).rows[0];
    expect(dbRow.kind).toBe('github_digest');
    const expectedHash = computeDigestConfigHash({
      config: dbRow.digest_config,
      recurrence: { type: 'daily', time: '08:30' },
      userId: owner.id,
    });
    expect(dbRow.digest_config_hash).toBe(expectedHash);
  });
});
