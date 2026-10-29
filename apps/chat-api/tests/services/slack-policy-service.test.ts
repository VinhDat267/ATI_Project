import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigratedSchema } from '../helpers/gmail-test-db.js';
import { SlackPolicyService } from '../../src/services/slack/policy-service.js';
import { SlackConsentRepo } from '../../src/db/repositories/slack-consent-repo.js';
import { SlackConnectionRepo } from '../../src/db/repositories/slack-connection-repo.js';
import { resolveRuntimeProviderIdentity } from '../../src/config/slack-policy-runtime.js';
import { randomBytes, createHash } from 'node:crypto';

describe('SlackPolicyService fail-closed authorization', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;
  let policyService: SlackPolicyService;
  let consentRepo: SlackConsentRepo;
  let connectionRepo: SlackConnectionRepo;
  let alice: Awaited<ReturnType<Awaited<ReturnType<typeof createMigratedSchema>>['person']>>;
  let connectionId: string;

  const mockEnv = {
    LLM_PROVIDER: 'gemini',
    GEMINI_MODEL: 'gemini-2.5-flash',
    RUNTIME_ACCOUNT_ID: 'TEST_POLICY_ACCOUNT',
  };
  const runtimeIdentity = resolveRuntimeProviderIdentity(mockEnv);

  beforeAll(async () => {
    db = await createMigratedSchema('slack_policy_svc');
    consentRepo = new SlackConsentRepo(db.pool);
    connectionRepo = new SlackConnectionRepo(db.pool);
    policyService = new SlackPolicyService(db.pool, { env: mockEnv });
    alice = await db.person('Alice');

    // Setup active connection for Alice
    const state = randomBytes(32).toString('base64url');
    const browser = randomBytes(32).toString('base64url');
    const hash = (s: string) => createHash('sha256').update(s).digest('hex');
    await connectionRepo.start({ userId: alice.id, sessionId: alice.sid, stateHash: hash(state), browserHash: hash(browser) });
    const consumed = await connectionRepo.consume({ userId: alice.id, sessionId: alice.sid, state, browser });
    const saved = await connectionRepo.save(alice.id, consumed!.id, {
      appId: 'A_TEST',
      workspaceId: 'T_POLICY_01',
      workspaceName: 'Policy Workspace',
      actorId: 'U_ALICE_SLACK',
      config: 'ENCRYPTED_CONFIG',
      scopes: ['chat:write', 'channels:history'],
    });
    connectionId = saved!.id;

    // Attest provider matching runtime identity
    await consentRepo.attestProvider({
      id: runtimeIdentity.providerId,
      name: runtimeIdentity.name,
      verified: true,
      noTraining: true,
      maxRetentionDays: 30,
      configurationFingerprint: runtimeIdentity.fingerprint,
      evidenceRef: 'POLICY-EVIDENCE-001',
      verifiedBy: 'security-officer@example.com',
      verifiedAt: new Date(),
    });

    // Grant consent for T_POLICY_01
    await consentRepo.grantConsent({
      workspaceId: 'T_POLICY_01',
      providerId: runtimeIdentity.providerId,
      policyVersion: 'v1.0.0',
      purposes: ['manual_lookup', 'triage', 'planning'],
      retentionDays: 14,
      organizationRepresentative: 'Bob Legal',
      evidenceRef: 'DPA-POLICY-01',
      recordedBy: 'operator@example.com',
    });
  });

  afterAll(async () => {
    await db?.close();
  });

  it('allows model use when all 6 criteria are satisfied', async () => {
    const decision = await policyService.resolveSlackModelPolicy({
      binding: {
        atiUserId: alice.id,
        connectionId,
        workspaceId: 'T_POLICY_01',
        slackUserId: 'U_ALICE_SLACK',
        identityVersion: 1,
      },
      purpose: 'triage',
      requestedRetentionDays: 0,
      env: mockEnv,
    });

    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.policyReference.workspaceId).toBe('T_POLICY_01');
      expect(decision.policyReference.providerId).toBe(runtimeIdentity.providerId);
      expect(decision.policyReference.providerProfileId).toBe(runtimeIdentity.providerId);
      expect(decision.policyReference.configFingerprint).toBe(runtimeIdentity.fingerprint);
      expect(decision.policyReference.policyVersion).toBe('v1.0.0');
      expect(decision.policyReference.consentRevision).toBe('1');
      expect(decision.policyReference.providerRevision).toBe('1');
      // Zero secrets present and serializes to ordinary JSON without bigint replacer
      expect(JSON.stringify(decision)).not.toContain('ENCRYPTED_CONFIG');
    }
  });

  it('fails with connection_inactive if connection does not exist or is disconnected', async () => {
    const decision = await policyService.resolveSlackModelPolicy({
      binding: {
        atiUserId: alice.id,
        connectionId: '00000000-0000-4000-8000-000000000000',
        workspaceId: 'T_NON_EXISTENT_WS',
        slackUserId: 'U_OTHER',
        identityVersion: 1,
      },
      purpose: 'triage',
      requestedRetentionDays: 0,
      env: mockEnv,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('connection_inactive');
    }
  });

  it('fails with identity_changed if binding slackUserId or identityVersion mismatches DB', async () => {
    const decision = await policyService.resolveSlackModelPolicy({
      binding: {
        atiUserId: alice.id,
        connectionId,
        workspaceId: 'T_POLICY_01',
        slackUserId: 'U_ALICE_SLACK',
        identityVersion: 999, // Stale!
      },
      purpose: 'triage',
      requestedRetentionDays: 0,
      env: mockEnv,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('identity_changed');
    }
  });

  it('fails with consent_missing if consent is revoked or missing', async () => {
    await consentRepo.revokeConsent({
      workspaceId: 'T_POLICY_01',
      providerId: runtimeIdentity.providerId,
      reason: 'security_audit',
      recordedBy: 'operator@example.com',
      expectedRevision: 1n,
    });

    const decision = await policyService.resolveSlackModelPolicy({
      binding: {
        atiUserId: alice.id,
        connectionId,
        workspaceId: 'T_POLICY_01',
        slackUserId: 'U_ALICE_SLACK',
        identityVersion: 1,
      },
      purpose: 'triage',
      requestedRetentionDays: 0,
      env: mockEnv,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('consent_missing');
    }

    // Restore consent for subsequent tests
    await consentRepo.grantConsent({
      workspaceId: 'T_POLICY_01',
      providerId: runtimeIdentity.providerId,
      policyVersion: 'v1.0.0',
      purposes: ['manual_lookup', 'triage', 'planning'],
      retentionDays: 14,
      organizationRepresentative: 'Bob Legal',
      evidenceRef: 'DPA-POLICY-01',
      recordedBy: 'operator@example.com',
      expectedRevision: 2n,
    });
  });

  it('fails with policy_changed if requested purpose is not authorized or policyVersion mismatches', async () => {
    // Purpose 'digest' is not in granted purposes ['manual_lookup', 'triage', 'planning']
    const decisionPurpose = await policyService.resolveSlackModelPolicy({
      binding: {
        atiUserId: alice.id,
        connectionId,
        workspaceId: 'T_POLICY_01',
        slackUserId: 'U_ALICE_SLACK',
        identityVersion: 1,
      },
      purpose: 'digest',
      requestedRetentionDays: 0,
      env: mockEnv,
    });
    expect(decisionPurpose.allowed).toBe(false);
    if (!decisionPurpose.allowed) {
      expect(decisionPurpose.reason).toBe('policy_changed');
    }

    // Expected policyVersion mismatch
    const decisionVersion = await policyService.resolveSlackModelPolicy({
      binding: {
        atiUserId: alice.id,
        connectionId,
        workspaceId: 'T_POLICY_01',
        slackUserId: 'U_ALICE_SLACK',
        identityVersion: 1,
      },
      purpose: 'triage',
      requestedRetentionDays: 0,
      expectedPolicyVersion: 'v2.0.0-future',
      env: mockEnv,
    });
    expect(decisionVersion.allowed).toBe(false);
    if (!decisionVersion.allowed) {
      expect(decisionVersion.reason).toBe('policy_changed');
    }
  });

  it('fails with provider_unverified if runtime configuration changes without re-attestation', async () => {
    // Model changed to gemini-1.5-pro -> fingerprint changes
    const alteredEnv = {
      LLM_PROVIDER: 'gemini',
      GEMINI_MODEL: 'gemini-1.5-pro',
      RUNTIME_ACCOUNT_ID: 'TEST_POLICY_ACCOUNT',
    };
    const alteredPolicyService = new SlackPolicyService(db.pool, { env: alteredEnv });

    const decision = await alteredPolicyService.resolveSlackModelPolicy({
      binding: {
        atiUserId: alice.id,
        connectionId,
        workspaceId: 'T_POLICY_01',
        slackUserId: 'U_ALICE_SLACK',
        identityVersion: 1,
      },
      purpose: 'triage',
      requestedRetentionDays: 0,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('provider_unverified');
    }
  });

  it('fails with retention_exceeded if requested retention exceeds consent or provider limit', async () => {
    const decision = await policyService.resolveSlackModelPolicy({
      binding: {
        atiUserId: alice.id,
        connectionId,
        workspaceId: 'T_POLICY_01',
        slackUserId: 'U_ALICE_SLACK',
        identityVersion: 1,
      },
      purpose: 'triage',
      requestedRetentionDays: 365, // Exceeds consent 14 and provider max 30
      env: mockEnv,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('retention_exceeded');
    }
  });

  it('calculates checkProcessingReady correctly for workspace', async () => {
    const ready = await policyService.checkProcessingReady('T_POLICY_01', mockEnv);
    expect(ready.processingReady).toBe(true);
    expect(ready.consentStatus).toBe('granted');

    const pending = await policyService.checkProcessingReady('T_UNKNOWN_WORKSPACE', mockEnv);
    expect(pending.processingReady).toBe(false);
    expect(pending.consentStatus).toBe('pending');
  });

  it('rejects stale expectedPolicyReference after consent revocation and regrant', async () => {
    const initialDecision = await policyService.resolveSlackModelPolicy({
      binding: {
        atiUserId: alice.id,
        connectionId,
        workspaceId: 'T_POLICY_01',
        slackUserId: 'U_ALICE_SLACK',
        identityVersion: 1,
      },
      purpose: 'triage',
      requestedRetentionDays: 0,
      env: mockEnv,
    });
    expect(initialDecision.allowed).toBe(true);
    const staleRef = (initialDecision as any).policyReference;

    // Revoke consent (revision -> 4)
    await consentRepo.revokeConsent({
      workspaceId: 'T_POLICY_01',
      providerId: runtimeIdentity.providerId,
      reason: 'rotation',
      recordedBy: 'operator@example.com',
      expectedRevision: 3n,
    });

    // Regrant consent with same policyVersion (revision -> 5)
    await consentRepo.grantConsent({
      workspaceId: 'T_POLICY_01',
      providerId: runtimeIdentity.providerId,
      policyVersion: 'v1.0.0',
      purposes: ['manual_lookup', 'triage', 'planning'],
      retentionDays: 14,
      organizationRepresentative: 'Bob Legal',
      evidenceRef: 'DPA-POLICY-01',
      recordedBy: 'operator@example.com',
      expectedRevision: 4n,
    });

    // Resolver must reject stale reference whose consentRevision is 3n when current is 5n
    const staleCheck = await policyService.resolveSlackModelPolicy({
      binding: {
        atiUserId: alice.id,
        connectionId,
        workspaceId: 'T_POLICY_01',
        slackUserId: 'U_ALICE_SLACK',
        identityVersion: 1,
      },
      purpose: 'triage',
      requestedRetentionDays: 0,
      expectedPolicyVersion: 'v1.0.0',
      expectedPolicyReference: staleRef,
      env: mockEnv,
    });
    expect(staleCheck.allowed).toBe(false);
    if (!staleCheck.allowed) {
      expect(staleCheck.reason).toBe('policy_changed');
    }
  });

  it('marks processingReady false when consent retention exceeds provider max retention cap', async () => {
    const envLowCap = {
      LLM_PROVIDER: 'openai-compatible',
      LLM_MODEL: 'test-model',
      LLM_BASE_URL: 'http://127.0.0.1:8000',
      RUNTIME_ACCOUNT_ID: 'TEST_ACCT',
    };
    const runtimeLowCap = resolveRuntimeProviderIdentity(envLowCap);
    const existing = await consentRepo.getTrustedProvider(runtimeLowCap.providerId);

    // Provider with maxRetentionDays = 5
    await consentRepo.attestProvider({
      id: runtimeLowCap.providerId,
      name: runtimeLowCap.name,
      verified: true,
      noTraining: true,
      maxRetentionDays: 5,
      configurationFingerprint: runtimeLowCap.fingerprint,
      evidenceRef: 'EVID-LOW-CAP',
      verifiedBy: 'operator@example.com',
      verifiedAt: new Date(),
      expectedRevision: existing?.revision,
    });

    const existingConsent = await consentRepo.getConsent('T_EXCEED_CAP', runtimeLowCap.providerId);
    // Consent with retentionDays = 10 (exceeds 5)
    await consentRepo.grantConsent({
      workspaceId: 'T_EXCEED_CAP',
      providerId: runtimeLowCap.providerId,
      policyVersion: 'v1.0.0',
      purposes: ['triage'],
      retentionDays: 10,
      organizationRepresentative: 'Rep',
      evidenceRef: 'DPA',
      recordedBy: 'operator',
      expectedRevision: existingConsent?.revision,
    });

    const ready = await policyService.checkProcessingReady('T_EXCEED_CAP', envLowCap);
    expect(ready.processingReady).toBe(false);
    expect(ready.consentStatus).toBe('granted');
  });

  it('rejects empty expectedPolicyReference and missing binding', async () => {
    const valid = await policyService.resolveSlackModelPolicy({
      binding: {
        atiUserId: alice.id,
        connectionId,
        workspaceId: 'T_POLICY_01',
        slackUserId: 'U_ALICE_SLACK',
        identityVersion: 1,
      },
      purpose: 'triage',
      requestedRetentionDays: 0,
      env: mockEnv,
    });
    expect(valid.allowed).toBe(true);
    const ref = (valid as any).policyReference;

    // Empty expectedPolicyReference
    const emptyCheck = await policyService.resolveSlackModelPolicy({
      binding: {
        atiUserId: alice.id,
        connectionId,
        workspaceId: 'T_POLICY_01',
        slackUserId: 'U_ALICE_SLACK',
        identityVersion: 1,
      },
      purpose: 'triage',
      requestedRetentionDays: 0,
      expectedPolicyReference: {} as any,
      env: mockEnv,
    });
    expect(emptyCheck.allowed).toBe(false);

    // Missing binding in expectedPolicyReference
    const missingBinding = { ...ref };
    delete missingBinding.binding;
    const missingBindingCheck = await policyService.resolveSlackModelPolicy({
      binding: {
        atiUserId: alice.id,
        connectionId,
        workspaceId: 'T_POLICY_01',
        slackUserId: 'U_ALICE_SLACK',
        identityVersion: 1,
      },
      purpose: 'triage',
      requestedRetentionDays: 0,
      expectedPolicyReference: missingBinding,
      env: mockEnv,
    });
    expect(missingBindingCheck.allowed).toBe(false);

    // Noncanonical revision string e.g. '01'
    const noncanonicalCheck = await policyService.resolveSlackModelPolicy({
      binding: {
        atiUserId: alice.id,
        connectionId,
        workspaceId: 'T_POLICY_01',
        slackUserId: 'U_ALICE_SLACK',
        identityVersion: 1,
      },
      purpose: 'triage',
      requestedRetentionDays: 0,
      expectedPolicyReference: { ...ref, consentRevision: '01' },
      env: mockEnv,
    });
    expect(noncanonicalCheck.allowed).toBe(false);
  });
});
