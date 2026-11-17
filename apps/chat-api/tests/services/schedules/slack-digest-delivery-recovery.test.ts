import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ScheduleProposalMetadata, SlackDigestConfig } from '@wap/tool-schemas';
import { ConversationRepo } from '../../../src/db/repositories/conversation-repo.js';
import { MessageRepo } from '../../../src/db/repositories/message-repo.js';
import { CALENDAR_DELIVERY_UNKNOWN } from '../../../src/services/schedules/calendar-digest-runner.js';
import { reconcileScheduleRuns } from '../../../src/services/schedules/schedule-runner.js';
import { ScheduleService } from '../../../src/services/schedules/schedule-service.js';
import { computeSlackDigestConfigHash } from '../../../src/services/schedules/slack-digest-candidate.js';
import { SLACK_DIGEST_DELIVERY_UNKNOWN } from '../../../src/services/schedules/slack-digest-runner.js';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';

const NOW = new Date('2026-11-17T01:00:00.000Z');
const TIME_ZONE = 'Asia/Ho_Chi_Minh';

describe('Slack digest recovery after switching to manual approval', () => {
  let db: Awaited<ReturnType<typeof createMigratedSchema>>;

  beforeAll(async () => {
    db = await createMigratedSchema('slack_delivery_history');
  });
  afterAll(async () => db?.close());

  it.each([
    { case: 'an existing Slack unknown run', status: 'needs_attention', error: SLACK_DIGEST_DELIVERY_UNKNOWN },
    { case: 'a run interrupted during dispatch', status: 'planning', error: null },
    { case: 'a run marked unknown by older startup recovery', status: 'needs_attention', error: CALENDAR_DELIVERY_UNKNOWN },
  ])('can mark $case as sent using the original destination and cannot retry it', async ({ status, error }) => {
    const owner = await db.person();
    const conversation = await new ConversationRepo(db.pool).createConversation(owner.id, 'Slack digest');
    const service = new ScheduleService({ pool: db.pool, timeZone: TIME_ZONE });
    const config: SlackDigestConfig = {
      destination: 'slack',
      workspaceMode: 'personal',
      workspaceId: null,
      slackCredentialId: randomUUID(),
      channelId: 'C0123456789',
      channelName: 'original-channel',
      sources: [{ service: 'github', tool: 'github.search_issues', args: { repo: 'test/sample' }, label: 'GitHub' }],
      recurrence: { type: 'daily', time: '08:00' },
      timeZone: TIME_ZONE,
    };
    const configHash = computeSlackDigestConfigHash(config);
    const scheduleResult = await db.pool.query<{ id: string; version: number }>(
      `INSERT INTO schedules(
         user_id, conv_id, name, request, recurrence, services, status, next_run_at, workspace_mode,
         kind, digest_config, digest_config_hash, digest_approved_at
       )
       VALUES($1, $2, 'Slack digest', 'Send GitHub updates to Slack', $3, $4, 'active', $5,
              'personal', 'slack_digest', $6, $7, $5)
       RETURNING id, version`,
      [owner.id, conversation.id, JSON.stringify(config.recurrence), ['github', 'slack'], NOW, JSON.stringify(config), configHash],
    );
    const schedule = scheduleResult.rows[0]!;
    const runResult = await db.pool.query<{ id: string }>(
      `INSERT INTO schedule_runs(schedule_id, schedule_version, trigger, due_at, status, error,
                                 delivery_started_at, dispatched_config, dispatched_config_hash)
       VALUES($1, $2, 'scheduled', $3, $4, $5, $3, $6, $7)
       RETURNING id`,
      [schedule.id, schedule.version, NOW, status, error, JSON.stringify(config), configHash],
    );

    const run = runResult.rows[0]!;

    const update: ScheduleProposalMetadata = {
      type: 'schedule_proposal',
      proposal: {
        kind: 'schedule',
        action: 'update',
        name: 'Manual Slack review',
        request: 'Prepare a GitHub update and ask before sending it to another Slack channel',
        recurrence: config.recurrence,
        summary: 'Enable manual approval.',
      },
      scheduleId: schedule.id,
      baseVersion: schedule.version,
      services: ['github', 'slack'],
      nextRuns: [],
      previous: null,
    };
    const message = await new MessageRepo(db.pool).createMessage(conversation.id, 'assistant', update.proposal.summary, update);
    const confirmed = await service.confirmProposal({
      userId: owner.id,
      convId: conversation.id,
      messageId: message.id,
      approvalMode: 'manual',
      now: NOW,
    });
    expect(confirmed.schedule).toMatchObject({ kind: 'plan', version: schedule.version + 1, digestConfig: null });

    if (status === 'planning') {
      await reconcileScheduleRuns(db.pool);
      const reconciled = await db.pool.query('SELECT error FROM schedule_runs WHERE id = $1', [run.id]);
      expect(reconciled.rows[0]?.error).toBe(SLACK_DIGEST_DELIVERY_UNKNOWN);
    }
    const [unresolved] = await service.listRuns(owner.id, schedule.id, 10, NOW);
    expect(unresolved).toMatchObject({
      id: run.id,
      state: 'needs_attention',
      error: SLACK_DIGEST_DELIVERY_UNKNOWN,
      deliveryResolution: null,
      canRetryDelivery: false,
    });
    const input = { userId: owner.id, runId: run.id, now: NOW };
    await expect(service.resolveRunDelivery({
      ...input,
      resolution: 'retry_new_run',
      confirmDuplicateRisk: true,
    })).rejects.toMatchObject({ code: 'CONFIG_CHANGED_SINCE_RUN' });

    const resolved = await service.resolveRunDelivery({ ...input, resolution: 'mark_sent' });
    expect(resolved.run).toMatchObject({
      id: run.id,
      state: 'digest_sent',
      deliveryResolution: 'confirmed_sent',
      deliveryStartedAt: NOW.toISOString(),
      delivery: {
        destinationService: 'slack',
        channelId: 'C0123456789',
        channelName: 'original-channel',
        ts: null,
      },
    });
    expect(resolved.followUpRun).toBeNull();
    expect(await service.listRuns(owner.id, schedule.id, 10, NOW)).toHaveLength(1);
  });
});
