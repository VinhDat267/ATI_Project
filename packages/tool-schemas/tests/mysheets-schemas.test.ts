import { describe, expect, it } from 'vitest';
import { ALL_TOOLS, SERVICE_REGISTRY, MYSHEETS_TOOLS, MYSHEETS_SERVICE, MYSHEETS_SCOPE } from '../src/index.js';
import { isWriteTool } from '../../executor/src/runner.js';
import { validatePlan } from '../../planner/src/validator.js';

describe('MYSHEETS_TOOLS and MYSHEETS_SERVICE', () => {
  it('keeps ALL_TOOLS at 33 and SERVICE_REGISTRY at 8 while exporting MYSHEETS_* separately', () => {
    expect(ALL_TOOLS).toHaveLength(33);
    expect(SERVICE_REGISTRY).toHaveLength(8);
    expect(MYSHEETS_SCOPE).toBe('https://www.googleapis.com/auth/drive.file');
    expect(MYSHEETS_SERVICE.id).toBe('mysheets');
    expect(MYSHEETS_SERVICE.connection).toBe('personal');
    expect(MYSHEETS_SERVICE.scopeKey).toBe('spreadsheets');
    expect(MYSHEETS_TOOLS.map((t) => t.name)).toEqual([
      'mysheets.list_spreadsheets',
      'mysheets.list_sheets',
      'mysheets.read_range',
      'mysheets.append_rows',
    ]);
  });

  it('marks mysheets.append_rows as a write tool in executor and separates x-resource myspreadsheet/mysheet from shared sheets', () => {
    expect(isWriteTool('mysheets.append_rows')).toBe(true);
    expect(isWriteTool('mysheets.read_range')).toBe(false);
    expect(isWriteTool('mysheets.list_sheets')).toBe(false);
    expect(isWriteTool('mysheets.list_spreadsheets')).toBe(false);

    const planJson = JSON.stringify({
      kind: 'plan',
      thinking: 'Thêm dòng vào bảng tính cá nhân',
      summary: 'Thêm công việc',
      steps: [{
        id: 's1',
        tool: 'mysheets.append_rows',
        description: 'Thêm dòng vào sheet',
        dependsOn: [],
        args: {
          spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
          sheet: 'Sheet1',
          rows: [['Task 1', 'Done']],
        },
      }],
    });

    // Unshared: shared memory.spreadsheet and memory.sheet must NOT ground mysheets.append_rows
    const ungrounded = validatePlan(planJson, [...ALL_TOOLS, ...MYSHEETS_TOOLS], {
      grounding: {
        memory: {
          spreadsheet: [{ id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', title: 'Shared' }],
          sheet: [{ id: 0, title: 'Sheet1', spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms' }],
        },
        userTexts: [],
      },
    });
    expect(ungrounded.valid).toBe(false);
    if (!ungrounded.valid) expect(ungrounded.layer).toBe('grounding');

    // Grounded: memory.myspreadsheet and memory.mysheet ground mysheets.append_rows
    const grounded = validatePlan(planJson, [...ALL_TOOLS, ...MYSHEETS_TOOLS], {
      grounding: {
        memory: {
          myspreadsheet: [{ id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', title: 'My Sheet' }],
          mysheet: [{ id: 0, title: 'Sheet1', spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms' }],
        },
        userTexts: [],
      },
    });
    expect(grounded.valid).toBe(true);
  });
});
