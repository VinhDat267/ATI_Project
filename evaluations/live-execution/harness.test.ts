import { describe, it, expect } from 'vitest';
import type { PlanResponse } from '@wap/tool-schemas';
import { executeApproved, planDigest, readLiveConfig, writeSteps } from './harness.js';

const fullEnv = {
  TRELLO_API_KEY: 'key', TRELLO_TOKEN: 'token', LIVE_TRELLO_BOARD_IDS: ' b1 , b2,b1 ',
  SLACK_BOT_TOKEN: 'xoxb', LIVE_SLACK_CHANNELS: 'C1',
  GITHUB_TOKEN: 'ghp', LIVE_GITHUB_REPOS: 'acme/sandbox',
};

const plan: PlanResponse = {
  kind: 'plan', thinking: 't', summary: 'Issue, card and notice', warnings: [],
  steps: [
    { id: 'issue', tool: 'github.create_issue', description: 'Create issue', args: { repo: 'acme/sandbox', title: 'Live check' }, dependsOn: [] },
    { id: 'card', tool: 'trello.create_card', description: 'Create card', args: { listId: 'l1', title: 'Live check', desc: { $template: 'Issue: ${issue.output.url}' } }, dependsOn: ['issue'] },
    { id: 'note', tool: 'slack.send_message', description: 'Notify', args: { channel: 'C1', text: { $template: 'Card ${card.output.url}' } }, dependsOn: ['card'] },
  ],
};

function fakeAdapters(fail?: string) {
  const calls: Array<{ tool: string; args: any }> = [];
  const getAdapter = (_service: string) => ({
    execute: async (tool: string, args: any) => {
      calls.push({ tool, args });
      if (tool === fail) throw Object.assign(new Error('invalid channel'), { category: 'VALIDATION' });
      if (tool === 'github.create_issue') return { id: 'i1', number: 7, title: args.title, url: 'https://github.com/acme/sandbox/issues/7', repo: args.repo };
      if (tool === 'trello.create_card') return { id: 'c1', name: args.title, url: 'https://trello.com/c/c1', listId: args.listId };
      return { ts: '1.0', channel: args.channel };
    },
  });
  return { getAdapter, calls };
}

describe('readLiveConfig', () => {
  it('enables a service only when it has credentials and a resource allowlist', () => {
    const { services, skipped } = readLiveConfig(fullEnv);
    expect(Object.keys(services).sort()).toEqual(['github', 'slack', 'trello']);
    expect(services.trello!.allowedScope).toEqual({ boards: ['b1', 'b2'] });
    expect(services.slack!.allowedScope).toEqual({ channels: ['C1'] });
    expect(services.github!.allowedScope).toEqual({ repos: ['acme/sandbox'] });
    expect(skipped).toEqual({});
  });

  it('skips a service without a token or without an allowlist and says why', () => {
    const { services, skipped } = readLiveConfig({ ...fullEnv, TRELLO_TOKEN: '', LIVE_SLACK_CHANNELS: '', LIVE_GITHUB_REPOS: 'not-a-repo' });
    expect(services).toEqual({});
    expect(skipped.trello).toMatch(/TRELLO_TOKEN/);
    expect(skipped.slack).toMatch(/LIVE_SLACK_CHANNELS/);
    expect(skipped.github).toMatch(/owner\/name/);
  });
});

describe('plan approval', () => {
  it('hashes a plan deterministically and lists only its write steps', () => {
    expect(planDigest(plan)).toMatch(/^[0-9a-f]{64}$/);
    expect(planDigest(plan)).toBe(planDigest(JSON.parse(JSON.stringify(plan))));
    expect(planDigest({ ...plan, summary: 'changed' })).not.toBe(planDigest(plan));
    const withRead: PlanResponse = { ...plan, steps: [{ id: 'look', tool: 'trello.search_boards', description: 'Look', args: { query: 'x' }, dependsOn: [] }, ...plan.steps] };
    expect(writeSteps(withRead).map((step) => step.id)).toEqual(['issue', 'card', 'note']);
  });

  it('refuses to execute unless the approved hash matches the plan', async () => {
    const { getAdapter, calls } = fakeAdapters();
    await expect(executeApproved({ plan, approvedHash: 'deadbeef', services: ['trello', 'slack', 'github'], getAdapter }))
      .rejects.toThrow(/does not match/i);
    const edited = { ...plan, steps: [{ ...plan.steps[0]!, args: { repo: 'acme/production', title: 'x' } }, ...plan.steps.slice(1)] };
    await expect(executeApproved({ plan: edited, approvedHash: planDigest(plan), services: ['trello', 'slack', 'github'], getAdapter }))
      .rejects.toThrow(/does not match/i);
    expect(calls).toHaveLength(0);
  });

  it('refuses a plan that uses a service that is not configured', async () => {
    const { getAdapter, calls } = fakeAdapters();
    await expect(executeApproved({ plan, approvedHash: planDigest(plan), services: ['trello', 'slack'], getAdapter }))
      .rejects.toThrow(/github.*not configured/i);
    expect(calls).toHaveLength(0);
  });

  it('refuses a plan that fails schema validation even when the hash matches', async () => {
    const { getAdapter, calls } = fakeAdapters();
    const broken = { ...plan, steps: [{ ...plan.steps[0]!, args: { repo: 'acme/sandbox' } }] } as PlanResponse;
    await expect(executeApproved({ plan: broken, approvedHash: planDigest(broken), services: ['github'], getAdapter }))
      .rejects.toThrow(/title/);
    expect(calls).toHaveLength(0);
  });
});

describe('executeApproved', () => {
  it('runs the approved steps in order and passes earlier outputs to later steps', async () => {
    const { getAdapter, calls } = fakeAdapters();
    const result = await executeApproved({ plan, approvedHash: planDigest(plan), services: ['trello', 'slack', 'github'], getAdapter });
    expect(result.status).toBe('completed');
    expect(calls.map((c) => c.tool)).toEqual(['github.create_issue', 'trello.create_card', 'slack.send_message']);
    expect(calls[1]!.args.desc).toBe('Issue: https://github.com/acme/sandbox/issues/7');
    expect(calls[2]!.args.text).toBe('Card https://trello.com/c/c1');
    expect(result.steps.map((s) => s.status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    expect(result.steps[0]!.output.url).toBe('https://github.com/acme/sandbox/issues/7');
  });

  it('stops at a failed step without running later writes', async () => {
    const { getAdapter, calls } = fakeAdapters('trello.create_card');
    const result = await executeApproved({ plan, approvedHash: planDigest(plan), services: ['trello', 'slack', 'github'], getAdapter });
    expect(result.status).not.toBe('completed');
    expect(calls.map((c) => c.tool)).toEqual(['github.create_issue', 'trello.create_card']);
    expect(result.steps.map((s) => s.status)).toEqual(['succeeded', 'failed', 'pending']);
    expect(result.steps[1]!.error?.message).toMatch(/invalid channel/);
  });
});
