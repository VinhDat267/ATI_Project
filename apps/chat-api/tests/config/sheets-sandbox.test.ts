import { expect, it } from 'vitest';
import { createSandboxAdapter } from '../../src/sandbox/index.js';
import { createSandboxProvider } from '../../src/sandbox/scenarios.js';

it('uses a Sheets read/append then Slack plan with a real output dependency in the sandbox', async () => {
  const provider = createSandboxProvider('sheets_slack');
  const plan = JSON.parse(await provider.generatePlan({} as any));
  expect(plan.steps.map((step: any) => step.tool)).toEqual(['sheets.read_range', 'sheets.append_rows', 'slack.send_message']);
  expect(plan.steps[2].args.text).toEqual({ $template: 'Đã thêm dòng vào Google Sheets: ${step_2.output.updatedRange}' });
  const adapter = createSandboxAdapter('sheets', 'sheets_slack');
  expect(await adapter.execute('sheets.list_spreadsheets', { query: '', limit: 10 })).toEqual([{ id: 'spreadsheet_fixture_123456', title: 'ATI Test Tracker', url: 'https://docs.google.com/spreadsheets/d/spreadsheet_fixture_123456/edit' }]);
  expect(await adapter.execute('sheets.append_rows', { spreadsheetId: 'spreadsheet_fixture_123456', sheet: 'Tasks', rows: [['Task']] })).toMatchObject({ updatedRange: 'Tasks!A4:A4', updatedRows: 1 });
});
