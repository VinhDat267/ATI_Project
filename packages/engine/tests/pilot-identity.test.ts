import { expect, it } from 'vitest';
import { sourceKey, createIntentKey } from '../src/pilot/identity.js';

const a = { groupId: 'g', spreadsheetId: 's', tabId: 't', requestId: 'r' };

it('is stable and distinguishes requests and boards', () => {
  expect(sourceKey({ ...a })).toBe(sourceKey(a));
  expect(sourceKey({ ...a, requestId: 'r2' })).not.toBe(sourceKey(a));
  expect(createIntentKey(a, 'b')).not.toBe(createIntentKey(a, 'b2'));
});

for (const field of ['groupId', 'spreadsheetId', 'tabId', 'requestId'] as const) {
  it(`isolates both source and create keys by ${field}`, () => {
    const changed = { ...a, [field]: `${a[field]}-other` };
    expect(sourceKey(changed)).not.toBe(sourceKey(a));
    expect(createIntentKey(changed, 'b')).not.toBe(createIntentKey(a, 'b'));
  });
}

it('keeps the create intent stable across runs, operators and source revisions', () => {
  const first = { ...a, runId: 'run-1', operatorId: 'operator-a', sourceRevision: 'v1', rowNumber: 2 };
  const second = { ...a, runId: 'run-2', operatorId: 'operator-b', sourceRevision: 'v2', rowNumber: 9 };
  expect(sourceKey(first)).toBe(sourceKey(second));
  expect(createIntentKey(first, 'b')).toBe(createIntentKey(second, 'b'));
});

it('does not alias delimiter-containing identities', () => {
  expect(sourceKey({ ...a, groupId: 'g|s', spreadsheetId: 'x' }))
    .not.toBe(sourceKey({ ...a, groupId: 'g', spreadsheetId: 's|x' }));
});

it('rejects whitespace-corrupted identifiers without repairing them', () => {
  expect(() => sourceKey({ ...a, requestId: ' r' })).toThrow('INVALID_ID');
});
