import { expect, it } from 'vitest';
import { validatePlan } from '../src/index.js';
import { groundingMemory, recordObserved } from '../src/search.js';
import type { ToolDefinition } from '@wap/tool-schemas';

it('grounds x-resource-field key from compacted search results', () => {
  const tool: ToolDefinition = {
    name: 'demo.create_thing', service: 'demo', description: 'Create', sideEffect: 'write', riskLevel: 'low',
    inputSchema: { type: 'object', required: ['project'], properties: { project: { type: 'string', 'x-resource': 'project', 'x-resource-field': 'key' } } },
    outputSchema: { type: 'object', properties: { id: { type: 'string' } } },
  };
  const observed = recordObserved(undefined, 'project', [{ id: '1', name: 'Project', key: 'APP', secret: 'discard' }]);
  expect(observed.project).toEqual([{ id: '1', name: 'Project', key: 'APP' }]);
  const plan = (project: string) => JSON.stringify({
    kind: 'plan', thinking: 'Create in the observed project', summary: 'Create', warnings: [],
    steps: [{ id: 'create', tool: tool.name, description: 'Create', args: { project }, dependsOn: [] }],
  });
  const memory = groundingMemory({}, observed);
  const options = { grounding: { memory, userTexts: [] } };
  expect(validatePlan(plan('APP'), [tool], options).valid).toBe(true);
  expect(validatePlan(plan('UNOBSERVED'), [tool], options).valid).toBe(false);
});
