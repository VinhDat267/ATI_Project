import { expect, it } from 'vitest';
import { Ajv } from 'ajv';
import { ALL_TOOLS, NOTION_OAUTH_TOOLS, getServiceDefinition, getToolDefinition } from '../src/index.js';

it('publishes Notion database/page contracts with resource grounding and bounded plain text', () => {
  const tools = ALL_TOOLS.filter(t => t.service === 'notion');
  expect(tools.map(t => t.name)).toEqual(['notion.search_databases', 'notion.query_database', 'notion.create_page', 'notion.append_text']);
  expect(NOTION_OAUTH_TOOLS.map(t => t.name)).toEqual([
    'notion.get_page',
    'notion.update_page',
    'notion.get_database',
    'notion.search_pages',
    'notion.append_blocks',
    'notion.list_comments',
    'notion.add_comment',
  ]);
  expect(getToolDefinition('notion.get_page')?.sideEffect).toBe('read');
  expect(getToolDefinition('notion.update_page')?.sideEffect).toBe('write');
  expect(getToolDefinition('notion.get_database')?.sideEffect).toBe('read');
  expect(getToolDefinition('notion.search_pages')?.sideEffect).toBe('read');
  expect(getToolDefinition('notion.append_blocks')?.sideEffect).toBe('write');
  expect(getToolDefinition('notion.list_comments')?.sideEffect).toBe('read');
  expect(getToolDefinition('notion.add_comment')?.sideEffect).toBe('write');
  const ajv = new Ajv({ strict: false });
  for (const tool of [...tools, ...NOTION_OAUTH_TOOLS]) { ajv.compile(tool.inputSchema); ajv.compile(tool.outputSchema); }
  expect(tools.filter(t => t.listable).map(t => t.name)).toEqual(['notion.search_databases']);
  expect(tools[0]!.discovers).toBe('database'); expect(tools[1]!.discovers).toBe('page');
  expect(NOTION_OAUTH_TOOLS[0]!.discovers).toBe('page');
  expect(NOTION_OAUTH_TOOLS[3]!.discovers).toBe('page');
  for (const tool of [...tools, ...NOTION_OAUTH_TOOLS].filter(t => t.sideEffect === 'write')) expect(tool.riskLevel).toBe('medium');
  const create = ajv.compile(tools[2]!.inputSchema);
  const args = { databaseId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', title: 'Biên bản', content: '# Văn bản thuần', properties: { Score: '2' } };
  expect(create(args)).toBe(true); expect(create({ ...args, databaseId: '../outside' })).toBe(false);
  expect(create({ ...args, title: 'x'.repeat(201) })).toBe(false); expect(create({ ...args, content: 'x'.repeat(4001) })).toBe(false);
  expect(create({ ...args, properties: { Score: 2 } })).toBe(false);
  expect(ajv.compile(tools[1]!.inputSchema)({ databaseId: args.databaseId, status: 'In progress', dateProperty: 'Due', dateOnOrAfter: '2026-11-01', dateOnOrBefore: '2026-11-30', sortDirection: 'descending', limit: 20 })).toBe(true);
  expect(ajv.compile(tools[1]!.inputSchema)({ databaseId: args.databaseId, sortDirection: 'invalid' })).toBe(false);
  expect(ajv.compile(tools[1]!.inputSchema)({ databaseId: args.databaseId, limit: 21 })).toBe(false);
  expect(ajv.compile(tools[3]!.inputSchema)({ pageId: args.databaseId, text: 'x'.repeat(2001) })).toBe(false);
  expect(tools[3]!.inputSchema.properties.pageId['x-resource']).toBe('page');
  expect(ajv.compile(NOTION_OAUTH_TOOLS[0]!.inputSchema)({ pageId: args.databaseId })).toBe(true);
  expect(ajv.compile(NOTION_OAUTH_TOOLS[1]!.inputSchema)({ pageId: args.databaseId, properties: { Status: 'Done' }, archived: false })).toBe(true);
  expect(ajv.compile(NOTION_OAUTH_TOOLS[2]!.inputSchema)({ databaseId: args.databaseId })).toBe(true);
  expect(ajv.compile(NOTION_OAUTH_TOOLS[3]!.inputSchema)({ query: 'Sprint', databaseId: args.databaseId, limit: 20 })).toBe(true);
  expect(ajv.compile(NOTION_OAUTH_TOOLS[4]!.inputSchema)({ pageId: args.databaseId, content: '## Checklist\n- [ ] Task 1' })).toBe(true);
  expect(ajv.compile(NOTION_OAUTH_TOOLS[4]!.inputSchema)({ pageId: args.databaseId, content: 'x'.repeat(4001) })).toBe(false);
  expect(ajv.compile(NOTION_OAUTH_TOOLS[5]!.inputSchema)({ pageId: args.databaseId, limit: 10 })).toBe(true);
  expect(ajv.compile(NOTION_OAUTH_TOOLS[6]!.inputSchema)({ pageId: args.databaseId, text: 'Đã review xong' })).toBe(true);
  expect(ajv.compile(NOTION_OAUTH_TOOLS[6]!.inputSchema)({ pageId: args.databaseId, text: 'x'.repeat(2001) })).toBe(false);
});

it('registers UUID scope normalization and business routing keywords', () => {
  const definition = getServiceDefinition('notion'); expect(definition).toBeDefined();
  expect(definition!.scopeKey).toBe('databases'); expect(definition!.scopeLabel).toBe('Database ID');
  expect(definition!.credentialFields).toEqual([{ key: 'token', label: 'Internal integration token', type: 'password' }]);
  expect(definition!.intentKeywords).toEqual(['notion']);
  expect(definition!.fallbackIntentKeywords).toEqual(['ghi chú', 'wiki', 'tài liệu', 'biên bản họp', 'meeting notes', 'knowledge base', 'roadmap', 'backlog', 'crm']);
  for (const id of ['AAAAAAAABBBBCCCCDDDDEEEEEEEEEEEE', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']) expect(definition!.scopePattern!.test(id)).toBe(true);
  for (const id of ['', 'abc', '../outside', 'a'.repeat(33)]) expect(definition!.scopePattern!.test(id)).toBe(false);
});
