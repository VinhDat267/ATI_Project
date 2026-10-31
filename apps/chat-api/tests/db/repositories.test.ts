import { afterAll,beforeAll,describe, it, expect, vi } from 'vitest';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import {
  PlanRepo,
  ConversationRepo,
  MessageRepo,
  StepRepo,
  CredentialRepo,
} from '../../src/db/repositories/index.js';

describe('apps/chat-api (Task 7: Database Repositories with Optimistic Locking)', () => {
  let db:Awaited<ReturnType<typeof createMigratedSchema>>;
  beforeAll(async()=>{db=await createMigratedSchema('repo_atomic_guards');});
  afterAll(async()=>{await db?.close();});
  async function realPlan(){
    const owner=await db.person(),conv=await new ConversationRepo(db.pool).createConversation(owner.id),repo=new PlanRepo(db.pool);
    const plan=await repo.createPlan({convId:conv.id,planJson:{steps:[]},planText:'{"steps":[]}',planHash:'hash123',expiresAt:new Date(Date.now()+600000)});
    return {owner,plan,repo};
  }
  describe('PlanRepo', () => {
    it('treats a malformed PostgreSQL UUID plan id as not found without querying', async () => {
      const query = vi.fn();
      const repo = new PlanRepo({ query } as any);
      await expect(repo.getPlan('khong-ton-tai')).resolves.toBeNull();
      expect(query).not.toHaveBeenCalled();
    });
    it('approves exactly once with real pending/hash/owner predicates under concurrent clients', async () => {
      const {owner,plan,repo}=await realPlan(),other=await db.person();
      expect(await repo.approvePlan(plan.id,'wrong-hash',owner.id)).toBe(false);
      expect(await repo.approvePlan(plan.id,'hash123',other.id)).toBe(false);
      const results=await Promise.all([repo.approvePlan(plan.id,'hash123',owner.id),repo.approvePlan(plan.id,'hash123',owner.id)]);
      expect(results.sort()).toEqual([false,true]);
      expect((await db.pool.query('SELECT status FROM plans WHERE id=$1',[plan.id])).rows[0].status).toBe('approved');
    });

    it('returns false when plan is already approved or not pending (optimistic lock protection)', async () => {
      const {owner,plan,repo}=await realPlan();
      for(const status of ['approved','rejected','superseded']){
        await db.pool.query('UPDATE plans SET status=$2 WHERE id=$1',[plan.id,status]);
        expect(await repo.approvePlan(plan.id,'hash123',owner.id)).toBe(false);
      }
      await db.pool.query("UPDATE plans SET status='pending',expires_at=now()-interval '1 second' WHERE id=$1",[plan.id]);
      expect(await repo.approvePlan(plan.id,'hash123',owner.id)).toBe(false);
    });

    it('creates a plan with deterministic hash and expiration', async () => {
      const mockQuery = vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [{ id: 'p1', plan_hash: 'hash123', status: 'pending' }],
      });
      const repo = new PlanRepo({ connect: async () => ({ query: mockQuery, release: () => undefined }) } as any);

      const expiresAt = new Date(Date.now() + 1800000);
      const plan = await repo.createPlan({
        convId: 'c1',
        planJson: { steps: [] },
        planText: '{"steps":[]}',
        planHash: 'hash123',
        expiresAt,
      });

      expect(plan.id).toBe('p1');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO plans'),
        expect.arrayContaining(['c1', 'hash123'])
      );
    });
  });

  describe('ConversationRepo', () => {
    it('treats malformed PostgreSQL UUID conversation ids as not found without querying', async () => {
      const query = vi.fn();
      const repo = new ConversationRepo({ query } as any);
      await expect(repo.getConversation('khong-ton-tai')).resolves.toBeNull();
      await expect(repo.renameConversation('khong-ton-tai', 'u1', 'Tên hợp lệ')).resolves.toBeNull();
      expect(query).not.toHaveBeenCalled();
    });
    it('creates and lists conversations for user', async () => {
      const mockQuery = vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('INSERT INTO conversations')) {
          return { rowCount: 1, rows: [{ id: 'conv-1', user_id: 'u1', status: 'chatting' }] };
        }
        return { rowCount: 1, rows: [{ id: 'conv-1', user_id: 'u1', status: 'chatting' }] };
      });
      const repo = new ConversationRepo({ query: mockQuery } as any);

      const created = await repo.createConversation('u1');
      expect(created.id).toBe('conv-1');

      const list = await repo.listConversations('u1');
      expect(list).toHaveLength(1);
    });
  });

  describe('MessageRepo', () => {
    it('creates and retrieves messages for conversation in chronological order', async () => {
      const mockQuery = vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('INSERT INTO messages')) {
          return { rowCount: 1, rows: [{ id: 'm1', role: 'user', content: 'hello' }] };
        }
        return { rowCount: 1, rows: [{ id: 'm1', role: 'user', content: 'hello' }] };
      });
      const repo = new MessageRepo({ query: mockQuery } as any);

      const msg = await repo.createMessage('c1', 'user', 'hello', { source: 'test' });
      expect(msg.id).toBe('m1');

      const history = await repo.listMessages('c1');
      expect(history).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC, id DESC'),
        ['c1', 100]
      );
    });
  });

  describe('StepRepo', () => {
    it('creates and updates execution step status', async () => {
      const {owner,plan}=await realPlan(),repo = new StepRepo(db.pool);

      const step = await repo.createStep({
        planId: plan.id,
        stepId: 'step_1',
        tool: 'trello.create_card',
        argsJson: { title: 'Test' },
        requestedBy: owner.id,
      });
      expect(step.status).toBe('pending');expect(step.args_json).toEqual({title:'Test'});

      const updated = await repo.updateStepStatus(step.id, 'succeeded', { id: 'card-1' });
      expect(updated.status).toBe('succeeded');expect((await repo.listSteps(plan.id))[0]?.output_json).toEqual({id:'card-1'});
    });
  });

  describe('CredentialRepo', () => {
    it('saves and retrieves encrypted credentials by service', async () => {
      const mockQuery = vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('INSERT INTO service_credentials')) {
          return { rowCount: 1, rows: [{ id: 'cred-1', service: 'trello', config: 'v1:...' }] };
        }
        return { rowCount: 1, rows: [{ id: 'cred-1', service: 'trello', config: 'v1:...' }] };
      });
      const repo = new CredentialRepo({ query: mockQuery, connect: async () => ({ query: mockQuery, release: () => undefined }) } as any);

      const saved = await repo.saveCredentials('trello', 'v1:enc...');
      expect(saved.service).toBe('trello');

      const retrieved = await repo.getCredentials('trello');
      expect(retrieved?.config).toBe('v1:...');
    });
  });
});
