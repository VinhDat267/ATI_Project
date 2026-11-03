import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  validateSlackAssistantConfig,
  validateSlackBinding,
} from '@wap/tool-schemas';
import type { SlackAssistantRepo } from '../../db/repositories/slack-assistant-repo.js';
import type { SlackAssistantArtifactRepo } from '../../db/repositories/slack-assistant-artifact-repo.js';
import { SlackDerivedLineageRepo, type DerivedSegmentInput } from '../../db/repositories/slack-derived-lineage-repo.js';
import type { SlackPolicyService } from './policy-service.js';
import { sealMessageOrigin } from './slack-message-origin.js';
import { slackArtifactValue } from './slack-artifact-targets.js';
import { uniqueSegments } from './slack-plan-lineage.js';
import { isUuid } from '../../db/repositories/uuid.js';

export interface SlackDigestEntry {
  proposalId: string;
  title: string;
  rationale: string;
  status: string;
  createdAt: string;
}

export interface SlackDigestView {
  id: string;
  connectionId: string;
  localDate: string | null;
  revision: string;
  status: string;
  body: {
    artifactId: string;
    localDate: string;
    timezone: string;
    summary: string;
    entries: SlackDigestEntry[];
  } | null;
  createdAt: string;
}

export interface SlackDigestServiceOptions {
  pool: pg.Pool;
  repo: SlackAssistantRepo;
  artifacts: SlackAssistantArtifactRepo;
  policy: SlackPolicyService;
}

function localDateAndTime(now: Date, timezone: string): { localDate: string; localTime: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  const rawHour = pick('hour');
  const hour = rawHour === '24' ? '00' : rawHour;
  const minute = pick('minute');
  return { localDate: `${year}-${month}-${day}`, localTime: `${hour}:${minute}` };
}

export class SlackDigestService {
  private readonly lineage: SlackDerivedLineageRepo;

  constructor(private readonly options: SlackDigestServiceOptions) {
    this.lineage = new SlackDerivedLineageRepo(options.pool, options.policy);
  }

  async runDueDigests(now = new Date(), signal?: AbortSignal): Promise<{ generated: number; skipped: number }> {
    const stats = { generated: 0, skipped: 0 };
    if (signal?.aborted) return stats;
    const rows = (
      await this.options.pool.query(
        `SELECT c.id AS connection_id, c.user_id, c.workspace_id, c.actor_id, c.identity_version,
                cfg.config_json, cfg.version AS config_version
           FROM slack_connections c
           JOIN users u ON u.id = c.user_id
           JOIN slack_workspace_configs cfg ON cfg.connection_id = c.id AND cfg.user_id = c.user_id
          WHERE c.status = 'active' AND u.status = 'active'
          ORDER BY c.id`,
      )
    ).rows;

    for (const row of rows) {
      if (signal?.aborted) break;
      let config;
      try {
        config = validateSlackAssistantConfig(row.config_json);
      } catch {
        stats.skipped++;
        continue;
      }
      if (!config.enabled || !config.digest.enabled) {
        stats.skipped++;
        continue;
      }
      const { localDate, localTime } = localDateAndTime(now, config.timezone);
      if (localTime < config.digest.time) {
        stats.skipped++;
        continue;
      }
      const existing = (
        await this.options.pool.query(
          "SELECT id FROM slack_assistant_artifacts WHERE connection_id=$1 AND kind='daily_digest_entry' AND local_date=$2::date LIMIT 1",
          [row.connection_id, localDate],
        )
      ).rows[0];
      if (existing) {
        stats.skipped++;
        continue;
      }

      const c = await this.options.pool.connect();
      try {
        await c.query('BEGIN');
        await c.query("SET LOCAL statement_timeout='5s'");
        const locked = (
          await c.query("SELECT pg_try_advisory_xact_lock(hashtext('ati-slack-owner'),hashtext($1)) AS held", [
            row.user_id,
          ])
        ).rows[0]?.held;
        if (!locked) {
          await c.query('ROLLBACK');
          stats.skipped++;
          continue;
        }
        const again = (
          await c.query(
            "SELECT id FROM slack_assistant_artifacts WHERE connection_id=$1 AND kind='daily_digest_entry' AND local_date=$2::date LIMIT 1",
            [row.connection_id, localDate],
          )
        ).rows[0];
        if (again) {
          await c.query('ROLLBACK');
          stats.skipped++;
          continue;
        }
        const binding = validateSlackBinding({
          atiUserId: row.user_id,
          connectionId: row.connection_id,
          workspaceId: row.workspace_id,
          slackUserId: row.actor_id,
          identityVersion: row.identity_version,
        });
        const policyDecision = await this.options.policy.resolveSlackModelPolicy(
          { binding, purpose: 'digest', requestedRetentionDays: 0 },
          c,
        );
        if (!policyDecision.allowed) {
          await c.query('ROLLBACK');
          stats.skipped++;
          continue;
        }
        const candidates = (
          await c.query(
            `SELECT * FROM slack_assistant_artifacts
              WHERE user_id = $1 AND connection_id = $2 AND kind = 'proposal_excerpt'
                AND review_expires_at > clock_timestamp() AND config_version = $3
              ORDER BY created_at DESC, id LIMIT 50`,
            [row.user_id, row.connection_id, row.config_version],
          )
        ).rows;
        const entries: SlackDigestEntry[] = [];
        const allSegments: DerivedSegmentInput[] = [];
        for (const prop of candidates) {
          try {
            const propSegments = await this.options.artifacts.getSegmentsInTransaction(
              c,
              row.user_id,
              prop.id,
              'digest',
            );
            const propBody = slackArtifactValue(prop, 'proposal_excerpt', 'body_json') as any;
            if (!propBody || propBody.__slack_purged) continue;
            entries.push({
              proposalId: prop.id,
              title: String(propBody.decision?.title ?? 'Đề xuất'),
              rationale: String(propBody.decision?.rationale ?? ''),
              status: prop.status,
              createdAt: prop.created_at.toISOString(),
            });
            allSegments.push(...propSegments);
          } catch {
            // Skip stale/unauthorized proposal
          }
        }
        const segments = uniqueSegments(allSegments);
        if (entries.length === 0 || segments.length === 0) {
          await c.query('ROLLBACK');
          stats.skipped++;
          continue;
        }
        const convId = (
          await c.query(
            "INSERT INTO conversations(user_id,status,title) VALUES($1,'chatting','Tổng hợp hằng ngày') RETURNING id",
            [row.user_id],
          )
        ).rows[0].id;
        await sealMessageOrigin(c, 'conversations', convId, 'conversation_create');
        await this.lineage.prepareConversationWriteInTransaction(c, convId, row.user_id, segments, 'digest');
        const id = randomUUID();
        const dedupe = createHash('sha256')
          .update(JSON.stringify({ connectionId: row.connection_id, localDate }))
          .digest('hex');
        const body = {
          artifactId: id,
          binding,
          configVersion: row.config_version,
          payloadRevision: '1',
          localDate,
          timezone: config.timezone,
          summary: `Tổng hợp ${entries.length} đề xuất ngày ${localDate}`,
          entries,
        };
        await c.query(
          `INSERT INTO slack_assistant_artifacts(id,kind,user_id,connection_id,workspace_id,slack_user_id,identity_version,conv_id,config_version,status,dedupe_hash,local_date,body_json)
           VALUES($1,'daily_digest_entry',$2,$3,$4,$5,$6,$7,$8,'completed',$9,$10::date,$11)`,
          [
            id,
            row.user_id,
            row.connection_id,
            row.workspace_id,
            row.actor_id,
            row.identity_version,
            convId,
            row.config_version,
            dedupe,
            localDate,
            JSON.stringify(body),
          ],
        );
        await this.lineage.registerDerivedCopyInTransaction(c, {
          atiUserId: row.user_id,
          targetKind: 'daily_digest_entry',
          targetId: id,
          targetSubId: 'body_json',
          segments,
        });
        await c.query('COMMIT');
        stats.generated++;
      } catch {
        await c.query('ROLLBACK').catch(() => {});
        stats.skipped++;
      } finally {
        c.release();
      }
    }
    return stats;
  }

  async list(owner: string, connectionId: string): Promise<SlackDigestView[]> {
    if (!isUuid(owner) || !isUuid(connectionId)) return [];
    const rows = (
      await this.options.pool.query(
        "SELECT id FROM slack_assistant_artifacts WHERE user_id=$1 AND connection_id=$2 AND kind='daily_digest_entry' ORDER BY local_date DESC NULLS LAST, created_at DESC, id LIMIT 30",
        [owner, connectionId],
      )
    ).rows;
    return Promise.all(rows.map((r) => this.get(owner, r.id)));
  }

  async get(owner: string, id: string): Promise<SlackDigestView> {
    if (!isUuid(owner) || !isUuid(id)) throw new Error('SLACK_DIGEST_NOT_FOUND');
    const c = await this.options.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL statement_timeout='5s'");
      let row = (
        await c.query(
          "SELECT * FROM slack_assistant_artifacts WHERE id=$1 AND user_id=$2 AND kind='daily_digest_entry'",
          [id, owner],
        )
      ).rows[0];
      if (!row) throw new Error('SLACK_DIGEST_NOT_FOUND');
      const target = { atiUserId: owner, targetKind: 'daily_digest_entry' as const, targetId: id, targetSubId: 'body_json' };
      const copy = await this.lineage.getActiveCopyInTransaction(c, target);
      const allowed =
        !!copy &&
        (
          await this.lineage.assertDerivedCopyAllowedInTransaction(c, {
            callerAtiUserId: owner,
            consumerPurpose: 'digest',
            targetKind: 'daily_digest_entry',
            targetId: id,
            targetSubId: 'body_json',
            expectedTargetVersion: copy.targetVersion,
          })
        ).status === 'allowed';
      row = (
        await c.query(
          `SELECT a.*, a.review_expires_at > clock_timestamp() AS review_current,
                  to_char(a.local_date, 'YYYY-MM-DD') AS local_date_str,
                  cfg.version AS current_config_version
             FROM slack_assistant_artifacts a
             LEFT JOIN slack_workspace_configs cfg ON cfg.connection_id = a.connection_id
            WHERE a.id = $1 AND a.user_id = $2
              FOR SHARE OF a`,
          [id, owner],
        )
      ).rows[0];
      if (!row) throw new Error('SLACK_DIGEST_NOT_FOUND');
      let body: any = null;
      if (allowed && row.review_current && row.config_version === row.current_config_version) {
        try {
          body = slackArtifactValue(row, 'daily_digest_entry', 'body_json');
          if (body?.__slack_purged) body = null;
        } catch {
          body = null;
        }
      }
      const view: SlackDigestView = {
        id: row.id,
        connectionId: row.connection_id,
        localDate: body?.localDate ?? row.local_date_str ?? null,
        revision: row.revision,
        status: body ? row.status : 'stale',
        body: body
          ? {
              artifactId: body.artifactId,
              localDate: body.localDate,
              timezone: body.timezone,
              summary: body.summary,
              entries: body.entries ?? [],
            }
          : null,
        createdAt: row.created_at.toISOString(),
      };
      await c.query('COMMIT');
      return view;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async refreshStatus(owner: string, id: string): Promise<SlackDigestView> {
    if (!isUuid(owner) || !isUuid(id)) throw new Error('SLACK_DIGEST_NOT_FOUND');
    const c = await this.options.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL statement_timeout='5s'");
      await c.query("SELECT pg_advisory_xact_lock(hashtext('ati-slack-owner'),hashtext($1))", [owner]);
      const exists = (
        await c.query(
          "SELECT id FROM slack_assistant_artifacts WHERE id=$1 AND user_id=$2 AND kind='daily_digest_entry' FOR UPDATE",
          [id, owner],
        )
      ).rows[0];
      if (!exists) throw new Error('SLACK_DIGEST_NOT_FOUND');
      const target = { atiUserId: owner, targetKind: 'daily_digest_entry' as const, targetId: id, targetSubId: 'body_json' };
      const copy = await this.lineage.getActiveCopyInTransaction(c, target);
      if (
        !copy ||
        (
          await this.lineage.assertDerivedCopyAllowedInTransaction(c, {
            callerAtiUserId: owner,
            consumerPurpose: 'digest',
            targetKind: 'daily_digest_entry',
            targetId: id,
            targetSubId: 'body_json',
            expectedTargetVersion: copy.targetVersion,
          })
        ).status !== 'allowed'
      ) {
        throw new Error('SLACK_DIGEST_STALE');
      }
      const segments = await this.lineage.segmentsInTransaction(c, copy.derivedCopyId);
      const row = (
        await c.query(
          `SELECT a.*, a.review_expires_at > clock_timestamp() AS review_current,
                  cfg.version AS current_config_version
             FROM slack_assistant_artifacts a
             LEFT JOIN slack_workspace_configs cfg ON cfg.connection_id = a.connection_id
            WHERE a.id = $1 AND a.user_id = $2
              FOR UPDATE OF a`,
          [id, owner],
        )
      ).rows[0];
      if (!row || !row.review_current || row.config_version !== row.current_config_version) {
        throw new Error('SLACK_DIGEST_STALE');
      }
      const body = slackArtifactValue(row, 'daily_digest_entry', 'body_json') as any;
      if (!body || body.__slack_purged) throw new Error('SLACK_DIGEST_STALE');
      const propIds = (body.entries ?? []).map((e: any) => e.proposalId).filter(isUuid);
      const currentProps = new Map<string, string>();
      if (propIds.length > 0) {
        const propRows = (
          await c.query(
            "SELECT id, status, review_expires_at > clock_timestamp() AS fresh FROM slack_assistant_artifacts WHERE id = ANY($1::uuid[]) AND user_id = $2 AND kind = 'proposal_excerpt'",
            [propIds, owner],
          )
        ).rows;
        for (const p of propRows) {
          currentProps.set(p.id, p.fresh ? p.status : 'stale');
        }
      }
      const nextPayloadRev = String(BigInt(row.payload_revision) + 1n);
      const updatedBody = {
        ...body,
        payloadRevision: nextPayloadRev,
        entries: (body.entries ?? []).map((e: any) => ({
          ...e,
          status: currentProps.get(e.proposalId) ?? 'stale',
        })),
      };
      await this.lineage.prepareConversationWriteInTransaction(c, row.conv_id, owner, segments, 'digest');
      await c.query(
        'UPDATE slack_assistant_artifacts SET body_json=$2, payload_revision=payload_revision+1, revision=revision+1, updated_at=clock_timestamp() WHERE id=$1',
        [id, JSON.stringify(updatedBody)],
      );
      await this.lineage.registerDerivedCopyInTransaction(c, {
        atiUserId: owner,
        targetKind: 'daily_digest_entry',
        targetId: id,
        targetSubId: 'body_json',
        segments,
      });
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
    return this.get(owner, id);
  }
}
