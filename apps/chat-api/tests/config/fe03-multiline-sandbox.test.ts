import { expect, it } from 'vitest';
import { AIPlanner, WorkingMemory } from '@wap/planner';
import { ALL_TOOLS } from '@wap/tool-schemas';
import { createSandboxProvider } from '../../src/sandbox/scenarios.js';

it('validates the FE-03 multiline browser request against the canned two-service sandbox plan', async () => {
  const planner = new AIPlanner({ provider: createSandboxProvider(), toolCatalog: ALL_TOOLS, requireGroundedResources: false });
  // The sandbox fixture always includes Slack, so a Trello-only request correctly
  // fails catalog validation rather than bypassing routing to preview that plan.
  await expect(planner.processMessage({ userMessage: 'Tạo công việc Trello\na', memory: new WorkingMemory() }))
    .rejects.toThrow(/Validation failed after retry/);
  const response = await planner.processMessage({ userMessage: 'Tạo công việc Trello\nThông báo Slack', memory: new WorkingMemory() });
  expect(response.kind).toBe('plan');
  if (response.kind === 'plan') expect(response.steps.map(step => step.tool)).toEqual(['trello.create_card', 'trello.add_member', 'slack.send_message']);
});
