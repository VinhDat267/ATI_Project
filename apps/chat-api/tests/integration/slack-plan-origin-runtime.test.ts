import {createHash,randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {createMigratedSchema} from '../helpers/gmail-test-db.js';
import {ConversationRepo} from '../../src/db/repositories/conversation-repo.js';
import {PlanRepo} from '../../src/db/repositories/plan-repo.js';
import {StepRepo} from '../../src/db/repositories/step-repo.js';
import {SlackPlanOriginBackfill} from '../../src/services/slack/slack-plan-origin-backfill.js';

let db: Awaited<ReturnType<typeof createMigratedSchema>>;
let conversations: ConversationRepo;
let plans: PlanRepo;
let steps: StepRepo;
const secret = 'uncertified legacy plan private';

beforeAll(async () => {
  db = await createMigratedSchema('plan_origin');
  conversations = new ConversationRepo(db.pool);
  plans = new PlanRepo(db.pool);
  steps = new StepRepo(db.pool);
});
afterAll(async () => { await db?.close(); });

function planBody(text: string) {
  const planJson = {summary: text, steps: [{id: 's1', tool: 'trello.create_card', args: {name: text}}]};
  const planText = JSON.stringify(planJson);
  return {planJson, planText, planHash: createHash('sha256').update(planText).digest('hex')};
}

async function ownerConv() {
  const owner = await db.person();
  const conv = await conversations.createConversation(owner.id);
  return {owner, conv};
}

it('rejects an unmarked legacy plan at approval, snapshot and dispatch', async () => {
  const {owner, conv} = await ownerConv();
  const body = planBody(secret);
  const id = randomUUID();
  await db.pool.query(
    `INSERT INTO plans (id, conv_id, plan_json, plan_text, plan_hash, status, expires_at)
     VALUES ($1,$2,$3,$4,$5,'pending', now() + interval '30 minutes')`,
    [id, conv.id, JSON.stringify(body.planJson), body.planText, body.planHash],
  );
  expect(JSON.stringify(await plans.getPlan(id))).not.toContain(secret);
  expect(await plans.approvePlan(id, body.planHash, owner.id)).toBe(false);
  await expect(plans.assertSourceDispatchAllowed(id, owner.id, body.planHash, 's1', 'trello.create_card')).rejects.toThrow('SLACK_SOURCE_UNAVAILABLE');
  expect((await db.pool.query('SELECT plan_text FROM plans WHERE id=$1', [id])).rows[0].plan_text).toContain(secret);
});

it('seals a real source-free plan and its step output, then hides a later SQL bypass', async () => {
  const {owner, conv} = await ownerConv();
  const body = planBody('certified source-free plan');
  const plan = await plans.createPlan({
    convId: conv.id, planJson: body.planJson, planText: body.planText, planHash: body.planHash,
    expiresAt: new Date(Date.now() + 30 * 60_000),
  });
  expect(JSON.stringify(await plans.getPlan(plan.id))).toContain('certified source-free plan');
  expect(await plans.approvePlan(plan.id, body.planHash, owner.id)).toBe(true);
  const args = body.planJson.steps[0]?.args;
  if (!args) throw new Error('fixture step missing');
  const step = await steps.createStep({planId: plan.id, stepId: 's1', tool: 'trello.create_card', argsJson: args, requestedBy: owner.id});
  await steps.updateStepStatus(step.id, 'succeeded', {url: 'https://example.test/card'});
  const snapshot = await plans.getSourceExecutionSnapshot(plan.id);
  expect(JSON.stringify(snapshot.steps)).toContain('https://example.test/card');
  await plans.assertSourceDispatchAllowed(plan.id, owner.id, body.planHash, 's1', 'trello.create_card');

  const bypass = randomUUID();
  await db.pool.query(
    `INSERT INTO plans (id, conv_id, plan_json, plan_text, plan_hash, status, expires_at)
     VALUES ($1,$2,$3,$4,$5,'approved', now() + interval '30 minutes')`,
    [bypass, conv.id, JSON.stringify(body.planJson), body.planText, body.planHash],
  );
  expect(JSON.stringify(await plans.getPlan(bypass))).not.toContain('certified source-free plan');
  await db.pool.query('UPDATE plans SET plan_text=$2 WHERE id=$1', [plan.id, secret]);
  expect(JSON.stringify(await plans.getPlan(plan.id))).not.toContain(secret);
});

it('backfill certifies only plans with no Slack marker and leaves ambiguous bytes', async () => {
  const first = await ownerConv();
  const second = await ownerConv();
  const plain = planBody('plain legacy wording');
  const marked = planBody('mentions myslack.list');
  const plainId = randomUUID();
  const markedId = randomUUID();
  await db.pool.query(
    `INSERT INTO plans (id, conv_id, plan_json, plan_text, plan_hash, status, expires_at)
     VALUES ($1,$2,$3,$4,$5,'pending', now() + interval '30 minutes')`,
    [plainId, first.conv.id, JSON.stringify(plain.planJson), plain.planText, plain.planHash],
  );
  await db.pool.query(
    `INSERT INTO plans (id, conv_id, plan_json, plan_text, plan_hash, status, expires_at)
     VALUES ($1,$2,$3,$4,$5,'pending', now() + interval '30 minutes')`,
    [markedId, second.conv.id, JSON.stringify(marked.planJson), marked.planText, marked.planHash],
  );
  const dry = new SlackPlanOriginBackfill(db.pool);
  const preview = await dry.page('plans', {limit: 50});
  expect(preview.applied).toBe(0);
  expect(JSON.stringify(await plans.getPlan(plainId))).not.toContain('plain legacy wording');
  await dry.page('plans', {limit: 50, apply: true});
  expect(JSON.stringify(await plans.getPlan(plainId))).toContain('plain legacy wording');
  expect(JSON.stringify(await plans.getPlan(markedId))).not.toContain('myslack.list');
});
