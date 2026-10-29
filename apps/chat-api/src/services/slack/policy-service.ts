import type pg from 'pg';
import { validateSlackBinding, type SlackBinding } from '@wap/tool-schemas';
import { ALLOWED_SLACK_PURPOSES, type SlackPurpose } from '../../db/repositories/slack-consent-repo.js';
import { resolveRuntimeProviderIdentity } from '../../config/slack-policy-runtime.js';

export interface SlackPolicyReference {
  workspaceId: string;
  providerId: string;
  policyVersion: string;
  consentRevision: bigint;
  providerRevision: bigint;
  retentionDays: number;
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

  async resolveSlackModelPolicy(input: ResolveSlackModelPolicyInput): Promise<SlackPolicyDecision> {
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
    const connRes = await this.pool.query(
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

    // 2. Resolve runtime provider identity and configuration fingerprint
    const activeEnv = input.env ?? this.runtimeConfig?.env ?? process.env;
    const runtimeProvider = resolveRuntimeProviderIdentity(activeEnv);

    // 3. Query trusted provider in DB
    const providerRes = await this.pool.query(
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
    const consentRes = await this.pool.query(
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

    if (input.expectedPolicyReference) {
      const ref = input.expectedPolicyReference;
      if (ref.policyVersion !== undefined && ref.policyVersion !== consent.policy_version) {
        return deny('policy_changed');
      }
      if (ref.consentRevision !== undefined && BigInt(ref.consentRevision) !== BigInt(consent.revision)) {
        return deny('policy_changed');
      }
      if (ref.providerRevision !== undefined && BigInt(ref.providerRevision) !== BigInt(provider.revision)) {
        return deny('policy_changed');
      }
      if (ref.workspaceId !== undefined && ref.workspaceId !== validBinding.workspaceId) {
        return deny('policy_changed');
      }
      if (ref.providerId !== undefined && ref.providerId !== runtimeProvider.providerId) {
        return deny('policy_changed');
      }
      if (ref.retentionDays !== undefined && ref.retentionDays !== consent.retention_days) {
        return deny('policy_changed');
      }
      if (ref.purpose !== undefined && ref.purpose !== input.purpose) {
        return deny('policy_changed');
      }
      if (ref.requestedRetentionDays !== undefined && ref.requestedRetentionDays !== input.requestedRetentionDays) {
        return deny('retention_exceeded');
      }
      if (ref.binding) {
        if (ref.binding.atiUserId !== undefined && ref.binding.atiUserId !== validBinding.atiUserId) {
          return deny('identity_changed');
        }
        if (ref.binding.connectionId !== undefined && ref.binding.connectionId !== validBinding.connectionId) {
          return deny('identity_changed');
        }
        if (ref.binding.workspaceId !== undefined && ref.binding.workspaceId !== validBinding.workspaceId) {
          return deny('identity_changed');
        }
        if (ref.binding.slackUserId !== undefined && ref.binding.slackUserId !== validBinding.slackUserId) {
          return deny('identity_changed');
        }
        if (ref.binding.identityVersion !== undefined && ref.binding.identityVersion !== validBinding.identityVersion) {
          return deny('identity_changed');
        }
      }
    }

    const authorizedPurposes: string[] = consent.purposes || [];
    if (!authorizedPurposes.includes(input.purpose)) {
      return deny('policy_changed');
    }

    if (!consent.organization_representative || !consent.evidence_ref || !consent.recorded_by || !consent.granted_at) {
      return deny('consent_missing');
    }

    // 5. Retention limit check
    if (
      input.requestedRetentionDays > consent.retention_days ||
      input.requestedRetentionDays > provider.max_retention_days
    ) {
      return deny('retention_exceeded');
    }

    // All fail-closed gates passed
    return {
      allowed: true,
      policyReference: {
        workspaceId: validBinding.workspaceId,
        providerId: runtimeProvider.providerId,
        policyVersion: consent.policy_version,
        consentRevision: BigInt(consent.revision),
        providerRevision: BigInt(provider.revision),
        retentionDays: consent.retention_days,
      },
    };
  }

  async checkProcessingReady(
    workspaceId: string,
    env: Record<string, string | undefined> = this.runtimeConfig?.env ?? process.env
  ): Promise<{ processingReady: boolean; consentStatus: 'pending' | 'granted' | 'revoked' }> {
    const runtimeProvider = resolveRuntimeProviderIdentity(env);

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
