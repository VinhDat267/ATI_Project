import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, describeToolCompact } from '../src/index.js';
import { ALL_TOOLS } from '@wap/tool-schemas';

const tool = (name: string) => ALL_TOOLS.find((candidate) => candidate.name === name)!;

describe('compact tool listing', () => {
  it('describes a write tool with required markers, types, resources and returned fields', () => {
    const text = describeToolCompact(tool('trello.create_card'));
    expect(text).toContain('trello.create_card (write, risk: low)');
    expect(text).toContain('listId* string [x-resource: list]');
    expect(text).toContain('title* string');
    expect(text).toContain('idMembers string[] [x-resource: member]');
    expect(text).toMatch(/due string/);
    expect(text).toContain('returns { id, name, url, listId }');
    expect(text).not.toContain('"type"');
  });

  it('keeps the resource field, numeric bounds and list results', () => {
    expect(describeToolCompact(tool('github.create_issue'))).toContain('repo* string [x-resource: repository.fullName]');
    expect(describeToolCompact(tool('github.add_label'))).toContain('issueNumber* number ≥1 [x-resource: issue.number]');
    const boards = describeToolCompact(tool('trello.search_boards'));
    expect(boards).toContain('limit number ≤10');
    expect(boards).toMatch(/returns list of \{ id, name/);
  });

  it('names every input and output property of every tool', () => {
    for (const definition of ALL_TOOLS) {
      const text = describeToolCompact(definition);
      for (const name of Object.keys(definition.inputSchema.properties ?? {})) expect(text, `${definition.name}.${name}`).toContain(name);
      const output = definition.outputSchema.type === 'array' ? definition.outputSchema.items : definition.outputSchema;
      for (const name of Object.keys(output?.properties ?? {})) expect(text, `${definition.name} -> ${name}`).toContain(name);
    }
  });

  it('shortens the tool section by at least 40% when selected, and is off by default', () => {
    const verbose = buildSystemPrompt(ALL_TOOLS);
    const compact = buildSystemPrompt(ALL_TOOLS, undefined, { compactTools: true });
    expect(verbose).toContain('"additionalProperties":false');
    expect(compact).not.toContain('"additionalProperties"');
    expect(compact).toContain('Arguments marked * are required');
    expect(compact.length).toBeLessThan(verbose.length * 0.7);
  });
});
