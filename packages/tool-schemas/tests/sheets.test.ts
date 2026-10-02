import { expect, it } from 'vitest';
import Ajv from 'ajv';
import { ALL_TOOLS, SERVICE_REGISTRY, getServiceDefinition } from '../src/index.js';

it('registers four safe Sheets tools and service-account metadata', () => {
  const service = getServiceDefinition('sheets');
  expect(service).toMatchObject({ name: 'Google Sheets', scopeKey: 'spreadsheets', scopeLabel: 'Spreadsheet ID', credentialFields: [
    { key: 'clientEmail', type: 'text' }, { key: 'privateKey', type: 'multiline' },
  ] });
  expect(service!.scopePattern!.test('spreadsheet_fixture_123456')).toBe(true);
  expect(service!.scopePattern!.test('bad/id')).toBe(false);
  const tools = ALL_TOOLS.filter(tool => tool.service === 'sheets');
  expect(tools.map(tool => tool.name)).toEqual(['sheets.list_spreadsheets', 'sheets.list_sheets', 'sheets.read_range', 'sheets.append_rows']);
  const ajv = new Ajv({ strict: false });
  for (const tool of tools) { expect(() => ajv.compile(tool.inputSchema)).not.toThrow(); expect(() => ajv.compile(tool.outputSchema)).not.toThrow(); }
  expect(tools.filter(tool => tool.listable).map(tool => tool.discovers)).toEqual(['spreadsheet', 'sheet']);
  expect(tools[3]).toMatchObject({ sideEffect: 'write', riskLevel: 'medium' });
  expect(tools[3]!.inputSchema.properties.sheet).toMatchObject({ 'x-resource': 'sheet', 'x-resource-field': 'title' });
  expect(SERVICE_REGISTRY.filter(service => service.id === 'sheets')).toHaveLength(1);
});

it('constrains append payload shape and list/read limits in the schema', () => {
  const ajv = new Ajv({ strict: false });
  const append = ALL_TOOLS.find(tool => tool.name === 'sheets.append_rows')!;
  expect(append).toBeDefined();
  const validate = ajv.compile(append.inputSchema);
  const base = { spreadsheetId: 'spreadsheet_fixture_123456', sheet: 'Tasks', rows: [['Task']] };
  expect(validate(base)).toBe(true);
  for (const rows of [[], Array(21).fill(['x']), [Array(21).fill('x')], [['x'.repeat(1001)]]]) expect(validate({ ...base, rows })).toBe(false);
});
