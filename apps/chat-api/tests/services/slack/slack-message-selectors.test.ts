import { afterAll, beforeAll, expect, it } from 'vitest';
import { createMigratedSchema } from '../../helpers/gmail-test-db.js';
import { eraseMessageSelector, messageFingerprint, messageOutputSelectors, memoryOutputSelectors, messageSelectorKind, messageSelectorValue, validateMessageSelector } from '../../../src/services/slack/slack-message-selectors.js';

let db: Awaited<ReturnType<typeof createMigratedSchema>>;
beforeAll(async () => { db = await createMigratedSchema('slack_selector_parity'); });
afterAll(async () => { await db?.close(); });
it('queue SQL and runtime extraction agree for all concrete selectors, escaped Unicode IDs, JSON null and absent values', async () => {
  const rows = [
    { content: 'private', metadata: { type: 'plan', plan: { z: 1, a: null }, proposal: { text: 'x' }, previous: { name: 'x', request: 'x', recurrence: {} }, schedule: { name: 'x', request: 'x', recurrence: {}, lastRun: { error: 'x' } }, resourceLabels: { 'k/🧪': 'x' }, lookups: [] } },
    { content: '', metadata: { type: 'clarification', options: ['x'], context: null, reason: 'x' } },
    { content: '', metadata: { type: 'refusal', reason: 'x', suggestion: 'x' } },
    { content: '', metadata: { type: 'schedule_run', name: 'x' } },
    { content: '', metadata: { type: 'working_memory', state: { board: { id: 'B/#🧪', name: 'x' }, __observed: { channel: [{ id: 'C/#🧪', name: 'x' }] }, __labels: { 'k/🧪': 'x' }, __gatherBindings: { key: 'x' }, __gatherIntent: 'x', __gatherMissing: { key: 'x' }, __gatherPending: { query: 'x', candidates: [{ id: 'C/#🧪', name: 'x' }] }, members: [{ id: 'U', name: 'x' }] } } },
  ];
  for (const row of rows) {
    const selectors = row.metadata.type === 'working_memory' ? memoryOutputSelectors(row.metadata.state!) : messageOutputSelectors(row);
    for (const selector of selectors) {
      const kind = messageSelectorKind(selector);
      const read = async (r: typeof row) => (await db.pool.query(`SELECT value,value IS NOT NULL AS present FROM
        (SELECT slack_message_selector_value($1,$2::jsonb,$3,$4) AS value) extracted`, [r.content, JSON.stringify(r.metadata), kind, selector])).rows[0];
      const value = await read(row);
      expect(value.present, selector).toBe(true); expect(value.value, selector).toEqual(messageSelectorValue(row, kind, selector));
      const erased = structuredClone(row); eraseMessageSelector(erased, kind, selector);
      const after = await read(erased);
      if (selector === 'content') expect(after.value).toBe('Slack content is unavailable.');
      else expect(after.present, selector).toBe(false);
    }
  }
});
it('fingerprints are canonical for JSON, type-sensitive, and preserve exact content bytes', () => {
  expect(messageFingerprint({ b: 1, a: [true, null] }, 'metadata.plan')).toBe(messageFingerprint({ a: [true, null], b: 1 }, 'metadata.plan'));
  expect(messageFingerprint(null, 'metadata.plan')).not.toBe(messageFingerprint('null', 'metadata.plan'));
  expect(messageFingerprint('x')).not.toBe(messageFingerprint('x '));
});
it.each(['state:/__labels/__proto__', 'state:/members#id=%GG', 'state:/__observed', 'metadata.resourceLabels/', 'metadata.unknown'])('rejects malformed selector %s', selector => {
  expect(() => validateMessageSelector(messageSelectorKind(selector), selector)).toThrow();
});
