import type pg from 'pg';
import { validateSlackBinding, type SlackBinding } from '@wap/tool-schemas';
import { ALLOWED_SLACK_PURPOSES, type SlackPurpose } from '../../db/repositories/slack-consent-repo.js';
import { resolveRuntimeProviderIdentity } from '../../config/slack-policy-runtime.js';

export interface SlackPolicyReference {
  binding: SlackBinding;
  purpose: SlackPurpose;
  requestedRetentionDays: number;
  providerProfileId: string;
  providerId: string;
  configFingerprint: string;
  configurationFingerprint: string;
  policyVersion: string;
  consentRevision: string;
  providerRevision: string;
  retentionDays: number;
  workspaceId?: string;
}

export type SlackPolicyBlockReason =
  | 'connection_inactive'
  | 'identity_changed'
  | 'consent_missing'
  | 'policy_changed'
  | 'provider_unverified'
  | 'retention_exceeded';

export type SlackPolicyDecision =
  | { allowed: true; policyReference: SlackPolicyReference }
  | { allowed: false; reason: SlackPolicyBlockReason };

export interface SlackPolicyRuntimeConfig {
  env?: Record<string, string | undefined>;
}

export interface ResolveSlackModelPolicyInput {
  binding: SlackBinding;
  purpose: SlackPurpose;
  requestedRetentionDays: number;
  expectedPolicyVersion?: string;
  expectedPolicyReference?: Partial<SlackPolicyReference> & {
    binding?: Partial<SlackBinding>;
    purpose?: SlackPurpose;
    requestedRetentionDays?: number;
  };
  env?: Record<string, string | undefined>;
}

export class SlackPolicyService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly runtimeConfig?: SlackPolicyRuntimeConfig
  ) {}

  /** Pass the caller's query client when authority rows are locked in its transaction.
   * Reusing that client avoids a second pool checkout and keeps every policy read
   * in the same transaction. Decorators must forward the query client as well.
   */
  async resolveSlackModelPolicy(
    input: ResolveSlackModelPolicyInput,
    db: Pick<pg.Pool | pg.PoolClient, 'query'> = this.pool,
  ): Promise<SlackPolicyDecision> {
    const deny = (reason: SlackPolicyBlockReason): SlackPolicyDecision => ({ allowed: false, reason });

    let validBinding: SlackBinding;
    try {
      validBinding = validateSlackBinding(input.binding);
    } catch {
      return deny('identity_changed');
    }

    if (!ALLOWED_SLACK_PURPOSES.includes(input.purpose)) {
      return deny('policy_changed');
    }

    if (
      typeof input.requestedRetentionDays !== 'number' ||
      !Number.isSafeInteger(input.requestedRetentionDays) ||
      input.requestedRetentionDays < 0
    ) {
      return deny('retention_exceeded');
    }

    // 1. Verify connection and identity binding against real DB
    const connRes = await db.query(
      `SELECT c.id, c.user_id, c.workspace_id, c.actor_id, c.identity_version, c.status, u.status AS user_status
       FROM slack_connections c
       JOIN users u ON u.id = c.user_id
       WHERE c.id = $1 AND c.user_id = $2`,
      [validBinding.connectionId, validBinding.atiUserId]
    );

    const conn = connRes.rows[0];
    if (!conn || conn.status !== 'active' || conn.user_status !== 'active') {
      return deny('connection_inactive');
    }

    if (
      conn.workspace_id !== validBinding.workspaceId ||
      conn.actor_id !== validBinding.slackUserId ||
      conn.identity_version !== validBinding.identityVersion
    ) {
      return deny('identity_changed');
    }

    // 2. Resolve runtime provider identity and configuration fingerprint from server-owned config
    const activeEnv = this.runtimeConfig?.env ?? process.env;
    const runtimeProvider = resolveRuntimeProviderIdentity(activeEnv);

    if (
      !runtimeProvider.accountIdentifier ||
      !runtimeProvider.model ||
      !runtimeProvider.endpoint ||
      runtimeProvider.providerId === 'unknown'
    ) {
      return deny('provider_unverified');
    }

    // 3. Query trusted provider in DB
    const providerRes = await db.query(
      'SELECT * FROM slack_trusted_providers WHERE id = $1',
      [runtimeProvider.providerId]
    );
    const provider = providerRes.rows[0];
    if (!provider) {
      return deny('provider_unverified');
    }

    if (
      provider.verified !== true ||
      provider.no_training !== true ||
      provider.configuration_fingerprint !== runtimeProvider.fingerprint ||
      !provider.evidence_ref ||
      !provider.verified_by
    ) {
      return deny('provider_unverified');
    }

    // 4. Query organization processing consent in DB
    const consentRes = await db.query(
      'SELECT * FROM slack_processing_consents WHERE workspace_id = $1 AND provider_id = $2',
      [validBinding.workspaceId, runtimeProvider.providerId]
    );
    const consent = consentRes.rows[0];
    if (!consent || consent.status !== 'granted') {
      return deny('consent_missing');
    }

    if (input.expectedPolicyVersion && consent.policy_version !== input.expectedPolicyVersion) {
      return deny('policy_changed');
    }

    // 5. Consumption checks on expectedPolicyReference
    if (input.expectedPolicyReference) {
      const ref = input.expectedPolicyReference as Partial<SlackPolicyReference>;

      const providerProfileId = ref.providerProfileId ?? ref.providerId;
      const configFingerprint = ref.configFingerprint ?? ref.configurationFingerprint;

      // Require complete canonical expected reference
      if (
        !ref ||
        typeof ref !== 'object' ||
        !ref.binding ||
        !ref.purpose ||
        ref.requestedRetentionDays === undefined ||
        !providerProfileId ||
        !configFingerprint ||
        !ref.policyVersion ||
        ref.consentRevision === undefined ||
        ref.providerRevision === undefined
      ) {
        return deny('policy_changed');
      }

      // Revisions must be canonical decimal strings, not numbers or non-canonical strings
      if (
        typeof ref.consentRevision !== 'string' ||
        typeof ref.providerRevision !== 'string'
      ) {
        return deny('policy_changed');
      }

      const CANONICAL_REVISION_RE = /^[1-9][0-9]*$/;
      if (
        !CANONICAL_REVISION_RE.test(ref.consentRevision) ||
        !CANONICAL_REVISION_RE.test(ref.providerRevision)
      ) {
        return deny('policy_changed');
      }

      // Check binding tampering
      const b = ref.binding;
      if (
        !b ||
        typeof b !== 'object' ||
        b.atiUserId !== validBinding.atiUserId ||
        b.connectionId !== validBinding.connectionId ||
        b.workspaceId !== validBinding.workspaceId ||
        b.slackUserId !== validBinding.slackUserId ||
        b.identityVersion !== validBinding.identityVersion
      ) {
        return deny('identity_changed');
      }

      // Check purpose tampering
      if (ref.purpose !== input.purpose) {
        return deny('policy_changed');
      }

      // Check requested retention tampering
      if (ref.requestedRetentionDays !== input.requestedRetentionDays) {
        return deny('retention_exceeded');
      }

      // Check provider and fingerprint
      if (
        providerProfileId !== runtimeProvider.providerId ||
        configFingerprint !== runtimeProvider.fingerprint
      ) {
        return deny('provider_unverified');
      }

      // Check policy version and revisions
      if (
        ref.policyVersion !== consent.policy_version ||
        ref.consentRevision !== String(consent.revision) ||
        ref.providerRevision !== String(provider.revision) ||
        (ref.retentionDays !== undefined && ref.retentionDays !== consent.retention_days)
      ) {
        return deny('policy_changed');
      }
    }

    const authorizedPurposes: string[] = consent.purposes || [];
    if (!authorizedPurposes.includes(input.purpose)) {
      return deny('policy_changed');
    }

    if (!consent.organization_representative || !consent.evidence_ref || !consent.recorded_by || !consent.granted_at) {
      return deny('consent_missing');
    }

    // 6. Retention limit check
    if (
      input.requestedRetentionDays > consent.retention_days ||
      input.requestedRetentionDays > provider.max_retention_days
    ) {
      return deny('retention_exceeded');
    }

    // All fail-closed gates passed -> return JSON-safe policy reference
    return {
      allowed: true,
      policyReference: {
        binding: {
          atiUserId: validBinding.atiUserId,
          connectionId: validBinding.connectionId,
          workspaceId: validBinding.workspaceId,
          slackUserId: validBinding.slackUserId,
          identityVersion: validBinding.identityVersion,
        },
        purpose: input.purpose,
        requestedRetentionDays: input.requestedRetentionDays,
        providerProfileId: runtimeProvider.providerId,
        providerId: runtimeProvider.providerId,
        configFingerprint: runtimeProvider.fingerprint,
        configurationFingerprint: runtimeProvider.fingerprint,
        policyVersion: consent.policy_version,
        consentRevision: String(consent.revision),
        providerRevision: String(provider.revision),
        retentionDays: consent.retention_days,
        workspaceId: validBinding.workspaceId,
      },
    };
  }

  async checkProcessingReady(
    workspaceId: string,
    env: Record<string, string | undefined> = this.runtimeConfig?.env ?? process.env
  ): Promise<{ processingReady: boolean; consentStatus: 'pending' | 'granted' | 'revoked' }> {
    const runtimeProvider = resolveRuntimeProviderIdentity(env);

    if (
      !runtimeProvider.accountIdentifier ||
      !runtimeProvider.model ||
      !runtimeProvider.endpoint ||
      runtimeProvider.providerId === 'unknown'
    ) {
      return { processingReady: false, consentStatus: 'pending' };
    }

    const consentRes = await this.pool.query(
      'SELECT * FROM slack_processing_consents WHERE workspace_id = $1 AND provider_id = $2',
      [workspaceId, runtimeProvider.providerId]
    );
    const consent = consentRes.rows[0];

    if (!consent) {
      return { processingReady: false, consentStatus: 'pending' };
    }

    if (consent.status === 'revoked') {
      return { processingReady: false, consentStatus: 'revoked' };
    }

    if (consent.status !== 'granted') {
      return { processingReady: false, consentStatus: 'pending' };
    }

    // status === 'granted'
    const providerRes = await this.pool.query(
      'SELECT * FROM slack_trusted_providers WHERE id = $1',
      [runtimeProvider.providerId]
    );
    const provider = providerRes.rows[0];

    const isProviderReady =
      provider &&
      provider.verified === true &&
      provider.no_training === true &&
      provider.configuration_fingerprint === runtimeProvider.fingerprint &&
      Boolean(provider.evidence_ref) &&
      Boolean(provider.verified_by) &&
      Boolean(provider.verified_at);

    const isConsentValid =
      Boolean(consent.organization_representative) &&
      Boolean(consent.evidence_ref) &&
      Boolean(consent.recorded_by) &&
      Boolean(consent.granted_at) &&
      Array.isArray(consent.purposes) &&
      consent.purposes.length > 0 &&
      consent.retention_days >= 0 &&
      provider &&
      consent.retention_days <= provider.max_retention_days;

    return {
      processingReady: Boolean(isProviderReady && isConsentValid),
      consentStatus: 'granted',
    };
  }
}
