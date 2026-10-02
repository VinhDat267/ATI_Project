import { expect, it } from 'vitest';
import Ajv from 'ajv';
import { ALL_TOOLS, getServiceDefinition } from '../src/index.js';

it('registers three bounded Calendar contracts and only the calendar directory is listable', () => {
  const tools = ALL_TOOLS.filter(t => t.service === 'calendar');
  expect(tools.map(t => t.name)).toEqual(['calendar.list_calendars', 'calendar.list_events', 'calendar.create_event']);
  const ajv = new Ajv({ strict: false });
  for (const tool of tools) { expect(ajv.compile(tool.inputSchema)).toBeTypeOf('function'); expect(ajv.compile(tool.outputSchema)).toBeTypeOf('function'); }
  expect(tools.filter(t => t.listable).map(t => t.name)).toEqual(['calendar.list_calendars']);
  expect(tools[0]!.discovers).toBe('calendar');
  expect(tools[2]!.riskLevel).toBe('medium');
  const create = ajv.compile(tools[2]!.inputSchema);
  const args = { calendarId: 'ati@group.calendar.google.com', summary: 'Review', start: '2026-10-09T15:00:00+07:00', end: '2026-10-09T16:00:00+07:00' };
  expect(create(args)).toBe(true);
  expect(create({ ...args, attendees: ['outside@example.test'] })).toBe(false);
  expect(create({ ...args, summary: 'x'.repeat(201) })).toBe(false);
  expect(create({ ...args, start: '2026-10-09T15:00:00' })).toBe(false);
  const definition = getServiceDefinition('calendar')!;
  expect(definition.scopeKey).toBe('calendars');
  expect(definition.scopes).toEqual(['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly']);
  for (const id of ['ati@group.calendar.google.com', 'person@gmail.com', 'en.usa#holiday@group.v.calendar.google.com', 'opaque_calendar_id']) expect(definition.scopePattern!.test(id)).toBe(true);
  for (const id of ['primary', '', 'bad/id', 'a b', 'x'.repeat(600)]) expect(definition.scopePattern!.test(id)).toBe(false);
});
