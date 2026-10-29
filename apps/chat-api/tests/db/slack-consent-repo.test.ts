import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SlackConsentRepo, type AttestProviderInput, type GrantConsentInput } from '../../src/db/repositories/slack-consent-repo.js';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';

describe('Slack organization processing consent on PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let repo: SlackConsentRepo;

  beforeAll(async () => {
    db = await createMigratedSchema('slack_consent');
    repo = new SlackConsentRepo(db.pool);
  });

  afterAll(async () => {
    await db?.close();
  });

  const validProvider: AttestProviderInput = {
    id: 'google-vertex',
    name: 'Google Vertex AI',
    verified: true,
    noTraining: true,
    maxRetentionDays: 30,
    configurationFingerprint: 'sha256:abcd1234ef5678',
    evidenceRef: 'SOC2-TYPE-2-GOOGLE-2026',
    verifiedBy: 'operator-alice@example.com',
    verifiedAt: new Date('2026-10-01T00:00:00.000Z'),
  };

  it('attests a trusted provider and records a policy event', async () => {
    const provider = await repo.attestProvider(validProvider);
    expect(provider.id).toBe('google-vertex');
    expect(provider.verified).toBe(true);
    expect(provider.noTraining).toBe(true);
    expect(provider.revision).toBe(1n);

    const events = await repo.listPolicyEvents('*', 'google-vertex');
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('provider_attested');
    expect(events[0]!.providerRevision).toBe(1n);
  });

  it('fails constraint if provider is verified but has no training or missing evidence', async () => {
    await expect(repo.attestProvider({
      id: 'bad-provider',
      name: 'Bad AI',
      verified: true,
      noTraining: false, // Invariant violation: verified requires noTraining = true
      maxRetentionDays: 0,
      configurationFingerprint: 'fp',
    })).rejects.toThrow();
  });

  it('updates provider with CAS and increments revision', async () => {
    const updated = await repo.attestProvider({
      ...validProvider,
      maxRetentionDays: 60,
      expectedRevision: 1n,
    });
    expect(updated.maxRetentionDays).toBe(60);
    expect(updated.revision).toBe(2n);

    // Stale expectedRevision should throw SLACK_CAS_CONFLICT
    await expect(repo.attestProvider({
      ...validProvider,
      maxRetentionDays: 90,
      expectedRevision: 1n, // Stale!
    })).rejects.toThrow('SLACK_CAS_CONFLICT');
  });

  it('grants organization consent with retentionDays = 0 and records policy event atomically', async () => {
    const grantInput: GrantConsentInput = {
      workspaceId: 'T_CONSENT_01',
      providerId: 'google-vertex',
      policyVersion: 'v1.0.0',
      purposes: ['manual_lookup', 'triage'],
      retentionDays: 0, // 0 is completely valid (no stored copies)
      organizationRepresentative: 'Jane Doe (VP Tech)',
      evidenceRef: 'DPA-2026-ACME-001',
      recordedBy: 'operator-bob@example.com',
    };

    const consent = await repo.grantConsent(grantInput);
    expect(consent.workspaceId).toBe('T_CONSENT_01');
    expect(consent.providerId).toBe('google-vertex');
    expect(consent.status).toBe('granted');
    expect(consent.retentionDays).toBe(0);
    expect(consent.revision).toBe(1n);

    // Consent must remain 'granted', not automatically revoked when retentionDays = 0
    const fetched = await repo.getConsent('T_CONSENT_01', 'google-vertex');
    expect(fetched?.status).toBe('granted');

    const events = await repo.listPolicyEvents('T_CONSENT_01', 'google-vertex');
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('consent_granted');
    expect(events[0]!.policyVersion).toBe('v1.0.0');
    expect(events[0]!.consentRevision).toBe(1n);
  });

  it('rejects invalid grant inputs: negative retentionDays, blank policyVersion, invalid purposes', async () => {
    const base: GrantConsentInput = {
      workspaceId: 'T_CONSENT_02',
      providerId: 'google-vertex',
      policyVersion: 'v1',
      purposes: ['manual_lookup'],
      retentionDays: 0,
      organizationRepresentative: 'Rep',
      evidenceRef: 'Ref',
      recordedBy: 'Op',
    };

    await expect(repo.grantConsent({ ...base, retentionDays: -1 })).rejects.toThrow();
    await expect(repo.grantConsent({ ...base, policyVersion: '   ' })).rejects.toThrow();
    await expect(repo.grantConsent({ ...base, purposes: [] })).rejects.toThrow();
    await expect(repo.grantConsent({ ...base, purposes: ['invalid_unknown_purpose' as any] })).rejects.toThrow();
  });

  it('updates consent with monotonic revision and CAS support', async () => {
    const updated = await repo.grantConsent({
      workspaceId: 'T_CONSENT_01',
      providerId: 'google-vertex',
      policyVersion: 'v2.0.0',
      purposes: ['manual_lookup', 'triage', 'planning'],
      retentionDays: 7,
      organizationRepresentative: 'Jane Doe (VP Tech)',
      evidenceRef: 'DPA-2026-ACME-002',
      recordedBy: 'operator-carol@example.com',
      expectedRevision: 1n,
    });
    expect(updated.policyVersion).toBe('v2.0.0');
    expect(updated.revision).toBe(2n);

    // CAS failure
    await expect(repo.grantConsent({
      workspaceId: 'T_CONSENT_01',
      providerId: 'google-vertex',
      policyVersion: 'v3.0.0',
      purposes: ['manual_lookup'],
      retentionDays: 7,
      organizationRepresentative: 'Rep',
      evidenceRef: 'Ref',
      recordedBy: 'Op',
      expectedRevision: 1n, // Stale!
    })).rejects.toThrow('SLACK_CAS_CONFLICT');
  });

  it('revokes consent with CAS and records event atomically', async () => {
    const revoked = await repo.revokeConsent({
      workspaceId: 'T_CONSENT_01',
      providerId: 'google-vertex',
      recordedBy: 'operator-dave@example.com',
      reason: 'organization_contract_terminated',
      expectedRevision: 2n,
    });
    expect(revoked).not.toBeNull();
    expect(revoked!.status).toBe('revoked');
    expect(revoked!.revokedAt).toBeDefined();
    expect(revoked!.revision).toBe(3n);

    const events = await repo.listPolicyEvents('T_CONSENT_01', 'google-vertex');
    expect(events[0]!.eventType).toBe('consent_revoked');
    expect(events[0]!.reason).toBe('organization_contract_terminated');
    expect(events[0]!.consentRevision).toBe(3n);

    // Stale revision CAS error
    await expect(repo.revokeConsent({
      workspaceId: 'T_CONSENT_01',
      providerId: 'google-vertex',
      recordedBy: 'operator-dave@example.com',
      reason: 'already_revoked',
      expectedRevision: 2n, // Stale!
    })).rejects.toThrow('SLACK_CAS_CONFLICT');
  });

  it('returns null when revoking non-existent consent', async () => {
    const nonExistent = await repo.revokeConsent({
      workspaceId: 'T_NON_EXISTENT',
      providerId: 'google-vertex',
      recordedBy: 'operator@example.com',
      reason: 'testing',
    });
    expect(nonExistent).toBeNull();
  });

  it('handles concurrent grant updates: exactly one CAS succeeds, stale one fails', async () => {
    const workspaceId = 'T_CONCURRENT_RACE';
    // Initial grant
    const initial = await repo.grantConsent({
      workspaceId,
      providerId: 'google-vertex',
      policyVersion: 'v1.0.0',
      purposes: ['manual_lookup'],
      retentionDays: 0,
      organizationRepresentative: 'Rep A',
      evidenceRef: 'Ref A',
      recordedBy: 'opA',
    });
    expect(initial.revision).toBe(1n);

    // Two parallel updates both claiming expectedRevision = 1n
    const results = await Promise.allSettled([
      repo.grantConsent({
        workspaceId,
        providerId: 'google-vertex',
        policyVersion: 'v1.1.0',
        purposes: ['manual_lookup', 'triage'],
        retentionDays: 5,
        organizationRepresentative: 'Rep 1',
        evidenceRef: 'Ref 1',
        recordedBy: 'op1',
        expectedRevision: 1n,
      }),
      repo.grantConsent({
        workspaceId,
        providerId: 'google-vertex',
        policyVersion: 'v1.2.0',
        purposes: ['manual_lookup', 'planning'],
        retentionDays: 10,
        organizationRepresentative: 'Rep 2',
        evidenceRef: 'Ref 2',
        recordedBy: 'op2',
        expectedRevision: 1n,
      }),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toContain('SLACK_CAS_CONFLICT');

    const finalConsent = await repo.getConsent(workspaceId, 'google-vertex');
    expect(finalConsent?.revision).toBe(2n);
  });

  it('can repeat migration 0016 on an existing non-empty schema with zero regression', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const sqlPath = fileURLToPath(new URL('../../../../db/v3/0016_slack_processing_consents.sql', import.meta.url));
    const sql = await readFile(sqlPath, 'utf8');

    // Executing the migration again must be idempotent and not destroy data
    await db.pool.query(sql);

    const consent = await repo.getConsent('T_CONSENT_01', 'google-vertex');
    expect(consent).not.toBeNull();
    expect(consent?.status).toBe('revoked');
  });
});

