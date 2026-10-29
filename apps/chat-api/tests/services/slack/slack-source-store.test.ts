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
import { SlackConsentRepo } from '../../../src/db/repositories/slack-consent-repo.js';
import type { SlackBinding, SlackPolicyReference, SlackSourceRef } from '@wap/tool-schemas';

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

  async function seedStoreEnv(workspaceId = 'T_STORE_1') {
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
    const consent = await consentRepo.grantConsent({
      workspaceId,
      providerId: runtimeIdentity.providerId,
      policyVersion: '2026-10-28',
      purposes: ['storage', 'manual_lookup', 'triage', 'planning', 'digest'],
      retentionDays: 30,
      organizationRepresentative: 'admin@example.com',
      evidenceRef: 'CONSENT-001',
      recordedBy: 'operator@example.com',
    });

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

    return { person, connectionId, workspaceId, binding, storagePolicyRef, acquisitionPolicyRef };
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
});
