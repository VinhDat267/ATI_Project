import type pg from 'pg';
import {
  formatSlackOwnerSourceKey,
  validateSlackSourceRef,
  validateSlackPolicyReference,
  sameSlackBinding,
  slackPolicyRefToEpoch,
  RAW_SOURCE_MAX_RETENTION_DAYS,
  type SlackSourceRef,
  type SlackPolicyReference,
  type SlackSourceMetadata,
  type SlackTombstoneReason,
  type SlackPurgeTarget,
} from '@wap/tool-schemas';
import { hashPolicyEpoch } from '../../services/slack/slack-invalidation-service.js';

export interface SlackSourceRecord {
  id: string;
  ownerSourceKey: string;
  userId: string;
  connectionId: string;
  workspaceId: string;
  slackUserId: string;
  identityVersion: number;
  resourceType: string;
  resourceId: string;
  revision: string;
  policyEpochHash: string;
  policyRequestedRetentionDays: number;
  retentionDays: number;
  policyRef: SlackPolicyReference;
  untrustedContent: string;
  metadata: SlackSourceMetadata;
  capturedAt: Date;
  expiresAt: Date;
  tombstonedAt: Date | null;
  tombstoneReason: string | null;
  purgedAt: Date | null;
  createdAt: Date;
}

export interface SaveSourceDbInput {
  sourceRef: SlackSourceRef;
  policyRef: SlackPolicyReference;
  untrustedContent: string;
  metadata?: SlackSourceMetadata;
  capturedAt?: string | Date;
}

function mapSourceRow(raw: any): SlackSourceRecord {
  return {
    id: raw.id,
    ownerSourceKey: raw.owner_source_key,
    userId: raw.user_id,
    connectionId: raw.connection_id,
    workspaceId: raw.workspace_id,
    slackUserId: raw.slack_user_id,
    identityVersion: raw.identity_version,
    resourceType: raw.resource_type,
    resourceId: raw.resource_id,
    revision: raw.revision,
    policyEpochHash: raw.policy_epoch_hash,
    policyRequestedRetentionDays: raw.policy_requested_retention_days,
    retentionDays: raw.retention_days,
    policyRef: raw.policy_ref as SlackPolicyReference,
    untrustedContent: raw.untrusted_content,
    metadata: (raw.metadata || {}) as SlackSourceMetadata,
    capturedAt: new Date(raw.captured_at),
    expiresAt: new Date(raw.expires_at),
    tombstonedAt: raw.tombstoned_at ? new Date(raw.tombstoned_at) : null,
    tombstoneReason: raw.tombstone_reason ?? null,
    purgedAt: raw.purged_at ? new Date(raw.purged_at) : null,
    createdAt: new Date(raw.created_at),
  };
}

export class SlackSourceRepo {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Saves raw source under strict lock hierarchy:
   * 1. users (FOR SHARE)
   * 2. slack_connections (FOR SHARE)
   * 3. slack_trusted_providers (FOR SHARE)
   * 4. slack_processing_consents (FOR SHARE)
   *
   * All authority validations and TTL/epoch parameters are derived internally from policyRef.
   */
  async saveSourceAtomic(input: SaveSourceDbInput): Promise<SlackSourceRecord> {
    const cleanSourceRef = validateSlackSourceRef(input.sourceRef);
    const cleanPolicyRef = validateSlackPolicyReference(input.policyRef);

    if (cleanPolicyRef.purpose !== 'storage') {
      throw new Error('PURPOSE_MISMATCH: storagePolicyRef must have purpose "storage"');
    }

    if (!sameSlackBinding(cleanSourceRef.binding, cleanPolicyRef.binding)) {
      throw new Error('IDENTITY_CHANGED: sourceRef binding must match policyRef binding');
    }

    const policyRequestedRetentionDays = cleanPolicyRef.requestedRetentionDays;
    if (policyRequestedRetentionDays <= 0) {
      throw new Error('RETENTION_EXCEEDED: policyRef requestedRetentionDays must be > 0');
    }

    const retentionDays = Math.min(RAW_SOURCE_MAX_RETENTION_DAYS, policyRequestedRetentionDays);
    const storageEpoch = slackPolicyRefToEpoch(cleanPolicyRef);
    const policyEpochHash = hashPolicyEpoch(storageEpoch);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock user (FOR SHARE)
      const userRes = await client.query(
        'SELECT id, status FROM users WHERE id = $1 FOR SHARE',
        [cleanSourceRef.binding.atiUserId]
      );
      const user = userRes.rows[0];
      if (!user || user.status !== 'active') {
        throw new Error('USER_INACTIVE');
      }

      // 2. Lock connection (FOR SHARE)
      const connRes = await client.query(
        `SELECT id, user_id, workspace_id, actor_id, identity_version, status
         FROM slack_connections
         WHERE id = $1 AND user_id = $2 FOR SHARE`,
        [cleanSourceRef.binding.connectionId, cleanSourceRef.binding.atiUserId]
      );
      const conn = connRes.rows[0];
      if (!conn || conn.status !== 'active') {
        throw new Error('CONNECTION_INACTIVE');
      }
      if (
        conn.workspace_id !== cleanSourceRef.binding.workspaceId ||
        conn.actor_id !== cleanSourceRef.binding.slackUserId ||
        conn.identity_version !== cleanSourceRef.binding.identityVersion
      ) {
        throw new Error('IDENTITY_CHANGED');
      }

      // 3. Lock trusted provider (FOR SHARE)
      const provRes = await client.query(
        `SELECT id, verified, no_training, max_retention_days, configuration_fingerprint, evidence_ref, verified_by, revision
         FROM slack_trusted_providers
         WHERE id = $1 FOR SHARE`,
        [cleanPolicyRef.providerProfileId]
      );
      const prov = provRes.rows[0];
      if (!prov || prov.verified !== true || prov.no_training !== true || !prov.evidence_ref || !prov.verified_by) {
        throw new Error('PROVIDER_UNVERIFIED');
      }
      if (prov.configuration_fingerprint !== cleanPolicyRef.configFingerprint) {
        throw new Error('POLICY_CHANGED: Provider fingerprint mismatch');
      }
      if (prov.revision.toString() !== cleanPolicyRef.providerRevision) {
        throw new Error('POLICY_CHANGED: Provider revision mismatch');
      }
      if (cleanPolicyRef.requestedRetentionDays > prov.max_retention_days) {
        throw new Error('RETENTION_EXCEEDED: Exceeds provider maximum retention days');
      }

      // 4. Lock processing consent (FOR SHARE)
      const consentRes = await client.query(
        `SELECT workspace_id, provider_id, policy_version, revision, status, purposes, retention_days
         FROM slack_processing_consents
         WHERE workspace_id = $1 AND provider_id = $2 FOR SHARE`,
        [cleanSourceRef.binding.workspaceId, cleanPolicyRef.providerProfileId]
      );
      const consent = consentRes.rows[0];
      if (!consent || consent.status !== 'granted') {
        throw new Error('CONSENT_MISSING');
      }
      if (!Array.isArray(consent.purposes) || !consent.purposes.includes('storage')) {
        throw new Error('CONSENT_PURPOSE_NOT_GRANTED');
      }
      if (consent.policy_version !== cleanPolicyRef.policyVersion) {
        throw new Error('POLICY_CHANGED: Consent policy version mismatch');
      }
      if (consent.revision.toString() !== cleanPolicyRef.consentRevision) {
        throw new Error('POLICY_CHANGED: Consent revision mismatch');
      }
      if (cleanPolicyRef.requestedRetentionDays > consent.retention_days) {
        throw new Error('RETENTION_EXCEEDED: Exceeds organization consented retentionDays');
      }

      // Compute timestamps
      const capturedAt = input.capturedAt ? new Date(input.capturedAt) : new Date();
      const expiresAt = new Date(capturedAt.getTime() + retentionDays * 86_400_000);
      const ownerSourceKey = formatSlackOwnerSourceKey(cleanSourceRef);

      const insertRes = await client.query(
        `INSERT INTO slack_sources (
          owner_source_key, user_id, connection_id, workspace_id, slack_user_id,
          identity_version, resource_type, resource_id, revision, policy_epoch_hash,
          policy_requested_retention_days, retention_days, policy_ref, untrusted_content,
          metadata, captured_at, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING *`,
        [
          ownerSourceKey,
          cleanSourceRef.binding.atiUserId,
          cleanSourceRef.binding.connectionId,
          cleanSourceRef.binding.workspaceId,
          cleanSourceRef.binding.slackUserId,
          cleanSourceRef.binding.identityVersion,
          cleanSourceRef.resourceType,
          cleanSourceRef.resourceId,
          cleanSourceRef.revision,
          policyEpochHash,
          policyRequestedRetentionDays,
          retentionDays,
          JSON.stringify(cleanPolicyRef),
          input.untrustedContent,
          JSON.stringify(input.metadata || {}),
          capturedAt,
          expiresAt,
        ]
      );

      await client.query('COMMIT');
      return mapSourceRow(insertRes.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getSourceById(id: string): Promise<SlackSourceRecord | null> {
    const res = await this.pool.query('SELECT * FROM slack_sources WHERE id = $1', [id]);
    return res.rows[0] ? mapSourceRow(res.rows[0]) : null;
  }

  async getActiveSourceByOwnerKey(ownerSourceKey: string, policyEpochHash: string): Promise<SlackSourceRecord | null> {
    const res = await this.pool.query(
      'SELECT * FROM slack_sources WHERE owner_source_key = $1 AND policy_epoch_hash = $2 AND purged_at IS NULL',
      [ownerSourceKey, policyEpochHash]
    );
    return res.rows[0] ? mapSourceRow(res.rows[0]) : null;
  }

  async tombstoneSource(id: string, reason: SlackTombstoneReason): Promise<SlackSourceRecord | null> {
    const res = await this.pool.query(
      `UPDATE slack_sources
       SET tombstoned_at = COALESCE(tombstoned_at, now()),
           tombstone_reason = COALESCE(tombstone_reason, $2)
       WHERE id = $1
       RETURNING *`,
      [id, reason]
    );
    return res.rows[0] ? mapSourceRow(res.rows[0]) : null;
  }

  async purgeSource(id: string, reason?: SlackTombstoneReason): Promise<SlackSourceRecord | null> {
    const res = await this.pool.query(
      `UPDATE slack_sources
       SET untrusted_content = '',
           metadata = '{}'::jsonb,
           purged_at = now(),
           tombstoned_at = COALESCE(tombstoned_at, now()),
           tombstone_reason = COALESCE(tombstone_reason, $2)
       WHERE id = $1
       RETURNING *`,
      [id, reason || null]
    );
    return res.rows[0] ? mapSourceRow(res.rows[0]) : null;
  }

  /**
   * Purges raw sources matching a purge target, erasing content while retaining tombstone record.
   */
  async purgeSourcesByTarget(target: SlackPurgeTarget): Promise<{ purgedCount: number }> {
    let query = '';
    const params: any[] = [target.tombstoneReason];

    switch (target.scope) {
      case 'owner_retention':
        params.push(
          target.binding.atiUserId,
          target.binding.connectionId,
          target.resourceType,
          target.resourceId
        );
        query = `UPDATE slack_sources
                 SET untrusted_content = '', metadata = '{}'::jsonb, purged_at = now(),
                     tombstoned_at = COALESCE(tombstoned_at, now()), tombstone_reason = COALESCE(tombstone_reason, $1)
                 WHERE user_id = $2 AND connection_id = $3 AND resource_type = $4 AND resource_id = $5 AND purged_at IS NULL`;
        break;

      case 'channel_membership_lost':
        params.push(target.binding.workspaceId, target.channelId);
        query = `UPDATE slack_sources
                 SET untrusted_content = '', metadata = '{}'::jsonb, purged_at = now(),
                     tombstoned_at = COALESCE(tombstoned_at, now()), tombstone_reason = COALESCE(tombstone_reason, $1)
                 WHERE workspace_id = $2 AND metadata->>'channelId' = $3 AND purged_at IS NULL`;
        break;

      case 'authorization_disconnect':
        params.push(
          target.binding.atiUserId,
          target.binding.connectionId,
          target.binding.identityVersion
        );
        query = `UPDATE slack_sources
                 SET untrusted_content = '', metadata = '{}'::jsonb, purged_at = now(),
                     tombstoned_at = COALESCE(tombstoned_at, now()), tombstone_reason = COALESCE(tombstone_reason, $1)
                 WHERE user_id = $2 AND connection_id = $3 AND identity_version = $4 AND purged_at IS NULL`;
        break;

      case 'resource_lifecycle':
        params.push(target.workspaceId, target.resourceType, target.resourceId);
        let revClause = '';
        if (target.revision) {
          params.push(target.revision);
          revClause = ` AND revision = $${params.length}`;
        }
        query = `UPDATE slack_sources
                 SET untrusted_content = '', metadata = '{}'::jsonb, purged_at = now(),
                     tombstoned_at = COALESCE(tombstoned_at, now()), tombstone_reason = COALESCE(tombstone_reason, $1)
                 WHERE workspace_id = $2 AND resource_type = $3 AND resource_id = $4${revClause} AND purged_at IS NULL`;
        break;

      case 'workspace_consent_revocation':
        params.push(target.workspaceId, target.policyVersion, target.providerProfileId);
        query = `UPDATE slack_sources
                 SET untrusted_content = '', metadata = '{}'::jsonb, purged_at = now(),
                     tombstoned_at = COALESCE(tombstoned_at, now()), tombstone_reason = COALESCE(tombstone_reason, $1)
                 WHERE workspace_id = $2 AND (policy_ref->>'policyVersion') = $3 AND (policy_ref->>'providerProfileId') = $4 AND purged_at IS NULL`;
        break;

      case 'policy_epoch_invalidated':
        params.push(
          target.epoch.binding.workspaceId,
          target.epoch.providerProfileId,
          target.epoch.configFingerprint,
          target.epoch.policyVersion,
          target.epoch.consentRevision,
          target.epoch.providerRevision
        );
        query = `UPDATE slack_sources
                 SET untrusted_content = '', metadata = '{}'::jsonb, purged_at = now(),
                     tombstoned_at = COALESCE(tombstoned_at, now()), tombstone_reason = COALESCE(tombstone_reason, $1)
                 WHERE workspace_id = $2
                   AND (policy_ref->>'providerProfileId') = $3
                   AND (policy_ref->>'configFingerprint') = $4
                   AND (policy_ref->>'policyVersion') = $5
                   AND (policy_ref->>'consentRevision') = $6
                   AND (policy_ref->>'providerRevision') = $7
                   AND purged_at IS NULL`;
        break;
    }

    const res = await this.pool.query(query, params);
    return { purgedCount: res.rowCount ?? 0 };
  }

  /**
   * Purges expired raw sources whose retention TTL has elapsed.
   */
  async purgeExpiredSources(limit = 100): Promise<{ purgedCount: number }> {
    const res = await this.pool.query(
      `UPDATE slack_sources
       SET untrusted_content = '',
           metadata = '{}'::jsonb,
           purged_at = now(),
           tombstoned_at = COALESCE(tombstoned_at, now()),
           tombstone_reason = COALESCE(tombstone_reason, 'retention_expired')
       WHERE id IN (
         SELECT id FROM slack_sources
         WHERE expires_at <= now() AND purged_at IS NULL
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )`,
      [limit]
    );
    return { purgedCount: res.rowCount ?? 0 };
  }
}
