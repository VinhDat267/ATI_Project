import type pg from 'pg';
import {
  slackPolicyRefToEpoch,
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

export class SlackPolicyEventConsumer {
  constructor(
    private readonly pool: pg.Pool,
    private readonly invalidationService: SlackInvalidationService,
    private readonly sourceRepo: SlackSourceRepo
  ) {}

  /**
   * Consumes pending policy events from 02B (slack_policy_events) using anti-join
   * against slack_invalidation_receipts, expanding after-change events to exact old epochs.
   */
  async consumePendingPolicyEvents(limit = 50): Promise<ConsumePolicyEventsResult> {
    // 1. Anti-join query prevents starvation of older events
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

    for (const e of events) {
      const sourceEventKey = `policy:${e.id}`;
      const effects: InvalidationEffect[] = [];

      if (e.event_type === 'consent_revoked') {
        // Find stored raw sources for this workspace and provider that used old consent revisions <= e.consent_revision
        const storedEpochsRes = await this.pool.query(
          `SELECT DISTINCT policy_ref
           FROM slack_sources
           WHERE (workspace_id = $1 OR $1 = '*')
             AND (policy_ref->>'providerProfileId') = $2
             AND ((policy_ref->>'consentRevision')::bigint <= $3)
             AND purged_at IS NULL`,
          [e.workspace_id, e.provider_id, e.consent_revision]
        );

        for (const row of storedEpochsRes.rows) {
          const sourcePolicyRef = row.policy_ref as SlackPolicyReference;
          const epoch: SlackPolicyEpoch = slackPolicyRefToEpoch(sourcePolicyRef);
          const epochHash = hashPolicyEpoch(epoch);

          effects.push({
            effectKey: `epoch_invalidated:${epochHash}`,
            barrier: {
              barrierType: 'epoch',
              epoch,
              reason: 'consent_revoked',
            },
            purgeTarget: {
              scope: 'policy_epoch_invalidated',
              epoch,
              cascadeTargetKinds: [
                'chat_history_message',
                'working_memory_entity',
                'plan_step_arg',
                'proposal_excerpt',
                'daily_digest_entry',
                'scheduled_workflow_arg',
                'audit_log_entry',
              ],
              tombstoneReason: 'policy_changed',
            },
          });
        }

        // If workspace is specific and not wildcard, also register workspace consent revocation target
        if (e.workspace_id !== '*' && effects.length === 0) {
          // If no specific sources currently stored, still record barrier-only or scope
          // to ensure future lookups or derived purges recognize it
          effects.push({
            effectKey: `ws_consent_revocation:${e.workspace_id}:${e.consent_revision}`,
            barrier: {
              barrierType: 'resource',
              workspaceId: e.workspace_id,
              resourceType: 'conversation',
              resourceId: '*',
              deleted: true,
              reason: 'consent_revoked',
            },
            purgeTarget: {
              scope: 'workspace_consent_revocation',
              workspaceId: e.workspace_id,
              policyVersion: e.policy_version,
              providerProfileId: e.provider_id,
              consentRevision: String(e.consent_revision),
              cascadeTargetKinds: [
                'chat_history_message',
                'working_memory_entity',
                'plan_step_arg',
                'proposal_excerpt',
                'daily_digest_entry',
                'scheduled_workflow_arg',
                'audit_log_entry',
              ],
              tombstoneReason: 'consent_revoked',
            },
          });
        }
      } else if (e.event_type === 'provider_updated') {
        // Find stored raw sources that used old provider revisions
        if (e.provider_revision != null) {
          const storedEpochsRes = await this.pool.query(
            `SELECT DISTINCT policy_ref
             FROM slack_sources
             WHERE (policy_ref->>'providerProfileId') = $1
               AND ((policy_ref->>'providerRevision')::bigint < $2)
               AND purged_at IS NULL`,
            [e.provider_id, e.provider_revision]
          );

          for (const row of storedEpochsRes.rows) {
            const sourcePolicyRef = row.policy_ref as SlackPolicyReference;
            const epoch: SlackPolicyEpoch = slackPolicyRefToEpoch(sourcePolicyRef);
            const epochHash = hashPolicyEpoch(epoch);

            effects.push({
              effectKey: `provider_epoch_invalidated:${epochHash}`,
              barrier: {
                barrierType: 'epoch',
                epoch,
                reason: 'policy_changed',
              },
              purgeTarget: {
                scope: 'policy_epoch_invalidated',
                epoch,
                cascadeTargetKinds: [
                  'chat_history_message',
                  'working_memory_entity',
                  'plan_step_arg',
                  'proposal_excerpt',
                  'daily_digest_entry',
                  'scheduled_workflow_arg',
                  'audit_log_entry',
                ],
                tombstoneReason: 'policy_changed',
              },
            });
          }
        }
      }

      // Stage in transaction: receipt + effects committed atomically
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
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    return { processedCount };
  }
}
