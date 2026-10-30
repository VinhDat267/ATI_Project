import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { createHmac, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { SLACK_DERIVED_TARGET_KINDS } from '@wap/tool-schemas';
import { createSlackReadEnvironment, TEST_ENV, TEST_KEY } from '../helpers/slack-private-read-fixture.js';
import { SlackDerivedLineageRepo } from '../../src/db/repositories/slack-derived-lineage-repo.js';

type Environment = Awaited<ReturnType<typeof createSlackReadEnvironment>>;
type User = Awaited<ReturnType<Environment['addUser']>>;
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const signingSecret = 'native-runtime-fixture-signing-secret';
const unavailable = 'Slack content is unavailable.';

async function reservePort(): Promise<number> {
  const socket = createServer();
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const port = (socket.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}

async function startNative(env: Environment, slackConfigured: boolean) {
  const port = await reservePort();
  const childEnv: NodeJS.ProcessEnv = {};
  // In particular do not inherit provider keys, OAuth secrets or dotenv options.
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA']) {
    if (process.env[key]) childEnv[key] = process.env[key];
  }
  Object.assign(childEnv, TEST_ENV, {
    NODE_ENV: 'test', RUNTIME_MODE: 'sandbox', PORT: String(port),
    DATABASE_URL: env.db.pool.options.connectionString, ENCRYPTION_KEY: TEST_KEY,
    JWT_SECRET: 'native-runtime-fixture-secret-longer-than-thirty-two-bytes',
    MYSLACK_ENABLED: 'off', MYSLACK_AUTOMATION_ENABLED: 'off',
    GMAIL_ENABLED: 'off', MYCALENDAR_ENABLED: 'off', MYSHEETS_ENABLED: 'off',
    SCHEDULES_ENABLED: 'off', AUTH_SIGNUP_ENABLED: 'false',
  });
  if (slackConfigured) Object.assign(childEnv, {
    MYSLACK_APP_ID: 'A_TEST', SLACK_SIGNING_SECRET: signingSecret,
    MYSLACK_API_BASE_URL: env.fixture.url,
  });
  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'apps/chat-api/src/server.ts'], {
    cwd: root, env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '', spawnError: Error | undefined;
  const capture = (chunk: Buffer) => { output = (output + chunk.toString('utf8')).slice(-4000); };
  child.stdout!.on('data', capture);
  child.stderr!.on('data', capture);
  child.once('error', error => { spawnError = error; });
  // Register immediately, before any awaited health request or exit check.
  const exited = new Promise<void>(resolve => child.once('close', () => resolve()));
  const url = `http://127.0.0.1:${port}`;
  async function until(predicate: () => Promise<boolean>, label: string) {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Native server stopped during ${label}: ${spawnError?.message ?? output}`);
      }
      if (await predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error(`Native server timed out during ${label}. ${output}`);
  }
  async function stop() {
    const wait = (ms: number) => new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), ms);
      void exited.then(() => { clearTimeout(timer); resolve(true); });
    });
    if (child.exitCode === null && child.signalCode === null) child.kill();
    if (!await wait(4000)) {
      child.kill('SIGKILL');
      if (!await wait(2000)) throw new Error('Native fixture child did not terminate');
    }
  }
  return { url, until, stop };
}

async function registerMessage(env: Environment, user: User, text: string) {
  const decision = await env.policyService.resolveSlackModelPolicy({
    binding: user.binding, purpose: 'storage', requestedRetentionDays: 7, env: TEST_ENV,
  });
  if (!decision.allowed) throw new Error('Fixture storage policy denied');
  const policy = decision.policyReference;
  const client = await env.db.pool.connect();
  try {
    await client.query('BEGIN');
    const convId = (await client.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [user.person.id])).rows[0].id;
    const id = (await client.query("INSERT INTO messages(conv_id,role,content) VALUES($1,'assistant',$2) RETURNING id", [convId, text])).rows[0].id as string;
    await new SlackDerivedLineageRepo(env.db.pool, env.policyService).registerDerivedCopyInTransaction(client, {
      atiUserId: user.person.id, targetKind: 'chat_history_message', targetId: id, targetSubId: 'content',
      segments: [{
        sourceRef: { binding: user.binding, resourceType: 'message', resourceId: JSON.stringify(['C_NATIVE', '1730000000.000001']), revision: '1730000000.000001' },
        storagePolicyRef: policy, acquisitionPolicyRef: { ...policy, purpose: 'manual_lookup', requestedRetentionDays: 0 },
        captureHash: 'a'.repeat(64), capturedAt: new Date().toISOString(),
      }],
    });
    await client.query('COMMIT');
    return id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function allowStorage(env: Environment, workspaceId: string) {
  const previous = await env.consentRepo.getConsent(workspaceId, env.runtimeIdentity.providerId);
  if (!previous) throw new Error('Fixture consent missing');
  await env.consentRepo.grantConsent({
    workspaceId, providerId: env.runtimeIdentity.providerId, policyVersion: 'v1.0.0',
    expectedRevision: previous.revision, purposes: ['storage', 'manual_lookup'], retentionDays: 14,
    organizationRepresentative: 'fixture', evidenceRef: 'FIXTURE', recordedBy: 'fixture',
  });
}

async function health(url: string) {
  try { return (await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) })).ok; }
  catch { return false; }
}

it('actual server drains signed revocation through validation and purge with flags off, preserving the other ATI owner', async () => {
  const env = await createSlackReadEnvironment('slack_native_chain');
  let native: Awaited<ReturnType<typeof startNative>> | undefined;
  try {
    const workspaceId = `T${randomUUID()}`;
    // Definitive invalid_auth can disconnect a nonrotating credential. A retained
    // refresh token instead requires recovery, which is a separate acceptance gate.
    const alice = await env.addUser({ name: 'native-alice', workspaceId, actorId: `U${randomUUID()}`, accessToken: 'NATIVE_ALICE_FIXTURE', refreshToken: '' });
    const bob = await env.addUser({ name: 'native-bob', workspaceId, actorId: `U${randomUUID()}`, accessToken: 'NATIVE_BOB_FIXTURE' });
    await allowStorage(env, workspaceId);
    const aliceMessage = await registerMessage(env, alice, 'Alice Slack fixture');
    const bobMessage = await registerMessage(env, bob, 'Bob Slack fixture');
    env.fixture.setHandler('/auth.test', () => ({ body: { ok: false, error: 'invalid_auth' } }));
    native = await startNative(env, true);
    await native.until(() => health(native!.url), 'health');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const eventId = `Ev${randomUUID().replaceAll('-', '')}`;
    const body = JSON.stringify({
      type: 'event_callback', api_app_id: 'A_TEST', team_id: workspaceId, event_id: eventId,
      event_time: Number(timestamp), event: { type: 'tokens_revoked', tokens: { oauth: [alice.binding.slackUserId] }, event_ts: `${timestamp}.000001` },
    });
    const signature = `v0=${createHmac('sha256', signingSecret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
    const response = await fetch(`${native.url}/api/slack/events`, {
      method: 'POST', body, headers: { 'content-type': 'application/json', 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signature },
      signal: AbortSignal.timeout(5000),
    });
    expect(response.status).toBe(200);
    await native.until(async () => (await env.db.pool.query('SELECT content FROM messages WHERE id=$1', [aliceMessage])).rows[0].content === unavailable, 'registered erasure after signed revocation');
    expect((await env.db.pool.query('SELECT content FROM messages WHERE id=$1', [bobMessage])).rows[0].content).toBe('Bob Slack fixture');
    const connections = (await env.db.pool.query('SELECT id,status,config,identity_version FROM slack_connections')).rows;
    expect(connections.find(row => row.id === alice.row.id)).toEqual({ id: alice.row.id, status: 'disconnected', config: null, identity_version: alice.binding.identityVersion + 1 });
    expect(connections.find(row => row.id === bob.row.id)).toEqual({ id: bob.row.id, status: bob.row.status, config: bob.row.config, identity_version: bob.row.identity_version });
    expect((await env.db.pool.query('SELECT status,validation_outcome FROM slack_lifecycle_intents')).rows).toEqual([{ status: 'applied', validation_outcome: 'invalid' }]);
    expect((await env.db.pool.query('SELECT event_id FROM slack_event_receipts WHERE event_id=$1', [eventId])).rows).toEqual([{ event_id: eventId }]);
    expect(env.fixture.requests.map(request => [request.path, request.authorization])).toEqual([['/auth.test', 'Bearer NATIVE_ALICE_FIXTURE']]);
  } finally {
    try { await native?.stop(); } finally { await env.close(); }
  }
}, 65_000);

it('actual server erases a durable registered message without any Slack config and leaves unsupported kinds pending', async () => {
  const env = await createSlackReadEnvironment('slack_native_no_config');
  let native: Awaited<ReturnType<typeof startNative>> | undefined;
  try {
    const user = await env.addUser({ name: 'native-purge', workspaceId: `T${randomUUID()}`, actorId: `U${randomUUID()}` });
    await allowStorage(env, user.binding.workspaceId);
    const id = await registerMessage(env, user, 'Offline purge fixture');
    const { MessageRepo } = await import('../../src/db/repositories/message-repo.js');
    const registry = new SlackDerivedLineageRepo(env.db.pool, env.policyService);
    const copy = (await env.db.pool.query('SELECT id FROM slack_derived_copies WHERE target_id=$1', [id])).rows[0];
    const held = await env.db.pool.connect();
    const segments = await registry.segmentsInTransaction(held, copy.id); held.release();
    const convId = (await env.db.pool.query('SELECT conv_id FROM messages WHERE id=$1', [id])).rows[0].conv_id;
    const memory = await new MessageRepo(env.db.pool, registry).createSlackMessage(convId, 'system', '',
      { type: 'working_memory', state: { members: [{ id: 'SLACK', name: 'Private memory' }, { id: 'TRELLO', name: 'Keep' }] } },
      { segments, selectors: ['state:/members#id=SLACK'] });
    const key = `native-disconnect:${randomUUID()}`;
    await env.stageBarriers([{
      effectKey: 'disconnect', barrier: { barrierType: 'binding', binding: user.binding, reason: 'disconnect' },
      purgeTarget: { scope: 'authorization_disconnect', binding: user.binding, cascadeTargetKinds: [...SLACK_DERIVED_TARGET_KINDS], tombstoneReason: 'connection_disconnected' },
    }], key);
    native = await startNative(env, false);
    await native.until(() => health(native!.url), 'health without Slack config');
    await native.until(async () => (await env.db.pool.query('SELECT content FROM messages WHERE id=$1', [id])).rows[0].content === unavailable, 'durable purge without Slack config');
    await native.until(async () => JSON.stringify((await env.db.pool.query('SELECT metadata FROM messages WHERE id=$1', [memory.id])).rows[0]).includes('Private memory') === false, 'working memory purge without Slack config');
    const jobs = (await env.db.pool.query('SELECT target_kind,status FROM slack_invalidation_intents WHERE source_event_key=$1', [key])).rows;
    expect(jobs.filter(row => row.status === 'completed').map(row => row.target_kind).sort()).toEqual(['chat_history_message', 'slack_source_raw', 'working_memory_entity']);
    expect(jobs.filter(row => row.status === 'pending')).toHaveLength(5);
    expect((await env.db.pool.query('SELECT metadata FROM messages WHERE id=$1', [memory.id])).rows[0].metadata.state.members).toEqual([{ id: 'TRELLO', name: 'Keep' }]);
    expect(env.fixture.requests).toHaveLength(0);
    expect((await fetch(`${native.url}/api/slack/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(1000) })).status).toBe(503);
  } finally {
    try { await native?.stop(); } finally { await env.close(); }
  }
}, 65_000);
