import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyIntent } from '@wap/planner';
import { ALL_TOOLS, SERVICE_REGISTRY } from '@wap/tool-schemas';
import golden from './cases.json';
import freeform from './cases-freeform.json';
import launchpad from './launchpad-prompts.json';

const corpus = [
  ...golden.cases.map(item => ({ ...item, source: 'golden' })),
  ...freeform.cases.map(item => ({ ...item, source: 'freeform' })),
  ...launchpad.map(item => ({ ...item, source: 'launchpad' })),
];
const legacyCatalog = ALL_TOOLS.filter(tool => ['trello', 'slack', 'github'].includes(tool.service));

it('preserves routing for the 50 golden, 18 freeform and 4 launchpad requests in both catalog configurations', () => {
  const actual = corpus.map(({ id, prompt, source }) => ({
    id, source, prompt,
    legacyCatalog: classifyIntent(prompt, legacyCatalog, SERVICE_REGISTRY),
    fullCatalog: classifyIntent(prompt, ALL_TOOLS, SERVICE_REGISTRY),
  }));
  const snapshotUrl = new URL('./routing.snapshot.json', import.meta.url);
  // Deliberately manual: adding a service requires an explained, separate snapshot commit.
  expect(() => readFileSync(snapshotUrl, 'utf8'), 'routing baseline must be committed').not.toThrow();
  const expected = JSON.parse(readFileSync(snapshotUrl, 'utf8'));
  expect(actual).toEqual(expected);
  for (const row of actual.filter(row => row.source !== 'launchpad')) {
    const baseline = expected.find((entry: typeof row) => entry.id === row.id && entry.source === row.source);
    if (baseline?.legacyCatalog.length) expect(row.legacyCatalog.length, row.id).toBeGreaterThan(0);
  }
});
