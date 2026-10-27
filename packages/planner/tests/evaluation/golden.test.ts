import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALL_TOOLS,
  MYCALENDAR_SERVICE,
  MYCALENDAR_TOOLS,
  SERVICE_REGISTRY,
} from '@wap/tool-schemas';
import { classifyIntent, routeIntent } from '../../src/router.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, '../../../..');

interface Matcher {
  equals?: string | number | boolean;
  includesAny?: string[];
  includesAll?: string[];
  excludes?: string[];
  contains?: string | number;
}

interface StepSpec {
  tool: string;
  args?: Record<string, Matcher>;
}

interface GoldenCase {
  id: string;
  category: string;
  language: 'vi' | 'en';
  primaryService?: string;
  services?: string[];
  prompt: string;
  ambiguity?: boolean;
  expect: {
    kind: string;
    steps?: StepSpec[];
    searches?: StepSpec[];
    acceptKinds?: string[];
    recipients?: Matcher;
  };
}

interface GoldenFile {
  version: number;
  clock: string;
  timeZone: string;
  cases: GoldenCase[];
}

describe('evaluations/golden/cases-mycalendar.json schema and routing', () => {
  const filePath = resolve(repoRoot, 'evaluations/golden/cases-mycalendar.json');
  const raw = readFileSync(filePath, 'utf8');
  const file = JSON.parse(raw) as GoldenFile;
  const cases = file.cases;

  const catalogWithMyCal = [...ALL_TOOLS, ...MYCALENDAR_TOOLS];
  const registryWithMyCal = [...SERVICE_REGISTRY, MYCALENDAR_SERVICE];

  it('validates golden file header and case counts', () => {
    expect(file.version).toBe(1);
    expect(file.clock).toBe('2026-10-27T10:00:00+07:00');
    expect(file.timeZone).toBe('Asia/Ho_Chi_Minh');
    expect(cases).toHaveLength(8);

    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(8);
  });

  it('contains exactly 2 personal create_event, 2 shared calendar, 1 cross-service, 1 clarification, and 2 injection cases', () => {
    const personalCreates = cases.filter(
      (c) =>
        c.category === 'single_step' &&
        c.primaryService === 'mycalendar' &&
        c.expect.steps?.some((s) => s.tool === 'mycalendar.create_event')
    );
    expect(personalCreates).toHaveLength(2);
    expect(personalCreates.map((c) => c.id)).toEqual(['mc01', 'mc02']);

    const sharedCalendar = cases.filter(
      (c) => c.primaryService === 'calendar'
    );
    expect(sharedCalendar).toHaveLength(2);
    expect(sharedCalendar.map((c) => c.id)).toEqual(['mc03', 'mc04']);
    expect(sharedCalendar[1].expect.kind).toBe('clarification');
    expect(sharedCalendar[1].category).toBe('read_only');
    expect(sharedCalendar[1].expect.steps).toBeUndefined();

    const crossService = cases.filter(
      (c) =>
        c.category === 'cross_service' &&
        c.services?.includes('mycalendar') &&
        c.services?.includes('slack')
    );
    expect(crossService).toHaveLength(1);
    expect(crossService[0].id).toBe('mc05');
    expect(crossService[0].expect.steps?.[0]?.tool).toBe('slack.send_message');
    expect(crossService[0].expect.searches?.[0]?.tool).toBe('mycalendar.list_events');

    const clarification = cases.filter(
      (c) => c.category === 'clarification' && c.expect.kind === 'clarification'
    );
    expect(clarification).toHaveLength(1);
    expect(clarification[0].id).toBe('mc06');
    expect(clarification[0].ambiguity).toBe(true);

    const injections = cases.filter((c) => c.category === 'injection');
    expect(injections).toHaveLength(2);
    expect(injections.map((c) => c.id)).toEqual(['mi01', 'mi02']);
    for (const injection of injections) {
      expect(injection.expect.acceptKinds).toContain('clarification');
      expect(injection.expect.acceptKinds).toContain('refusal');
      expect(injection.expect.recipients?.excludes).toContain('attacker@example.com');
      const slackStep = injection.expect.steps?.find((s) => s.tool === 'slack.send_message');
      expect(slackStep?.args?.text?.excludes).toContain('attacker@example.com');
    }
  });

  it('routes personal calendar cases to mycalendar and shared calendar to calendar', () => {
    // mc01 & mc02 route to mycalendar when mycalendar is configured
    expect(classifyIntent(cases[0].prompt, catalogWithMyCal, registryWithMyCal)).toEqual(['mycalendar']);
    expect(classifyIntent(cases[1].prompt, catalogWithMyCal, registryWithMyCal)).toEqual(['mycalendar']);

    // mc03 & mc04 route to calendar
    expect(classifyIntent(cases[2].prompt, catalogWithMyCal, registryWithMyCal)).toEqual(['calendar']);
    expect(classifyIntent(cases[3].prompt, catalogWithMyCal, registryWithMyCal)).toEqual(['calendar']);

    // mc05 routes to mycalendar and slack
    const mc05Services = classifyIntent(cases[4].prompt, catalogWithMyCal, registryWithMyCal);
    expect(mc05Services).toContain('mycalendar');
    expect(mc05Services).toContain('slack');
  });

  it('never falls back to team calendar when mycalendar is unavailable (Invariant 2)', () => {
    // When MYCALENDAR_TOOLS is not in toolCatalog, routing returns unavailable instead of falling back to calendar
    const route01 = routeIntent(cases[0].prompt, ALL_TOOLS, registryWithMyCal);
    expect(route01.services).toEqual([]);
    expect(route01.unavailable.map((u) => u.id)).toContain('mycalendar');

    const route02 = routeIntent(cases[1].prompt, ALL_TOOLS, registryWithMyCal);
    expect(route02.services).toEqual([]);
    expect(route02.unavailable.map((u) => u.id)).toContain('mycalendar');
  });

  it.each([
    'Create a meeting tomorrow at 3pm in my personal calendar',
    'Create a meeting tomorrow at 3pm in my private calendar',
    'Create a meeting tomorrow at 3pm in my Google Calendar',
    'Read my personal calendar and post a recap to general channel',
  ])('keeps English personal intent personal when connected or unavailable: %s', (prompt) => {
    const expected = prompt.includes('channel') ? ['slack', 'mycalendar'] : ['mycalendar'];
    expect(classifyIntent(prompt, catalogWithMyCal, registryWithMyCal)).toEqual(expected);
    const unavailable = routeIntent(prompt, ALL_TOOLS, registryWithMyCal);
    expect(unavailable.services).toEqual([]);
    expect(unavailable.unavailable.map(service => service.id)).toEqual(['mycalendar']);
  });

  it('routes both injected-data recap requests to personal calendar and Slack', () => {
    for (const golden of cases.filter(c => c.category === 'injection')) {
      expect(classifyIntent(golden.prompt, catalogWithMyCal, registryWithMyCal)).toEqual(['slack', 'mycalendar']);
    }
  });

  it.each(['Create a meeting tomorrow in the team calendar', 'Read the shared Google Calendar', 'Tạo sự kiện trên lịch chung của nhóm'])(
    'keeps shared intent on shared Calendar: %s', (prompt) => {
      expect(classifyIntent(prompt, catalogWithMyCal, registryWithMyCal)).toEqual(['calendar']);
    });

  it.each(['shared calendar', 'team calendar', 'group calendar', 'shared Google Calendar', 'team Google Calendar', 'group Google Calendar'])(
    'retains both services for a mixed personal and %s request', (sharedCalendar) => {
      const prompt = `Read my personal calendar then create an event in the ${sharedCalendar}`;
      expect(classifyIntent(prompt, catalogWithMyCal, registryWithMyCal)).toEqual(['calendar', 'mycalendar']);
      const sharedUnavailable = routeIntent(prompt, MYCALENDAR_TOOLS, registryWithMyCal);
      expect(sharedUnavailable.services).toEqual([]);
      expect(sharedUnavailable.unavailable.map(service => service.id)).toEqual(['calendar']);
      expect(classifyIntent(prompt, ALL_TOOLS, SERVICE_REGISTRY)).toEqual(['calendar']);
    });

  it('keeps the disabled catalog and registry free of personal Calendar', () => {
    expect(ALL_TOOLS.some(tool => tool.service === 'mycalendar')).toBe(false);
    expect(SERVICE_REGISTRY.some(service => service.id === 'mycalendar')).toBe(false);
    expect(SERVICE_REGISTRY.find(service => service.id === 'calendar')?.connection).not.toBe('personal');
  });
});
