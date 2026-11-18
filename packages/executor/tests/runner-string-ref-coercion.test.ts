import { describe, it, expect } from 'vitest';
import { StepRunner } from '../src/index.js';

// Live audit 18/11/2026: notion.create_page { content: { $ref: 'read_slack.output.messages' } }
// failed with "Notion text is outside its allowed size" because an array reached a string field.
describe('StepRunner formats $ref arrays/objects passed into string parameters', () => {
  const run = async (args: Record<string, any>, tool = 'notion.create_page') => {
    const seen: any[] = [];
    const runner = new StepRunner({
      getAdapter: () => ({ execute: async (_tool: string, resolved: any) => { seen.push(resolved); return { id: 'x' }; } }),
    });
    const outputs = new Map<string, any>([
      ['read_slack', { messages: [{ ts: '1.1', text: 'Tin A', user: 'U1' }, { ts: '1.2', text: 'Tin B', user: 'U2' }] }],
      ['find', [{ id: 'db1', title: 'Notes' }]],
    ]);
    const result = await runner.executeStep({ id: 's2', tool, description: 'x', args, dependsOn: [] } as any, outputs);
    return { result, resolved: seen[0] };
  };

  it('turns an array $ref into readable text for a string-typed field', async () => {
    const { result, resolved } = await run({ databaseId: 'd', title: 'T', content: { $ref: 'read_slack.output.messages' } });
    expect(result.status).toBe('success');
    expect(resolved.content).toBe('- Tin A\n- Tin B');
  });

  it('leaves scalar $ref values for string fields unchanged', async () => {
    const { resolved } = await run({ databaseId: { $ref: 'find.output.0.id' }, title: 'T' });
    expect(resolved.databaseId).toBe('db1');
  });

  it('does not touch non-string parameters', async () => {
    const { resolved } = await run({ databaseId: 'd', title: 'T', properties: { $ref: 'find.output.0' } });
    expect(resolved.properties).toEqual({ id: 'db1', title: 'Notes' });
  });
});
