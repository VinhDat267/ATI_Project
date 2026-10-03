import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, type PlannerResponse } from '@wap/tool-schemas';
import { aggregateRuns, scoreCase, type CaseRun, type GoldenCase } from './scorer.js';

const read: GoldenCase = { id: 'read', category: 'read_only', language: 'en', prompt: 'Read cells', services: ['sheets'],
  expect: { kind: 'clarification', searches: [{ tool: 'sheets.read_range', args: { spreadsheetId: { equals: 'spreadsheet_frontend_2026' }, range: { equals: 'Tasks!A1:B2' } } }] } };
const answer: PlannerResponse = { kind: 'clarification', question: 'Which write action follows this read?', context: '' };
const searched = [{ tool: 'sheets.read_range', args: { spreadsheetId: 'spreadsheet_frontend_2026', range: 'Tasks!A1:B2' }, result: { range: 'Tasks!A1:B2', values: [['Task', 'Status']] } }];
const linked: GoldenCase = { id: 'linked', category: 'cross_service', language: 'en', prompt: 'Issue to sheet', services: ['jira', 'sheets'],
  expect: { kind: 'plan', steps: [
    { tool: 'jira.create_issue', args: { projectKey: { equals: 'FE' }, summary: { includesAll: ['Audit'] } } },
    { tool: 'sheets.append_rows', args: { rows: { minItems: 1, includesAll: ['Audit'], refTo: 'jira.create_issue' } } },
  ] } };
const response: PlannerResponse = { kind: 'plan', thinking: '', summary: 'x', warnings: [], steps: [
  { id: 'issue', tool: 'jira.create_issue', description: 'Create issue', args: { projectKey: 'FE', summary: 'Audit' }, dependsOn: [] },
  { id: 'rows', tool: 'sheets.append_rows', description: 'Append row', args: { spreadsheetId: 'spreadsheet_frontend_2026', sheet: 'Tasks', rows: [['Audit', { $template: '${issue.output.url}' }]] }, dependsOn: ['issue'] },
] };

describe('service scoring evidence', () => {
  it('requires the actual successful read tool rather than a clarification alone or a directory prefetch', () => {
    expect(scoreCase(read, answer, ALL_TOOLS, searched)).toMatchObject({ passed: true, toolsOk: true, argsOk: true });
    expect(scoreCase(read, answer, ALL_TOOLS, [])).toMatchObject({ passed: false, toolsOk: false });
    expect(scoreCase(read, answer, ALL_TOOLS, [{ ...searched[0]!, error: 'read failed', result: undefined }])).toMatchObject({ passed: false, toolsOk: false });
    expect(scoreCase(read, answer, ALL_TOOLS, [{ tool: 'sheets.list_spreadsheets', args: { query: '' }, result: [] }])).toMatchObject({ passed: false, toolsOk: false });
  });
  it('detects read parameter mistakes', () => {
    expect(scoreCase(read, answer, ALL_TOOLS, [{ ...searched[0]!, args: { ...searched[0]!.args, range: 'Tasks!A1:A2' } }]))
      .toMatchObject({ passed: false, toolsOk: true, argsOk: false });
  });
  it('checks nested row text and genuine cross-step references, rejecting a literal invented future URL', () => {
    expect(scoreCase(linked, response, ALL_TOOLS).passed).toBe(true);
    const literal = structuredClone(response);
    literal.steps[1]!.args.rows = [['Audit', 'https://fixture.atlassian.net/browse/FE-99']];
    expect(scoreCase(linked, literal, ALL_TOOLS).passed).toBe(false);
  });
  it('matches equivalent explicit-offset timestamps but rejects incorrect dates and missing time zones', () => {
    const c: GoldenCase = { id: 'date', category: 'single_step', language: 'en', prompt: 'Tomorrow', expect: { kind: 'plan', steps: [
      { tool: 'calendar.create_event', args: { start: { instantEquals: '2026-09-30T15:00:00+07:00' } } },
    ] } };
    for (const [start, expected] of [['2026-09-30T08:00:00Z', true], ['2026-10-01T08:00:00Z', false], ['2026-09-30T15:00:00', false]] as const) {
      const p: PlannerResponse = { kind: 'plan', thinking: '', summary: 'x', warnings: [], steps: [{ id: 'e', tool: 'calendar.create_event', description: 'Create', args: { start }, dependsOn: [] }] };
      expect(scoreCase(c, p, ALL_TOOLS).passed, start).toBe(expected);
    }
  });
  it('reports actual service-specific denominators including reads and attributes cross-service arguments separately', () => {
    const incorrect = structuredClone(response);
    incorrect.steps[0]!.args.summary = 'wrong';
    const rows: CaseRun[] = [
      { case: read, response: answer, searches: searched, latencyMs: 10, llmCalls: 1, score: scoreCase(read, answer, ALL_TOOLS, searched) },
      { case: linked, response: incorrect, latencyMs: 20, llmCalls: 1, score: scoreCase(linked, incorrect, ALL_TOOLS) },
    ];
    const result = aggregateRuns([rows], ALL_TOOLS);
    expect(result.byService.sheets).toMatchObject({ cases: 2, scoredAttempts: 2, mean: { toolSelectionAccuracy: 1, argumentQuality: 1 } });
    expect(result.byService.jira).toMatchObject({ cases: 1, scoredAttempts: 1, mean: { toolSelectionAccuracy: 1, argumentQuality: 0 } });
    expect(result.mean.toolSelectionAccuracy).toBe(1);
    expect(result.mean.argumentQuality).toBe(0.5);
  });
});
