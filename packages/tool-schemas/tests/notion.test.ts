import { expect, it } from 'vitest';
import { Ajv } from 'ajv';
import { ALL_TOOLS, getServiceDefinition } from '../src/index.js';

it('publishes Notion database/page contracts with resource grounding and bounded plain text', () => {
  const tools = ALL_TOOLS.filter(t => t.service === 'notion');
  expect(tools.map(t => t.name)).toEqual(['notion.search_databases', 'notion.query_database', 'notion.create_page', 'notion.append_text']);
  const ajv = new Ajv({ strict: false });
  for (const tool of tools) { ajv.compile(tool.inputSchema); ajv.compile(tool.outputSchema); }
  expect(tools.filter(t => t.listable).map(t => t.name)).toEqual(['notion.search_databases']);
  expect(tools[0]!.discovers).toBe('database'); expect(tools[1]!.discovers).toBe('page');
  for (const tool of tools.filter(t => t.sideEffect === 'write')) expect(tool.riskLevel).toBe('medium');
  const create = ajv.compile(tools[2]!.inputSchema);
  const args = { databaseId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', title: 'Biên bản', content: '# Văn bản thuần', properties: { Score: '2' } };
  expect(create(args)).toBe(true); expect(create({ ...args, databaseId: '../outside' })).toBe(false);
  expect(create({ ...args, title: 'x'.repeat(201) })).toBe(false); expect(create({ ...args, content: 'x'.repeat(4001) })).toBe(false);
  expect(create({ ...args, properties: { Score: 2 } })).toBe(false);
  expect(ajv.compile(tools[1]!.inputSchema)({ databaseId: args.databaseId, limit: 21 })).toBe(false);
  expect(ajv.compile(tools[3]!.inputSchema)({ pageId: args.databaseId, text: 'x'.repeat(2001) })).toBe(false);
  expect(tools[3]!.inputSchema.properties.pageId['x-resource']).toBe('page');
});

it('registers UUID scope normalization without broad routing keywords', () => {
  const definition = getServiceDefinition('notion'); expect(definition).toBeDefined();
  expect(definition!.scopeKey).toBe('databases'); expect(definition!.scopeLabel).toBe('Database ID');
  expect(definition!.credentialFields).toEqual([{ key: 'token', label: 'Internal integration token', type: 'password' }]);
  expect(definition!.intentKeywords).toEqual(['notion']);
  expect(definition!.fallbackIntentKeywords).toEqual(['ghi chú', 'wiki', 'tài liệu']);
  for (const id of ['AAAAAAAABBBBCCCCDDDDEEEEEEEEEEEE', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']) expect(definition!.scopePattern!.test(id)).toBe(true);
  for (const id of ['', 'abc', '../outside', 'a'.repeat(33)]) expect(definition!.scopePattern!.test(id)).toBe(false);
});
