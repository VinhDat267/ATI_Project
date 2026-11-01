import { createHash } from 'node:crypto';
import type pg from 'pg';
import { planSlackProposalWorkflow, type SlackProposalPlanInput } from '@wap/planner';
import {
  SLACK_PROPOSAL_WORKFLOW_TOOLS,
  validateSlackPolicyReference,
  validateSlackProposalPrepareInput,
  validateSlackProposalRevisionInput,
} from '@wap/tool-schemas';
import type { SlackAssistantRepo } from '../../db/repositories/slack-assistant-repo.js';
import type { SlackAssistantArtifactRepo, SlackProposalView } from '../../db/repositories/slack-assistant-artifact-repo.js';
import type { PlanRepo } from '../../db/repositories/plan-repo.js';
import type { MessageRepo } from '../../db/repositories/message-repo.js';
import type { SlackPolicyService } from './policy-service.js';
import type { SlackInvalidationService } from './slack-invalidation-service.js';
import { slackArtifactValue } from './slack-artifact-targets.js';
import { isUuid } from '../../db/repositories/uuid.js';

export interface SlackProposalServiceOptions {
  pool: pg.Pool;
  repo: SlackAssistantRepo;
  artifacts: SlackAssistantArtifactRepo;
  plans: PlanRepo;
  messages: MessageRepo;
  policy: SlackPolicyService;
  invalidation?: SlackInvalidationService;
}

export class SlackProposalService {
  constructor(private readonly options: SlackProposalServiceOptions) {}

  private async lockProposalForUpdate(c: pg.PoolClient, owner: string, id: string, expectedRevision: string) {
    if (!isUuid(owner) || !isUuid(id)) throw new Error('SLACK_PROPOSAL_NOT_FOUND');
    await c.query("SELECT pg_advisory_xact_lock(hashtext('ati-slack-owner'),hashtext($1))", [owner]);
    const exists = (
      await c.query(
        "SELECT id,revision,status FROM slack_assistant_artifacts WHERE id=$1 AND user_id=$2 AND kind='proposal_excerpt' FOR UPDATE",
        [id, owner],
      )
    ).rows[0];
    if (!exists) throw new Error('SLACK_PROPOSAL_NOT_FOUND');
    if (exists.revision !== expectedRevision || !['pending', 'needs_info', 'awaiting_approval'].includes(exists.status)) {
      throw new Error('SLACK_PROPOSAL_VERSION_CONFLICT');
    }
    const segments = await this.options.artifacts.getSegmentsInTransaction(c, owner, id, 'planning');
    const row = (
      await c.query(
        `SELECT a.*, a.review_expires_at > clock_timestamp() AS review_current,
                cfg.version AS current_config_version,
                cfg.config_json AS current_config_json
           FROM slack_assistant_artifacts a
           LEFT JOIN slack_workspace_configs cfg ON cfg.connection_id = a.connection_id
          WHERE a.id = $1 AND a.user_id = $2
            FOR UPDATE OF a`,
        [id, owner],
      )
    ).rows[0];
    if (!row || !row.review_current || row.config_version !== row.current_config_version) {
      throw new Error('SLACK_PROPOSAL_STALE');
    }
    const body = slackArtifactValue(row, 'proposal_excerpt', 'body_json') as any;
    if (!body || body.__slack_purged) throw new Error('SLACK_PROPOSAL_STALE');
    return { row, body, segments };
  }

  async refine(
    owner: string,
    id: string,
    rawInput: unknown,
  ): Promise<{ conversationId: string; proposal: SlackProposalView }> {
    const { expectedRevision } = validateSlackProposalRevisionInput(rawInput);
    const revision = String(expectedRevision);
    const c = await this.options.pool.connect();
    let convId = '';
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL statement_timeout='5s'");
      const { row, body, segments } = await this.lockProposalForUpdate(c, owner, id, revision);
      convId = row.conv_id;
      const seeded = (
        await c.query(
          "SELECT id FROM messages WHERE conv_id=$1 AND metadata->>'proposalId'=$2 LIMIT 1",
          [convId, id],
        )
      ).rows[0];
      if (!seeded) {
        const summaryText = `${body.decision?.title ?? 'Đề xuất'}: ${body.decision?.rationale ?? ''}`.trim();
        await this.options.messages.createSlackMessage(
          convId,
          'assistant',
          summaryText,
          { proposalId: id },
          { segments, selectors: ['content'] },
          c,
        );
      }
      await c.query(
        'UPDATE slack_assistant_artifacts SET revision=revision+1, updated_at=clock_timestamp() WHERE id=$1 AND user_id=$2 AND revision=$3',
        [id, owner, revision],
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
    const proposal = await this.options.artifacts.get(owner, id, 'planning');
    return { conversationId: convId, proposal };
  }

  async prepare(
    owner: string,
    id: string,
    rawInput: unknown,
  ): Promise<
    | { status: 'needs_info'; clarification: string; proposal: SlackProposalView }
    | { status: 'awaiting_approval'; planId: string; planHash: string; plan: any; proposal: SlackProposalView }
  > {
    const input = validateSlackProposalPrepareInput(rawInput);
    const revision = String(input.expectedRevision);
    const c = await this.options.pool.connect();
    let outcome:
      | { status: 'needs_info'; clarification: string }
      | { status: 'awaiting_approval'; planId: string; planHash: string; plan: any };
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL statement_timeout='5s'");
      const { row, body, segments } = await this.lockProposalForUpdate(c, owner, id, revision);
      const policyDecision = await this.options.policy.resolveSlackModelPolicy(
        { binding: body.binding, purpose: 'planning', requestedRetentionDays: 0 },
        c,
      );
      if (!policyDecision.allowed) throw new Error('SLACK_POLICY_DENIED');
      const policyReference = validateSlackPolicyReference(policyDecision.policyReference);
      const rawTargets = ((row.current_config_json ?? {}) as Record<string, any>).targets ?? {};
      const taskTarget = rawTargets[SLACK_PROPOSAL_WORKFLOW_TOOLS.taskService];
      const bugTarget = rawTargets[SLACK_PROPOSAL_WORKFLOW_TOOLS.bugService];
      const progressTarget = rawTargets.mysheets;
      const triggerIndex = body.decision?.relevance?.sourceIndex ?? body.decision?.sourceIndices?.[0] ?? 0;
      const triggerMsg = body.context?.[triggerIndex] ?? body.context?.[0];
      if (!triggerMsg) throw new Error('SLACK_PROPOSAL_STALE');
      const planInput: SlackProposalPlanInput = {
        ownerId: owner,
        binding: body.binding,
        policyReference,
        source: {
          channelId: triggerMsg.channelId,
          messageTs: triggerMsg.ts,
          threadTs: triggerMsg.threadTs ?? triggerMsg.ts,
        },
        proposal: {
          title: body.decision?.title ?? 'Đề xuất',
          rationale: body.decision?.rationale ?? '',
          intents: Array.isArray(body.decision?.intents) ? body.decision.intents : [],
          sourceTexts: Array.isArray(body.context) ? body.context.map((m: any) => String(m.text ?? '')) : [],
        },
        targets: {
          task: taskTarget?.listId ? { listId: taskTarget.listId } : undefined,
          bug: bugTarget?.projectKey ? { projectKey: bugTarget.projectKey } : undefined,
          progress: progressTarget?.spreadsheetId
            ? {
                spreadsheetId: progressTarget.spreadsheetId,
                sheet: String(progressTarget.range ?? 'Sheet1').split('!')[0] || 'Sheet1',
                allowedSpreadsheetIds: [progressTarget.spreadsheetId],
              }
            : undefined,
          replyInThread: input.replyInThread ?? (rawTargets.replyToSource === true),
        },
        instruction: input.instruction,
      };
      const built = planSlackProposalWorkflow(planInput);
      await c.query(
        "UPDATE plans SET status='superseded', decided_at=clock_timestamp() WHERE conv_id=$1 AND status='pending'",
        [row.conv_id],
      );
      if (built.kind === 'needs_info') {
        await c.query(
          "UPDATE slack_assistant_artifacts SET status='needs_info', active_plan_id=NULL, revision=revision+1, updated_at=clock_timestamp() WHERE id=$1 AND user_id=$2 AND revision=$3",
          [id, owner, revision],
        );
        outcome = { status: 'needs_info', clarification: built.question };
      } else {
        const planText = JSON.stringify(built.plan);
        const planHash = createHash('sha256').update(planText).digest('hex');
        const saved = await this.options.plans.createSlackPlan(
          {
            convId: row.conv_id,
            planJson: built.plan,
            planText,
            planHash,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          },
          { segments },
          c,
        );
        await c.query(
          "UPDATE slack_assistant_artifacts SET status='awaiting_approval', active_plan_id=$4, revision=revision+1, updated_at=clock_timestamp() WHERE id=$1 AND user_id=$2 AND revision=$3",
          [id, owner, revision, saved.id],
        );
        outcome = { status: 'awaiting_approval', planId: saved.id, planHash: saved.plan_hash, plan: built.plan };
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
    const proposal = await this.options.artifacts.get(owner, id, 'planning');
    return { ...outcome, proposal };
  }

  async reject(owner: string, id: string, rawInput: unknown) {
    const { expectedRevision } = validateSlackProposalRevisionInput(rawInput);
    return this.options.artifacts.reject(owner, id, String(expectedRevision));
  }
}
