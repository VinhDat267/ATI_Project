import { describe, expect, it } from 'vitest';
import {
  ALL_TOOLS,
  GMAIL_SERVICE,
  GMAIL_TOOLS,
  MYCALENDAR_TOOLS,
  MYJIRA_TOOLS,
  MYSHEETS_TOOLS,
  SERVICE_REGISTRY,
  SHEETS_EXTENDED_TOOLS,
  TRELLO_OAUTH_TOOLS,
  type ToolDefinition,
} from '@wap/tool-schemas';
import {
  AIPlanner,
  MockLLMProvider,
  WorkingMemory,
  prepareSearchCall,
  validatePlan,
  type GroundingContext,
} from '../src/index.js';

const SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const MY_SPREADSHEET_ID = '1PersonalSheetId0XRA5nFMdKvBdBZjgmUUqptlbs74';
const THREADS_21 = Array.from({ length: 21 }, (_, i) => `t_${i + 1}`);
const LABELS_21 = Array.from({ length: 21 }, (_, i) => `Label_${i + 1}`);
const ATTENDEES_21 = Array.from({ length: 21 }, (_, i) => `member${i + 1}@example.com`);
const RECIPIENTS_24 = Array.from({ length: 24 }, (_, i) => `user${i + 1}@example.com`);

const CUSTOM_BOUNDED_TOOLS: ToolDefinition[] = [
  {
    name: 'custom.bounded_tags',
    service: 'trello',
    sideEffect: 'write',
    riskLevel: 'low',
    description: 'Custom bounded array fixture for minItems 2..4 and minItems 0..3',
    inputSchema: {
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          items: { type: 'string' },
        },
        optionalZeroMin: {
          type: 'array',
          minItems: 0,
          maxItems: 3,
          items: { type: 'string' },
        },
      },
      required: ['tags'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
    },
  },
  {
    name: 'custom.nested_groups',
    service: 'trello',
    sideEffect: 'write',
    riskLevel: 'low',
    description: 'Custom 3-level object-array nesting fixture',
    inputSchema: {
      type: 'object',
      properties: {
        groups: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              tags: {
                type: 'array',
                minItems: 1,
                maxItems: 2,
                items: { type: 'string' },
              },
            },
            required: ['name', 'tags'],
            additionalProperties: false,
          },
        },
      },
      required: ['groups'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
    },
  },
];

const CATALOG: ToolDefinition[] = [
  ...ALL_TOOLS,
  ...TRELLO_OAUTH_TOOLS,
  ...SHEETS_EXTENDED_TOOLS,
  ...GMAIL_TOOLS,
  ...MYCALENDAR_TOOLS,
  ...MYSHEETS_TOOLS,
  ...MYJIRA_TOOLS,
  ...CUSTOM_BOUNDED_TOOLS,
];

function createGroundedContext(extraTexts: string[] = []): GroundingContext {
  return {
    memory: {
      gmail_account: { email: 'owner@example.com' },
      thread: THREADS_21.map((id) => ({ id, participants: ['lan@example.com'] })),
      label: [
        { id: 'STARRED', name: 'STARRED', type: 'system' },
        { id: 'UNREAD', name: 'UNREAD', type: 'system' },
        { id: 'INBOX', name: 'INBOX', type: 'system' },
        ...LABELS_21.map((id) => ({ id, name: id, type: 'user' })),
      ],
      __observed: {
        thread: THREADS_21.map((id) => ({ id, participants: ['lan@example.com'] })),
        recipient: RECIPIENTS_24.map((id) => ({ id, service: 'sheets' })),
      },
      spreadsheet: [{ id: SPREADSHEET_ID, title: 'Ops Tracker' }],
      sheet: [{ id: 0, title: 'Tasks', spreadsheetId: SPREADSHEET_ID }],
      myspreadsheet: [{ id: MY_SPREADSHEET_ID, title: 'Personal Tracker' }],
      mysheet: [{ id: 0, title: 'Tasks', spreadsheetId: MY_SPREADSHEET_ID }],
      mycalendar: [{ id: 'cal_team@group.calendar.google.com', title: 'Team Calendar' }],
      calendar: [{ id: 'cal_org@group.calendar.google.com', title: 'Org Calendar' }],
      board: [{ id: 'board_1', name: 'Sprint Board' }],
      list: [{ id: 'list_1', name: 'To Do', boardId: 'board_1' }],
      card: [{ id: 'card_1', name: 'Card 1', boardId: 'board_1', listId: 'list_1' }],
      member: [
        { id: 'm_1', fullName: 'Minh', boardId: 'board_1' },
        { id: 'm_2', fullName: 'Lan', boardId: 'board_1' },
      ],
      channel: [{ id: 'C_OPS', name: 'ops' }],
      repository: [{ id: 'repo_1', name: 'app', fullName: 'acme/app', url: 'https://github.com/acme/app' }],
      jira_site: [
        {
          id: 'site_acme',
          siteId: 'site_acme',
          cloudId: '11111111-1111-1111-1111-111111111111',
          workspaceId: 'ws_1',
          name: 'Acme Workspace',
          url: 'https://acme.atlassian.net',
        },
      ],
      jira_project: [
        {
          id: 'proj_1',
          key: 'ATIT',
          name: 'ATI Tasks',
          siteId: 'site_acme',
          cloudId: '11111111-1111-1111-1111-111111111111',
          workspaceId: 'ws_1',
        },
      ],
    },
    userTexts: ['Thực hiện thao tác công việc được yêu cầu trên Acme', ...extraTexts],
  };
}

function singleStepPlan(tool: string, args: Record<string, unknown>, id = 'step_1'): string {
  return JSON.stringify({
    kind: 'plan',
    thinking: 'Thực hiện hành động đã xác minh tham số',
    summary: 'Thực hiện hành động',
    warnings: [],
    steps: [
      {
        id,
        tool,
        description: 'Thực hiện bước công việc',
        args,
        dependsOn: [],
      },
    ],
  });
}

describe('G2 C3 (07): generic literal-array minItems/maxItems validation', () => {
  describe('non-recipient literal arrays (minItems: 1, maxItems: 20): below, above, and exact bounds', () => {
    const outOfBoundsCases: Array<{
      label: string;
      tool: string;
      emptyArgs: Record<string, unknown>;
      overMaxArgs: Record<string, unknown>;
      expectedField: string;
    }> = [
      {
        label: 'gmail.modify_thread_labels addLabelIds',
        tool: 'gmail.modify_thread_labels',
        emptyArgs: { threadId: 't_1', addLabelIds: [] },
        overMaxArgs: { threadId: 't_1', addLabelIds: LABELS_21 },
        expectedField: 'args.addLabelIds',
      },
      {
        label: 'gmail.modify_thread_labels removeLabelIds',
        tool: 'gmail.modify_thread_labels',
        emptyArgs: { threadId: 't_1', removeLabelIds: [] },
        overMaxArgs: { threadId: 't_1', removeLabelIds: LABELS_21 },
        expectedField: 'args.removeLabelIds',
      },
      {
        label: 'gmail.batch_modify_threads threadIds',
        tool: 'gmail.batch_modify_threads',
        emptyArgs: { threadIds: [], addLabelIds: ['STARRED'] },
        overMaxArgs: { threadIds: THREADS_21, addLabelIds: ['STARRED'] },
        expectedField: 'args.threadIds',
      },
      {
        label: 'gmail.batch_modify_threads addLabelIds',
        tool: 'gmail.batch_modify_threads',
        emptyArgs: { threadIds: ['t_1'], addLabelIds: [] },
        overMaxArgs: { threadIds: ['t_1'], addLabelIds: LABELS_21 },
        expectedField: 'args.addLabelIds',
      },
      {
        label: 'mycalendar.create_event attendees',
        tool: 'mycalendar.create_event',
        emptyArgs: {
          calendarId: 'cal_team@group.calendar.google.com',
          summary: 'Họp nhóm kỹ thuật',
          start: '2026-11-12T09:00:00+07:00',
          end: '2026-11-12T10:00:00+07:00',
          attendees: [],
        },
        overMaxArgs: {
          calendarId: 'cal_team@group.calendar.google.com',
          summary: 'Họp nhóm kỹ thuật',
          start: '2026-11-12T09:00:00+07:00',
          end: '2026-11-12T10:00:00+07:00',
          attendees: ATTENDEES_21,
        },
        expectedField: 'args.attendees',
      },
      {
        label: 'mycalendar.schedule_meet attendees',
        tool: 'mycalendar.schedule_meet',
        emptyArgs: {
          calendarId: 'cal_team@group.calendar.google.com',
          summary: 'Họp đồng bộ tuần',
          start: '2026-11-12T14:00:00+07:00',
          end: '2026-11-12T15:00:00+07:00',
          attendees: [],
        },
        overMaxArgs: {
          calendarId: 'cal_team@group.calendar.google.com',
          summary: 'Họp đồng bộ tuần',
          start: '2026-11-12T14:00:00+07:00',
          end: '2026-11-12T15:00:00+07:00',
          attendees: ATTENDEES_21,
        },
        expectedField: 'args.attendees',
      },
      {
        label: 'sheets.append_rows records',
        tool: 'sheets.append_rows',
        emptyArgs: {
          spreadsheetId: SPREADSHEET_ID,
          sheet: 'Tasks',
          records: [],
        },
        overMaxArgs: {
          spreadsheetId: SPREADSHEET_ID,
          sheet: 'Tasks',
          records: Array.from({ length: 21 }, (_, i) => ({ Task: `Item ${i + 1}` })),
        },
        expectedField: 'args.records',
      },
      {
        label: 'sheets.append_rows deduplicateColumns',
        tool: 'sheets.append_rows',
        emptyArgs: {
          spreadsheetId: SPREADSHEET_ID,
          sheet: 'Tasks',
          rows: [['Item 1']],
          deduplicate: true,
          deduplicateColumns: [],
        },
        overMaxArgs: {
          spreadsheetId: SPREADSHEET_ID,
          sheet: 'Tasks',
          rows: [['Item 1']],
          deduplicate: true,
          deduplicateColumns: Array.from({ length: 21 }, (_, i) => i % 20),
        },
        expectedField: 'args.deduplicateColumns',
      },
      {
        label: 'mysheets.append_rows records',
        tool: 'mysheets.append_rows',
        emptyArgs: {
          spreadsheetId: MY_SPREADSHEET_ID,
          sheet: 'Tasks',
          records: [],
        },
        overMaxArgs: {
          spreadsheetId: MY_SPREADSHEET_ID,
          sheet: 'Tasks',
          records: Array.from({ length: 21 }, (_, i) => ({ Task: `Item ${i + 1}` })),
        },
        expectedField: 'args.records',
      },
      {
        label: 'sheets.delete_rows rowNumbers',
        tool: 'sheets.delete_rows',
        emptyArgs: {
          spreadsheetId: SPREADSHEET_ID,
          sheet: 'Tasks',
          rowNumbers: [],
        },
        overMaxArgs: {
          spreadsheetId: SPREADSHEET_ID,
          sheet: 'Tasks',
          rowNumbers: Array.from({ length: 21 }, (_, i) => i + 2),
        },
        expectedField: 'args.rowNumbers',
      },
      {
        label: 'sheets.create_sheet headers',
        tool: 'sheets.create_sheet',
        emptyArgs: {
          spreadsheetId: SPREADSHEET_ID,
          title: 'Archive',
          headers: [],
        },
        overMaxArgs: {
          spreadsheetId: SPREADSHEET_ID,
          title: 'Archive',
          headers: Array.from({ length: 21 }, (_, i) => `Col_${i + 1}`),
        },
        expectedField: 'args.headers',
      },
      {
        label: 'mysheets.create_sheet headers',
        tool: 'mysheets.create_sheet',
        emptyArgs: {
          spreadsheetId: MY_SPREADSHEET_ID,
          title: 'Archive',
          headers: [],
        },
        overMaxArgs: {
          spreadsheetId: MY_SPREADSHEET_ID,
          title: 'Archive',
          headers: Array.from({ length: 21 }, (_, i) => `Col_${i + 1}`),
        },
        expectedField: 'args.headers',
      },
    ];

    it.each(outOfBoundsCases)('rejects empty array (length 0 < minItems 1) for $label at schema layer', ({ tool, emptyArgs, expectedField }) => {
      const grounding = createGroundedContext();
      const result = validatePlan(singleStepPlan(tool, emptyArgs), CATALOG, { grounding });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.layer).toBe('schema');
        expect(result.error).toContain(expectedField);
        expect(result.error).toContain(tool);
      }
    });

    it.each(outOfBoundsCases)('rejects oversized array (length 21 > maxItems 20) for $label at schema layer', ({ tool, overMaxArgs, expectedField }) => {
      const grounding = createGroundedContext();
      const result = validatePlan(singleStepPlan(tool, overMaxArgs), CATALOG, { grounding });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.layer).toBe('schema');
        expect(result.error).toContain(expectedField);
        expect(result.error).toContain(tool);
      }
    });

    it.each([1, 20])('accepts exact valid boundary length %i for grounded Gmail, MyCalendar, and Sheets tools', (count) => {
      const grounding = createGroundedContext();

      expect(
        validatePlan(
          singleStepPlan('gmail.batch_modify_threads', {
            threadIds: THREADS_21.slice(0, count),
            addLabelIds: LABELS_21.slice(0, count),
          }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({ valid: true });

      expect(
        validatePlan(
          singleStepPlan('gmail.modify_thread_labels', {
            threadId: 't_1',
            addLabelIds: LABELS_21.slice(0, count),
            removeLabelIds: LABELS_21.slice(0, count),
          }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({ valid: true });

      expect(
        validatePlan(
          singleStepPlan('mycalendar.schedule_meet', {
            calendarId: 'cal_team@group.calendar.google.com',
            summary: 'Họp nhóm',
            start: '2026-11-12T09:00:00+07:00',
            end: '2026-11-12T10:00:00+07:00',
            attendees: ATTENDEES_21.slice(0, count),
          }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({ valid: true });

      expect(
        validatePlan(
          singleStepPlan('sheets.append_rows', {
            spreadsheetId: SPREADSHEET_ID,
            sheet: 'Tasks',
            records: Array.from({ length: count }, (_, i) => ({ Task: `Row ${i + 1}` })),
            deduplicate: true,
            deduplicateColumns: Array.from({ length: count }, (_, i) => i),
          }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({ valid: true });

      expect(
        validatePlan(
          singleStepPlan('sheets.delete_rows', {
            spreadsheetId: SPREADSHEET_ID,
            sheet: 'Tasks',
            rowNumbers: Array.from({ length: count }, (_, i) => i + 2),
          }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({ valid: true });

      expect(
        validatePlan(
          singleStepPlan('sheets.create_sheet', {
            spreadsheetId: SPREADSHEET_ID,
            title: 'SummaryTab',
            headers: Array.from({ length: count }, (_, i) => `H_${i + 1}`),
          }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({ valid: true });
    });
  });

  describe('custom bounds (maxItems: 10, minItems: 2..4), minItems: 0, upper-only maxItems, unconstrained, and optional/missing arrays', () => {
    it('enforces 1..10 bounds on sheets.aggregate_rows filters and metrics in mixed read-write plans', () => {
      const grounding = createGroundedContext();
      const makeAggregatePlan = (aggArgs: Record<string, unknown>) =>
        JSON.stringify({
          kind: 'plan',
          thinking: 'Đọc số liệu rồi gửi tin nhắn kênh ops',
          summary: 'Gửi kết quả lên kênh ops',
          warnings: [],
          steps: [
            {
              id: 'agg',
              tool: 'sheets.aggregate_rows',
              description: 'Tính số liệu dòng',
              args: { spreadsheetId: SPREADSHEET_ID, sheet: 'Tasks', ...aggArgs },
              dependsOn: [],
            },
            {
              id: 'notify',
              tool: 'slack.send_message',
              description: 'Gửi tin nhắn',
              args: { channel: 'C_OPS', text: { $template: 'Số dòng khớp: ${agg.output.matchedRows}' } },
              dependsOn: ['agg'],
            },
          ],
        });

      const emptyFilters = validatePlan(makeAggregatePlan({ filters: [] }), CATALOG, { grounding });
      expect(emptyFilters).toMatchObject({ valid: false, layer: 'schema' });
      if (!emptyFilters.valid) expect(emptyFilters.error).toContain('args.filters');

      const elevenFilters = validatePlan(
        makeAggregatePlan({
          filters: Array.from({ length: 11 }, (_, i) => ({ column: `Col${i + 1}`, operator: 'equals', value: 'done' })),
        }),
        CATALOG,
        { grounding },
      );
      expect(elevenFilters).toMatchObject({ valid: false, layer: 'schema' });
      if (!elevenFilters.valid) expect(elevenFilters.error).toContain('args.filters');

      const emptyMetrics = validatePlan(makeAggregatePlan({ metrics: [] }), CATALOG, { grounding });
      expect(emptyMetrics).toMatchObject({ valid: false, layer: 'schema' });
      if (!emptyMetrics.valid) expect(emptyMetrics.error).toContain('args.metrics');

      const elevenMetrics = validatePlan(
        makeAggregatePlan({
          metrics: Array.from({ length: 11 }, (_, i) => ({ column: `Amount${i + 1}`, fn: 'sum' })),
        }),
        CATALOG,
        { grounding },
      );
      expect(elevenMetrics).toMatchObject({ valid: false, layer: 'schema' });
      if (!elevenMetrics.valid) expect(elevenMetrics.error).toContain('args.metrics');

      for (const validLen of [1, 10]) {
        expect(
          validatePlan(
            makeAggregatePlan({
              filters: Array.from({ length: validLen }, (_, i) => ({ column: `Col${i + 1}`, operator: 'equals', value: 'done' })),
              metrics: Array.from({ length: validLen }, (_, i) => ({ column: `Amount${i + 1}`, fn: 'sum' })),
            }),
            CATALOG,
            { grounding },
          ),
        ).toMatchObject({ valid: true });
      }
    });

    it('enforces arbitrary minItems > 1 (2..4) and allows empty literal array when minItems is 0 (0..3)', () => {
      for (const badLen of [0, 1, 5]) {
        const res = validatePlan(
          singleStepPlan('custom.bounded_tags', {
            tags: Array.from({ length: badLen }, (_, i) => `tag_${i}`),
          }),
          CATALOG,
        );
        expect(res).toMatchObject({ valid: false, layer: 'schema' });
        if (!res.valid) expect(res.error).toContain('args.tags');
      }

      for (const okLen of [2, 3, 4]) {
        expect(
          validatePlan(
            singleStepPlan('custom.bounded_tags', {
              tags: Array.from({ length: okLen }, (_, i) => `tag_${i}`),
              optionalZeroMin: [],
            }),
            CATALOG,
          ),
        ).toMatchObject({ valid: true });
      }

      expect(
        validatePlan(
          singleStepPlan('custom.bounded_tags', {
            tags: ['a', 'b'],
            optionalZeroMin: ['x', 'y', 'z'],
          }),
          CATALOG,
        ),
      ).toMatchObject({ valid: true });

      const overZeroMinMax = validatePlan(
        singleStepPlan('custom.bounded_tags', {
          tags: ['a', 'b'],
          optionalZeroMin: ['w', 'x', 'y', 'z'],
        }),
        CATALOG,
      );
      expect(overZeroMinMax).toMatchObject({ valid: false, layer: 'schema' });
      if (!overZeroMinMax.valid) expect(overZeroMinMax.error).toContain('args.optionalZeroMin');
    });

    it('enforces upper-only maxItems (myjira.create_issue labels maxItems: 20 without minItems) while allowing []', () => {
      const grounding = createGroundedContext();

      for (const okCount of [0, 1, 20]) {
        expect(
          validatePlan(
            singleStepPlan('myjira.create_issue', {
              siteId: 'site_acme',
              projectKey: 'ATIT',
              summary: 'Tạo đầu việc kiểm thử mới',
              labels: Array.from({ length: okCount }, (_, i) => `lbl_${i + 1}`),
            }),
            CATALOG,
            { grounding },
          ),
        ).toMatchObject({ valid: true });
      }

      const tooManyLabels = validatePlan(
        singleStepPlan('myjira.create_issue', {
          siteId: 'site_acme',
          projectKey: 'ATIT',
          summary: 'Tạo đầu việc kiểm thử mới',
          labels: Array.from({ length: 21 }, (_, i) => `lbl_${i + 1}`),
        }),
        CATALOG,
        { grounding },
      );
      expect(tooManyLabels).toMatchObject({ valid: false, layer: 'schema' });
      if (!tooManyLabels.valid) expect(tooManyLabels.error).toContain('args.labels');
    });

    it('preserves unconstrained arrays on Trello and GitHub tools (including empty and >20 items)', () => {
      const grounding = createGroundedContext();

      expect(
        validatePlan(
          singleStepPlan('trello.create_card', {
            listId: 'list_1',
            title: 'Chuẩn bị tài liệu',
            idMembers: [],
          }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({ valid: true });

      expect(
        validatePlan(
          singleStepPlan('trello.create_card', {
            listId: 'list_1',
            title: 'Chuẩn bị tài liệu',
            idMembers: ['m_1', 'm_2'],
          }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({ valid: true });

      expect(
        validatePlan(
          singleStepPlan('trello.add_checklist', {
            cardId: 'card_1',
            title: 'Checklist triển khai',
            items: [],
          }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({ valid: true });

      expect(
        validatePlan(
          singleStepPlan('trello.add_checklist', {
            cardId: 'card_1',
            title: 'Checklist triển khai',
            items: Array.from({ length: 25 }, (_, i) => `Mục ${i + 1}`),
          }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({ valid: true });

      expect(
        validatePlan(
          singleStepPlan('github.create_issue', {
            repo: 'acme/app',
            title: 'Fix validation edge case',
            labels: [],
            assignees: [],
          }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({ valid: true });
    });

    it('accepts omitted optional arrays and rejects missing or null required arrays', () => {
      const grounding = createGroundedContext();

      expect(
        validatePlan(
          singleStepPlan('mycalendar.create_event', {
            calendarId: 'cal_team@group.calendar.google.com',
            summary: 'Khối giờ tập trung',
            start: '2026-11-12T08:00:00+07:00',
            end: '2026-11-12T09:00:00+07:00',
          }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({ valid: true });

      expect(
        validatePlan(
          singleStepPlan('calendar.create_event', {
            calendarId: 'cal_org@group.calendar.google.com',
            summary: 'Lịch nội bộ',
            start: '2026-11-12T10:00:00+07:00',
            end: '2026-11-12T11:00:00+07:00',
          }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({ valid: true });

      expect(
        validatePlan(
          singleStepPlan('sheets.create_sheet', {
            spreadsheetId: SPREADSHEET_ID,
            title: 'BacklogTab',
          }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({ valid: true });

      const missingThreadIds = validatePlan(
        singleStepPlan('gmail.batch_modify_threads', { addLabelIds: ['STARRED'] }),
        CATALOG,
        { grounding },
      );
      expect(missingThreadIds).toMatchObject({ valid: false, layer: 'schema' });
      if (!missingThreadIds.valid) expect(missingThreadIds.error).toMatch(/missing required argument 'threadIds'/);

      const nullThreadIds = validatePlan(
        singleStepPlan('gmail.batch_modify_threads', { threadIds: null, addLabelIds: ['STARRED'] }),
        CATALOG,
        { grounding },
      );
      expect(nullThreadIds).toMatchObject({ valid: false, layer: 'schema' });
      if (!nullThreadIds.valid) expect(nullThreadIds.error).toMatch(/missing required argument 'threadIds'/);

      const missingUpdates = validatePlan(
        singleStepPlan('sheets.update_rows', { spreadsheetId: SPREADSHEET_ID, sheet: 'Tasks' }),
        CATALOG,
        { grounding },
      );
      expect(missingUpdates).toMatchObject({ valid: false, layer: 'schema' });
      if (!missingUpdates.valid) expect(missingUpdates.error).toMatch(/missing required argument 'updates'/);
    });
  });

  describe('nested arrays and nested object-array constraints', () => {
    it.each([
      { tool: 'sheets.append_rows', spreadsheetId: SPREADSHEET_ID },
      { tool: 'mysheets.append_rows', spreadsheetId: MY_SPREADSHEET_ID },
    ])('enforces outer and inner 1..20 bounds on $tool rows (string[][])', ({ tool, spreadsheetId }) => {
      const grounding = createGroundedContext();

      const outerEmpty = validatePlan(
        singleStepPlan(tool, { spreadsheetId, sheet: 'Tasks', rows: [] }),
        CATALOG,
        { grounding },
      );
      expect(outerEmpty).toMatchObject({ valid: false, layer: 'schema' });
      if (!outerEmpty.valid) expect(outerEmpty.error).toContain('args.rows ');

      const outerOverMax = validatePlan(
        singleStepPlan(tool, {
          spreadsheetId,
          sheet: 'Tasks',
          rows: Array.from({ length: 21 }, (_, i) => [`Row ${i + 1}`]),
        }),
        CATALOG,
        { grounding },
      );
      expect(outerOverMax).toMatchObject({ valid: false, layer: 'schema' });
      if (!outerOverMax.valid) expect(outerOverMax.error).toContain('args.rows ');

      const innerEmpty = validatePlan(
        singleStepPlan(tool, {
          spreadsheetId,
          sheet: 'Tasks',
          rows: [['Valid row'], []],
        }),
        CATALOG,
        { grounding },
      );
      expect(innerEmpty).toMatchObject({ valid: false, layer: 'schema' });
      if (!innerEmpty.valid) expect(innerEmpty.error).toContain('args.rows[1]');

      const innerOverMax = validatePlan(
        singleStepPlan(tool, {
          spreadsheetId,
          sheet: 'Tasks',
          rows: [['Valid row'], Array.from({ length: 21 }, (_, j) => `c_${j + 1}`)],
        }),
        CATALOG,
        { grounding },
      );
      expect(innerOverMax).toMatchObject({ valid: false, layer: 'schema' });
      if (!innerOverMax.valid) expect(innerOverMax.error).toContain('args.rows[1]');

      expect(
        validatePlan(
          singleStepPlan(tool, {
            spreadsheetId,
            sheet: 'Tasks',
            rows: [['Single cell']],
          }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({ valid: true });

      expect(
        validatePlan(
          singleStepPlan(tool, {
            spreadsheetId,
            sheet: 'Tasks',
            rows: Array.from({ length: 20 }, (_, r) => Array.from({ length: 20 }, (__, c) => `r${r}_c${c}`)),
          }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({ valid: true });
    });

    it('enforces array bounds and nested object/integer/map constraints on sheets.update_rows updates', () => {
      const grounding = createGroundedContext();

      const emptyUpdates = validatePlan(
        singleStepPlan('sheets.update_rows', { spreadsheetId: SPREADSHEET_ID, sheet: 'Tasks', updates: [] }),
        CATALOG,
        { grounding },
      );
      expect(emptyUpdates).toMatchObject({ valid: false, layer: 'schema' });
      if (!emptyUpdates.valid) expect(emptyUpdates.error).toContain('args.updates');

      const overMaxUpdates = validatePlan(
        singleStepPlan('sheets.update_rows', {
          spreadsheetId: SPREADSHEET_ID,
          sheet: 'Tasks',
          updates: Array.from({ length: 21 }, (_, i) => ({ rowNumber: i + 2, values: { Status: 'Done' } })),
        }),
        CATALOG,
        { grounding },
      );
      expect(overMaxUpdates).toMatchObject({ valid: false, layer: 'schema' });
      if (!overMaxUpdates.valid) expect(overMaxUpdates.error).toContain('args.updates');

      for (const badItem of [
        { rowNumber: 2 }, // missing required values
        { rowNumber: 2, values: { Status: 'Done' }, unexpected: true }, // additionalProperties: false
        { rowNumber: 1, values: { Status: 'Done' } }, // rowNumber < 2
        { rowNumber: 501, values: { Status: 'Done' } }, // rowNumber > 500
        { rowNumber: 2.5, values: { Status: 'Done' } }, // non-integer
        { rowNumber: 2, values: { Status: 123 } }, // additionalProperties string map violation
      ]) {
        const res = validatePlan(
          singleStepPlan('sheets.update_rows', {
            spreadsheetId: SPREADSHEET_ID,
            sheet: 'Tasks',
            updates: [badItem],
          }),
          CATALOG,
          { grounding },
        );
        expect(res).toMatchObject({ valid: false, layer: 'schema' });
      }

      for (const okLen of [1, 20]) {
        expect(
          validatePlan(
            singleStepPlan('sheets.update_rows', {
              spreadsheetId: SPREADSHEET_ID,
              sheet: 'Tasks',
              updates: Array.from({ length: okLen }, (_, i) => ({
                rowNumber: i + 2,
                values: { Status: 'Done' },
              })),
            }),
            CATALOG,
            { grounding },
          ),
        ).toMatchObject({ valid: true });
      }
    });

    it('enforces 3-level object -> array -> object -> array bounds with exact nested path reporting', () => {
      const emptyOuter = validatePlan(singleStepPlan('custom.nested_groups', { groups: [] }), CATALOG);
      expect(emptyOuter).toMatchObject({ valid: false, layer: 'schema' });
      if (!emptyOuter.valid) expect(emptyOuter.error).toContain('args.groups ');

      const overOuter = validatePlan(
        singleStepPlan('custom.nested_groups', {
          groups: Array.from({ length: 4 }, (_, i) => ({ name: `g_${i}`, tags: ['t1'] })),
        }),
        CATALOG,
      );
      expect(overOuter).toMatchObject({ valid: false, layer: 'schema' });
      if (!overOuter.valid) expect(overOuter.error).toContain('args.groups ');

      const emptyInnerTags = validatePlan(
        singleStepPlan('custom.nested_groups', {
          groups: [{ name: 'g1', tags: ['ok'] }, { name: 'g2', tags: [] }],
        }),
        CATALOG,
      );
      expect(emptyInnerTags).toMatchObject({ valid: false, layer: 'schema' });
      if (!emptyInnerTags.valid) expect(emptyInnerTags.error).toContain('args.groups[1].tags');

      const overInnerTags = validatePlan(
        singleStepPlan('custom.nested_groups', {
          groups: [{ name: 'g1', tags: ['a', 'b', 'c'] }],
        }),
        CATALOG,
      );
      expect(overInnerTags).toMatchObject({ valid: false, layer: 'schema' });
      if (!overInnerTags.valid) expect(overInnerTags.error).toContain('args.groups[0].tags');

      expect(
        validatePlan(
          singleStepPlan('custom.nested_groups', {
            groups: [
              { name: 'g1', tags: ['a'] },
              { name: 'g2', tags: ['b', 'c'] },
              { name: 'g3', tags: ['d'] },
            ],
          }),
          CATALOG,
        ),
      ).toMatchObject({ valid: true });
    });
  });

  describe('$ref/$template, anyOf, primitive/enum semantics, grounding non-bypass, and x-recipient protections', () => {
    it('rejects $ref and $template in array position while allowing valid string $ref/$template items inside bounded arrays', () => {
      const grounding = createGroundedContext();

      for (const badArrayRef of [{ $ref: 'card.output.url' }, { $template: '${card.output.url}' }]) {
        const res = validatePlan(
          JSON.stringify({
            kind: 'plan',
            thinking: 'Tạo thẻ rồi gắn nhãn',
            summary: 'Tạo thẻ và gắn nhãn',
            warnings: [],
            steps: [
              {
                id: 'card',
                tool: 'trello.create_card',
                description: 'Tạo thẻ',
                args: { listId: 'list_1', title: 'Task A' },
                dependsOn: [],
              },
              {
                id: 'batch',
                tool: 'gmail.batch_modify_threads',
                description: 'Đổi nhãn',
                args: { threadIds: badArrayRef, addLabelIds: ['STARRED'] },
                dependsOn: ['card'],
              },
            ],
          }),
          CATALOG,
          { grounding },
        );
        expect(res).toMatchObject({ valid: false, layer: 'schema' });
      }

      const validRefItemsPlan = JSON.stringify({
        kind: 'plan',
        thinking: 'Tạo thẻ rồi ghi dòng vào tab Tasks',
        summary: 'Tạo thẻ và ghi dòng',
        warnings: [],
        steps: [
          {
            id: 'card',
            tool: 'trello.create_card',
            description: 'Tạo thẻ',
            args: { listId: 'list_1', title: 'Task A' },
            dependsOn: [],
          },
          {
            id: 'append',
            tool: 'sheets.append_rows',
            description: 'Ghi dòng',
            args: {
              spreadsheetId: SPREADSHEET_ID,
              sheet: 'Tasks',
              rows: [[{ $ref: 'card.output.name' }, { $template: 'Link: ${card.output.url}' }]],
            },
            dependsOn: ['card'],
          },
        ],
      });
      expect(validatePlan(validRefItemsPlan, CATALOG, { grounding })).toMatchObject({ valid: true });

      const overMaxRefRowsPlan = JSON.stringify({
        kind: 'plan',
        thinking: 'Tạo thẻ rồi ghi 21 dòng',
        summary: 'Tạo thẻ và ghi dòng',
        warnings: [],
        steps: [
          {
            id: 'card',
            tool: 'trello.create_card',
            description: 'Tạo thẻ',
            args: { listId: 'list_1', title: 'Task A' },
            dependsOn: [],
          },
          {
            id: 'append',
            tool: 'sheets.append_rows',
            description: 'Ghi dòng',
            args: {
              spreadsheetId: SPREADSHEET_ID,
              sheet: 'Tasks',
              rows: Array.from({ length: 21 }, () => [{ $ref: 'card.output.url' }]),
            },
            dependsOn: ['card'],
          },
        ],
      });
      expect(validatePlan(overMaxRefRowsPlan, CATALOG, { grounding })).toMatchObject({
        valid: false,
        layer: 'schema',
      });
    });

    it('blocks unresolved/forward/bad-property refs and ungrounded resource IDs inside valid-length arrays', () => {
      const grounding = createGroundedContext();

      // Missing step in $ref inside array item -> semantic failure
      expect(
        validatePlan(
          singleStepPlan('sheets.append_rows', {
            spreadsheetId: SPREADSHEET_ID,
            sheet: 'Tasks',
            rows: [[{ $ref: 'nonexistent.output.url' }]],
          }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({ valid: false, layer: 'semantic' });

      // Forward reference inside array item -> semantic failure
      const forwardRefPlan = JSON.stringify({
        kind: 'plan',
        thinking: 'Ghi trước tạo sau',
        summary: 'Ghi dòng',
        warnings: [],
        steps: [
          {
            id: 'append',
            tool: 'sheets.append_rows',
            description: 'Ghi dòng',
            args: {
              spreadsheetId: SPREADSHEET_ID,
              sheet: 'Tasks',
              rows: [[{ $ref: 'later.output.url' }]],
            },
            dependsOn: [],
          },
          {
            id: 'later',
            tool: 'trello.create_card',
            description: 'Tạo thẻ',
            args: { listId: 'list_1', title: 'Task B' },
            dependsOn: [],
          },
        ],
      });
      expect(validatePlan(forwardRefPlan, CATALOG, { grounding })).toMatchObject({
        valid: false,
        layer: 'semantic',
      });

      // Unknown output property in $ref inside array item -> semantic failure
      const badOutputPropPlan = JSON.stringify({
        kind: 'plan',
        thinking: 'Tạo thẻ rồi ghi trường không tồn tại',
        summary: 'Ghi dòng',
        warnings: [],
        steps: [
          {
            id: 'card',
            tool: 'trello.create_card',
            description: 'Tạo thẻ',
            args: { listId: 'list_1', title: 'Task B' },
            dependsOn: [],
          },
          {
            id: 'append',
            tool: 'sheets.append_rows',
            description: 'Ghi dòng',
            args: {
              spreadsheetId: SPREADSHEET_ID,
              sheet: 'Tasks',
              rows: [[{ $ref: 'card.output.missingField' }]],
            },
            dependsOn: ['card'],
          },
        ],
      });
      expect(validatePlan(badOutputPropPlan, CATALOG, { grounding })).toMatchObject({
        valid: false,
        layer: 'semantic',
      });

      // Raw ${step.output...} string placeholder inside array item -> semantic failure
      expect(
        validatePlan(
          singleStepPlan('sheets.append_rows', {
            spreadsheetId: SPREADSHEET_ID,
            sheet: 'Tasks',
            rows: [['${card.output.url}']],
          }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({ valid: false, layer: 'semantic' });

      // Ungrounded literal ID mixed into valid-length bounded array -> grounding failure
      expect(
        validatePlan(
          singleStepPlan('gmail.batch_modify_threads', {
            threadIds: ['t_1', 't_invented_999'],
            addLabelIds: ['STARRED'],
          }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({
        valid: false,
        layer: 'grounding',
        ungrounded: [{ argument: 'threadIds', resource: 'thread', value: 't_invented_999' }],
      });

      expect(
        validatePlan(
          singleStepPlan('trello.create_card', {
            listId: 'list_1',
            title: 'Task C',
            idMembers: ['m_1', 'm_invented'],
          }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({
        valid: false,
        layer: 'grounding',
        ungrounded: [{ argument: 'idMembers', resource: 'member', value: 'm_invented' }],
      });
    });

    it('preserves anyOf, non-array type errors, integer minimum/maximum, and enum checks', () => {
      const grounding = createGroundedContext();

      // anyOf on gmail.modify_thread_labels and sheets.append_rows
      expect(
        validatePlan(singleStepPlan('gmail.modify_thread_labels', { threadId: 't_1' }), CATALOG, { grounding }),
      ).toMatchObject({ valid: false, layer: 'schema' });

      expect(
        validatePlan(
          singleStepPlan('sheets.append_rows', { spreadsheetId: SPREADSHEET_ID, sheet: 'Tasks' }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({ valid: false, layer: 'schema' });

      // Non-array passed where array is required
      expect(
        validatePlan(
          singleStepPlan('gmail.batch_modify_threads', { threadIds: 't_1', addLabelIds: ['STARRED'] }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({ valid: false, layer: 'schema' });

      // Integer bounds inside bounded array (rowNumbers 2..500, deduplicateColumns 0..19) and enum check
      for (const badRowNum of [1, 501, 2.5]) {
        expect(
          validatePlan(
            singleStepPlan('sheets.delete_rows', {
              spreadsheetId: SPREADSHEET_ID,
              sheet: 'Tasks',
              rowNumbers: [badRowNum],
            }),
            CATALOG,
            { grounding },
          ),
        ).toMatchObject({ valid: false, layer: 'schema' });
      }

      for (const badCol of [-1, 20, 1.5]) {
        expect(
          validatePlan(
            singleStepPlan('sheets.append_rows', {
              spreadsheetId: SPREADSHEET_ID,
              sheet: 'Tasks',
              rows: [['ok']],
              deduplicateColumns: [badCol],
            }),
            CATALOG,
            { grounding },
          ),
        ).toMatchObject({ valid: false, layer: 'schema' });
      }

      expect(
        validatePlan(
          singleStepPlan('sheets.append_rows', {
            spreadsheetId: SPREADSHEET_ID,
            sheet: 'Tasks',
            rows: [['ok']],
            onDuplicate: 'overwrite',
          }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({ valid: false, layer: 'schema' });
    });

    it('preserves x-recipient prohibitions, per-array bounds, recipient grounding, and leaves cross-field To+Cc+Bcc cap to adapter', () => {
      const grounding = createGroundedContext();

      // Dynamic refs/templates/placeholders and malformed headers remain forbidden in x-recipient arrays
      for (const badTo of [
        [{ $ref: 'step0.output.email' }],
        [{ $template: '${step0.output.email}' }],
        ['${step0.output.email}'],
        ['User <user1@example.com>'],
        ['user1@example.com\r\nBcc: evil@example.com'],
      ]) {
        const res = validatePlan(
          singleStepPlan('gmail.send_message', { to: badTo, subject: 'Chào', body: 'Nội dung' }),
          CATALOG,
          { grounding },
        );
        expect(res).toMatchObject({ valid: false, layer: 'schema' });
        if (!res.valid) expect(res.error).toContain('literal bare email addresses');
      }

      // Per-array bounds on x-recipient: send_message to minItems: 1, maxItems: 20
      const emptySendTo = validatePlan(
        singleStepPlan('gmail.send_message', { to: [], subject: 'Chào', body: 'Nội dung' }),
        CATALOG,
        { grounding },
      );
      expect(emptySendTo).toMatchObject({ valid: false, layer: 'schema' });
      if (!emptySendTo.valid) expect(emptySendTo.error).toContain('recipient count is out of range');

      const overMaxSendCc = validatePlan(
        singleStepPlan('gmail.send_message', {
          to: ['user1@example.com'],
          cc: RECIPIENTS_24.slice(0, 21),
          subject: 'Chào',
          body: 'Nội dung',
        }),
        CATALOG,
        { grounding },
      );
      expect(overMaxSendCc).toMatchObject({ valid: false, layer: 'schema' });
      if (!overMaxSendCc.valid) expect(overMaxSendCc.error).toContain('recipient count is out of range');

      // create_draft allows empty or omitted to (minItems: 0), but rejects 21 recipients in a single array
      expect(
        validatePlan(
          singleStepPlan('gmail.create_draft', { to: [], body: 'Nháp nội dung' }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({ valid: true });

      expect(
        validatePlan(
          singleStepPlan('gmail.create_draft', {
            to: RECIPIENTS_24.slice(0, 21),
            body: 'Nháp nội dung',
          }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({ valid: false, layer: 'schema' });

      // Ungrounded recipient remains rejected at grounding layer
      expect(
        validatePlan(
          singleStepPlan('gmail.send_message', {
            to: ['stranger@untrusted.example'],
            subject: 'Chào',
            body: 'Nội dung',
          }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({
        valid: false,
        layer: 'grounding',
        ungrounded: [{ argument: 'to', resource: 'recipient', value: 'stranger@untrusted.example' }],
      });

      // Per Owner contract (msg_c340e002e47c): validator enforces per-array min/max only (no cross-field To+Cc+Bcc cap in validator)
      expect(
        validatePlan(
          singleStepPlan('gmail.send_message', {
            to: RECIPIENTS_24.slice(0, 12),
            cc: RECIPIENTS_24.slice(12, 24),
            subject: 'Thông báo nhóm',
            body: 'Nội dung đã duyệt',
          }),
          CATALOG,
          { grounding },
        ),
      ).toMatchObject({ valid: true });
    });
  });

  describe('pre-preview and pre-search rejection via AIPlanner and prepareSearchCall with zero provider/adapter calls', () => {
    it.each([
      { label: 'empty threadIds (0)', threadIds: [] as string[] },
      { label: 'oversized threadIds (21)', threadIds: THREADS_21 },
    ])('rejects invalid literal array ($label) in AIPlanner before returning a plan preview (zero adapter calls)', async ({ threadIds }) => {
      const provider = new MockLLMProvider();
      const invalidPlan = JSON.parse(
        singleStepPlan('gmail.batch_modify_threads', { threadIds, addLabelIds: ['STARRED'] }, 'batch'),
      );
      provider.setPlanResponses([invalidPlan, invalidPlan]);

      let externalCalls = 0;
      const memory = new WorkingMemory();
      memory.setEntity(
        'thread',
        THREADS_21.map((id) => ({ id, participants: ['lan@example.com'] })),
      );
      memory.setEntity('label', [{ id: 'STARRED', name: 'STARRED', type: 'system' }]);

      const planner = new AIPlanner({
        provider,
        toolCatalog: [...ALL_TOOLS, ...GMAIL_TOOLS],
        serviceRegistry: [...SERVICE_REGISTRY, GMAIL_SERVICE],
        searchMode: 'llm',
        prefetchDirectory: false,
        gatherSearch: async () => {
          externalCalls++;
          return [];
        },
      });

      await expect(
        planner.processMessage({
          userMessage: 'Gắn sao các luồng thư đã chọn trong Gmail',
          memory,
        }),
      ).rejects.toThrow(/\[schema\].*args\.threadIds/i);

      expect(provider.getCallCount()).toBe(2);
      expect(externalCalls).toBe(0);
    });

    it('feeds schema array-bound error back on retry so AIPlanner recovers on attempt 2 without external calls', async () => {
      const provider = new MockLLMProvider();
      provider.setPlanResponses([
        JSON.parse(singleStepPlan('gmail.modify_thread_labels', { threadId: 't_1', addLabelIds: [] }, 'mod')),
        JSON.parse(singleStepPlan('gmail.modify_thread_labels', { threadId: 't_1', addLabelIds: ['STARRED'] }, 'mod')),
      ]);

      let externalCalls = 0;
      const memory = new WorkingMemory();
      memory.setEntity('thread', [{ id: 't_1', participants: ['lan@example.com'] }]);
      memory.setEntity('label', [{ id: 'STARRED', name: 'STARRED', type: 'system' }]);

      const planner = new AIPlanner({
        provider,
        toolCatalog: [...ALL_TOOLS, ...GMAIL_TOOLS],
        serviceRegistry: [...SERVICE_REGISTRY, GMAIL_SERVICE],
        searchMode: 'llm',
        prefetchDirectory: false,
        gatherSearch: async () => {
          externalCalls++;
          return [];
        },
      });

      const response = await planner.processMessage({
        userMessage: 'Gắn sao luồng thư t_1 trong Gmail',
        memory,
      });

      expect(provider.getCallCount()).toBe(2);
      expect(externalCalls).toBe(0);
      expect(response.kind).toBe('plan');
      if (response.kind === 'plan') {
        expect(response.steps[0]?.args.addLabelIds).toEqual(['STARRED']);
      }
    });

    it('blocks out-of-bounds read-tool array args in prepareSearchCall and AIPlanner search before gatherSearch runs (gatherCalls = 0)', async () => {
      expect(
        prepareSearchCall(
          {
            tool: 'sheets.search_rows',
            args: { spreadsheetId: SPREADSHEET_ID, sheet: 'Tasks', filters: [] },
          },
          CATALOG,
        ),
      ).toMatchObject({ error: expect.stringContaining('args.filters') });

      expect(
        prepareSearchCall(
          {
            tool: 'sheets.search_rows',
            args: {
              spreadsheetId: SPREADSHEET_ID,
              sheet: 'Tasks',
              filters: Array.from({ length: 11 }, (_, i) => ({ column: `C_${i}`, operator: 'equals', value: 'x' })),
            },
          },
          CATALOG,
        ),
      ).toMatchObject({ error: expect.stringContaining('args.filters') });

      const provider = new MockLLMProvider();
      provider.setPlanResponses([
        {
          kind: 'search',
          calls: [{ tool: 'sheets.search_rows', args: { spreadsheetId: SPREADSHEET_ID, sheet: 'Tasks', filters: [] } }],
        },
        JSON.parse(
          singleStepPlan('sheets.append_rows', {
            spreadsheetId: SPREADSHEET_ID,
            sheet: 'Tasks',
            rows: [['New Task']],
          }),
        ),
      ]);

      let gatherCalls = 0;
      const memory = new WorkingMemory();
      memory.setEntity('spreadsheet', [{ id: SPREADSHEET_ID, title: 'Ops Tracker' }]);
      memory.setEntity('sheet', [{ id: 0, title: 'Tasks', spreadsheetId: SPREADSHEET_ID }]);

      const planner = new AIPlanner({
        provider,
        toolCatalog: [...ALL_TOOLS, ...SHEETS_EXTENDED_TOOLS],
        serviceRegistry: SERVICE_REGISTRY,
        searchMode: 'llm',
        prefetchDirectory: false,
        gatherSearch: async () => {
          gatherCalls++;
          return { sheet: 'Tasks', headers: ['Task'], totalMatched: 0, matches: [] };
        },
      });

      const response = await planner.processMessage({
        userMessage: 'Thêm dòng mới vào tab Tasks trên Google Sheets',
        memory,
      });

      expect(gatherCalls).toBe(0);
      expect(provider.getCallCount()).toBe(2);
      expect(response.kind).toBe('plan');
    });
  });
});
