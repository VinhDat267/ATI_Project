// Audit evidence, not acceptance tests. Assertions confirm defects at audited HEAD.
// Run from repository root: node --import tsx docs/audits/2026-09-29-v3-review/offline-probes.mjs
// HTTP is restricted to Supertest's local ephemeral server. All external transports are fixtures.
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../../apps/chat-api/src/app.ts';
import { generateTokens } from '../../../apps/chat-api/src/auth/jwt.ts';
import { validateEnv } from '../../../apps/chat-api/src/config/env.ts';
import { validatePlan } from '../../../packages/planner/src/validator.ts';
import { classifyIntent } from '../../../packages/planner/src/router.ts';
import { TRELLO_TOOLS, SLACK_TOOLS } from '../../../packages/tool-schemas/src/index.ts';
import { StepRunner } from '../../../packages/executor/src/runner.ts';
import { ExecutionController } from '../../../packages/executor/src/controller.ts';
import { TrelloAdapter, SlackAdapter } from '../../../packages/tool-adapters/src/index.ts';
import { ExecutionService } from '../../../apps/chat-api/src/services/execution-service.ts';
import { useChatStore } from '../../../apps/chat-web/src/store/chat-store.ts';
import { handleSSEEvent } from '../../../apps/chat-web/src/hooks/use-sse.ts';

const observations = [];
const record = (name, detail) => observations.push({ name, ...detail });
const secret = 'audit-only-secret-never-used-outside-this-process';
const app = createApp({ jwtSecret: secret });
const bypass = await request(app).get('/api/auth/me').set('Authorization', 'Bearer demo-token');
assert.equal(bypass.status, 200);
record('auth_bypass', { httpStatus: bypass.status, identity: bypass.body.user.id });

const env = validateEnv({ NODE_ENV: 'production' });
record('production_missing_env_accepted', {
  jwtDefaultAccepted: Boolean(env.JWT_SECRET), encryptionDefaultAccepted: Boolean(env.ENCRYPTION_KEY),
  missingGeminiKeyAccepted: env.GEMINI_API_KEY === '',
});

const tokenA = generateTokens({ id: 'user-a', email: 'a@example.test', name: 'A' }, secret).accessToken;
const isolatedApp = createApp({
  jwtSecret: secret,
  convRepo: { getConversation: async () => ({ id: 'conv-b', user_id: 'user-b' }) },
  msgRepo: { listMessages: async () => [{ id: 'msg-b', content: 'fixture owned by B' }] },
  chatService: { handleUserMessage: async () => ({ status: 202, messageId: 'new' }) },
});
const crossUser = await request(isolatedApp).get('/api/conversations/conv-b').set('Authorization', `Bearer ${tokenA}`);
assert.equal(crossUser.status, 200);
assert.equal(crossUser.body.conversation.user_id, 'user-b');
record('cross_user_read', { httpStatus: crossUser.status, requester: 'user-a', owner: crossUser.body.conversation.user_id });
const missingServices = await request(app).get('/api/services').set('Authorization', `Bearer ${tokenA}`);
assert.equal(missingServices.status, 404);
record('missing_service_routes', { httpStatus: missingServices.status });

const catalog = [...TRELLO_TOOLS, ...SLACK_TOOLS];
const step = { id: 's1', tool: 'trello.create_card', description: 'fixture', args: { listId: 'l1', title: 'x' }, dependsOn: [] };
const plan = (steps) => JSON.stringify({ kind: 'plan', thinking: 'fixture', summary: 'fixture', steps, warnings: [] });
for (const [name, steps] of [
  ['missing_required_args', [{ ...step, args: {} }]],
  ['nonexistent_dependency', [{ ...step, dependsOn: ['does-not-exist'] }]],
  ['nonexistent_output_property', [step, { ...step, id: 's2', tool: 'trello.add_member', args: { cardId: { $ref: 's1.output.doesNotExist' }, memberId: 'm1' }, dependsOn: ['s1'] }]],
  ['empty_plan', []],
]) {
  const result = validatePlan(plan(steps), catalog);
  assert.equal(result.valid, true);
  record('validator_accepts_' + name, { valid: result.valid });
}
const services = classifyIntent('Tạo task cập nhật homepage cho team frontend, deadline thứ 6, gán Minh, báo trên Slack');
assert.deepEqual(services, ['slack']);
record('demo_prompt_routes_out_trello', { services });

const asyncAdapterResult = await new StepRunner({
  getAdapter: async () => ({ execute: async () => ({ id: 'fixture' }) }),
}).executeStep(step, new Map());
assert.equal(asyncAdapterResult.status, 'unknown');
assert.match(asyncAdapterResult.error.message, /execute is not a function/);
record('async_factory_contract', { status: asyncAdapterResult.status, message: asyncAdapterResult.error.message });

for (const [name, Adapter, credentials, tool, args, response] of [
  ['trello', TrelloAdapter, { apiKey: 'fixture', token: 'fixture' }, 'trello.create_card', step.args, { id: 'c1', name: 'x', url: 'fixture', idList: 'l1' }],
  ['slack', SlackAdapter, { botToken: 'fixture' }, 'slack.send_message', { channel: 'c1', text: 'fixture' }, { ok: true, ts: '1', channel: 'c1' }],
]) {
  let receivedSignal = false;
  const adapter = new Adapter({ credentials, fetchFn: async (_url, init) => {
    receivedSignal = Boolean(init?.signal);
    await new Promise(resolve => setTimeout(resolve, 45));
    return new Response(JSON.stringify(response), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } });
  const result = await new StepRunner({ getAdapter: () => adapter }).executeStep({ ...step, tool, args }, new Map(), { timeoutMs: 10 });
  assert.equal(receivedSignal, false);
  assert.equal(result.status, 'success');
  record(name + '_timeout_not_forwarded', { receivedSignal, status: result.status, durationMs: result.durationMs, timeoutMs: 10 });
}

let methods = [];
const scopedAdapter = new TrelloAdapter({
  credentials: { apiKey: 'fixture', token: 'fixture' }, allowedScope: { boards: ['allowed-board'] },
  fetchFn: async (_url, init) => {
    methods.push(init?.method || 'GET');
    return new Response(JSON.stringify({ id: 'c-outside', name: 'x', idBoard: 'outside-board', idList: 'outside-list' }), { status: 200 });
  },
});
await scopedAdapter.execute('trello.create_card', { listId: 'outside-list', title: 'fixture' });
assert.deepEqual(methods, ['POST']);
record('trello_write_scope_not_checked', { requests: methods, parentBoardLookup: false });

let calls = 0;
const controller = new ExecutionController({ steps: [step], runner: { executeStep: async () => {
  calls++;
  await new Promise(resolve => setTimeout(resolve, 20));
  return { status: 'succeeded', output: { id: 'fixture' } };
} } });
await controller.runUntilPause();
await Promise.all([controller.retryStep('s1'), controller.retryStep('s1')]);
assert.equal(calls, 3);
record('completed_write_can_be_retried_concurrently', { adapterCalls: calls, expectedIfProtected: 1 });

const persistedEvents = [];
let statusUpdates = 0;
const execution = new ExecutionService({
  planRepo: {
    approvePlan: async () => true,
    getPlan: async () => ({ id: 'p', conv_id: 'c', plan_json: { steps: [step] } }),
    updatePlanStatus: async () => { statusUpdates++; },
  },
  stepRepo: { createStep: async () => ({ id: 'db-step' }), updateStepStatus: async () => { throw new Error('fixture DB failure'); } },
  adapterFactory: { getAdapterForService: () => ({ execute: async () => ({ id: 'c1' }) }) },
  sseManager: { emitEvent: (_c, name, data) => persistedEvents.push({ name, data }) },
});
await execution.approveAndStart('p', 'user-a');
await new Promise(resolve => setTimeout(resolve, 40));
const done = persistedEvents.find(e => e.name === 'exec_done');
assert.equal(done?.data.status, 'completed');
assert.equal(statusUpdates, 0);
record('completed_despite_step_persistence_failure', { clientStatus: done.data.status, planStatusUpdateCalls: statusUpdates });

useChatStore.getState().reset();
handleSSEEvent('text_start', '{}', 1);
handleSSEEvent('text_delta', JSON.stringify({ delta: 'hello' }), 2);
handleSSEEvent('text_delta', JSON.stringify({ delta: 'hello' }), 2);
handleSSEEvent('text_end', '{}', 3);
assert.equal(useChatStore.getState().streamingText, 'hellohello');
assert.equal(useChatStore.getState().isStreaming, true);
record('sse_duplicate_and_end_event', { text: useChatStore.getState().streamingText, isStreamingAfterTextEnd: useChatStore.getState().isStreaming });

console.log(JSON.stringify({ purpose: 'defect reproduction, not product acceptance', externalCalls: 0, observations }, null, 2));
