import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { WorkspaceRepo } from '../../src/db/repositories/workspace-repo.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const secret = 'slack_route_workspace_guard_secret_at_least_32_chars';
const encKey = '0123456789abcdef0123456789abcdef';

describe('Slack conversation & execution routes enforce workspace access guards', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let convRepo: ConversationRepo;
  let msgRepo: MessageRepo;
  let planRepo: PlanRepo;

  beforeAll(async () => {
    db = await createMigratedSchema('slack_route_ws_guards');
    convRepo = new ConversationRepo(db.pool);
    msgRepo = new MessageRepo(db.pool);
    planRepo = new PlanRepo(db.pool);
  });

  afterAll(async () => {
    await db?.close();
  });

  it('rejects org-scoped conversation on slack-read-plans, slack-write-plans, and slack-reconcile when workspace mode mismatches or membership is revoked', async () => {
    const owner = await db.person();
    const workspaceRepo = new WorkspaceRepo(db.pool);
    const ws = await workspaceRepo.create(owner.id, 'Audit Org');
    const wsId = ws.id;

    const orgConv = await convRepo.createConversation(owner.id, 'Org Slack Conv', {
      workspaceMode: 'organization',
      workspaceId: wsId,
    });

    const planRow = await planRepo.createPlan({
      convId: orgConv.id,
      planJson: {
        kind: 'plan',
        thinking: 'Create card',
        summary: 'Create card',
        warnings: [],
        steps: [
          {
            id: 'post',
            tool: 'trello.create_card',
            description: 'Create card',
            args: { listId: 'L1', title: 'Hi' },
            dependsOn: [],
          },
        ],
      },
      planText: 'plan-text',
      planHash: 'hash-1',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const handleSlackReadProposal = vi.fn(async () => ({ status: 202, messageId: 'm-read' }));
    const handleSlackWriteProposal = vi.fn(async () => ({ status: 202, messageId: 'm-write' }));
    const reconcileSlackPost = vi.fn(async () => ({ ok: true }));

    const app = createApp({
      jwtSecret: secret,
      encryptionKey: encKey,
      pool: db.pool,
      userRepo: db.users,
      workspaceRepo,
      convRepo,
      msgRepo,
      planRepo,
      chatService: {
        hasSlackReads: () => true,
        hasSlackWrites: () => true,
        handleSlackReadProposal,
        handleSlackWriteProposal,
      } as any,
      executionService: {
        planRepo,
        convRepo,
        reconcileSlackPost,
      } as any,
    });

    const bearer = `Bearer ${generateAccessToken(owner, secret, owner.sid).accessToken}`;
    const connId = randomUUID();

    // 1. Wrong workspace mode (personal header targeting an org conversation) -> denied BEFORE service runs
    const readWrongMode = await request(app)
      .post(`/api/conversations/${orgConv.id}/slack-read-plans`)
      .set('Authorization', bearer)
      .set('x-workspace-id', 'personal')
      .send({ content: 'Đọc kênh', connectionId: connId });
    expect([403, 404]).toContain(readWrongMode.status);
    expect(handleSlackReadProposal).not.toHaveBeenCalled();

    const writeWrongMode = await request(app)
      .post(`/api/conversations/${orgConv.id}/slack-write-plans`)
      .set('Authorization', bearer)
      .set('x-workspace-id', 'personal')
      .send({ content: 'Gửi tin', channel: 'C1', connectionId: connId });
    expect([403, 404]).toContain(writeWrongMode.status);
    expect(handleSlackWriteProposal).not.toHaveBeenCalled();

    const reconcileWrongMode = await request(app)
      .post(`/api/executions/${planRow.id}/steps/post/slack-reconcile`)
      .set('Authorization', bearer)
      .set('x-workspace-id', 'personal')
      .send({});
    expect([403, 404]).toContain(reconcileWrongMode.status);
    expect(reconcileSlackPost).not.toHaveBeenCalled();

    // 2. Revoked org membership -> denied even with matching organization workspace header
    await db.pool.query(
      `UPDATE workspace_members SET status = 'disabled' WHERE workspace_id = $1 AND user_id = $2`,
      [wsId, owner.id],
    );

    const readRevoked = await request(app)
      .post(`/api/conversations/${orgConv.id}/slack-read-plans`)
      .set('Authorization', bearer)
      .set('x-workspace-id', wsId)
      .send({ content: 'Đọc kênh', connectionId: connId });
    expect([403, 404]).toContain(readRevoked.status);
    expect(handleSlackReadProposal).not.toHaveBeenCalled();

    const reconcileRevoked = await request(app)
      .post(`/api/executions/${planRow.id}/steps/post/slack-reconcile`)
      .set('Authorization', bearer)
      .set('x-workspace-id', wsId)
      .send({});
    expect([403, 404]).toContain(reconcileRevoked.status);
    expect(reconcileSlackPost).not.toHaveBeenCalled();
  });
});
