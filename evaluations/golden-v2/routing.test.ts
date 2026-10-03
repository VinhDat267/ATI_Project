import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyIntent } from '@wap/planner';
import { ALL_TOOLS, SERVICE_REGISTRY } from '@wap/tool-schemas';
import golden from './cases.json';
import freeform from './cases-freeform.json';
import launchpad from './launchpad-prompts.json';
import services from './cases-services.json';
import { legacyRoutingFailures } from './legacy-routing-guard.js';

const corpus = [
  ...golden.cases.map(item => ({ ...item, source: 'golden', expectedKind: item.expect.kind })),
  ...freeform.cases.map(item => ({ ...item, source: 'freeform', expectedKind: item.expect.kind })),
  ...launchpad.map(item => ({ ...item, source: 'launchpad', expectedKind: undefined })),
];
const legacyCatalog = ALL_TOOLS.filter(tool => ['trello', 'slack', 'github'].includes(tool.service));
const rf06 = golden.cases.find(row => row.id === 'rf06')!;
// Test-only registration: exercise the real router without adding a production service.
// Replace a future real Calendar entry rather than duplicating its registration.
const registryWithoutCalendar = SERVICE_REGISTRY.filter(service => service.id !== 'calendar');
const calendar = {
  ...SERVICE_REGISTRY[0]!, id: 'calendar', name: 'Google Calendar',
  intentKeywords: ['calendar', 'google calendar'], intentPatterns: [],
  fallbackIntentKeywords: [], gatherRules: [],
};
const calendarRegistry = [...registryWithoutCalendar, calendar];
const fullCalendarCatalog = [
  ...ALL_TOOLS.filter(tool => tool.service !== 'calendar'),
  { ...ALL_TOOLS[0]!, name: 'calendar.list_calendars', service: 'calendar' },
];
const calendarContext = {
  registeredServiceIds: calendarRegistry.map(service => service.id),
  legacyCatalogServiceIds: [...new Set(legacyCatalog.map(tool => tool.service))],
};
const rf06Row = () => ({
  id: rf06.id, source: 'golden', prompt: rf06.prompt, expectedKind: rf06.expect.kind,
  legacyCatalog: classifyIntent(rf06.prompt, legacyCatalog, calendarRegistry),
  fullCatalog: classifyIntent(rf06.prompt, fullCalendarCatalog, calendarRegistry),
});

it('preserves routing for the 50 golden, 18 freeform and 4 launchpad requests in both catalog configurations', () => {
  const actual = corpus.map(item => ({
    id: item.id, source: item.source, prompt: item.prompt,
    expectedKind: item.expectedKind,
    legacyCatalog: classifyIntent(item.prompt, legacyCatalog, SERVICE_REGISTRY),
    fullCatalog: classifyIntent(item.prompt, ALL_TOOLS, SERVICE_REGISTRY),
  }));
  const snapshotUrl = new URL('./routing.snapshot.json', import.meta.url);
  // Deliberately manual: adding a service requires an explained, separate snapshot commit.
  expect(() => readFileSync(snapshotUrl, 'utf8'), 'routing baseline must be committed').not.toThrow();
  const expected = JSON.parse(readFileSync(snapshotUrl, 'utf8'));
  expect(actual.map(({ expectedKind: _kind, ...routing }) => routing)).toEqual(expected);
  expect(legacyRoutingFailures(actual, {
    registeredServiceIds: SERVICE_REGISTRY.map(service => service.id),
    legacyCatalogServiceIds: [...new Set(legacyCatalog.map(tool => tool.service))],
  })).toEqual([]);
});

it('matches preregistered routing for all new-service cases in both availability configurations', () => {
  for (const row of services.cases) {
    expect(classifyIntent(row.prompt, legacyCatalog, SERVICE_REGISTRY), `${row.id}:legacy`).toEqual(row.routing.legacy);
    expect(classifyIntent(row.prompt, ALL_TOOLS, SERVICE_REGISTRY), `${row.id}:full`).toEqual(row.routing.full);
    // These requests explicitly require unavailable services; no partial legacy write plan is permitted.
    expect(row.routing.legacy, row.id).toEqual([]);
    for (const spec of row.expect.steps ?? []) expect(row.routing.full, `${row.id}:${spec.tool}`).toContain(spec.tool.split('.')[0]);
  }
});

it('does not confuse message history with Calendar or spreadsheet tabs with Notion pages', () => {
  for (const id of ['sh08', 'no08', 'tg07']) {
    const row = services.cases.find(c => c.id === id)!;
    expect(classifyIntent(row.prompt, ALL_TOOLS, SERVICE_REGISTRY), id).not.toContain('calendar');
  }
  expect(classifyIntent(services.cases.find(c => c.id === 'sh07')!.prompt, ALL_TOOLS, SERVICE_REGISTRY)).toEqual(['sheets']);
  // Existing GitHub metadata also reserves "issue". Preserve the broader route;
  // the model evaluation checks that the actual write selects Jira, never GitHub.
  expect(classifyIntent(services.cases.find(c => c.id === 'ji06')!.prompt, ALL_TOOLS, SERVICE_REGISTRY)).toEqual(['github', 'jira']);
});

it('rejects legacy prompts emptied by an unavailable service even when the comparison snapshot has been refreshed', () => {
  const item = golden.cases.find(row => row.id === 'ss03')!;
  const unavailable = {
    ...SERVICE_REGISTRY[0]!, id: 'demo', name: 'Demo', intentKeywords: ['họp sprint'],
    intentPatterns: [], fallbackIntentKeywords: [], gatherRules: [],
  };
  expect(classifyIntent(item.prompt, legacyCatalog, SERVICE_REGISTRY)).toEqual(['slack']);
  const row = { id: 'ss03', source: 'golden', legacyCatalog: classifyIntent(item.prompt, legacyCatalog, [...SERVICE_REGISTRY, unavailable]) };
  expect(row.legacyCatalog).toEqual([]);
  // A valid, uniquely registered phrase can still steal a complete legacy request.
  const refreshedSnapshot = [{ ...row }];
  expect(legacyRoutingFailures(refreshedSnapshot)).toEqual(['golden:ss03']);
});

it('binds the approved rf06 clarification label to the existing unavailable-Calendar legacy exception', () => {
  expect(rf06.expect.kind).toBe('clarification');
  expect(classifyIntent(rf06.prompt, legacyCatalog, registryWithoutCalendar)).toEqual(['trello', 'slack', 'github']);
  const row = rf06Row();
  expect(row.legacyCatalog).toEqual([]);
  expect(row.fullCatalog).toEqual(['calendar']);
  expect(legacyRoutingFailures([row], calendarContext)).toEqual([]);
});

it.each([
  ['different id', { id: 'rf07' }],
  ['different source', { source: 'freeform' }],
  ['changed prompt', { prompt: rf06.prompt + ' and send a Slack message' }],
  ['changed label', { expectedKind: 'plan' }],
  ['missing prompt', { prompt: undefined }],
  ['missing label', { expectedKind: undefined }],
  ['missing full routing', { fullCatalog: undefined }],
  ['empty full routing', { fullCatalog: [] }],
  ['unrelated service', { fullCatalog: ['demo'] }],
  ['mixed routing', { fullCatalog: ['calendar', 'slack'] }],
])('rejects an rf06 exception with %s', (_reason, change) => {
  const row = { ...rf06Row(), ...change };
  expect(legacyRoutingFailures([row], calendarContext)).toEqual([row.source + ':' + row.id]);
});

it('rejects empty rf06 routing without registration evidence or when Calendar is available', () => {
  const row = rf06Row();
  expect(legacyRoutingFailures([row])).toEqual(['golden:rf06']);
  expect(legacyRoutingFailures([row], {
    ...calendarContext, registeredServiceIds: registryWithoutCalendar.map(service => service.id),
  })).toEqual(['golden:rf06']);
  expect(legacyRoutingFailures([row], {
    ...calendarContext, legacyCatalogServiceIds: [...calendarContext.legacyCatalogServiceIds, 'calendar'],
  })).toEqual(['golden:rf06']);
  expect(classifyIntent(rf06.prompt, fullCalendarCatalog, calendarRegistry)).toEqual(['calendar']);
});

it('still rejects another legacy request stolen by unavailable Calendar after snapshot refresh', () => {
  const item = golden.cases.find(row => row.id === 'ss03')!;
  const registry = [...registryWithoutCalendar, { ...calendar, intentKeywords: ['họp sprint'] }];
  const row = {
    id: item.id, source: 'golden', prompt: item.prompt, expectedKind: item.expect.kind,
    legacyCatalog: classifyIntent(item.prompt, legacyCatalog, registry),
    fullCatalog: classifyIntent(item.prompt, fullCalendarCatalog, registry),
  };
  expect(row.legacyCatalog).toEqual([]);
  expect(row.fullCatalog).toEqual(['slack', 'calendar']);
  const refreshedSnapshot = [{ ...row }];
  expect(legacyRoutingFailures(refreshedSnapshot, calendarContext)).toEqual(['golden:ss03']);
});
