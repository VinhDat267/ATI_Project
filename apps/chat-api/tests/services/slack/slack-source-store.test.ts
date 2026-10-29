import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';
import {
  SlackSourceStore,
  type SaveSourceInput,
} from '../../../src/services/slack/slack-source-store.js';
import { SlackSourceRepo } from '../../../src/db/repositories/slack-source-repo.js';
import { SlackInvalidationService } from '../../../src/services/slack/slack-invalidation-service.js';
import { SlackPolicyService } from '../../../src/services/slack/policy-service.js';
import {
  SlackConsentRepo,
  type GrantConsentInput,
  type SlackPurpose,
} from '../../../src/db/repositories/slack-consent-repo.js';
import {
  slackPolicyRefToEpoch,
  type SlackBinding,
  type SlackPolicyReference,
  type SlackSourceRef,
} from '@wap/tool-schemas';

import { resolveRuntimeProviderIdentity } from '../../../src/config/slack-policy-runtime.js';

describe('SlackSourceStore on PostgreSQL (03B1)', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let store: SlackSourceStore;
  let sourceRepo: SlackSourceRepo;
  let invalidationService: SlackInvalidationService;
  let policyService: SlackPolicyService;
  let consentRepo: SlackConsentRepo;

  const mockEnv = {
    LLM_PROVIDER: 'gemini',
    GEMINI_MODEL: 'gemini-3.8-flash',
    RUNTIME_ACCOUNT_ID: 'TEST_POLICY_ACCOUNT',
  };
  const runtimeIdentity = resolveRuntimeProviderIdentity(mockEnv);

  beforeAll(async () => {
    db = await createMigratedSchema('slack_source_store');
    sourceRepo = new SlackSourceRepo(db.pool);
    invalidationService = new SlackInvalidationService(db.pool);
    policyService = new SlackPolicyService(db.pool, { env: mockEnv });
    consentRepo = new SlackConsentRepo(db.pool);
    store = new SlackSourceStore(db.pool, sourceRepo, invalidationService, policyService, { env: mockEnv });
  });

  afterAll(async () => {
    await db?.close();
  });

  async function seedStoreEnv(
    workspaceId = 'T_STORE_1',
    purposes: SlackPurpose[] = ['storage', 'manual_lookup', 'triage', 'planning', 'digest']
  ) {
    const person = await db.person('Charlie');
    const connectionId = randomUUID();
    await db.pool.query(
      `INSERT INTO slack_connections (
        id, user_id, app_id, workspace_id, workspace_name, actor_id,
        identity_version, status, config, scopes, connected_at, last_state_order
      ) VALUES ($1, $2, 'A_APP', $3, 'Test Workspace', 'U_CHARLIE', 1, 'active', 'ENCRYPTED_CONFIG', ARRAY['channels:history'], now(), '0001')`,
      [connectionId, person.id, workspaceId]
    );

    // Attest provider matching runtime environment if not already attested
    const existingProvider = await consentRepo.getTrustedProvider(runtimeIdentity.providerId);
    if (!existingProvider) {
      await consentRepo.attestProvider({
        id: runtimeIdentity.providerId,
        name: runtimeIdentity.name,
        verified: true,
        noTraining: true,
        maxRetentionDays: 30,
        configurationFingerprint: runtimeIdentity.fingerprint,
        evidenceRef: 'SOC2-GEMINI',
        verifiedBy: 'security@example.com',
        verifiedAt: new Date(),
      });
    }

    // Grant consent
    const grantInput: GrantConsentInput = {
      workspaceId,
      providerId: runtimeIdentity.providerId,
      policyVersion: '2026-10-28',
      purposes,
      retentionDays: 30,
      organizationRepresentative: 'admin@example.com',
      evidenceRef: 'CONSENT-001',
      recordedBy: 'operator@example.com',
    };
    const consent = await consentRepo.grantConsent(grantInput);

    const binding: SlackBinding = {
      atiUserId: person.id,
      connectionId,
      workspaceId,
      slackUserId: 'U_CHARLIE',
      identityVersion: 1,
    };

    const storagePolicyRef: SlackPolicyReference = {
      binding,
      purpose: 'storage',
      requestedRetentionDays: 30,
      providerProfileId: runtimeIdentity.providerId,
      configFingerprint: runtimeIdentity.fingerprint,
      policyVersion: '2026-10-28',
      consentRevision: String(consent.revision),
      providerRevision: '1',
    };

    const acquisitionPolicyRef: SlackPolicyReference = {
      ...storagePolicyRef,
      purpose: 'manual_lookup',
      requestedRetentionDays: 0,
    };

    const sourceRef: SlackSourceRef = {
      binding,
      resourceType: 'message',
      resourceId: `MSG_${workspaceId}`,
      revision: '1.0',
    };

    return {
      person,
      connectionId,
      workspaceId,
      binding,
      storagePolicyRef,
      acquisitionPolicyRef,
      sourceRef,
      consent,
      grantInput,
    };
  }

  it('T4.1: server TTL clamping preserves requestedRetentionDays = 30 but clamps raw retention to <= 7 days', async () => {
    const env = await seedStoreEnv('T_TTL_CLAMP');
    const sourceRef: SlackSourceRef = {
      binding: env.binding,
      resourceType: 'message',
      resourceId: 'MSG_TTL',
      revision: '100.1',
    };

    const input: SaveSourceInput = {
      sourceRef,
      acquisitionPolicyRef: env.acquisitionPolicyRef,
      storagePolicyRef: env.storagePolicyRef, // requestedRetentionDays = 30
      untrustedContent: 'Secret message requiring clamping',
      metadata: { channelId: 'C_GENERAL' },
    };

    const entity = await store.saveSource(input);
    expect(entity.id).toBeDefined();
    expect(entity.retentionDays).toBe(7); // Clamped <= 7!
    expect(entity.policyRef.requestedRetentionDays).toBe(30); // Canonical ref preserved!

    const capturedTime = Date.parse(entity.capturedAt);
    const expiresTime = Date.parse(entity.expiresAt);
    const diffDays = (expiresTime - capturedTime) / 86_400_000;
    expect(diffDays).toBe(7);
  });

  it('T4.2: acquisition epoch provenance match: rejects stale read observation from old grant when saving under new grant', async () => {
    const env = await seedStoreEnv('T_EPOCH_MISMATCH');
    const sourceRef: SlackSourceRef = {
      binding: env.binding,
      resourceType: 'message',
      resourceId: 'MSG_STALE_ACQ',
      revision: '100.2',
    };

    // Acquisition was under consent revision '1'
    const staleAcqPolicyRef: SlackPolicyReference = {
      ...env.acquisitionPolicyRef,
      consentRevision: '1',
    };

    // Storage is under consent revision '2'
    const newStoragePolicyRef: SlackPolicyReference = {
      ...env.storagePolicyRef,
      consentRevision: '2',
    };

    await expect(
      store.saveSource({
        sourceRef,
        acquisitionPolicyRef: staleAcqPolicyRef,
        storagePolicyRef: newStoragePolicyRef,
        untrustedContent: 'Stale content',
      })
    ).rejects.toThrow('ACQUISITION_EPOCH_MISMATCH');
  });

  it('T4.3: immediate read barrier blocks getSource and does not leak untrusted content', async () => {
    const env = await seedStoreEnv('T_BARRIER_BLOCK');
    const sourceRef: SlackSourceRef = {
      binding: env.binding,
      resourceType: 'message',
      resourceId: 'MSG_BLOCKED',
      revision: '100.3',
    };

    const saved = await store.saveSource({
      sourceRef,
      acquisitionPolicyRef: env.acquisitionPolicyRef,
      storagePolicyRef: env.storagePolicyRef,
      untrustedContent: 'Super sensitive content never to be shown',
      metadata: { channelId: 'C_SECRET' },
    });

    // Stage a channel barrier for C_SECRET
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await invalidationService.stageInTransaction(client, {
        sourceEventKey: 'slack:A_APP:block_c_secret',
        effects: [
          {
            effectKey: 'c_secret_barrier',
            barrier: {
              barrierType: 'channel',
              binding: env.binding,
              channelId: 'C_SECRET',
              reason: 'channel_membership_lost',
            },
          },
        ],
      });
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    // Call getSource
    const result = await store.getSource({
      expectedCaptureId: saved.id,
      sourceRef,
      consumerPurpose: 'triage',
    });

    expect(result.status).toBe('blocked_by_invalidation_barrier');
    if (result.status === 'blocked_by_invalidation_barrier') {
      expect(result.reason).toBe('channel_membership_lost');
      expect((result as any).entity).toBeUndefined(); // No untrusted content!
      expect(result.safeMetadataOnly).toBeDefined();
    }
  });

  it('T4.4: dual validation revalidates storage and separately authorizes consumer purpose (triage)', async () => {
    const env = await seedStoreEnv('T_DUAL_VALIDATION');
    const sourceRef: SlackSourceRef = {
      binding: env.binding,
      resourceType: 'message',
      resourceId: 'MSG_DUAL',
      revision: '100.4',
    };

    const saved = await store.saveSource({
      sourceRef,
      acquisitionPolicyRef: env.acquisitionPolicyRef,
      storagePolicyRef: env.storagePolicyRef,
      untrustedContent: 'Plaintext for triage',
      metadata: { channelId: 'C_OK' },
    });

    // Provide mock env so policyService verifies runtime provider correctly
    (store as any).runtimeConfig = { env: mockEnv };
    (policyService as any).runtimeConfig = { env: mockEnv };

    const result = await store.getSource({
      expectedCaptureId: saved.id,
      sourceRef,
      consumerPurpose: 'triage',
    });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.entity.id).toBe(saved.id);
      expect(result.entity.untrustedContent).toBe('Plaintext for triage');
      expect(result.entity.policyRef.purpose).toBe('storage'); // Stored ref purpose unchanged!
    }
  });

  it('T4.5: expired or tombstoned records return tombstoned_or_expired without plaintext', async () => {
    const env = await seedStoreEnv('T_TOMBSTONED');
    const sourceRef: SlackSourceRef = {
      binding: env.binding,
      resourceType: 'message',
      resourceId: 'MSG_EXPIRED',
      revision: '100.5',
    };

    const saved = await store.saveSource({
      sourceRef,
      acquisitionPolicyRef: env.acquisitionPolicyRef,
      storagePolicyRef: env.storagePolicyRef,
      untrustedContent: 'Expired content',
      metadata: { channelId: 'C_EXPIRED' },
    });

    // Purge the source
    await sourceRepo.purgeSource(saved.id, 'retention_expired');

    const result = await store.getSource({
      expectedCaptureId: saved.id,
      sourceRef,
      consumerPurpose: 'manual_lookup',
    });

    expect(result.status).toBe('tombstoned_or_expired');
    if (result.status === 'tombstoned_or_expired') {
      expect(result.reason).toBe('retention_expired');
      expect((result as any).entity).toBeUndefined();
    }
  });

  it('T4.6: capture lookup enforces full 5-field binding plus resource type/id/revision', async () => {
    const env = await seedStoreEnv('T_CAPTURE_IDENTITY');
    const sourceRef = { ...env.sourceRef, resourceId: 'MSG_CAPTURE_IDENTITY', revision: '100.6' };
    const saved = await store.saveSource({
      sourceRef,
      acquisitionPolicyRef: env.acquisitionPolicyRef,
      storagePolicyRef: env.storagePolicyRef,
      untrustedContent: 'Capture identity content',
      metadata: { channelId: 'C_IDENTITY' },
    });

    const mismatches: SlackSourceRef[] = [
      { ...sourceRef, resourceId: 'UNRELATED_RESOURCE' },
      { ...sourceRef, revision: '100.7' },
      { ...sourceRef, resourceType: 'file' },
      { ...sourceRef, binding: { ...env.binding, workspaceId: 'T_OTHER_WORKSPACE' } },
      { ...sourceRef, binding: { ...env.binding, slackUserId: 'U_OTHER' } },
      { ...sourceRef, binding: { ...env.binding, identityVersion: 2 } },
      { ...sourceRef, binding: { ...env.binding, atiUserId: randomUUID() } },
      { ...sourceRef, binding: { ...env.binding, connectionId: randomUUID() } },
    ];

    for (const mismatched of mismatches) {
      const got = await store.getSource({
        expectedCaptureId: saved.id,
        sourceRef: mismatched,
        consumerPurpose: 'triage',
      });
      expect(got.status, JSON.stringify(mismatched)).toBe('not_found');
      expect((got as any).entity).toBeUndefined();
    }

    const exact = await store.getSource({
      expectedCaptureId: saved.id,
      sourceRef,
      consumerPurpose: 'triage',
    });
    expect(exact.status).toBe('ok');
  });

  it('T4.7: current runtime policy denial blocks persistence despite matching old profile metadata', async () => {
    const env = await seedStoreEnv('T_RUNTIME_POLICY_DENY');
    const changedEnv = { ...mockEnv, RUNTIME_ACCOUNT_ID: 'CHANGED_POLICY_ACCOUNT' };
    const deniedPolicy = new SlackPolicyService(db.pool, { env: changedEnv });
    const deniedStore = new SlackSourceStore(db.pool, sourceRepo, invalidationService, deniedPolicy, {
      env: changedEnv,
    });

    const denied = await deniedPolicy.resolveSlackModelPolicy({
      binding: env.binding,
      purpose: 'storage',
      requestedRetentionDays: 30,
      expectedPolicyReference: env.storagePolicyRef,
    });
    expect(denied.allowed).toBe(false);

    await expect(
      deniedStore.saveSource({
        sourceRef: env.sourceRef,
        acquisitionPolicyRef: env.acquisitionPolicyRef,
        storagePolicyRef: env.storagePolicyRef,
        untrustedContent: 'Must not persist',
        metadata: { channelId: 'C_DENIED' },
      })
    ).rejects.toThrow(/SOURCE_POLICY_DENIED/);

    const rows = await db.pool.query('SELECT id FROM slack_sources WHERE connection_id = $1', [
      env.connectionId,
    ]);
    expect(rows.rows).toHaveLength(0);
  });

  it('T4.8: regrant committed between storage and consumer checks cannot release the old epoch', async () => {
    const env = await seedStoreEnv('T_REGRANT_RACE');
    const saved = await store.saveSource({
      sourceRef: env.sourceRef,
      acquisitionPolicyRef: env.acquisitionPolicyRef,
      storagePolicyRef: env.storagePolicyRef,
      untrustedContent: 'Old epoch plaintext',
      metadata: { channelId: 'C_REGRANT_RACE' },
    });

    const originalResolve = policyService.resolveSlackModelPolicy;
    let granted = false;
    (policyService as any).resolveSlackModelPolicy = async (input: any) => {
      const actual = await originalResolve.call(policyService, input);
      if (input.purpose === 'storage' && actual.allowed && !granted) {
        granted = true;
        await consentRepo.grantConsent({
          ...env.grantInput,
          expectedRevision: BigInt(env.consent.revision),
        });
      }
      return actual;
    };

    try {
      const got = await store.getSource({
        expectedCaptureId: saved.id,
        sourceRef: env.sourceRef,
        consumerPurpose: 'triage',
      });
      const current = await db.pool.query(
        'SELECT revision FROM slack_processing_consents WHERE workspace_id = $1',
        [env.workspaceId]
      );
      expect(String(current.rows[0].revision)).toBe('2');
      expect(granted).toBe(true);
      expect(got.status).not.toBe('ok');
      expect((got as any).entity).toBeUndefined();
    } finally {
      (policyService as any).resolveSlackModelPolicy = originalResolve;
    }
  });

  it('T4.9: metadata is whitelisted and bounded before the database commit', async () => {
    const env = await seedStoreEnv('T_METADATA_SANITIZE');
    const saved = await store.saveSource({
      sourceRef: env.sourceRef,
      acquisitionPolicyRef: env.acquisitionPolicyRef,
      storagePolicyRef: env.storagePolicyRef,
      untrustedContent: 'Metadata content',
      metadata: {
        channelId: 'C_METADATA',
        channelName: 'general',
        private_blob: { body: 'UNTRACKED_PRIVATE_METADATA' },
      } as any,
    });

    const rows = await db.pool.query('SELECT metadata FROM slack_sources WHERE id = $1', [saved.id]);
    expect(rows.rows[0].metadata).toEqual({ channelId: 'C_METADATA', channelName: 'general' });
    expect(rows.rows[0].metadata.private_blob).toBeUndefined();
    expect(saved.metadata).toEqual({ channelId: 'C_METADATA', channelName: 'general' });
  });

  it('T4.10: caller supplied future capturedAt cannot extend the server TTL', async () => {
    const env = await seedStoreEnv('T_FUTURE_CAPTURE');
    await expect(
      store.saveSource({
        sourceRef: env.sourceRef,
        acquisitionPolicyRef: env.acquisitionPolicyRef,
        storagePolicyRef: env.storagePolicyRef,
        untrustedContent: 'Future capture',
        capturedAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      })
    ).rejects.toThrow(/CAPTURED_AT_IN_FUTURE/);

    const rows = await db.pool.query('SELECT id FROM slack_sources WHERE connection_id = $1', [
      env.connectionId,
    ]);
    expect(rows.rows).toHaveLength(0);
  });

  it('T4.11: declared acquisition purpose must be currently authorized, not merely declared', async () => {
    const env = await seedStoreEnv('T_ACQUISITION_DENIED', ['storage']);
    const acquisition = await policyService.resolveSlackModelPolicy({
      binding: env.binding,
      purpose: 'manual_lookup',
      requestedRetentionDays: 0,
    });
    expect(acquisition.allowed).toBe(false);

    await expect(
      store.saveSource({
        sourceRef: env.sourceRef,
        acquisitionPolicyRef: env.acquisitionPolicyRef,
        storagePolicyRef: env.storagePolicyRef,
        untrustedContent: 'Acquisition not granted',
      })
    ).rejects.toThrow(/SOURCE_POLICY_DENIED:acquisition/);

    const rows = await db.pool.query('SELECT id FROM slack_sources WHERE connection_id = $1', [
      env.connectionId,
    ]);
    expect(rows.rows).toHaveLength(0);
  });

  it('T4.12: expectedPolicyEpoch is an exact alternative to capture id and requires exclusive input', async () => {
    const env = await seedStoreEnv('T_EPOCH_LOOKUP');
    const saved = await store.saveSource({
      sourceRef: env.sourceRef,
      acquisitionPolicyRef: env.acquisitionPolicyRef,
      storagePolicyRef: env.storagePolicyRef,
      untrustedContent: 'Epoch lookup content',
      metadata: { channelId: 'C_EPOCH_LOOKUP' },
    });
    const epoch = slackPolicyRefToEpoch(env.storagePolicyRef);

    const exact = await store.getSource({
      expectedPolicyEpoch: epoch,
      sourceRef: env.sourceRef,
      consumerPurpose: 'triage',
    });
    expect(exact.status).toBe('ok');
    if (exact.status === 'ok') {
      expect(exact.entity.id).toBe(saved.id);
    }

    const wrongEpoch = await store.getSource({
      expectedPolicyEpoch: { ...epoch, consentRevision: '99' },
      sourceRef: env.sourceRef,
      consumerPurpose: 'triage',
    });
    expect(wrongEpoch.status).toBe('not_found');

    await expect(
      store.getSource({
        expectedPolicyEpoch: { ...epoch, binding: { ...env.binding, workspaceId: 'T_OTHER' } },
        sourceRef: env.sourceRef,
        consumerPurpose: 'triage',
      })
    ).rejects.toThrow(/binding must match/);

    await expect(
      store.getSource({
        expectedCaptureId: saved.id,
        expectedPolicyEpoch: epoch,
        sourceRef: env.sourceRef,
        consumerPurpose: 'triage',
      } as any)
    ).rejects.toThrow(/exactly one/);

    await expect(
      store.getSource({ sourceRef: env.sourceRef, consumerPurpose: 'triage' } as any)
    ).rejects.toThrow(/exactly one/);

    await expect(
      store.getSource({
        expectedCaptureId: randomUUID(),
        sourceRef: env.sourceRef,
        consumerPurpose: 'triage',
      })
    ).resolves.toEqual({ status: 'not_found' });
  });
});
