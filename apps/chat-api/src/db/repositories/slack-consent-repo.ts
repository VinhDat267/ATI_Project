import type pg from 'pg';

export type SlackProcessingConsentStatus = 'pending' | 'granted' | 'revoked';
export type SlackPurpose = 'manual_lookup' | 'triage' | 'planning' | 'digest' | 'storage';

export const ALLOWED_SLACK_PURPOSES: readonly SlackPurpose[] = [
  'manual_lookup',
  'triage',
  'planning',
  'digest',
  'storage',
] as const;

const ALLOWED_PURPOSES_SET = new Set<string>(ALLOWED_SLACK_PURPOSES);

export interface TrustedProviderRow {
  id: string;
  name: string;
  verified: boolean;
  noTraining: boolean;
  maxRetentionDays: number;
  configurationFingerprint: string;
  evidenceRef: string | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  revision: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface SlackConsentRow {
  id: string;
  workspaceId: string;
  providerId: string;
  policyVersion: string;
  revision: bigint;
  status: SlackProcessingConsentStatus;
  purposes: SlackPurpose[];
  retentionDays: number;
  organizationRepresentative: string | null;
  evidenceRef: string | null;
  recordedBy: string | null;
  grantedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SlackPolicyEventRow {
  id: string;
  workspaceId: string;
  providerId: string;
  eventType: 'consent_granted' | 'consent_revoked' | 'provider_attested' | 'provider_updated';
  policyVersion: string;
  consentRevision: bigint;
  providerRevision: bigint | null;
  reason: string;
  occurredAt: Date;
}

export interface AttestProviderInput {
  id: string;
  name: string;
  verified: boolean;
  noTraining: boolean;
  maxRetentionDays: number;
  configurationFingerprint: string;
  evidenceRef?: string;
  verifiedBy?: string;
  verifiedAt?: Date | string;
  expectedRevision?: bigint | number;
}

export interface GrantConsentInput {
  workspaceId: string;
  providerId: string;
  policyVersion: string;
  purposes: SlackPurpose[];
  retentionDays: number;
  organizationRepresentative: string;
  evidenceRef: string;
  recordedBy: string;
  grantedAt?: Date | string;
  expectedRevision?: bigint | number;
}

export interface RevokeConsentInput {
  workspaceId: string;
  providerId: string;
  recordedBy: string;
  reason: string;
  revokedAt?: Date | string;
  expectedRevision?: bigint | number;
}

function requireNonBlank(val: unknown, fieldName: string): string {
  if (typeof val !== 'string' || val.trim().length === 0) {
    throw new TypeError(`Field '${fieldName}' must be a non-blank string`);
  }
  return val.trim();
}

function requireSafeNonNegativeInt(val: unknown, fieldName: string): number {
  if (typeof val !== 'number' || !Number.isSafeInteger(val) || val < 0) {
    throw new TypeError(`Field '${fieldName}' must be a non-negative safe integer (>= 0)`);
  }
  return val;
}

function mapProviderRow(raw: any): TrustedProviderRow {
  return {
    id: raw.id,
    name: raw.name,
    verified: raw.verified,
    noTraining: raw.no_training,
    maxRetentionDays: raw.max_retention_days,
    configurationFingerprint: raw.configuration_fingerprint,
    evidenceRef: raw.evidence_ref ?? null,
    verifiedBy: raw.verified_by ?? null,
    verifiedAt: raw.verified_at ? new Date(raw.verified_at) : null,
    revision: BigInt(raw.revision),
    createdAt: new Date(raw.created_at),
    updatedAt: new Date(raw.updated_at),
  };
}

function mapConsentRow(raw: any): SlackConsentRow {
  return {
    id: raw.id,
    workspaceId: raw.workspace_id,
    providerId: raw.provider_id,
    policyVersion: raw.policy_version,
    revision: BigInt(raw.revision),
    status: raw.status as SlackProcessingConsentStatus,
    purposes: (raw.purposes || []) as SlackPurpose[],
    retentionDays: raw.retention_days,
    organizationRepresentative: raw.organization_representative ?? null,
    evidenceRef: raw.evidence_ref ?? null,
    recordedBy: raw.recorded_by ?? null,
    grantedAt: raw.granted_at ? new Date(raw.granted_at) : null,
    revokedAt: raw.revoked_at ? new Date(raw.revoked_at) : null,
    createdAt: new Date(raw.created_at),
    updatedAt: new Date(raw.updated_at),
  };
}

function mapEventRow(raw: any): SlackPolicyEventRow {
  return {
    id: raw.id,
    workspaceId: raw.workspace_id,
    providerId: raw.provider_id,
    eventType: raw.event_type,
    policyVersion: raw.policy_version,
    consentRevision: BigInt(raw.consent_revision),
    providerRevision: raw.provider_revision != null ? BigInt(raw.provider_revision) : null,
    reason: raw.reason,
    occurredAt: new Date(raw.occurred_at),
  };
}

export class SlackConsentRepo {
  constructor(private readonly pool: pg.Pool) {}

  async attestProvider(input: AttestProviderInput): Promise<TrustedProviderRow> {
    const id = requireNonBlank(input.id, 'id');
    const name = requireNonBlank(input.name, 'name');
    const configurationFingerprint = requireNonBlank(input.configurationFingerprint, 'configurationFingerprint');
    const maxRetentionDays = requireSafeNonNegativeInt(input.maxRetentionDays, 'maxRetentionDays');

    if (input.verified === true) {
      if (input.noTraining !== true) {
        throw new Error('Verified provider must guarantee noTraining === true');
      }
      if (!input.evidenceRef || input.evidenceRef.trim().length === 0) {
        throw new Error('Verified provider requires non-blank evidenceRef');
      }
      if (!input.verifiedBy || input.verifiedBy.trim().length === 0) {
        throw new Error('Verified provider requires non-blank verifiedBy');
      }
      if (!input.verifiedAt) {
        throw new Error('Verified provider requires verifiedAt');
      }
    }

    const verifiedAt = input.verifiedAt ? new Date(input.verifiedAt) : (input.verified ? new Date() : null);
    const evidenceRef = input.evidenceRef?.trim() || null;
    const verifiedBy = input.verifiedBy?.trim() || null;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const existingRes = await client.query('SELECT revision FROM slack_trusted_providers WHERE id = $1 FOR UPDATE', [id]);
      const existing = existingRes.rows[0];

      let row: any;
      let eventType: 'provider_attested' | 'provider_updated';

      if (!existing) {
        if (input.expectedRevision !== undefined) {
          throw new Error('SLACK_CAS_CONFLICT: New provider must not specify expectedRevision');
        }
        const insertRes = await client.query(
          `INSERT INTO slack_trusted_providers (
            id, name, verified, no_training, max_retention_days,
            configuration_fingerprint, evidence_ref, verified_by, verified_at, revision
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1) RETURNING *`,
          [id, name, input.verified, input.noTraining, maxRetentionDays, configurationFingerprint, evidenceRef, verifiedBy, verifiedAt]
        );
        row = insertRes.rows[0];
        eventType = 'provider_attested';
      } else {
        if (input.expectedRevision === undefined) {
          throw new Error('SLACK_CAS_REVISION_REQUIRED: Updating existing provider requires expectedRevision');
        }
        if (BigInt(existing.revision) !== BigInt(input.expectedRevision)) {
          throw new Error('SLACK_CAS_CONFLICT: Provider revision mismatch');
        }
        const updateRes = await client.query(
          `UPDATE slack_trusted_providers SET
            name = $2,
            verified = $3,
            no_training = $4,
            max_retention_days = $5,
            configuration_fingerprint = $6,
            evidence_ref = $7,
            verified_by = $8,
            verified_at = $9,
            revision = revision + 1,
            updated_at = now()
          WHERE id = $1 RETURNING *`,
          [id, name, input.verified, input.noTraining, maxRetentionDays, configurationFingerprint, evidenceRef, verifiedBy, verifiedAt]
        );
        row = updateRes.rows[0];
        eventType = 'provider_updated';
      }

      const mapped = mapProviderRow(row);

      await client.query(
        `INSERT INTO slack_policy_events (
          workspace_id, provider_id, event_type, policy_version,
          consent_revision, provider_revision, reason, occurred_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
        ['*', id, eventType, '*', 0, mapped.revision, 'operator_attestation']
      );

      await client.query('COMMIT');
      return mapped;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getTrustedProvider(providerId: string): Promise<TrustedProviderRow | null> {
    const res = await this.pool.query('SELECT * FROM slack_trusted_providers WHERE id = $1', [providerId]);
    return res.rows[0] ? mapProviderRow(res.rows[0]) : null;
  }

  async listTrustedProviders(): Promise<TrustedProviderRow[]> {
    const res = await this.pool.query('SELECT * FROM slack_trusted_providers ORDER BY id');
    return res.rows.map(mapProviderRow);
  }

  async grantConsent(input: GrantConsentInput): Promise<SlackConsentRow> {
    const workspaceId = requireNonBlank(input.workspaceId, 'workspaceId');
    const providerId = requireNonBlank(input.providerId, 'providerId');
    const policyVersion = requireNonBlank(input.policyVersion, 'policyVersion');
    const organizationRepresentative = requireNonBlank(input.organizationRepresentative, 'organizationRepresentative');
    const evidenceRef = requireNonBlank(input.evidenceRef, 'evidenceRef');
    const recordedBy = requireNonBlank(input.recordedBy, 'recordedBy');
    const retentionDays = requireSafeNonNegativeInt(input.retentionDays, 'retentionDays');

    if (!Array.isArray(input.purposes) || input.purposes.length === 0) {
      throw new TypeError("Field 'purposes' must be a non-empty array of valid purposes");
    }
    for (const p of input.purposes) {
      if (!ALLOWED_PURPOSES_SET.has(p)) {
        throw new TypeError(`Invalid purpose: ${p}. Allowed: ${ALLOWED_SLACK_PURPOSES.join(', ')}`);
      }
    }

    const grantedAt = input.grantedAt ? new Date(input.grantedAt) : new Date();

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const providerRes = await client.query('SELECT revision FROM slack_trusted_providers WHERE id = $1 FOR UPDATE', [providerId]);
      if (!providerRes.rows[0]) {
        throw new Error(`Provider '${providerId}' is not registered in slack_trusted_providers`);
      }
      const providerRevision = BigInt(providerRes.rows[0].revision);

      const existingRes = await client.query(
        'SELECT revision FROM slack_processing_consents WHERE workspace_id = $1 AND provider_id = $2 FOR UPDATE',
        [workspaceId, providerId]
      );
      const existing = existingRes.rows[0];

      let row: any;

      if (!existing) {
        if (input.expectedRevision !== undefined) {
          throw new Error('SLACK_CAS_CONFLICT: New consent must not specify expectedRevision');
        }
        const insertRes = await client.query(
          `INSERT INTO slack_processing_consents (
            workspace_id, provider_id, policy_version, revision, status,
            purposes, retention_days, organization_representative, evidence_ref,
            recorded_by, granted_at
          ) VALUES ($1, $2, $3, 1, 'granted', $4, $5, $6, $7, $8, $9) RETURNING *`,
          [workspaceId, providerId, policyVersion, input.purposes, retentionDays, organizationRepresentative, evidenceRef, recordedBy, grantedAt]
        );
        row = insertRes.rows[0];
      } else {
        if (input.expectedRevision === undefined) {
          throw new Error('SLACK_CAS_REVISION_REQUIRED: Updating existing consent requires expectedRevision');
        }
        if (BigInt(existing.revision) !== BigInt(input.expectedRevision)) {
          throw new Error('SLACK_CAS_CONFLICT: Consent revision mismatch');
        }
        const updateRes = await client.query(
          `UPDATE slack_processing_consents SET
            policy_version = $3,
            status = 'granted',
            purposes = $4,
            retention_days = $5,
            organization_representative = $6,
            evidence_ref = $7,
            recorded_by = $8,
            granted_at = $9,
            revoked_at = NULL,
            revision = revision + 1,
            updated_at = now()
          WHERE workspace_id = $1 AND provider_id = $2 RETURNING *`,
          [workspaceId, providerId, policyVersion, input.purposes, retentionDays, organizationRepresentative, evidenceRef, recordedBy, grantedAt]
        );
        row = updateRes.rows[0];
      }

      const mapped = mapConsentRow(row);

      await client.query(
        `INSERT INTO slack_policy_events (
          workspace_id, provider_id, event_type, policy_version,
          consent_revision, provider_revision, reason, occurred_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
        [workspaceId, providerId, 'consent_granted', policyVersion, mapped.revision, providerRevision, 'operator_grant']
      );

      await client.query('COMMIT');
      return mapped;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async revokeConsent(input: RevokeConsentInput): Promise<SlackConsentRow | null> {
    const workspaceId = requireNonBlank(input.workspaceId, 'workspaceId');
    const providerId = requireNonBlank(input.providerId, 'providerId');
    const recordedBy = requireNonBlank(input.recordedBy, 'recordedBy');
    const reason = requireNonBlank(input.reason, 'reason');
    const revokedAt = input.revokedAt ? new Date(input.revokedAt) : new Date();

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const consentRes = await client.query(
        'SELECT * FROM slack_processing_consents WHERE workspace_id = $1 AND provider_id = $2 FOR UPDATE',
        [workspaceId, providerId]
      );
      const existing = consentRes.rows[0];
      if (!existing) {
        await client.query('ROLLBACK');
        return null;
      }

      if (input.expectedRevision === undefined) {
        throw new Error('SLACK_CAS_REVISION_REQUIRED: Revoking consent requires expectedRevision');
      }

      if (BigInt(existing.revision) !== BigInt(input.expectedRevision)) {
        throw new Error('SLACK_CAS_CONFLICT: Consent revision mismatch');
      }

      const providerRes = await client.query('SELECT revision FROM slack_trusted_providers WHERE id = $1', [providerId]);
      const providerRevision = providerRes.rows[0] ? BigInt(providerRes.rows[0].revision) : null;

      const updateRes = await client.query(
        `UPDATE slack_processing_consents SET
          status = 'revoked',
          revoked_at = $3,
          recorded_by = $4,
          revision = revision + 1,
          updated_at = now()
        WHERE workspace_id = $1 AND provider_id = $2 RETURNING *`,
        [workspaceId, providerId, revokedAt, recordedBy]
      );
      const row = updateRes.rows[0];
      const mapped = mapConsentRow(row);

      await client.query(
        `INSERT INTO slack_policy_events (
          workspace_id, provider_id, event_type, policy_version,
          consent_revision, provider_revision, reason, occurred_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
        [workspaceId, providerId, 'consent_revoked', mapped.policyVersion, mapped.revision, providerRevision, reason]
      );

      await client.query('COMMIT');
      return mapped;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getConsent(workspaceId: string, providerId: string): Promise<SlackConsentRow | null> {
    const res = await this.pool.query(
      'SELECT * FROM slack_processing_consents WHERE workspace_id = $1 AND provider_id = $2',
      [workspaceId, providerId]
    );
    return res.rows[0] ? mapConsentRow(res.rows[0]) : null;
  }

  async listConsentsForWorkspace(workspaceId: string): Promise<SlackConsentRow[]> {
    const res = await this.pool.query(
      'SELECT * FROM slack_processing_consents WHERE workspace_id = $1 ORDER BY provider_id',
      [workspaceId]
    );
    return res.rows.map(mapConsentRow);
  }

  async listPolicyEvents(workspaceId?: string, providerId?: string): Promise<SlackPolicyEventRow[]> {
    let query = 'SELECT * FROM slack_policy_events';
    const params: any[] = [];
    const conditions: string[] = [];

    if (workspaceId && workspaceId !== '*') {
      params.push(workspaceId);
      conditions.push(`workspace_id = $${params.length}`);
    }
    if (providerId && providerId !== '*') {
      params.push(providerId);
      conditions.push(`provider_id = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ' ORDER BY occurred_at DESC, id DESC';

    const res = await this.pool.query(query, params);
    return res.rows.map(mapEventRow);
  }
}
