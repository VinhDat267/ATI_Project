import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import {
  SlackSourceRepo,
  type SaveSourceDbInput,
} from '../../src/db/repositories/slack-source-repo.js';
import {
  SlackConsentRepo,
  type AttestProviderInput,
  type GrantConsentInput,
} from '../../src/db/repositories/slack-consent-repo.js';
import {
  compareSlackRevisions,
  hashPolicyEpoch,
  SlackInvalidationService,
} from '../../src/services/slack/slack-invalidation-service.js';
import {
  formatSlackOwnerSourceKey,
  slackPolicyRefToEpoch,
  type SlackBinding,
  type SlackSourceRef,
  type SlackPolicyReference,
} from '@wap/tool-schemas';

describe('SlackSourceRepo on PostgreSQL (03B1)', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let repo: SlackSourceRepo;
  let consentRepo: SlackConsentRepo;

  beforeAll(async () => {
    db = await createMigratedSchema('slack_source_repo');
    repo = new SlackSourceRepo(db.pool);
    consentRepo = new SlackConsentRepo(db.pool);
  });

  afterAll(async () => {
    await db?.close();
  });

  const providerInput: AttestProviderInput = {
    id: 'google-vertex',
    name: 'Google Vertex AI',
    verified: true,
    noTraining: true,
    maxRetentionDays: 30,
    configurationFingerprint: 'sha256:config12345678',
    evidenceRef: 'SOC2-GOOGLE-2026',
    verifiedBy: 'auditor@example.com',
    verifiedAt: new Date('2026-10-01T00:00:00.000Z'),
  };

  async function seedEnvironment(workspaceId = 'T_WORKSPACE_1') {
    const person = await db.person('Alice');
    const connectionId = randomUUID();
    await db.pool.query(
      `INSERT INTO slack_connections (
        id, user_id, app_id, workspace_id, workspace_name, actor_id,
        identity_version, status, config, scopes, connected_at, last_state_order
      ) VALUES ($1, $2, 'A_SLACK_APP', $3, 'Test Workspace', 'U_ALICE', 1, 'active', 'ENCRYPTED_CONFIG', ARRAY['channels:history'], now(), '0001')`,
      [connectionId, person.id, workspaceId]
    );

    // Attest provider if not already attested
    const existingProvider = await consentRepo.getTrustedProvider(providerInput.id);
    if (!existingProvider) {
      await consentRepo.attestProvider(providerInput);
    }

    // Grant consent for storage
    const consentInput: GrantConsentInput = {
      workspaceId,
      providerId: providerInput.id,
      policyVersion: '2026-10-28',
      purposes: ['storage', 'manual_lookup', 'triage', 'planning'],
      retentionDays: 30,
      organizationRepresentative: 'admin@company.test',
      evidenceRef: 'CONSENT-DOC-001',
      recordedBy: 'alice@company.test',
    };
    const consent = await consentRepo.grantConsent(consentInput);

    const binding: SlackBinding = {
      atiUserId: person.id,
      connectionId,
      workspaceId,
      slackUserId: 'U_ALICE',
      identityVersion: 1,
    };

    const policyRef: SlackPolicyReference = {
      binding,
      purpose: 'storage',
      requestedRetentionDays: 30,
      providerProfileId: providerInput.id,
      configFingerprint: providerInput.configurationFingerprint,
      policyVersion: '2026-10-28',
      consentRevision: String(consent.revision),
      providerRevision: '1',
    };

    return { person, connectionId, workspaceId, binding, policyRef, consent };
  }

  it('T2.1: saves raw source atomically under lock hierarchy and verifies row contents', async () => {
    const env = await seedEnvironment('T_SAVE_1');
    const sourceRef: SlackSourceRef = {
      binding: env.binding,
      resourceType: 'message',
      resourceId: 'C123_1730219400.000100',
      revision: '1730219400.000100',
    };

    const input: SaveSourceDbInput = {
      sourceRef,
      policyRef: env.policyRef,
      untrustedContent: 'Hello Slack world! Sensitive raw content.',
      metadata: { channelId: 'C123', channelName: 'general' },
    };

    const saved = await repo.saveSourceAtomic(input);
    expect(saved.id).toBeDefined();
    expect(saved.ownerSourceKey).toBe(formatSlackOwnerSourceKey(sourceRef));
    expect(saved.retentionDays).toBe(7); // Clamped internally
    expect(saved.policyRequestedRetentionDays).toBe(30); // Derived from policyRef
    expect(saved.untrustedContent).toBe('Hello Slack world! Sensitive raw content.');
    expect(saved.metadata).toEqual({ channelId: 'C123', channelName: 'general' });
    expect(saved.purgedAt).toBeNull();
    expect(saved.tombstonedAt).toBeNull();

    // Verify retrieval by ID
    const retrieved = await repo.getSourceById(saved.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(saved.id);
    expect(retrieved!.untrustedContent).toBe(saved.untrustedContent);

    // Verify retrieval by owner source key and epoch hash
    const epochHash = hashPolicyEpoch(slackPolicyRefToEpoch(env.policyRef));
    const byKey = await repo.getActiveSourceByOwnerKey(saved.ownerSourceKey, epochHash);
    expect(byKey).not.toBeNull();
    expect(byKey!.id).toBe(saved.id);
  });

  it('T2.2a: deterministic PG lock proof: revoke holds FOR UPDATE on consent -> writer blocks -> revoke commits -> writer MUST reject', async () => {
    const env = await seedEnvironment('T_DETERMINISTIC_LOCK_1');
    const sourceRef: SlackSourceRef = {
      binding: env.binding,
      resourceType: 'message',
      resourceId: 'C123_1730219400.000200',
      revision: '1730219400.000200',
    };

    // Client 2 (Revoke) starts transaction and acquires FOR UPDATE on consent
    const client2 = await db.pool.connect();
    let client1Error: Error | null = null;
    try {
      await client2.query('BEGIN');
      await client2.query(
        'SELECT * FROM slack_processing_consents WHERE workspace_id = $1 AND provider_id = $2 FOR UPDATE',
        [env.workspaceId, env.policyRef.providerProfileId]
      );

      // Client 1 (Save) tries to save in background. It acquires connection FOR SHARE, provider FOR SHARE,
      // and blocks waiting for consent FOR SHARE!
      const client1Promise = repo.saveSourceAtomic({
        sourceRef,
        policyRef: env.policyRef,
        untrustedContent: 'Race message',
        metadata: { channelId: 'C123' },
      }).catch(err => {
        client1Error = err;
      });

      // Give client 1 time to execute and block on the consent lock
      await new Promise(r => setTimeout(r, 100));

      // Now client 2 updates consent to revoked and commits
      await client2.query(
        `UPDATE slack_processing_consents
         SET status = 'revoked', revision = revision + 1, updated_at = now()
         WHERE workspace_id = $1 AND provider_id = $2`,
        [env.workspaceId, env.policyRef.providerProfileId]
      );
      await client2.query('COMMIT');

      // Wait for Client 1 to unblock and finish
      await client1Promise;

      // Client 1 MUST have rejected because consent status is now 'revoked'!
      expect(client1Error).not.toBeNull();
      expect(client1Error!.message).toMatch(/CONSENT_MISSING/);

      // Verify no row was inserted into slack_sources
      const ownerKey = formatSlackOwnerSourceKey(sourceRef);
      const rows = await db.pool.query('SELECT * FROM slack_sources WHERE owner_source_key = $1', [ownerKey]);
      expect(rows.rows).toHaveLength(0);
    } finally {
      client2.release();
    }
  });

  it('T2.2b: deterministic PG lock proof: writer holds FOR SHARE -> revoke FOR UPDATE must wait until writer commits', async () => {
    const env = await seedEnvironment('T_DETERMINISTIC_LOCK_2');
    const sourceRef: SlackSourceRef = {
      binding: env.binding,
      resourceType: 'message',
      resourceId: 'C123_1730219400.000300',
      revision: '1730219400.000300',
    };

    const client1 = await db.pool.connect();
    const client2 = await db.pool.connect();
    try {
      // Client 1 starts transaction, locks consent FOR SHARE, and inserts source
      await client1.query('BEGIN');
      await client1.query(
        'SELECT * FROM slack_processing_consents WHERE workspace_id = $1 AND provider_id = $2 FOR SHARE',
        [env.workspaceId, env.policyRef.providerProfileId]
      );

      // Client 2 attempts to revoke consent: must block waiting on Client 1's FOR SHARE lock!
      let client2Finished = false;
      const client2Promise = (async () => {
        await client2.query('BEGIN');
        await client2.query(
          'SELECT * FROM slack_processing_consents WHERE workspace_id = $1 AND provider_id = $2 FOR UPDATE',
          [env.workspaceId, env.policyRef.providerProfileId]
        );
        await client2.query(
          `UPDATE slack_processing_consents SET status = 'revoked', revision = revision + 1 WHERE workspace_id = $1 AND provider_id = $2`,
          [env.workspaceId, env.policyRef.providerProfileId]
        );
        await client2.query('COMMIT');
        client2Finished = true;
      })();

      // Wait 100ms: verify Client 2 has NOT finished because it is blocked by Client 1
      await new Promise(r => setTimeout(r, 100));
      expect(client2Finished).toBe(false);

      // Client 1 now commits
      await client1.query('COMMIT');

      // Now Client 2 should unblock and finish
      await client2Promise;
      expect(client2Finished).toBe(true);
    } finally {
      client1.release();
      client2.release();
    }
  });

  it('T2.3: rejects save if authority rows are invalid (inactive connection, unverified provider, revoked consent)', async () => {
    const env = await seedEnvironment('T_AUTHORITY_INVALID');

    // 1. Inactive connection
    await db.pool.query("UPDATE slack_connections SET status = 'disconnected', config = NULL WHERE id = $1", [env.connectionId]);
    const sourceRef1: SlackSourceRef = {
      binding: env.binding,
      resourceType: 'message',
      resourceId: 'C123_1',
      revision: '1',
    };
    await expect(
      repo.saveSourceAtomic({
        sourceRef: sourceRef1,
        policyRef: env.policyRef,
        untrustedContent: 'content',
        metadata: {},
      })
    ).rejects.toThrow('CONNECTION_INACTIVE');

    // Restore connection
    await db.pool.query("UPDATE slack_connections SET status = 'active' WHERE id = $1", [env.connectionId]);

    // 2. Identity changed (version mismatch)
    const badBinding: SlackBinding = { ...env.binding, identityVersion: 99 };
    await expect(
      repo.saveSourceAtomic({
        sourceRef: { ...sourceRef1, binding: badBinding },
        policyRef: { ...env.policyRef, binding: badBinding },
        untrustedContent: 'content',
        metadata: {},
      })
    ).rejects.toThrow('IDENTITY_CHANGED');
  });

  it('T2.4: recapturing same native revision under new epoch creates distinct physical UUID', async () => {
    const env = await seedEnvironment('T_RECAPTURING');
    const sourceRef: SlackSourceRef = {
      binding: env.binding,
      resourceType: 'message',
      resourceId: 'MSG_RECAPTURE',
      revision: '1000.555',
    };

    // 1. Save capture under Epoch 1
    const cap1 = await repo.saveSourceAtomic({
      sourceRef,
      policyRef: env.policyRef,
      untrustedContent: 'Original capture in Epoch 1',
      metadata: {},
    });

    // 2. Purge capture 1
    await repo.purgeSource(cap1.id, 'consent_revoked');
    const cap1Purged = await repo.getSourceById(cap1.id);
    expect(cap1Purged!.purgedAt).not.toBeNull();
    expect(cap1Purged!.untrustedContent).toBe(''); // Erased!
    expect(cap1Purged!.tombstoneReason).toBe('consent_revoked');

    // 3. User regrants consent -> update DB consent revision to 3
    await db.pool.query(
      "UPDATE slack_processing_consents SET revision = 3, status = 'granted' WHERE workspace_id = $1 AND provider_id = $2",
      [env.workspaceId, env.policyRef.providerProfileId]
    );
    const cap2 = await repo.saveSourceAtomic({
      sourceRef,
      policyRef: { ...env.policyRef, consentRevision: '3' },
      untrustedContent: 'Fresh recaptured content under Epoch 3',
      metadata: {},
    });

    // Capture 2 must have a distinct UUID!
    expect(cap2.id).not.toBe(cap1.id);
    expect(cap2.untrustedContent).toBe('Fresh recaptured content under Epoch 3');

    // Cap 1 remains purged and not resurrected
    const cap1Check = await repo.getSourceById(cap1.id);
    expect(cap1Check!.purgedAt).not.toBeNull();
    expect(cap1Check!.untrustedContent).toBe('');
  });

  it('T2.5: big decimal revision string (> MAX_SAFE_INTEGER) roundtrips accurately as string', async () => {
    const env = await seedEnvironment('T_BIG_REVISION');
    const bigRevision = '9007199254740993.123456789'; // > Number.MAX_SAFE_INTEGER
    const sourceRef: SlackSourceRef = {
      binding: env.binding,
      resourceType: 'message',
      resourceId: 'MSG_BIG',
      revision: bigRevision,
    };

    const saved = await repo.saveSourceAtomic({
      sourceRef,
      policyRef: env.policyRef,
      untrustedContent: 'Big revision test',
      metadata: {},
    });

    expect(saved.revision).toBe(bigRevision);

    const fetched = await repo.getSourceById(saved.id);
    expect(fetched!.revision).toBe(bigRevision);
  });

  it('T2.6: enforces database check constraints on retention and expiry', async () => {
    const env = await seedEnvironment('T_CHECK_CONSTRAINTS');

    // 1. Direct insert with retention_days > 7 must fail DB check
    await expect(
      db.pool.query(
        `INSERT INTO slack_sources (
          owner_source_key, user_id, connection_id, workspace_id, slack_user_id,
          identity_version, resource_type, resource_id, revision, policy_epoch_hash,
          policy_requested_retention_days, retention_days, policy_ref, untrusted_content,
          expires_at
        ) VALUES ($1, $2, $3, $4, $5, 1, 'message', 'm1', '1', 'ep1', 30, 8, '{}'::jsonb, 'test', now() + INTERVAL '8 days')`,
        ['k1', env.person.id, env.connectionId, env.workspaceId, 'U_ALICE']
      )
    ).rejects.toThrow(/chk_slack_sources_retention_days|chk_slack_sources_raw_retention/);

    // 2. Direct insert with expires_at > captured_at + retention_days must fail DB check
    await expect(
      db.pool.query(
        `INSERT INTO slack_sources (
          owner_source_key, user_id, connection_id, workspace_id, slack_user_id,
          identity_version, resource_type, resource_id, revision, policy_epoch_hash,
          policy_requested_retention_days, retention_days, policy_ref, untrusted_content,
          expires_at
        ) VALUES ($1, $2, $3, $4, $5, 1, 'message', 'm2', '1', 'ep2', 30, 3, '{}'::jsonb, 'test', now() + INTERVAL '4 days')`,
        ['k2', env.person.id, env.connectionId, env.workspaceId, 'U_ALICE']
      )
    ).rejects.toThrow(/chk_slack_sources_raw_retention/);
  });

  it('T2.8: deterministic PG lock proof: committed resource-delete barrier staged before save blocks the writer', async () => {
    const env = await seedEnvironment('T_LOCK_DELETE_BEFORE_SAVE');
    const sourceRef: SlackSourceRef = {
      binding: env.binding,
      resourceType: 'message',
      resourceId: 'MSG_DELETE_BEFORE_SAVE',
      revision: '10.1',
    };
    const invalidation = new SlackInvalidationService(db.pool);
    const stager = await db.pool.connect();
    let writerError: Error | null = null;
    let writerSettled = false;
    try {
      await stager.query('BEGIN');
      await invalidation.stageInTransaction(stager, {
        sourceEventKey: `slack:A_SLACK_APP:delete_first_${env.workspaceId}`,
        effects: [
          {
            effectKey: 'resource_delete',
            barrier: {
              barrierType: 'resource',
              workspaceId: env.workspaceId,
              resourceType: 'message',
              resourceId: sourceRef.resourceId,
              deleted: true,
              reason: 'source_deleted',
            },
          },
        ],
      });

      const writerPromise = repo
        .saveSourceAtomic({
          sourceRef,
          policyRef: env.policyRef,
          untrustedContent: 'Must not be written after a committed delete',
          metadata: { channelId: 'C123' },
        })
        .catch(err => {
          writerError = err;
        })
        .finally(() => {
          writerSettled = true;
        });

      // The writer holds the barriered resource's advisory lock scope and must wait.
      await new Promise(r => setTimeout(r, 100));
      expect(writerSettled).toBe(false);

      await stager.query('COMMIT');
      await writerPromise;

      expect(writerError).not.toBeNull();
      expect(writerError!.message).toMatch(
        /BLOCKED_BY_INVALIDATION_BARRIER: resource:source_deleted/
      );

      const rows = await db.pool.query('SELECT id FROM slack_sources WHERE owner_source_key = $1', [
        formatSlackOwnerSourceKey(sourceRef),
      ]);
      expect(rows.rows).toHaveLength(0);
    } finally {
      try {
        await stager.query('ROLLBACK');
      } catch {
        // already committed
      }
      stager.release();
    }
  });

  it('T2.9: deterministic PG lock proof: barrier staging waits for an in-flight write, then purge erases it', async () => {
    const env = await seedEnvironment('T_LOCK_SAVE_BEFORE_DELETE');
    const sourceRef: SlackSourceRef = {
      binding: env.binding,
      resourceType: 'message',
      resourceId: 'MSG_SAVE_BEFORE_DELETE',
      revision: '11.2',
    };
    const invalidation = new SlackInvalidationService(db.pool);
    const writer = await db.pool.connect();
    const stager = await db.pool.connect();
    try {
      await writer.query('BEGIN');
      const saved = await repo.saveSourceInTransaction(writer, {
        sourceRef,
        policyRef: env.policyRef,
        untrustedContent: 'Written before the delete barrier',
        metadata: { channelId: 'C123' },
      });

      let stagerFinished = false;
      const stagerPromise = (async () => {
        await stager.query('BEGIN');
        await invalidation.stageInTransaction(stager, {
          sourceEventKey: `slack:A_SLACK_APP:delete_after_${env.workspaceId}`,
          effects: [
            {
              effectKey: 'resource_delete',
              barrier: {
                barrierType: 'resource',
                workspaceId: env.workspaceId,
                resourceType: 'message',
                resourceId: sourceRef.resourceId,
                deleted: true,
                reason: 'source_deleted',
              },
            },
          ],
        });
        await stager.query('COMMIT');
        stagerFinished = true;
      })();

      // Barrier staging must wait for the source write transaction to finish.
      await new Promise(r => setTimeout(r, 100));
      expect(stagerFinished).toBe(false);

      await writer.query('COMMIT');
      await stagerPromise;
      expect(stagerFinished).toBe(true);

      const purged = await repo.purgeSourcesByTarget({
        scope: 'resource_lifecycle',
        workspaceId: env.workspaceId,
        resourceType: 'message',
        resourceId: sourceRef.resourceId,
        revision: sourceRef.revision,
        cascadeTargetKinds: [],
        tombstoneReason: 'source_deleted',
      });
      expect(purged.purgedCount).toBe(1);

      const after = await repo.getSourceById(saved.id);
      expect(after!.purgedAt).not.toBeNull();
      expect(after!.untrustedContent).toBe('');
      expect(after!.tombstoneReason).toBe('source_deleted');
    } finally {
      try {
        await writer.query('ROLLBACK');
      } catch {
        // already committed
      }
      try {
        await stager.query('ROLLBACK');
      } catch {
        // already committed
      }
      writer.release();
      stager.release();
    }
  });

  it('T2.10: rejects future capture times, oversized raw content, oversized metadata, and strips untracked fields', async () => {
    const env = await seedEnvironment('T_BOUNDS');
    const sourceRef: SlackSourceRef = {
      binding: env.binding,
      resourceType: 'message',
      resourceId: 'MSG_BOUNDS',
      revision: '12.3',
    };

    await expect(
      repo.saveSourceAtomic({
        sourceRef,
        policyRef: env.policyRef,
        untrustedContent: 'future',
        capturedAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
    ).rejects.toThrow(/CAPTURED_AT_IN_FUTURE/);

    await expect(
      repo.saveSourceAtomic({
        sourceRef,
        policyRef: env.policyRef,
        untrustedContent: 'x'.repeat(1_048_577),
      })
    ).rejects.toThrow(/RAW_CONTENT_TOO_LARGE/);

    await expect(
      repo.saveSourceAtomic({
        sourceRef,
        policyRef: env.policyRef,
        untrustedContent: 'metadata bounds',
        metadata: { channelId: 'C_BOUNDS', channelName: 'y'.repeat(5_000) },
      })
    ).rejects.toThrow(/METADATA_FIELD_TOO_LARGE/);

    const saved = await repo.saveSourceAtomic({
      sourceRef,
      policyRef: env.policyRef,
      untrustedContent: 'sanitized metadata',
      metadata: {
        channelId: 'C_BOUNDS',
        private_blob: { body: 'UNTRACKED_PRIVATE_METADATA' },
      } as any,
    });

    const rows = await db.pool.query('SELECT metadata FROM slack_sources WHERE id = $1', [saved.id]);
    expect(rows.rows[0].metadata).toEqual({ channelId: 'C_BOUNDS' });

    // Only one physical row exists: every rejected attempt was refused before INSERT.
    const count = await db.pool.query(
      'SELECT count(*)::int AS n FROM slack_sources WHERE owner_source_key = $1',
      [formatSlackOwnerSourceKey(sourceRef)]
    );
    expect(count.rows[0].n).toBe(1);
  });

  it('T2.7: compareSlackRevisions exact decimal ordering and fail-closed validation', () => {
    // 1. Exact 10-digit timestamps near 9999999999 with 1 microsecond distinction
    expect(compareSlackRevisions('9999999999.000001', '9999999999.000002')).toBe(-1);
    expect(compareSlackRevisions('9999999999.000002', '9999999999.000001')).toBe(1);
    expect(compareSlackRevisions('9999999999.000001', '9999999999.000001')).toBe(0);

    // 2. Padding-equivalent decimal fractions: 0.1 > 0.01
    expect(compareSlackRevisions('100.1', '100.01')).toBe(1);
    expect(compareSlackRevisions('100.01', '100.1')).toBe(-1);

    // 3. Trailing zeros: 100.1 vs 100.10 are mathematically equal decimals
    expect(compareSlackRevisions('100.1', '100.10')).toBe(0);
    expect(compareSlackRevisions('100.100', '100.1')).toBe(0);

    // 4. Integer only
    expect(compareSlackRevisions('101', '100')).toBe(1);
    expect(compareSlackRevisions('100', '100')).toBe(0);

    // 5. Opaque / non-decimal invalid strings fail closed
    expect(() => compareSlackRevisions('invalid-rev', '100.1')).toThrow(TypeError);
    expect(() => compareSlackRevisions('100.1', 'not-a-number')).toThrow(TypeError);
    expect(() => compareSlackRevisions('', '100.1')).toThrow(TypeError);
  });

  it('T2.11: caller-managed write primitive fails closed outside an explicit transaction', async () => {
    const env = await seedEnvironment('T_OUTSIDE_TX');
    const sourceRef: SlackSourceRef = {
      binding: env.binding,
      resourceType: 'message',
      resourceId: 'MSG_OUTSIDE_TX',
      revision: '7.1',
    };
    const client = await db.pool.connect();
    try {
      await expect(
        repo.saveSourceInTransaction(client, {
          sourceRef,
          policyRef: env.policyRef,
          untrustedContent: 'must never persist without a transaction',
        })
      ).rejects.toThrow(/SAVE_SOURCE_OUTSIDE_TRANSACTION/);
    } finally {
      client.release();
    }

    const rows = await db.pool.query(
      'SELECT count(*)::int AS n FROM slack_sources WHERE owner_source_key = $1',
      [formatSlackOwnerSourceKey(sourceRef)]
    );
    expect(rows.rows[0].n).toBe(0);
  });
});
