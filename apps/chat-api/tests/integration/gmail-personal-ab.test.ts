import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { encryptCredentials } from '@wap/tool-adapters';
import { GMAIL_TOOLS, type PlanResponse } from '@wap/tool-schemas';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { StepRepo } from '../../src/db/repositories/step-repo.js';
import { AdapterFactory, type AdapterContext } from '../../src/services/adapter-factory.js';
import { ExecutionService } from '../../src/services/execution-service.js';
import { getConfiguredToolCatalog, getToolCatalogFor } from '../../src/services/registered-services.js';
import { GmailTokenManager } from '../../src/services/gmail/token-manager.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

const key = '0123456789abcdef0123456789abcdef';
type Person = Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;
interface Call { owner: string; tool: string; args: Record<string, unknown> }

describe('personal Gmail for two members A and B (spec 6.2)', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>, credentials: CredentialRepo, plans: PlanRepo, steps: StepRepo, conversations: ConversationRepo;
  let a: Person, b: Person, calls: Call[], created: string[], contexts: Array<{ service: string; context?: AdapterContext }>;
  const tokens = () => new GmailTokenManager({ client: { refresh: async () => { throw new Error('no refresh in this test'); } }, credentials });
  const factory = () => new AdapterFactory({
    credentialRepo: credentials, encryptionKey: key, gmailTokens: tokens(),
    createGmailAdapter: ({ userId }) => {
      created.push(userId);
      return { execute: async (tool: string, args: Record<string, unknown>) => { calls.push({ owner: userId, tool, args }); return { id: `m-${calls.length}`, threadId: 't-1' }; } };
    },
  });
  const connect = (who: Person, email: string) => credentials.saveCredentials('gmail',
    encryptCredentials({ refreshToken: `1//fake-${randomUUID()}`, email, scopes: ['https://www.googleapis.com/auth/gmail.modify'], connectedAt: new Date().toISOString() }, key), who.id);
  const send = (id: string): PlanResponse['steps'][number] => ({ id, tool: 'gmail.send_message', description: 'Send', args: { to: ['a@example.com'], subject: 'S', body: 'B' }, dependsOn: [] });
  const storePlan = async (owner: Person, plan: PlanResponse) => {
    const conv = await conversations.createConversation(owner.id);
    const text = JSON.stringify(plan);
    return plans.createPlan({ convId: conv.id, planJson: plan, planText: text, planHash: createHash('sha256').update(text).digest('hex'), expiresAt: new Date(Date.now() + 600_000) });
  };
  const service = (adapterFactory = factory()) => new ExecutionService({ planRepo: plans, stepRepo: steps, convRepo: conversations, adapterFactory: {
    getAdapterForService: (name: string, context?: AdapterContext) => { contexts.push({ service: name, context }); return adapterFactory.getAdapterForService(name, context); },
  } });
  const settle = async (planId: string) => {
    for (let i = 0; i < 100; i++) {
      const status = (await plans.getPlan(planId))!.status;
      if (!['approved', 'executing'].includes(status)) return status;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('execution did not settle');
  };

  beforeAll(async () => {
    db = await createMigratedSchema('gmail_ab');
    credentials = new CredentialRepo(db.pool); plans = new PlanRepo(db.pool); steps = new StepRepo(db.pool); conversations = new ConversationRepo(db.pool);
  });
  beforeEach(async () => {
    await db.pool.query("DELETE FROM service_credentials WHERE service='gmail'");
    a = await db.person('A'); b = await db.person('B');
    calls = []; created = []; contexts = [];
  });
  afterAll(async () => { await db?.close(); });

  describe('catalog per caller', () => {
    it("adds Gmail tools only for a caller with an active connection and only when Gmail is enabled", async () => {
      const own = await connect(a, 'a@example.test');
      const shared = await getConfiguredToolCatalog(credentials, key);
      expect(await getToolCatalogFor(credentials, key, { userId: a.id, gmailEnabled: false })).toEqual(shared);
      const forA = await getToolCatalogFor(credentials, key, { userId: a.id, gmailEnabled: true });
      expect(forA.filter((t) => t.service === 'gmail').map((t) => t.name)).toEqual(GMAIL_TOOLS.map((t) => t.name));
      expect(await getToolCatalogFor(credentials, key, { userId: b.id, gmailEnabled: true })).toEqual(shared);
      expect(await getToolCatalogFor(credentials, key, { gmailEnabled: true })).toEqual(shared);
      await credentials.markReconnectRequired('gmail', a.id, own.id);
      expect(await getToolCatalogFor(credentials, key, { userId: a.id, gmailEnabled: true })).toEqual(shared);
    });
  });

  describe('AdapterFactory', () => {
    it("never hands B the adapter cached for A, and caches per person and credential", async () => {
      await connect(a, 'a@example.test');
      const adapters = factory();
      const forA = await adapters.getAdapterForService('gmail', { userId: a.id, phase: 'planning' });
      expect(await adapters.getAdapterForService('gmail', { userId: a.id, phase: 'planning' })).toBe(forA);
      await expect(adapters.getAdapterForService('gmail', { userId: b.id, phase: 'planning' })).rejects.toMatchObject({ category: 'AUTH_ERROR' });
      await expect(adapters.getAdapterForService('gmail', { phase: 'planning' })).rejects.toMatchObject({ category: 'AUTH_ERROR' });
      await expect(adapters.getAdapterForService('gmail')).rejects.toMatchObject({ category: 'AUTH_ERROR' });
      await connect(b, 'b@example.test');
      const forB = await adapters.getAdapterForService('gmail', { userId: b.id, phase: 'planning' });
      expect(forB).not.toBe(forA);
      expect(created).toEqual([a.id, b.id]);
      // Reconnecting (a new credential id) never reuses the adapter built for the old one.
      await connect(a, 'a@example.test');
      expect(await adapters.getAdapterForService('gmail', { userId: a.id, phase: 'planning' })).not.toBe(forA);
    });

    it('checks the previewed credential before building an execution adapter', async () => {
      const own = await connect(a, 'a@example.test');
      const adapters = factory();
      const previewed = { gmail: { credentialId: own.id, email: 'a@example.test' } };
      await expect(adapters.getAdapterForService('gmail', { userId: a.id, phase: 'execution', connections: previewed })).resolves.toBeTruthy();
      for (const connections of [undefined, {}, { gmail: { credentialId: randomUUID(), email: 'a@example.test' } }]) {
        await expect(adapters.getAdapterForService('gmail', { userId: a.id, phase: 'execution', connections }))
          .rejects.toMatchObject({ category: 'AUTH_ERROR', message: expect.stringContaining('Kết nối Gmail đã thay đổi') });
      }
      // A's previewed reference does not unlock B.
      await expect(adapters.getAdapterForService('gmail', { userId: b.id, phase: 'execution', connections: previewed })).rejects.toMatchObject({ category: 'AUTH_ERROR' });
      await credentials.markReconnectRequired('gmail', a.id, own.id);
      await expect(adapters.getAdapterForService('gmail', { userId: a.id, phase: 'execution', connections: previewed })).rejects.toMatchObject({ category: 'AUTH_ERROR' });
      await expect(adapters.getAdapterForService('gmail', { userId: a.id, phase: 'planning' })).rejects.toMatchObject({ category: 'AUTH_ERROR' });
    });

    it('reports an unreadable stored connection as AUTH_ERROR, never as a network failure', async () => {
      const broken = await credentials.saveCredentials('gmail', 'v1:not-a-valid-ciphertext', a.id);
      await expect(factory().getAdapterForService('gmail', { userId: a.id, phase: 'execution', connections: { gmail: { credentialId: broken.id, email: 'a@example.test' } } }))
        .rejects.toMatchObject({ category: 'AUTH_ERROR' });
      expect(created).toEqual([]);
    });

    it('drops only one person when clearPersonal is called', async () => {
      await connect(a, 'a@example.test'); await connect(b, 'b@example.test');
      const adapters = factory();
      const forA = await adapters.getAdapterForService('gmail', { userId: a.id, phase: 'planning' });
      const forB = await adapters.getAdapterForService('gmail', { userId: b.id, phase: 'planning' });
      adapters.clearPersonal(a.id);
      expect(await adapters.getAdapterForService('gmail', { userId: a.id, phase: 'planning' })).not.toBe(forA);
      expect(await adapters.getAdapterForService('gmail', { userId: b.id, phase: 'planning' })).toBe(forB);
    });
  });

  describe('ExecutionService', () => {
    it("runs Gmail steps as the conversation owner with the plan's previewed connection", async () => {
      const own = await connect(a, 'a@example.test');
      const plan = await storePlan(a, { kind: 'plan', thinking: 't', summary: 's', warnings: [], steps: [send('s1')], connections: { gmail: { credentialId: own.id, email: 'a@example.test' } } });
      expect((await service().approveAndStart(plan.id, a.id)).success).toBe(true);
      expect(await settle(plan.id)).toBe('completed');
      expect(calls).toEqual([{ owner: a.id, tool: 'gmail.send_message', args: { to: ['a@example.com'], subject: 'S', body: 'B' } }]);
      const gmail = contexts.filter((c) => c.service === 'gmail');
      expect(gmail.length).toBeGreaterThan(0);
      for (const { context } of gmail) expect(context).toEqual({ userId: a.id, phase: 'execution', connections: { gmail: { credentialId: own.id, email: 'a@example.test' } } });
    });

    it.each([['another Google account', 'other@example.test'], ['the same address again', 'a@example.test']])(
      'stops at the Gmail step with AUTH_ERROR when A reconnects with %s between preview and approval', async (_label, email) => {
        const own = await connect(a, 'a@example.test');
        const plan = await storePlan(a, { kind: 'plan', thinking: 't', summary: 's', warnings: [], steps: [send('s1')], connections: { gmail: { credentialId: own.id, email: 'a@example.test' } } });
        await connect(a, email);
        expect((await service().approveAndStart(plan.id, a.id)).success).toBe(true);
        expect(await settle(plan.id)).not.toBe('completed');
        const [row] = await steps.listSteps(plan.id);
        expect(row).toMatchObject({ status: 'failed' });
        expect(row!.error_json).toMatchObject({ category: 'AUTH_ERROR' });
        expect(calls).toEqual([]);
      });

    it('keeps checking connections.gmail when recovery runs on a fresh service after a restart', async () => {
      const own = await connect(a, 'a@example.test');
      const plan = await storePlan(a, { kind: 'plan', thinking: 't', summary: 's', warnings: [], steps: [send('s1'), { ...send('s2'), dependsOn: ['s1'] }],
        connections: { gmail: { credentialId: own.id, email: 'a@example.test' } } });
      expect(await plans.approvePlan(plan.id, plan.plan_hash, a.id)).toBe(true);
      const first = await steps.createStep({ planId: plan.id, stepId: 's1', tool: 'gmail.send_message', argsJson: send('s1').args, requestedBy: a.id });
      const second = await steps.createStep({ planId: plan.id, stepId: 's2', tool: 'gmail.send_message', argsJson: send('s2').args, requestedBy: a.id });
      await steps.updateStepStatus(first.id, 'running'); await steps.updateStepStatus(first.id, 'succeeded', { id: 'm-1', threadId: 't-1' });
      await steps.updateStepStatus(second.id, 'running'); await steps.updateStepStatus(second.id, 'failed', null, { category: 'NETWORK', message: 'read timeout' });
      await plans.updatePlanStatus(plan.id, 'partial');

      await connect(a, 'a@example.test');
      await service().retryStep(plan.id, 's2', a.id);
      expect(calls).toEqual([]);
      expect((await steps.listSteps(plan.id)).find((row) => row.step_id === 's2')!.error_json).toMatchObject({ category: 'AUTH_ERROR' });
      for (const { context } of contexts.filter((c) => c.service === 'gmail')) {
        expect(context).toMatchObject({ userId: a.id, phase: 'execution', connections: { gmail: { credentialId: own.id } } });
      }
    });
  });
});
