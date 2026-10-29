import type pg from 'pg';
import {
  SLACK_DERIVED_TARGET_KINDS,
  slackPolicyRefToEpoch,
  validateSlackPolicyReference,
  type SlackPolicyEpoch,
  type SlackPolicyReference,
} from '@wap/tool-schemas';
import {
  SlackInvalidationService,
  hashPolicyEpoch,
  type InvalidationEffect,
} from './slack-invalidation-service.js';
import { SlackSourceRepo } from '../../db/repositories/slack-source-repo.js';

export interface ConsumePolicyEventsResult {
  processedCount: number;
}

const SUPPORTED_POLICY_EVENTS = new Set([
  'consent_granted',
  'consent_revoked',
  'provider_attested',
  'provider_updated',
]);

const CANONICAL_CONSENT_REVISION = /^[1-9][0-9]*$/;

interface ValidatedPolicyEvent {
  id: string;
  workspaceId: string;
  providerId: string;
  eventType: 'consent_granted' | 'consent_revoked' | 'provider_attested' | 'provider_updated';
  policyVersion: string;
  consentRevision: string | null;
  providerRevision: string | null;
}

/**
 * Validates the raw event row before it can drive any barrier. Unknown event shapes fail
 * closed (the event stays pending) rather than being silently ignored.
 */
function validatePolicyEventRow(row: any): ValidatedPolicyEvent {
  if (!row || typeof row !== 'object') {
    throw new Error('INVALID_POLICY_EVENT: row missing');
  }
  const id = row.id;
  const workspaceId = row.workspace_id;
  const providerId = row.provider_id;
  const eventType = row.event_type;

  if (typeof id !== 'string' || !id) {
    throw new Error('INVALID_POLICY_EVENT: id');
  }
  if (typeof workspaceId !== 'string' || !workspaceId.trim()) {
    throw new Error('INVALID_POLICY_EVENT: workspace_id');
  }
  if (typeof providerId !== 'string' || !providerId.trim()) {
    throw new Error('INVALID_POLICY_EVENT: provider_id');
  }
  if (typeof eventType !== 'string' || !SUPPORTED_POLICY_EVENTS.has(eventType)) {
    throw new Error('INVALID_POLICY_EVENT: unsupported event_type');
  }

  const consentRevision =
    row.consent_revision === null || row.consent_revision === undefined
      ? null
      : String(row.consent_revision);
  const providerRevision =
    row.provider_revision === null || row.provider_revision === undefined
      ? null
      : String(row.provider_revision);

  if (eventType === 'consent_granted' || eventType === 'consent_revoked') {
    if (!consentRevision || !CANONICAL_CONSENT_REVISION.test(consentRevision)) {
      throw new Error('INVALID_POLICY_EVENT: non-canonical consent_revision');
    }
  } else if (!providerRevision || !CANONICAL_CONSENT_REVISION.test(providerRevision)) {
    throw new Error('INVALID_POLICY_EVENT: non-canonical provider_revision');
  }

  return {
    id,
    workspaceId: workspaceId.trim(),
    providerId: providerId.trim(),
    eventType: eventType as ValidatedPolicyEvent['eventType'],
    policyVersion: String(row.policy_version ?? ''),
    consentRevision,
    providerRevision,
  };
}

function buildEpochEffects(
  storedPolicyRefs: unknown[],
  barrierReason: string
): InvalidationEffect[] {
  const byEffectKey = new Map<string, InvalidationEffect>();

  for (const raw of storedPolicyRefs) {
    const policyRef: SlackPolicyReference = validateSlackPolicyReference(raw);
    if (policyRef.purpose !== 'storage') {
      throw new Error('INVALID_STORED_POLICY_REFERENCE: purpose');
    }

    const epoch: SlackPolicyEpoch = slackPolicyRefToEpoch(policyRef);
    const epochHash = hashPolicyEpoch(epoch);
    const effectKey = `policy_epoch_invalidated:${epochHash}`;
    if (byEffectKey.has(effectKey)) {
      continue;
    }

    byEffectKey.set(effectKey, {
      effectKey,
      barrier: {
        barrierType: 'epoch',
        epoch,
        reason: barrierReason,
      },
      purgeTarget: {
        scope: 'policy_epoch_invalidated',
        epoch,
        // Raw purge only in 03B1. All seven derived target kinds are recorded and left
        // pending for the explicit 03B2 cascade seam; raw completion never marks them done.
        cascadeTargetKinds: [...SLACK_DERIVED_TARGET_KINDS],
        tombstoneReason: 'policy_changed',
      },
    });
  }

  return [...byEffectKey.values()].sort((a, b) =>
    a.effectKey < b.effectKey ? -1 : a.effectKey > b.effectKey ? 1 : 0
  );
}

export class SlackPolicyEventConsumer {
  constructor(
    private readonly pool: pg.Pool,
    private readonly invalidationService: SlackInvalidationService,
    private readonly sourceRepo: SlackSourceRepo
  ) {}

  /**
   * Consumes policy events from 02B using an anti-join against durable receipts.
   *
   * All four event kinds are handled because every one of them bumps an authorization
   * revision (consent_granted/consent_revoked bump consentRevision,
   * provider_attested/provider_updated bump providerRevision). Effects expand only the exact
   * stored old epochs; there is no wildcard/empty-source fallback barrier.
   */
  async consumePendingPolicyEvents(limit = 50): Promise<ConsumePolicyEventsResult> {
    const eventsRes = await this.pool.query(
      `SELECT e.id, e.workspace_id, e.provider_id, e.event_type, e.policy_version,
              e.consent_revision, e.provider_revision, e.reason, e.occurred_at
       FROM slack_policy_events e
       LEFT JOIN slack_invalidation_receipts r
         ON r.source_event_key = 'policy:' || e.id::text
       WHERE r.id IS NULL
       ORDER BY e.occurred_at ASC, e.id ASC
       LIMIT $1`,
      [limit]
    );

    const events = eventsRes.rows;
    if (events.length === 0) {
      return { processedCount: 0 };
    }

    let processedCount = 0;

    for (const row of events) {
      const event = validatePolicyEventRow(row);
      const sourceEventKey = `policy:${event.id}`;
      let storedPolicyRefs: unknown[] = [];
      let barrierReason = 'policy_changed';

      if (event.eventType === 'consent_granted' || event.eventType === 'consent_revoked') {
        // Every stored source under a consent revision strictly older than this event is
        // invalidated. A source written under the new revision is never touched.
        const storedEpochsRes = await this.pool.query(
          `SELECT DISTINCT policy_ref
           FROM slack_sources
           WHERE (workspace_id = $1 OR $1 = '*')
             AND (policy_ref->>'providerProfileId') = $2
             AND (policy_ref->>'consentRevision') ~ '^[1-9][0-9]*$'
             AND (policy_ref->>'consentRevision')::bigint < $3::bigint
             AND purged_at IS NULL`,
          [event.workspaceId, event.providerId, event.consentRevision]
        );
        storedPolicyRefs = storedEpochsRes.rows.map(r => r.policy_ref);
        barrierReason = event.eventType === 'consent_revoked' ? 'consent_revoked' : 'policy_changed';
      } else {
        // Provider attestations/updates are provider-global; revoke every stored epoch whose
        // providerRevision is older than the newly attested revision.
        const storedEpochsRes = await this.pool.query(
          `SELECT DISTINCT policy_ref
           FROM slack_sources
           WHERE (policy_ref->>'providerProfileId') = $1
             AND (policy_ref->>'providerRevision') ~ '^[1-9][0-9]*$'
             AND (policy_ref->>'providerRevision')::bigint < $2::bigint
             AND purged_at IS NULL`,
          [event.providerId, event.providerRevision]
        );
        storedPolicyRefs = storedEpochsRes.rows.map(r => r.policy_ref);
        barrierReason = 'policy_changed';
      }

      const effects = buildEpochEffects(storedPolicyRefs, barrierReason);

      // Receipt + barriers + intents are committed atomically before this event is counted
      // as processed or acknowledged. Empty effects still stage a receipt (no fallback
      // wildcard barrier is created when no old source is currently stored).
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await this.invalidationService.stageInTransaction(client, {
          sourceEventKey,
          effects,
        });
        await client.query('COMMIT');
        processedCount++;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // connection may already be aborted by a failed COMMIT
        }
        throw err;
      } finally {
        client.release();
      }
    }

    return { processedCount };
  }
}
