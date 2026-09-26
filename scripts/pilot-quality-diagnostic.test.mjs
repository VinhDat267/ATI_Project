import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectDiagnosticCase, assertDiagnosticPhase } from './pilot-quality-diagnostic.mjs';

test('diagnostic manifests cannot enter acceptance phases or vice versa', () => {
  assertDiagnosticPhase('run-diagnostic', 'diagnostic');
  assertDiagnosticPhase('run', 'probe');
  for (const phase of ['probe', 'smoke', 'public', 'holdout']) {
    assert.throws(() => assertDiagnosticPhase('run-diagnostic', phase));
  }
  assert.throws(() => assertDiagnosticPhase('run', 'diagnostic'));
});

test('diagnostics selects exactly one eligible public variant', () => {
  const entries = [{ variantId: 'V2-03-vi' }, { variantId: 'V2-03-en' }];
  assert.deepEqual(selectDiagnosticCase(entries, 'V2-03-vi'), [entries[0]]);
});

test('diagnostics rejects missing, unknown, duplicate and holdout IDs', () => {
  for (const id of [undefined, '', 'holdout-01', 'not-public']) {
    assert.throws(() => selectDiagnosticCase([{ variantId: 'V2-03-vi' }], id));
  }
  assert.throws(() => selectDiagnosticCase([{ variantId: 'duplicate' }, { variantId: 'duplicate' }], 'duplicate'));
});
