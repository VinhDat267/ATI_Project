import { describe, expect, it } from 'vitest';
import {
  ALL_TOOLS,
  SERVICE_REGISTRY,
  MYSHEETS_TOOLS,
  MYSHEETS_SERVICE,
  MYSHEETS_SCOPE,
  SHEETS_EXTENDED_TOOLS,
  getToolDefinition,
} from '../src/index.js';
import { isWriteTool } from '../../executor/src/runner.js';
import { validatePlan } from '../../planner/src/validator.js';

describe('MYSHEETS_TOOLS and MYSHEETS_SERVICE', () => {
  it('keeps ALL_TOOLS at 33 and SERVICE_REGISTRY at 8 while exporting MYSHEETS_* and SHEETS_EXTENDED_TOOLS separately', () => {
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
      'mysheets.search_rows',
      'mysheets.aggregate_rows',
      'mysheets.append_rows',
      'mysheets.update_rows',
      'mysheets.delete_rows',
      'mysheets.create_sheet',
      'mysheets.list_drive_files',
      'mysheets.create_drive_folder',
      'mysheets.create_doc',
      'mysheets.get_doc',
      'mysheets.append_doc_text',
      'mysheets.move_drive_file',
    ]);
    expect(SHEETS_EXTENDED_TOOLS.map((t) => t.name)).toEqual([
      'sheets.search_rows',
      'sheets.aggregate_rows',
      'sheets.update_rows',
      'sheets.delete_rows',
      'sheets.create_sheet',
    ]);
    expect(getToolDefinition('mysheets.aggregate_rows')?.sideEffect).toBe('read');
    expect(getToolDefinition('mysheets.delete_rows')?.sideEffect).toBe('write');
    expect(getToolDefinition('mysheets.list_drive_files')?.sideEffect).toBe('read');
    expect(getToolDefinition('mysheets.get_doc')?.sideEffect).toBe('read');
    expect(getToolDefinition('mysheets.create_drive_folder')?.sideEffect).toBe('write');
    expect(getToolDefinition('mysheets.create_doc')?.sideEffect).toBe('write');
    expect(getToolDefinition('mysheets.append_doc_text')?.sideEffect).toBe('write');
    expect(getToolDefinition('mysheets.move_drive_file')?.sideEffect).toBe('write');
    expect(getToolDefinition('sheets.aggregate_rows')?.sideEffect).toBe('read');
    expect(getToolDefinition('sheets.delete_rows')?.sideEffect).toBe('write');
  });

  it('marks mysheets write tools in executor, separates x-resource myspreadsheet/mysheet from shared sheets, and grounds sheet created in an earlier step', () => {
    expect(isWriteTool('mysheets.append_rows')).toBe(true);
    expect(isWriteTool('mysheets.update_rows')).toBe(true);
    expect(isWriteTool('mysheets.delete_rows')).toBe(true);
    expect(isWriteTool('mysheets.create_sheet')).toBe(true);
    expect(isWriteTool('mysheets.read_range')).toBe(false);
    expect(isWriteTool('mysheets.search_rows')).toBe(false);
    expect(isWriteTool('mysheets.aggregate_rows')).toBe(false);
    expect(isWriteTool('mysheets.list_sheets')).toBe(false);
    expect(isWriteTool('mysheets.list_spreadsheets')).toBe(false);
    expect(isWriteTool('sheets.delete_rows')).toBe(true);
    expect(isWriteTool('sheets.aggregate_rows')).toBe(false);

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

    // Multi-step grounding: mysheets.create_sheet grounds the new tab title for subsequent mysheets.append_rows / mysheets.update_rows
    const createAndAppendPlan = JSON.stringify({
      kind: 'plan',
      thinking: 'Tạo tab mới rồi thêm dòng và cập nhật trạng thái',
      summary: 'Tạo tab Sprint 15 và ghi dữ liệu',
      steps: [
        {
          id: 's1',
          tool: 'mysheets.create_sheet',
          description: 'Tạo tab Sprint 15',
          dependsOn: [],
          args: {
            spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
            title: 'Sprint 15',
            headers: ['Mã thẻ', 'Tiêu đề', 'Trạng thái'],
          },
        },
        {
          id: 's2',
          tool: 'mysheets.append_rows',
          description: 'Ghi dòng vào Sprint 15',
          dependsOn: ['s1'],
          args: {
            spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
            sheet: 'Sprint 15',
            rows: [['CARD-1', 'Thiết kế UI', 'Đang làm']],
          },
        },
        {
          id: 's3',
          tool: 'mysheets.update_rows',
          description: 'Cập nhật trạng thái dòng CARD-1',
          dependsOn: ['s2'],
          args: {
            spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
            sheet: 'Sprint 15',
            updates: [
              {
                matchColumn: 'Mã thẻ',
                matchValue: 'CARD-1',
                values: { 'Trạng thái': 'Hoàn thành' },
              },
            ],
          },
        },
      ],
    });
    const multiStepGrounded = validatePlan(createAndAppendPlan, [...ALL_TOOLS, ...MYSHEETS_TOOLS], {
      grounding: {
        memory: {
          myspreadsheet: [{ id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', title: 'My Sheet' }],
          mysheet: [{ id: 0, title: 'Sheet1', spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms' }],
        },
        userTexts: [],
      },
    });
    expect(multiStepGrounded.valid).toBe(true);
  });

  it('validates header-aware records append, numeric/date search filters, aggregate_rows and delete_rows in plans', () => {
    const businessPlan = JSON.stringify({
      kind: 'plan',
      thinking: 'Ghi bản ghi theo tên cột, thống kê doanh thu và xoá dòng huỷ',
      summary: 'Cập nhật và thống kê CRM',
      steps: [
        {
          id: 's1',
          tool: 'mysheets.append_rows',
          description: 'Thêm khách hàng theo tên cột',
          dependsOn: [],
          args: {
            spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
            sheet: 'Sheet1',
            records: [
              { 'Tên khách': 'Công ty ABC', Email: 'abc@example.com', 'Doanh thu': '50000000', 'Trạng thái': 'Mới' },
            ],
            keyColumn: 'Email',
            onDuplicate: 'update',
          },
        },
        {
          id: 's2',
          tool: 'mysheets.delete_rows',
          description: 'Xoá các dòng đơn huỷ',
          dependsOn: ['s1'],
          args: {
            spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
            sheet: 'Sheet1',
            matchColumn: 'Trạng thái',
            matchValue: 'Đã huỷ',
          },
        },
      ],
    });
    const res = validatePlan(businessPlan, [...ALL_TOOLS, ...MYSHEETS_TOOLS], {
      grounding: {
        memory: {
          myspreadsheet: [{ id: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', title: 'CRM' }],
          mysheet: [{ id: 0, title: 'Sheet1', spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms' }],
        },
        userTexts: [],
      },
    });
    expect(res.valid).toBe(true);
  });

  it('validates Google Drive folder creation and Google Docs creation/appending chained via $ref', () => {
    expect(isWriteTool('mysheets.create_drive_folder')).toBe(true);
    expect(isWriteTool('mysheets.create_doc')).toBe(true);
    expect(isWriteTool('mysheets.append_doc_text')).toBe(true);
    expect(isWriteTool('mysheets.move_drive_file')).toBe(true);
    expect(isWriteTool('mysheets.list_drive_files')).toBe(false);
    expect(isWriteTool('mysheets.get_doc')).toBe(false);

    const driveDocsPlan = JSON.stringify({
      kind: 'plan',
      thinking: 'Tạo thư mục Google Drive rồi tạo tài liệu Google Docs lưu vào thư mục đó',
      summary: 'Khởi tạo thư mục Drive và tài liệu biên bản họp Google Docs',
      steps: [
        {
          id: 's1',
          tool: 'mysheets.create_drive_folder',
          description: 'Tạo thư mục Dự án Q4 trên Drive',
          dependsOn: [],
          args: {
            name: 'Dự án Q4 - Biên bản họp',
          },
        },
        {
          id: 's2',
          tool: 'mysheets.create_doc',
          description: 'Tạo tài liệu biên bản họp Google Docs',
          dependsOn: ['s1'],
          args: {
            title: 'Biên bản họp Sprint 15',
            content: '1. Tiến độ dự án\n2. Các đầu việc tiếp theo',
            folderId: { $ref: 's1.output.id' },
          },
        },
        {
          id: 's3',
          tool: 'mysheets.append_doc_text',
          description: 'Nối thêm ghi chú vào tài liệu Docs',
          dependsOn: ['s2'],
          args: {
            documentId: { $ref: 's2.output.id' },
            text: 'Ghi chú bổ sung sau cuộc họp.',
          },
        },
      ],
    });

    const validated = validatePlan(driveDocsPlan, [...ALL_TOOLS, ...MYSHEETS_TOOLS], {
      grounding: { memory: {}, userTexts: [] },
    });
    expect(validated.valid).toBe(true);
  });
});
