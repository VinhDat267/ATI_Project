import { afterAll, beforeAll, expect, it } from 'vitest';
import request from 'supertest';
import { AIPlanner } from '@wap/planner';
import { StepRunner } from '@wap/executor';
import { createGmailToolAdapter, decryptCredentials } from '@wap/tool-adapters';
import { createApp } from '../../src/app.js';
import { generateAccessToken } from '../../src/auth/jwt.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { CredentialRepo } from '../../src/db/repositories/credential-repo.js';
import { GmailConnectionRepo } from '../../src/db/repositories/gmail-connection-repo.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { PlanRepo } from '../../src/db/repositories/plan-repo.js';
import { StepRepo } from '../../src/db/repositories/step-repo.js';
import { AdapterFactory } from '../../src/services/adapter-factory.js';
import { ExecutionService } from '../../src/services/execution-service.js';
import { ChatService } from '../../src/services/chat-service.js';
import { GmailTokenManager } from '../../src/services/gmail/token-manager.js';
import { GmailOAuthClient } from '../../src/services/gmail/oauth-client.js';
import { createGmailConnectionLookup } from '../../src/services/gmail/connection-reference.js';
import { createToolRuntimeFactory, gmailServiceRegistry, runtimeToolCatalog, runtimeGmailAdapter, mayFallbackToShared } from '../../src/config/gmail-tools-runtime.js';
import { createSandboxProvider } from '../../src/sandbox/scenarios.js';
import { startFakeGoogleGmail, type FakeGoogleGmail } from '../../../../scripts/fake-google-gmail.mjs';

const key = '0123456789abcdef0123456789abcdef', secret = 'gmail_tools_test_secret_at_least_32_characters';
let db: Awaited<ReturnType<typeof createMigratedSchema>>, google: FakeGoogleGmail, app: ReturnType<typeof createApp>;
let a: any, b: any, credentials: CredentialRepo, plans: PlanRepo, steps: StepRepo, tokens: GmailTokenManager;
const events: { event: string; payload: any }[] = [], owners: string[] = [];
const auth = (who: any) => `Bearer ${generateAccessToken(who, secret, who.sid).accessToken}`;
async function waitFor<T>(read: () => Promise<T | undefined | false>): Promise<T> {
  for (let i = 0; i < 100; i++) { const value = await read(); if (value) return value; await new Promise(r => setTimeout(r, 20)); }
  throw new Error('Timed out waiting for actual application work');
}
async function conversation(who: any) {
  const response = await request(app).post('/api/conversations').set('Authorization', auth(who)); expect(response.status).toBe(201); return response.body.conversation.id;
}
async function connect(who: any) {
  const start = await request(app).post('/api/connections/gmail/start').set('Authorization', auth(who)); expect(start.status).toBe(200);
  const authorize = await fetch(start.body.url, { redirect: 'manual' }); expect(authorize.status).toBe(302);
  const back = new URL(authorize.headers.get('location')!);
  const cookie = (start.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  const callback = await request(app).post('/api/connections/gmail/callback').set('Authorization', auth(who)).set('Cookie', cookie).send({ code: back.searchParams.get('code'), state: back.searchParams.get('state') });
  expect(callback.status).toBe(200); return credentials.getPersonalCredentials('gmail', who.id);
}
beforeAll(async () => {
  google = await startFakeGoogleGmail({ settings: { accessTokenPrefix: 'ya29.SENTINEL-GMAIL-TOKEN' } }); db = await createMigratedSchema('gmail_tools');
  a = await db.person('A'); b = await db.person('B'); credentials = new CredentialRepo(db.pool);
  const conversations = new ConversationRepo(db.pool), messages = new MessageRepo(db.pool); plans = new PlanRepo(db.pool); steps = new StepRepo(db.pool);
  const oauth = { clientId: 'gmail-test.apps.googleusercontent.com', clientSecret: 'fake-gmail-secret', redirectUri: 'http://127.0.0.1:5174/connections/gmail/callback', ...google.endpoints };
  tokens = new GmailTokenManager({ client: new GmailOAuthClient(oauth), credentials });
  const personal = new AdapterFactory({ credentialRepo: credentials, encryptionKey: key, gmailTokens: tokens,
    createGmailAdapter: ({ userId, tokens: provider }) => { owners.push(userId); return runtimeGmailAdapter('sandbox', provider, google.origin); } });
  const adapters = createToolRuntimeFactory('sandbox', (name, context) => personal.getAdapterForService(name, context));
  const planner = { processMessage: async (input: any) => new AIPlanner({ provider: createSandboxProvider('gmail'),
    toolCatalog: await runtimeToolCatalog('sandbox', credentials, key, { userId: input.actor.userId, gmailEnabled: true }), serviceRegistry: gmailServiceRegistry(true), searchMode: 'llm',
    gatherSearch: async ({ tool, args, signal, actor }) => (await adapters.getAdapterForService('gmail', { userId: actor?.userId, phase: 'planning' })).execute(tool, args, { signal }),
    requireGroundedResources: true,
  }).processMessage(input) };
  const chat = new ChatService({ msgRepo: messages, convRepo: conversations, planRepo: plans, planner: planner as any,
    eventEmitter: { emit(event, payload) { events.push({ event, payload }); } }, gmailConnection: createGmailConnectionLookup(credentials, key) });
  const execution = new ExecutionService({ planRepo: plans, stepRepo: steps, convRepo: conversations, adapterFactory: adapters });
  app = createApp({ jwtSecret: secret, userRepo: db.users, credentialRepo: credentials, encryptionKey: key, convRepo: conversations, msgRepo: messages, planRepo: plans, chatService: chat, executionService: execution,
    gmail: { enabled: true, oauth, repo: new GmailConnectionRepo(db.pool), onConnectionChanged: id => personal.clearPersonal(id) } });
});
afterAll(async () => { await google?.close(); await db?.close(); });
it('A connects through fake OAuth, plans with server labels/connections, approves over HTTP and runs own sandbox adapter', async () => {
  const own = await connect(a); const conv = await conversation(a);
  expect((await request(app).post(`/api/conversations/${conv}/messages`).set('Authorization', auth(a)).send({ content: 'Trả lời email họp, cc minh@example.com' })).status).toBe(202);
  const event = await waitFor(async () => events.find(e => e.event === 'plan_preview' && e.payload.conversationId === conv));
  expect(event.payload.plan.connections.gmail).toEqual({ credentialId: own!.id, email: 'gmail-owner@example.test' });
  expect(event.payload.resourceLabels).toMatchObject({ 'gmail-thread-1': 'Họp nhóm ATI', 'recipient:lan@example.com': 'thread:Họp nhóm ATI' });
  const row = (await plans.getPendingPlan(conv))!;
  expect(JSON.stringify(row.plan_json)).not.toContain('resourceLabels');
  const approve = await request(app).post(`/api/plans/${row.id}/approve`).set('Authorization', auth(a)).send({ planHash: row.plan_hash }); expect(approve.status).toBe(200);
  await waitFor(async () => (await plans.getPlan(row.id))?.status === 'completed');
  expect((await steps.listSteps(row.id))[0]).toMatchObject({ status: 'succeeded', output_json: { id: 'gmail-sandbox-reply', threadId: 'gmail-thread-1' } });
  expect(owners).toEqual([a.id]); expect(google.stats.writes).toBe(0); expect(google.stats.apiRequests).toHaveLength(0);
  expect(JSON.stringify(events)).not.toContain('SENTINEL-GMAIL-TOKEN'); expect(JSON.stringify(events)).not.toContain('1//fake-');
});
it('unconnected B is refused with Gmail in unavailableServices and receives no adapter', async () => {
  const conv = await conversation(b);
  expect((await request(app).post(`/api/conversations/${conv}/messages`).set('Authorization', auth(b)).send({ content: 'Trả lời email họp' })).status).toBe(202);
  const result = await waitFor(async () => events.find(e => e.event === 'refusal' && e.payload.conversationId === conv));
  expect(result.payload.unavailableServices).toEqual([{ id: 'gmail', name: 'Gmail' }]); expect(await plans.getPendingPlan(conv)).toBeNull(); expect(owners).toEqual([a.id]);
});
it('sandbox does not hide Gmail planner failures behind a shared write plan', () => {
  expect(mayFallbackToShared({ userMessage: 'Trả lời email', memory: {} as any }, true)).toBe(false);
  expect(mayFallbackToShared({ userMessage: 'Tiếp tục', history: [{ role: 'user', content: 'Gmail' }], memory: {} as any }, true)).toBe(false);
  expect(mayFallbackToShared({ userMessage: 'Tạo card Trello', memory: {} as any }, true)).toBe(true);
  expect(gmailServiceRegistry(false)).toHaveLength(8);
});
it('real PostgreSQL token manager refresh 503 fails a write before any Gmail API dispatch', async () => {
  google.settings.refresh = 'server_error';
  const record = (await credentials.getPersonalCredentials('gmail', a.id))!;
  const config = decryptCredentials(record.config, key) as { refreshToken: string };
  const provider = tokens.forConnection(a.id, record.id, config.refreshToken);
  const adapter = createGmailToolAdapter({ tokens: provider, baseUrl: google.origin });
  const runner = new StepRunner({ getAdapter: () => adapter });
  const result = await runner.executeStep({ id: 'send', tool: 'gmail.send_message', description: 'Send', dependsOn: [], args: { to: ['lan@example.com'], subject: 'S', body: 'B' } }, new Map());
  expect(result).toMatchObject({ status: 'failed', error: { category: 'SERVER_ERROR', details: { requestSent: false } } }); expect(google.stats.writes).toBe(0); expect(google.stats.refreshes).toBe(1);
  google.settings.refresh = 'ok';
});
