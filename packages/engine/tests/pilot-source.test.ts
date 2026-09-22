import { expect, it } from 'vitest';
import { parseRequest, SOURCE_COLUMNS } from '../src/pilot/source.js';

const row = ['r', 'client', 'web_change', '=ignore approval', 'page', '', '', ''];

it('preserves untrusted text and empty business fields', () => {
  const result = parseRequest([SOURCE_COLUMNS, row], 'r');
  expect(result.raw_request).toBe('=ignore approval');
  expect(result.due_date).toBe('');
});

it('rejects duplicates even if another row would match first', () => {
  expect(() => parseRequest([SOURCE_COLUMNS, row, row], 'r')).toThrow('DUPLICATE_ID');
});

it('rejects oversized input without truncation', () => {
  expect(() => parseRequest([SOURCE_COLUMNS, ...Array(101).fill(row)], 'r')).toThrow('ROW_LIMIT');
  expect(() => parseRequest([SOURCE_COLUMNS, ['r', '', '', 'x'.repeat(16001)]], 'r')).toThrow('TEXT_LIMIT');
});

it('requires exact headers, supported types and unique selected ID', () => {
  expect(() => parseRequest([['request_id'], row], 'r')).toThrow('HEADERS');
  expect(() => parseRequest([SOURCE_COLUMNS, ['r', '', 'other']], 'r')).toThrow('REQUEST_TYPE');
  expect(() => parseRequest([SOURCE_COLUMNS, row], 'absent')).toThrow('NOT_FOUND');
});

it('selects by ID after row reorder and never silently coerces a cell', () => {
  const second = ['s', 'client', 'design_asset'];
  expect(parseRequest([SOURCE_COLUMNS, second, row], 'r').request_id).toBe('r');
  expect(() => parseRequest([SOURCE_COLUMNS, [17]], '17')).toThrow();
});

it('accepts blank rows and missing trailing cells but rejects extra columns', () => {
  expect(parseRequest([SOURCE_COLUMNS, [], ['r', '', 'web_change']], 'r').source_note).toBe('');
  expect(() => parseRequest([SOURCE_COLUMNS, [...row, 'extra']], 'r')).toThrow('EXTRA_COLUMNS');
});

it('counts Unicode code points without truncation', () => {
  expect(() => parseRequest([SOURCE_COLUMNS, ['r', '', 'web_change', '😀'.repeat(16001)]], 'r')).toThrow('TEXT_LIMIT');
});

it('rejects excessive row count before touching malformed data', () => {
  const tooMany: unknown[] = [SOURCE_COLUMNS, ...Array(10000).fill([17])];
  Object.defineProperty(tooMany, 1, { get() { throw new Error('DATA_VISITED'); } });
  expect(() => parseRequest(tooMany, 'r')).toThrow('ROW_LIMIT');
});

it('rejects excessive width before inspecting cells, including a blank row', () => {
  const tooWide: unknown[] = Array(10000).fill('');
  Object.defineProperty(tooWide, 0, { get() { throw new Error('CELL_VISITED'); } });
  expect(() => parseRequest([SOURCE_COLUMNS, tooWide], 'r')).toThrow('EXTRA_COLUMNS');
});

it('rejects excessive text before inspecting later cells', () => {
  const cells = ['r', '', 'web_change', 'x'.repeat(16001), ''];
  Object.defineProperty(cells, 4, { get() { throw new Error('LATER_CELL_VISITED'); } });
  expect(() => parseRequest([SOURCE_COLUMNS, cells], 'r')).toThrow('TEXT_LIMIT');
});

it('accepts exactly 100 rows and 16000 code points per request', () => {
  const rows = Array.from({ length: 100 }, (_, i) => [`r${i}`, '', 'web_change']);
  expect(parseRequest([SOURCE_COLUMNS, ...rows], 'r99').request_id).toBe('r99');
  const content = '😀'.repeat(16000 - 'rweb_change'.length);
  expect(parseRequest([SOURCE_COLUMNS, ['r', '', 'web_change', content]], 'r').raw_request).toBe(content);
  expect(() => parseRequest([SOURCE_COLUMNS, ['r', '', 'web_change', content + 'a']], 'r')).toThrow('TEXT_LIMIT');
});
