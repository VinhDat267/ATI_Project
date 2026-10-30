import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { SlackPolicyReference } from '@wap/tool-schemas';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { SlackConsentRepo } from '../../src/db/repositories/slack-consent-repo.js';
import { SlackPolicyService } from '../../src/services/slack/policy-service.js';
import { resolveRuntimeProviderIdentity } from '../../src/config/slack-policy-runtime.js';
import { acquireSlackInvalidationLocks, slackSourceWriteLockKeys, SlackInvalidationService } from '../../src/services/slack/slack-invalidation-service.js';
import { SlackDerivedLineageRepo, type RegisterDerivedCopyInput } from '../../src/db/repositories/slack-derived-lineage-repo.js';

describe('03B2A message-content lineage on real PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let consent: SlackConsentRepo;
  let policy: SlackPolicyService;
  let repo: SlackDerivedLineageRepo;
  const env = { LLM_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-2.5-flash', RUNTIME_ACCOUNT_ID: 'LINEAGE_TEST' };
  const runtime = resolveRuntimeProviderIdentity(env);
  beforeAll(async () => {
    db = await createMigratedSchema('slack_derived');
    consent = new SlackConsentRepo(db.pool);
    policy = new SlackPolicyService(db.pool, { env });
    repo = new SlackDerivedLineageRepo(db.pool, policy);
    await consent.attestProvider({ id: runtime.providerId, name: 'Test runtime', verified: true, noTraining: true,
      maxRetentionDays: 30, configurationFingerprint: runtime.fingerprint,
      evidenceRef: 'FIXTURE', verifiedBy: 'fixture', verifiedAt: new Date() });
  });
  afterAll(async () => { await db?.close(); });

  async function fixture() {
    const person = await db.person();
    const connectionId = randomUUID(), workspaceId = `T${randomUUID()}`;
    await db.pool.query(`INSERT INTO slack_connections(id,user_id,app_id,workspace_id,workspace_name,actor_id,
      identity_version,status,config,scopes,connected_at,last_state_order)
      VALUES($1,$2,'A_REG',$3,'Fixture','U_REG',1,'active','FIXTURE',ARRAY['channels:history'],now(),'1')`,
    [connectionId, person.id, workspaceId]);
    const granted = await consent.grantConsent({ workspaceId, providerId: runtime.providerId, policyVersion: '2026-10-28',
      purposes: ['storage', 'manual_lookup', 'planning'], retentionDays: 30,
      organizationRepresentative: 'fixture', evidenceRef: 'FIXTURE', recordedBy: 'fixture' });
    const binding = { atiUserId: person.id, connectionId, workspaceId, slackUserId: 'U_REG', identityVersion: 1 };
    const acquisitionPolicyRef: SlackPolicyReference = { binding, purpose: 'manual_lookup', requestedRetentionDays: 0,
      providerProfileId: runtime.providerId, configFingerprint: runtime.fingerprint,
      policyVersion: '2026-10-28', consentRevision: String(granted.revision), providerRevision: '1' };
    const conv = (await db.pool.query('INSERT INTO conversations(user_id) VALUES($1) RETURNING id', [person.id])).rows[0].id;
    const targetId = (await db.pool.query("INSERT INTO messages(conv_id,role,content) VALUES($1,'assistant','Derived fixture') RETURNING id", [conv])).rows[0].id;
    const input: RegisterDerivedCopyInput = { atiUserId: person.id, targetKind: 'chat_history_message', targetId,
      targetSubId: 'content', segments: [{ sourceRef: { binding, resourceType: 'message',
        resourceId: JSON.stringify(['C_REG', '1730000000.000001']), revision: '1730000000.000001' },
        acquisitionPolicyRef, storagePolicyRef: { ...acquisitionPolicyRef, purpose: 'storage', requestedRetentionDays: 30 },
        captureHash: 'a'.repeat(64), channelId: 'C_REG', capturedAt: new Date().toISOString() }] };
    return { person, binding, input, targetId, conv };
  }
  async function register(input: RegisterDerivedCopyInput) {
    const client = await db.pool.connect();
    try { await client.query('BEGIN'); const copy = await repo.registerDerivedCopyInTransaction(client, input);
      await client.query('COMMIT'); return copy;
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  function guard(input: RegisterDerivedCopyInput, version: string) {
    return { callerAtiUserId: input.atiUserId, consumerPurpose: 'manual_lookup' as const,
      targetKind: input.targetKind, targetId: input.targetId, targetSubId: input.targetSubId,
      expectedTargetVersion: version };
  }

  it('stores real ownership, source epoch and server fingerprint/version; BIGINT remains exact', async () => {
    const f = await fixture();
    await db.pool.query("SELECT setval('slack_derived_target_version_seq',9007199254740992)");
    const first = await register(f.input);
    expect(first.targetVersion).toBe('9007199254740993');
    expect(first.targetFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect((await repo.assertDerivedCopyAllowed(guard(f.input, first.targetVersion))).status).toBe('allowed');
    expect((await repo.assertDerivedCopyAllowed(guard(f.input, '9007199254740992'))).status).toBe('blocked');
    const c = await db.pool.connect();
    try { expect(await repo.getActiveCopyInTransaction(c, f.input)).toEqual(first); } finally { c.release(); }
    const segment = (await db.pool.query('SELECT * FROM slack_derived_provenance_segments WHERE derived_copy_id=$1', [first.derivedCopyId])).rows[0];
    expect(segment.consent_revision).toBe('1');
    expect(segment.effective_retention_days).toBe(30);
    expect(segment.raw_source_id).toBeNull();
  });

  it('rolls artifact and registry back in the same transaction', async () => {
    const f = await fixture(), c = await db.pool.connect();
    try { await c.query('BEGIN');
      await repo.prepareMessageWriteInTransaction(c, f.input);
      await c.query("UPDATE messages SET content='Will roll back' WHERE id=$1", [f.targetId]);
      await repo.registerDerivedCopyInTransaction(c, f.input);
      await c.query('ROLLBACK');
    } finally { c.release(); }
    expect((await db.pool.query('SELECT content FROM messages WHERE id=$1', [f.targetId])).rows[0].content).toBe('Derived fixture');
    expect((await db.pool.query('SELECT count(*)::int AS n FROM slack_derived_copies WHERE target_id=$1', [f.targetId])).rows[0].n).toBe(0);
  });

  it('requires an active caller transaction before any registry mutation', async () => {
    const f = await fixture(), c = await db.pool.connect();
    try { await expect(repo.registerDerivedCopyInTransaction(c, f.input)).rejects.toThrow(); } finally { c.release(); }
  });

  it('supersedes identical text with a new server version and blocks the old generation', async () => {
    const f = await fixture(), first = await register(f.input), second = await register(f.input);
    expect(second.targetVersion).not.toBe(first.targetVersion);
    expect(second.targetFingerprint).toBe(first.targetFingerprint);
    expect((await repo.assertDerivedCopyAllowed(guard(f.input, first.targetVersion))).status).toBe('blocked');
    expect((await repo.assertDerivedCopyAllowed(guard(f.input, second.targetVersion))).status).toBe('allowed');
  });

  it('blocks changed content even when the lineage version is unchanged', async () => {
    const f = await fixture(), copy = await register(f.input);
    await db.pool.query("UPDATE messages SET content='Unregistered replacement' WHERE id=$1", [f.targetId]);
    expect((await repo.assertDerivedCopyAllowed(guard(f.input, copy.targetVersion))).status).toBe('blocked');
  });

  it('rejects foreign target ownership and mixed-owner/empty/stale epochs', async () => {
    const f = await fixture(), other = await fixture();
    for (const input of [ { ...f.input, atiUserId: other.person.id }, { ...f.input, segments: [] },
      { ...f.input, segments: [{ ...f.input.segments[0]!, sourceRef: { ...f.input.segments[0]!.sourceRef, binding: other.binding } }] },
      { ...f.input, segments: [{ ...f.input.segments[0]!, storagePolicyRef: { ...f.input.segments[0]!.storagePolicyRef, consentRevision: '999' } }] },
      { ...f.input, targetKind: 'audit_log_entry' as const }, { ...f.input, targetSubId: 'metadata' },
      { ...f.input, targetVersion: '99' },
    ]) await expect(register(input)).rejects.toThrow();
    const copy = await register(f.input);
    expect((await repo.assertDerivedCopyAllowed({ ...guard(f.input, copy.targetVersion), callerAtiUserId: other.person.id })).status).toBe('blocked');
  });

  it('blocks expired lineage and rejects future acquisition clocks', async () => {
    const f = await fixture();
    await expect(register({ ...f.input, segments: [{ ...f.input.segments[0]!, capturedAt: new Date(Date.now() + 60_000).toISOString() }] })).rejects.toThrow();
    const copy = await register(f.input);
    await db.pool.query("UPDATE slack_derived_provenance_segments SET captured_at=now()-interval '31 days', expires_at=now()-interval '1 day' WHERE derived_copy_id=$1", [copy.derivedCopyId]);
    expect((await repo.assertDerivedCopyAllowed(guard(f.input, copy.targetVersion))).status).toBe('blocked');
  });

  it('revalidates revoked consent before the barrier consumer runs', async () => {
    const f = await fixture(), copy = await register(f.input);
    await consent.revokeConsent({ workspaceId: f.binding.workspaceId, providerId: runtime.providerId, recordedBy: 'fixture', reason: 'fixture revocation', expectedRevision: 1n });
    expect((await repo.assertDerivedCopyAllowed(guard(f.input, copy.targetVersion))).status).toBe('blocked');
    await expect(register(f.input)).rejects.toThrow();
  });

  it('blocks a committed deletion and cannot register a new version with that old segment', async () => {
    const f = await fixture(), copy = await register(f.input), c = await db.pool.connect();
    try { await c.query('BEGIN');
      await new SlackInvalidationService(db.pool).stageInTransaction(c, { sourceEventKey: `derived:${randomUUID()}`,
        effects: [{ effectKey: 'delete', barrier: { barrierType: 'resource', workspaceId: f.binding.workspaceId,
          resourceType: 'message', resourceId: f.input.segments[0]!.sourceRef.resourceId, deleted: true, reason: 'source_deleted' } }] });
      await c.query('COMMIT');
    } finally { c.release(); }
    expect((await repo.assertDerivedCopyAllowed(guard(f.input, copy.targetVersion))).status).toBe('blocked');
    await expect(register(f.input)).rejects.toThrow();
  });

  it('derives message channel from its canonical tuple and never bypasses a real membership barrier', async () => {
    const f = await fixture();
    const segment = { ...f.input.segments[0]!, channelId: undefined };
    const withoutChannel = { ...f.input, segments: [segment] };
    const copy = await register(withoutChannel);
    const c = await db.pool.connect();
    try { await c.query('BEGIN');
      await new SlackInvalidationService(db.pool).stageInTransaction(c, { sourceEventKey: `channel:${randomUUID()}`,
        effects: [{ effectKey: 'lost', barrier: { barrierType: 'channel', binding: f.binding,
          channelId: 'C_REG', reason: 'channel_membership_lost' } }] });
      await c.query('COMMIT');
    } finally { c.release(); }
    // Also cover lineage persisted by an earlier writer with missing or relabeled metadata.
    await db.pool.query('UPDATE slack_derived_provenance_segments SET channel_id=NULL WHERE derived_copy_id=$1', [copy.derivedCopyId]);
    expect((await repo.assertDerivedCopyAllowed(guard(f.input, copy.targetVersion))).status).toBe('blocked');
    await expect(register(withoutChannel)).rejects.toThrow();
    const relabeled = { ...f.input, segments: [{ ...segment, channelId: 'C_OTHER' }] };
    await expect(register(relabeled)).rejects.toThrow();
    await db.pool.query("UPDATE slack_derived_provenance_segments SET channel_id='C_OTHER' WHERE derived_copy_id=$1", [copy.derivedCopyId]);
    expect((await repo.assertDerivedCopyAllowed(guard(f.input, copy.targetVersion))).status).toBe('blocked');
  });

  it('authorizes on the held client even when the real pool has only one connection', async () => {
    const f = await fixture(), copy = await register(f.input);
    const single = new pg.Pool({ ...db.pool.options, max: 1, connectionTimeoutMillis: 200 });
    try {
      const bounded = new SlackDerivedLineageRepo(single, new SlackPolicyService(single, { env }));
      expect((await bounded.assertDerivedCopyAllowed(guard(f.input, copy.targetVersion))).status).toBe('allowed');
    } finally { await single.end(); }
  });

  async function waitingOnAdvisory(pid: number) {
    const start = Date.now();
    while (true) {
      const row = (await db.pool.query('SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0];
      if (row?.wait_event_type === 'Lock' && row.wait_event === 'advisory') return;
      if (Date.now() - start > 1_000) throw new Error('Actual client did not wait on advisory lock');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
  it.each(['register_first', 'invalidation_first'] as const)('serializes real register/invalidation clients: %s', async order => {
    const f = await fixture(), writer = await db.pool.connect(), stager = await db.pool.connect();
    const writerPid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const stagerPid = (await stager.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const stage = () => new SlackInvalidationService(db.pool).stageInTransaction(stager, {
      sourceEventKey: `race:${randomUUID()}`, effects: [{ effectKey: 'delete', barrier: {
        barrierType: 'resource', workspaceId: f.binding.workspaceId, resourceType: 'message',
        resourceId: f.input.segments[0]!.sourceRef.resourceId, deleted: true, reason: 'source_deleted',
      } }],
    });
    try {
      await writer.query('BEGIN'); await stager.query('BEGIN');
      if (order === 'register_first') {
        const copy = await repo.registerDerivedCopyInTransaction(writer, f.input);
        const pending = stage(); pending.catch(() => {});
        await waitingOnAdvisory(stagerPid);
        await writer.query('COMMIT'); await pending; await stager.query('COMMIT');
        expect((await repo.assertDerivedCopyAllowed(guard(f.input, copy.targetVersion))).status).toBe('blocked');
      } else {
        await stage();
        const pending = repo.registerDerivedCopyInTransaction(writer, f.input); pending.catch(() => {});
        await waitingOnAdvisory(writerPid);
        await stager.query('COMMIT');
        await expect(pending).rejects.toThrow('blocked_by_barrier');
        await writer.query('ROLLBACK');
      }
    } finally { await writer.query('ROLLBACK'); await stager.query('ROLLBACK'); writer.release(); stager.release(); }
  });

  it('settles caller cancellation while a real advisory lock blocks the read guard', async () => {
    const f = await fixture(), copy = await register(f.input), holder = await db.pool.connect();
    const controller = new AbortController();
    const segment = f.input.segments[0]!;
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await holder.query('BEGIN');
      await acquireSlackInvalidationLocks(holder, slackSourceWriteLockKeys({ binding: f.binding,
        epoch: { ...segment.storagePolicyRef, binding: f.binding }, resourceType: segment.sourceRef.resourceType,
        resourceId: segment.sourceRef.resourceId, channelId: segment.channelId }));
      const started = Date.now();
      const pending = repo.assertDerivedCopyAllowed({ ...guard(f.input, copy.targetVersion), signal: controller.signal });
      setTimeout(() => controller.abort(), 25);
      releaseTimer = setTimeout(() => { void holder.query('ROLLBACK'); }, 450);
      expect((await pending).status).toBe('blocked');
      expect(Date.now() - started).toBeLessThan(300);
    } finally {
      if (releaseTimer) clearTimeout(releaseTimer);
      await holder.query('ROLLBACK'); holder.release();
    }
  });
});
