import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SLACK_DERIVED_TARGET_KINDS, type SlackPolicyReference } from '@wap/tool-schemas';
import { createSlackReadEnvironment, TEST_ENV, type SlackReadEnvironment } from '../helpers/slack-private-read-fixture.js';
import { SlackDerivedLineageRepo } from '../../src/db/repositories/slack-derived-lineage-repo.js';
import { MessageRepo } from '../../src/db/repositories/message-repo.js';
import { SlackMessagePurgeConsumer } from '../../src/services/slack/slack-message-purge-consumer.js';
import { ChatService } from '../../src/services/chat-service.js';
import express from 'express';
import request from 'supertest';
import { createConversationRoutes } from '../../src/routes/conversation-routes.js';
import { ConversationRepo } from '../../src/db/repositories/conversation-repo.js';
import { messageOutputSelectors, memoryOutputSelectors, messageSelectorKind } from '../../src/services/slack/slack-message-selectors.js';

describe('message and working-memory writer to physical erasure, real PostgreSQL', () => {
  let env: SlackReadEnvironment, messages: MessageRepo;
  beforeAll(async () => {
    env = await createSlackReadEnvironment('slack_message_memory');
    messages = new MessageRepo(env.db.pool, new SlackDerivedLineageRepo(env.db.pool, env.policyService));
  });
  afterAll(async () => { await env?.close(); });
  async function fixture() {
    const owner = await env.addUser({ name: 'M2 fixture', workspaceId: `T${randomUUID()}`, actorId: `U${randomUUID()}` });
    const current = await env.consentRepo.getConsent(owner.binding.workspaceId, env.runtimeIdentity.providerId);
    await env.consentRepo.grantConsent({ workspaceId: owner.binding.workspaceId, providerId: env.runtimeIdentity.providerId,
      expectedRevision: current!.revision, policyVersion: 'v1.0.0', purposes: ['storage', 'manual_lookup', 'planning'], retentionDays: 14,
      organizationRepresentative: 'fixture', evidenceRef: 'FIXTURE', recordedBy: 'fixture' });
    const policy = await env.policyService.resolveSlackModelPolicy({ binding: owner.binding, purpose: 'storage', requestedRetentionDays: 7, env: TEST_ENV });
    if (!policy.allowed) throw new Error('fixture policy denied');
    const storagePolicyRef = policy.policyReference as SlackPolicyReference;
    const conv = (await env.db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [owner.person.id])).rows[0].id;
    const segments = [{ sourceRef: { binding: owner.binding, resourceType: 'message' as const, resourceId: JSON.stringify(['C_M2', '1730000000.000001']), revision: '1730000000.000001' },
      acquisitionPolicyRef: { ...storagePolicyRef, purpose: 'manual_lookup' as const, requestedRetentionDays: 0 }, storagePolicyRef,
      capturedAt: new Date().toISOString(), captureHash: 'a'.repeat(64) }];
    return { owner, conv, segments };
  }
  async function invalidate(f: Awaited<ReturnType<typeof fixture>>) {
    const key = `m2:${randomUUID()}`;
    await env.stageBarriers([{ effectKey: 'disconnect', barrier: { barrierType: 'binding', binding: f.owner.binding, reason: 'fixture' },
      purgeTarget: { scope: 'authorization_disconnect', binding: f.owner.binding, cascadeTargetKinds: [...SLACK_DERIVED_TARGET_KINDS], tombstoneReason: 'connection_disconnected' } }], key);
    return key;
  }
  it('uses the actual writer, blocks before cleanup, and erases metadata without deleting unrelated labels', async () => {
    const f = await fixture();
    const row = await messages.createSlackMessage(f.conv, 'assistant', 'private excerpt', {
      type: 'plan', plan: { summary: 'private excerpt' }, resourceLabels: { slack: 'private label', trello: 'keep' }, usedDirectory: ['trello'],
    }, { segments: f.segments, selectors: ['content', 'metadata.plan', 'metadata.resourceLabels/slack'] });
    expect((await messages.listMessages(f.conv))[0]?.content).toBe('private excerpt');
    expect((await env.db.pool.query('SELECT count(*)::int AS n FROM slack_derived_copies WHERE target_id=$1', [row.id])).rows[0].n).toBe(3);
    await invalidate(f);
    const visible = (await messages.listMessages(f.conv))[0]!;
    expect(JSON.stringify(visible)).not.toContain('private');
    expect(visible.metadata.resourceLabels.trello).toBe('keep');
    expect((await new SlackMessagePurgeConsumer(env.db.pool).runOnce(50)).completed).toBeGreaterThan(0);
    const persisted = (await env.db.pool.query('SELECT content,metadata FROM messages WHERE id=$1', [row.id])).rows[0];
    expect(JSON.stringify(persisted)).not.toContain('private');
    expect(persisted.metadata.resourceLabels).toEqual({ trello: 'keep' });
    expect(persisted.metadata.usedDirectory).toEqual(['trello']);
  });
  it('removes only registered memory entities and preserves other service entries', async () => {
    const f = await fixture();
    const row = await messages.createSlackMessage(f.conv, 'system', '', { type: 'working_memory', state: {
      __observed: { channel: [{ id: 'C_M2', name: 'private' }, { id: 'TRELLO', name: 'keep' }] },
      __labels: { slack: 'private', trello: 'keep' }, members: [{ id: 'U_M2', name: 'private' }, { id: 'OTHER', name: 'keep' }],
    } }, { segments: f.segments, selectors: ['state:/__observed/channel#id=C_M2', 'state:/__labels/slack', 'state:/members#id=U_M2'] });
    expect((await messages.listMessages(f.conv))[0]?.metadata.state.members).toHaveLength(2);
    await invalidate(f);
    expect((await messages.listMessages(f.conv))[0]?.metadata.state.members).toEqual([{ id: 'OTHER', name: 'keep' }]);
    const consumer = new SlackMessagePurgeConsumer(env.db.pool, { targetKind: 'working_memory_entity' });
    expect((await consumer.runOnce(50)).completed).toBeGreaterThan(0);
    const state = (await env.db.pool.query('SELECT metadata FROM messages WHERE id=$1', [row.id])).rows[0].metadata.state;
    expect(state).toEqual({ __observed: { channel: [{ id: 'TRELLO', name: 'keep' }] }, __labels: { trello: 'keep' }, members: [{ id: 'OTHER', name: 'keep' }] });
  });
  it('rolls back real artifact and copies together when registration is denied', async () => {
    const f = await fixture();
    const bad = { ...f.segments[0]!, storagePolicyRef: { ...f.segments[0]!.storagePolicyRef, consentRevision: '999' } };
    await expect(messages.createSlackMessage(f.conv, 'assistant', 'must rollback', { type: 'answer' }, { segments: [bad], selectors: ['content'] })).rejects.toThrow();
    expect((await env.db.pool.query('SELECT count(*)::int AS n FROM messages WHERE conv_id=$1', [f.conv])).rows[0].n).toBe(0);
  });
  it('masks legacy Slack-marked memory without inventing provenance and rejects duplicate selectors/IDs', async () => {
    const f = await fixture();
    await env.db.pool.query("INSERT INTO messages(conv_id,role,content,metadata) VALUES($1,'system','',$2)", [f.conv, { type: 'working_memory', state: { private: { service: 'myslack', text: 'legacy secret' } } }]);
    expect(JSON.stringify(await messages.listMessages(f.conv))).not.toContain('legacy secret');
    await expect(messages.createSlackMessage(f.conv, 'system', '', { type: 'working_memory', state: { members: [{ id: 'U', name: 'one' }, { id: 'U', name: 'two' }] } },
      { segments: f.segments, selectors: ['state:/members#id=U'] })).rejects.toThrow();
  });
  it('uses a real aborted signal to prevent publication and checks the actual conversation owner', async () => {
    const f = await fixture(), other = await fixture(), controller = new AbortController(); controller.abort();
    await expect(messages.createSlackMessage(f.conv, 'assistant', 'cancel', {}, { segments: f.segments, selectors: ['content'] }, undefined, controller.signal)).rejects.toThrow();
    await expect(messages.createSlackMessage(other.conv, 'assistant', 'foreign', {}, { segments: f.segments, selectors: ['content'] })).rejects.toThrow();
    expect((await env.db.pool.query('SELECT count(*)::int AS n FROM messages WHERE conv_id=ANY($1::uuid[])', [[f.conv, other.conv]])).rows[0].n).toBe(0);
  });
  it('propagates trusted restored history through the real chat writer and publishes no cached Slack plaintext', async () => {
    const f = await fixture();
    await messages.createSlackMessage(f.conv, 'assistant', 'private history', { type: 'answer' }, { segments: f.segments, selectors: ['content'] });
    const events: any[] = [];
    const service = new ChatService({ msgRepo: messages, eventEmitter: { emit: (name, value) => events.push({ name, value }) },
      planner: { processMessage: async input => {
        expect(JSON.stringify(input.history)).toContain('private history');
        return { kind: 'answer', text: 'derived private response', lookups: [], usedDirectory: [] };
      }, routeSchedule: async () => ({ services: [], unavailable: [] }) } });
    await service.handleUserMessage({ conversationId: f.conv, userId: f.owner.person.id, content: 'Summarize' });
    await vi.waitFor(async () => expect((await env.db.pool.query("SELECT count(*)::int AS n FROM messages WHERE conv_id=$1 AND content='derived private response'", [f.conv])).rows[0].n).toBe(1));
    expect((await env.db.pool.query("SELECT count(*)::int AS n FROM slack_derived_copies c JOIN messages m ON m.id::text=c.target_id WHERE m.conv_id=$1 AND m.content='derived private response' AND c.target_sub_id='content'", [f.conv])).rows[0].n).toBe(1);
    expect(JSON.stringify(events)).not.toContain('derived private response');
    await invalidate(f);
    expect(JSON.stringify(await messages.listMessages(f.conv))).not.toContain('private');
  });
  it('guards actual HTTP history/latest routes and denies a second ATI user', async () => {
    const f = await fixture(), other = await fixture();
    await messages.createSlackMessage(f.conv, 'assistant', 'HTTP private', { type: 'answer', lookups: [{ text: 'HTTP private' }] }, { segments: f.segments, selectors: ['content', 'metadata.lookups'] });
    const app = express();
    app.use((req, _res, next) => { (req as any).user = { id: req.headers['x-fixture-owner'] }; next(); });
    app.use('/conversations', createConversationRoutes({ convRepo: new ConversationRepo(env.db.pool), msgRepo: messages, chatService: {} as ChatService }));
    expect((await request(app).get(`/conversations/${f.conv}`).set('x-fixture-owner', other.owner.person.id)).status).toBe(404);
    expect((await request(app).get(`/conversations/${f.conv}/messages/latest`).set('x-fixture-owner', f.owner.person.id)).text).toContain('HTTP private');
    await invalidate(f);
    for (const path of [`/conversations/${f.conv}`, `/conversations/${f.conv}/messages/latest`]) {
      const response = await request(app).get(path).set('x-fixture-owner', f.owner.person.id);
      expect(response.status).toBe(200); expect(response.text).not.toContain('HTTP private');
    }
  });
  it('revalidates policy immediately before model use, even before an asynchronous barrier exists', async () => {
    const f = await fixture();
    await messages.createSlackMessage(f.conv, 'assistant', 'policy secret', { type: 'answer' }, { segments: f.segments, selectors: ['content'] });
    const current = await env.consentRepo.getConsent(f.owner.binding.workspaceId, env.runtimeIdentity.providerId);
    await env.consentRepo.grantConsent({ workspaceId: f.owner.binding.workspaceId, providerId: env.runtimeIdentity.providerId,
      expectedRevision: current!.revision, policyVersion: 'v1.0.0', purposes: ['storage', 'manual_lookup'], retentionDays: 14,
      organizationRepresentative: 'fixture', evidenceRef: 'FIXTURE', recordedBy: 'fixture' });
    expect(JSON.stringify(await messages.listMessages(f.conv))).not.toContain('policy secret');
  });
  it('discards a completed model result after invalidation while it was awaiting the model', async () => {
    const f = await fixture();
    await messages.createSlackMessage(f.conv, 'assistant', 'race source', { type: 'answer' }, { segments: f.segments, selectors: ['content'] });
    let release!: () => void, started!: () => void;
    const waiting = new Promise<void>(resolve => { started = resolve; }), result = new Promise<void>(resolve => { release = resolve; });
    const events: any[] = [];
    const service = new ChatService({ msgRepo: messages, eventEmitter: { emit: (name, value) => events.push({ name, value }) },
      planner: { processMessage: async () => { started(); await result; return { kind: 'answer', text: 'late private result', lookups: [], usedDirectory: [] }; }, routeSchedule: async () => ({services:[],unavailable:[]}) } });
    await service.handleUserMessage({ conversationId: f.conv, userId: f.owner.person.id, content: 'summarize' });
    await waiting; await invalidate(f); release();
    await vi.waitFor(() => expect(events.some(e => e.name === 'error')).toBe(true));
    expect(JSON.stringify(events)).not.toContain('late private result');
    expect((await env.db.pool.query("SELECT count(*)::int AS n FROM messages WHERE conv_id=$1 AND content='late private result'", [f.conv])).rows[0].n).toBe(0);
  });
  it.each([
    { type: 'schedule_proposal', proposal: { summary: 'private' }, previous: { name: 'private', request: 'private', recurrence: { private: true } } },
    { type: 'schedule_state', schedule: { name: 'private', request: 'private', recurrence: { private: true }, lastRun: { error: 'private' } } },
    { type: 'clarification', options: ['private'], context: 'private', reason: 'private' },
    { type: 'refusal', reason: 'private', suggestion: 'private' },
    { type: 'schedule_run', name: 'private' },
  ])('physically erases every actual metadata selector in $type', async metadata => {
    const f = await fixture();
    const selectors = messageOutputSelectors({ content: 'private', metadata });
    const row = await messages.createSlackMessage(f.conv, 'assistant', 'private', metadata, { segments: f.segments, selectors });
    await invalidate(f); await new SlackMessagePurgeConsumer(env.db.pool).runOnce(50);
    const stored = (await env.db.pool.query('SELECT content,metadata FROM messages WHERE id=$1', [row.id])).rows[0];
    expect(JSON.stringify(stored)).not.toContain('private');
    if (metadata.type === 'schedule_proposal') expect(stored.metadata.type).toBe('schedule_proposal_purged');
  });
  it('erases gather/binding memory by ID/key with URI-escaped IDs and retains other entries', async () => {
    const f = await fixture(), state = { __gatherBindings: { 'slack/key': 'private', trello: 'keep' }, __gatherIntent: 'private', __gatherMissing: { key: 'private' },
      __gatherPending: { query: 'private', candidates: [{ id: 'C/#', name: 'private' }, { id: 'TRELLO', name: 'keep' }] }, channels: [{ id: 'C/#', name: 'private' }, { id: 'TRELLO', name: 'keep' }] };
    const selectors = memoryOutputSelectors(state).filter(selector => !selector.endsWith('/trello') && !selector.endsWith('id=TRELLO'));
    const row = await messages.createSlackMessage(f.conv, 'system', '', { type: 'working_memory', state }, { segments: f.segments, selectors });
    for (const selector of selectors) expect(messageSelectorKind(selector)).toBe('working_memory_entity');
    await invalidate(f); await new SlackMessagePurgeConsumer(env.db.pool, { targetKind: 'working_memory_entity' }).runOnce(50);
    const stored = (await env.db.pool.query('SELECT metadata FROM messages WHERE id=$1', [row.id])).rows[0].metadata.state;
    expect(JSON.stringify(stored)).not.toContain('private'); expect(stored.channels).toEqual([{ id: 'TRELLO', name: 'keep' }]);
    expect(stored.__gatherBindings).toEqual({trello:'keep'});
  });
});
