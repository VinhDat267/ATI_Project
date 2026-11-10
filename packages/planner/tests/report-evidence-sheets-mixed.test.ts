import { describe, it, expect, vi } from 'vitest';
import {
  ALL_TOOLS,
  SHEETS_EXTENDED_TOOLS,
  MYSHEETS_TOOLS,
  SERVICE_REGISTRY,
  MYSHEETS_SERVICE,
  REPORT_SOURCE_TOOLS,
  type PlanResponse,
} from '@wap/tool-schemas';
import * as toolSchemas from '@wap/tool-schemas';
import { validatePlan } from '../src/validator.js';
import { AIPlanner } from '../src/planner.js';
import { WorkingMemory } from '../src/working-memory.js';
import { ReportArtifactStore } from '../src/reports/artifacts.js';
import { renderSheetSummaryReport } from '../src/reports/renderers.js';
import { validateReportEvidenceBinding } from '../../../apps/chat-api/src/services/report-evidence-guard.js';

const FULL_TEST_TOOLS = [...ALL_TOOLS, ...SHEETS_EXTENDED_TOOLS, ...MYSHEETS_TOOLS];
const FULL_TEST_SERVICES = [...SERVICE_REGISTRY, MYSHEETS_SERVICE];
const PERSONAL_SPREADSHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
const SHARED_SPREADSHEET_ID = '1SharedOrdersSpreadsheetId000001';

describe('PR-R1-B1: Report Evidence Grounding for Sheets Search/Aggregate & Bounded Mixed-Plan Clarification', () => {
  it('1. preserves REPORT_SOURCE_TOOLS as ReadonlySet<string> and includes mysheets.search_rows, sheets.search_rows, and sheets.aggregate_rows alongside REPORT_SOURCE_TOOL_KINDS', () => {
    expect(REPORT_SOURCE_TOOLS instanceof Set).toBe(true);
    expect(REPORT_SOURCE_TOOLS.has('mysheets.read_range')).toBe(true);
    expect(REPORT_SOURCE_TOOLS.has('mysheets.aggregate_rows')).toBe(true);
    expect(REPORT_SOURCE_TOOLS.has('mysheets.search_rows')).toBe(true);
    expect(REPORT_SOURCE_TOOLS.has('sheets.read_range')).toBe(true);
    expect(REPORT_SOURCE_TOOLS.has('sheets.search_rows')).toBe(true);
    expect(REPORT_SOURCE_TOOLS.has('sheets.aggregate_rows')).toBe(true);

    const kinds = (toolSchemas as Record<string, unknown>).REPORT_SOURCE_TOOL_KINDS as
      | Record<string, string>
      | undefined;
    expect(kinds).toBeDefined();
    expect(kinds?.['mysheets.search_rows']).toBe('sheets_summary');
    expect(kinds?.['sheets.search_rows']).toBe('sheets_summary');
    expect(kinds?.['sheets.aggregate_rows']).toBe('sheets_summary');
    expect(kinds?.['mysheets.aggregate_rows']).toBe('sheets_summary');
  });

  it('2a. grounds report content from mysheets.search_rows verified read observations and overwrites fabricated LLM text', async () => {
    const store = new ReportArtifactStore();
    const planner = new AIPlanner({
      toolCatalog: FULL_TEST_TOOLS,
      serviceRegistry: FULL_TEST_SERVICES,
      searchMode: 'llm',
      prefetchDirectory: false,
      reportEvidenceStore: store,
      gatherSearch: async ({ tool }) => {
        if (tool === 'mysheets.search_rows') {
          return {
            sheet: 'Orders',
            headers: ['OrderID', 'Customer', 'Status', 'Amount'],
            totalMatched: 2,
            matches: [
              {
                rowNumber: 2,
                values: ['ORD-101', 'Acme Corp', 'overdue', '500'],
                record: { OrderID: 'ORD-101', Customer: 'Acme Corp', Status: 'overdue', Amount: '500' },
              },
              {
                rowNumber: 5,
                values: ['ORD-104', 'Beta LLC', 'overdue', '1200'],
                record: { OrderID: 'ORD-104', Customer: 'Beta LLC', Status: 'overdue', Amount: '1200' },
              },
            ],
          };
        }
        return [];
      },
      provider: {
        name: 'mock',
        model: 'mock',
        generatePlan: async () =>
          JSON.stringify({
            kind: 'plan',
            thinking: 'Tìm dòng overdue và gửi báo cáo Slack',
            summary: 'Báo cáo đơn hàng quá hạn sang kênh dev',
            warnings: [],
            steps: [
              {
                id: 's_search',
                tool: 'mysheets.search_rows',
                description: 'Tìm các dòng overdue trong sheet Orders',
                args: {
                  spreadsheetId: PERSONAL_SPREADSHEET_ID,
                  sheet: 'Orders',
                  query: 'overdue',
                },
                dependsOn: [],
              },
              {
                id: 's_notify',
                tool: 'slack.send_message',
                description: 'Gửi báo cáo vào Slack #dev',
                args: {
                  channel: 'C_DEV',
                  text: 'Báo cáo bịa đặt: Có 999 đơn hàng quá hạn trị giá $9,999,999 (#FAKE-999)',
                },
                dependsOn: ['s_search'],
              },
            ],
          }),
      },
    });

    const memory = new WorkingMemory();
    memory.setEntity('workflow_resource_defaults', {
      mysheets: { spreadsheetId: PERSONAL_SPREADSHEET_ID, sheetName: 'Orders' },
      slack: { channelId: 'C_DEV', channelName: 'dev' },
    });
    memory.setEntity('mysheet', { id: 0, title: 'Orders', spreadsheetId: PERSONAL_SPREADSHEET_ID });

    const response = await planner.processMessage({
      userMessage: 'Tìm các dòng overdue trong bảng tính cá nhân Orders rồi tổng hợp báo cáo gửi vào kênh Slack dev',
      memory,
      actor: { userId: 'user_1', workspaceId: 'ws_1' },
    });

    expect(response.kind).toBe('plan');
    if (response.kind === 'plan') {
      expect(response.reportEvidence).toBeDefined();
      expect(response.reportEvidence?.sourceTool).toBe('mysheets.search_rows');
      expect(response.reportEvidence?.kind).toBe('sheets_summary');
      expect(response.reportEvidence?.itemCount).toBe(2);

      const notifyStep = response.steps.find((s) => s.id === 's_notify');
      expect(notifyStep?.args.text).toContain('ORD-101');
      expect(notifyStep?.args.text).toContain('ORD-104');
      expect(notifyStep?.args.text).not.toContain('999');
      expect(notifyStep?.args.text).not.toContain('FAKE-999');
    }
  });

  it('2b. grounds report content from sheets.search_rows and sheets.aggregate_rows verified read observations', async () => {
    const store = new ReportArtifactStore();
    const planner = new AIPlanner({
      toolCatalog: [...ALL_TOOLS, ...SHEETS_EXTENDED_TOOLS],
      serviceRegistry: SERVICE_REGISTRY,
      searchMode: 'llm',
      prefetchDirectory: false,
      reportEvidenceStore: store,
      gatherSearch: async ({ tool }) => {
        if (tool === 'sheets.aggregate_rows') {
          return {
            sheet: 'Orders',
            totalRowsScanned: 25,
            matchedRows: 4,
            groups: [
              { key: { Status: 'overdue' }, count: 3, metrics: { Amount_sum: 2500 } },
              { key: { Status: 'paid' }, count: 1, metrics: { Amount_sum: 800 } },
            ],
            totals: { count: 4, Amount_sum: 3300 },
          };
        }
        return [];
      },
      provider: {
        name: 'mock',
        model: 'mock',
        generatePlan: async () =>
          JSON.stringify({
            kind: 'plan',
            thinking: 'Thống kê bảng tính chung và gửi báo cáo Slack',
            summary: 'Báo cáo thống kê Orders sang kênh dev',
            warnings: [],
            steps: [
              {
                id: 's_agg',
                tool: 'sheets.aggregate_rows',
                description: 'Thống kê theo Status',
                args: {
                  spreadsheetId: SHARED_SPREADSHEET_ID,
                  sheet: 'Orders',
                  groupBy: 'Status',
                },
                dependsOn: [],
              },
              {
                id: 's_notify',
                tool: 'slack.send_message',
                description: 'Gửi thống kê vào Slack #dev',
                args: {
                  channel: 'C_DEV',
                  text: 'Báo cáo bịa đặt: 777 dòng',
                },
                dependsOn: ['s_agg'],
              },
            ],
          }),
      },
    });

    const memory = new WorkingMemory();
    memory.setEntity('workflow_resource_defaults', {
      slack: { channelId: 'C_DEV', channelName: 'dev' },
    });
    memory.setEntity('spreadsheet', { id: SHARED_SPREADSHEET_ID, title: 'Shared Orders' });
    memory.setEntity('sheet', { id: 0, title: 'Orders', spreadsheetId: SHARED_SPREADSHEET_ID });

    const response = await planner.processMessage({
      userMessage: 'Thống kê dữ liệu theo Status từ bảng tính chung Orders rồi gửi báo cáo vào Slack kênh dev',
      memory,
      actor: { userId: 'user_1', workspaceId: 'ws_1' },
    });

    expect(response.kind).toBe('plan');
    if (response.kind === 'plan') {
      expect(response.reportEvidence).toBeDefined();
      expect(response.reportEvidence?.sourceTool).toBe('sheets.aggregate_rows');
      expect(response.reportEvidence?.kind).toBe('sheets_summary');
      const notifyStep = response.steps.find((s) => s.id === 's_notify');
      expect(notifyStep?.args.text).toContain('overdue: 3');
      expect(notifyStep?.args.text).toContain('paid: 1');
      expect(notifyStep?.args.text).not.toContain('777');
    }
  });

  it('3 & 5 & 6. mixed notification + work-item plan with explicit work-item title/body binds report to notification step, preserves work-item title/body, passes validatePlan & validateReportEvidenceBinding, and preserves per-write approval', async () => {
    const store = new ReportArtifactStore();
    const gatherSpy = vi.fn(async ({ tool }: { tool: string }) => {
      if (tool === 'mysheets.search_rows') {
        return {
          sheet: 'Orders',
          headers: ['OrderID', 'Status'],
          totalMatched: 1,
          matches: [
            {
              rowNumber: 2,
              values: ['ORD-501', 'overdue'],
              record: { OrderID: 'ORD-501', Status: 'overdue' },
            },
          ],
        };
      }
      return [];
    });

    const planner = new AIPlanner({
      toolCatalog: FULL_TEST_TOOLS,
      serviceRegistry: FULL_TEST_SERVICES,
      searchMode: 'llm',
      prefetchDirectory: false,
      reportEvidenceStore: store,
      gatherSearch: gatherSpy,
      provider: {
        name: 'mock',
        model: 'mock',
        generatePlan: async () =>
          JSON.stringify({
            kind: 'plan',
            thinking: 'Tìm dòng overdue, gửi báo cáo Slack và tạo issue GitHub theo dõi riêng',
            summary: 'Báo cáo đơn quá hạn vào Slack #dev và tạo issue GitHub',
            warnings: [],
            steps: [
              {
                id: 's_search',
                tool: 'mysheets.search_rows',
                description: 'Tìm dòng overdue',
                args: {
                  spreadsheetId: PERSONAL_SPREADSHEET_ID,
                  sheet: 'Orders',
                  query: 'overdue',
                },
                dependsOn: [],
              },
              {
                id: 's_slack',
                tool: 'slack.send_message',
                description: 'Gửi báo cáo vào Slack #dev',
                args: {
                  channel: 'C_DEV',
                  text: 'Hallucinated report text #999',
                },
                dependsOn: ['s_search'],
              },
              {
                id: 's_issue',
                tool: 'github.create_issue',
                description: 'Tạo issue GitHub để theo dõi',
                args: {
                  repo: 'acme/web',
                  title: 'Rà soát công nợ Q4',
                  body: 'Kiểm tra các đơn hàng quá hạn với bộ phận kế toán',
                },
                dependsOn: ['s_search'],
              },
            ],
          }),
      },
    });

    const memory = new WorkingMemory();
    memory.setEntity('workflow_resource_defaults', {
      mysheets: { spreadsheetId: PERSONAL_SPREADSHEET_ID, sheetName: 'Orders' },
      slack: { channelId: 'C_DEV', channelName: 'dev' },
      github: { repo: 'acme/web' },
    });
    memory.setEntity('mysheet', { id: 0, title: 'Orders', spreadsheetId: PERSONAL_SPREADSHEET_ID });

    const userPrompt =
      'Tìm các dòng overdue trong bảng tính Orders rồi gửi báo cáo tổng hợp vào kênh Slack dev, đồng thời tạo issue GitHub trên acme/web với tiêu đề "Rà soát công nợ Q4" và nội dung "Kiểm tra các đơn hàng quá hạn với bộ phận kế toán"';

    const response = await planner.processMessage({
      userMessage: userPrompt,
      memory,
      actor: { userId: 'user_1', workspaceId: 'ws_1' },
    });

    // 6. Per-write approval is never bypassed: returns a pending plan containing both write steps
    expect(response.kind).toBe('plan');
    if (response.kind === 'plan') {
      const slackStep = response.steps.find((s) => s.id === 's_slack');
      const issueStep = response.steps.find((s) => s.id === 's_issue');

      expect(slackStep).toBeDefined();
      expect(issueStep).toBeDefined();

      // Notification step receives grounded report text
      expect(slackStep?.args.text).toContain('ORD-501');
      expect(slackStep?.args.text).not.toContain('#999');

      // 5. Work-item step preserves explicit title and body without being overwritten by report text
      expect(issueStep?.args.title).toBe('Rà soát công nợ Q4');
      expect(issueStep?.args.body).toBe('Kiểm tra các đơn hàng quá hạn với bộ phận kế toán');

      // Report evidence binds to the notification step
      expect(response.reportEvidence).toBeDefined();
      expect(response.reportEvidence?.stepId).toBe('s_slack');
      expect(response.reportEvidence?.argument).toBe('text');

      // Passes both planner validator and chat-api execution guard
      const validation = validatePlan(JSON.stringify(response), FULL_TEST_TOOLS, {
        grounding: {
          memory: {
            channel: { id: 'C_DEV', name: 'dev' },
            repository: { id: 'acme/web', fullName: 'acme/web', name: 'web' },
            myspreadsheet: { id: PERSONAL_SPREADSHEET_ID, title: 'Orders' },
            mysheet: { id: 0, title: 'Orders', spreadsheetId: PERSONAL_SPREADSHEET_ID },
          },
          userTexts: [userPrompt],
        },
        reportEvidenceStore: store,
      });
      expect(validation.valid).toBe(true);

      const artifact = store.getArtifact(response.reportEvidence!.artifactId)!;
      const guardCheck = await validateReportEvidenceBinding(response, {
        userId: 'user_1',
        workspaceId: 'ws_1',
        observedArtifact: {
          id: artifact.id,
          ownerUserId: artifact.actorUserId,
          workspaceId: artifact.workspaceId,
          contentHash: artifact.contentHash,
        },
        enforceReportGrounding: true,
        requestTexts: [userPrompt],
      });
      expect(guardCheck.valid).toBe(true);
    }
  });

  it('4. asks clarification ONCE for an ambiguous mixed report + work-item plan on Turn 1, and does NOT loop infinitely on Turn 2 follow-up reply', async () => {
    const store = new ReportArtifactStore();
    const planner = new AIPlanner({
      toolCatalog: FULL_TEST_TOOLS,
      serviceRegistry: FULL_TEST_SERVICES,
      searchMode: 'llm',
      prefetchDirectory: false,
      reportEvidenceStore: store,
      gatherSearch: async ({ tool }) => {
        if (tool === 'mysheets.search_rows') {
          return {
            sheet: 'Orders',
            headers: ['OrderID', 'Status'],
            totalMatched: 1,
            matches: [
              {
                rowNumber: 3,
                values: ['ORD-777', 'overdue'],
                record: { OrderID: 'ORD-777', Status: 'overdue' },
              },
            ],
          };
        }
        return [];
      },
      provider: {
        name: 'mock',
        model: 'mock',
        generatePlan: async () =>
          JSON.stringify({
            kind: 'plan',
            thinking: 'Tìm dòng overdue, gửi báo cáo Slack và tạo issue GitHub',
            summary: 'Báo cáo đơn quá hạn vào Slack #dev và tạo issue GitHub',
            warnings: [],
            steps: [
              {
                id: 's_search',
                tool: 'mysheets.search_rows',
                description: 'Tìm dòng overdue',
                args: {
                  spreadsheetId: PERSONAL_SPREADSHEET_ID,
                  sheet: 'Orders',
                  query: 'overdue',
                },
                dependsOn: [],
              },
              {
                id: 's_slack',
                tool: 'slack.send_message',
                description: 'Gửi báo cáo vào Slack #dev',
                args: {
                  channel: 'C_DEV',
                  text: 'Placeholder report',
                },
                dependsOn: ['s_search'],
              },
              {
                id: 's_issue',
                tool: 'github.create_issue',
                description: 'Tạo issue GitHub',
                args: {
                  repo: 'acme/web',
                  title: 'Cảnh báo đơn quá hạn',
                  body: 'Nhờ team vận hành kiểm tra',
                },
                dependsOn: ['s_search'],
              },
            ],
          }),
      },
    });

    const memory = new WorkingMemory();
    memory.setEntity('workflow_resource_defaults', {
      mysheets: { spreadsheetId: PERSONAL_SPREADSHEET_ID, sheetName: 'Orders' },
      slack: { channelId: 'C_DEV', channelName: 'dev' },
      github: { repo: 'acme/web' },
    });
    memory.setEntity('mysheet', { id: 0, title: 'Orders', spreadsheetId: PERSONAL_SPREADSHEET_ID });

    const turn1UserMessage =
      'Tổng hợp báo cáo các dòng overdue trong bảng tính Orders gửi vào kênh Slack dev và tạo issue GitHub trên acme/web';

    // Turn 1: Ambiguous whether GitHub issue should contain the report or separate content -> asks clarification once
    const turn1Response = await planner.processMessage({
      userMessage: turn1UserMessage,
      memory,
      actor: { userId: 'user_1', workspaceId: 'ws_1' },
    });

    expect(turn1Response.kind).toBe('clarification');
    if (turn1Response.kind === 'clarification') {
      expect(turn1Response.question).toContain(
        'Bạn muốn nội dung công việc mới là báo cáo dữ liệu hay một nội dung riêng?',
      );
    }

    // Turn 2: User replies to the clarification specifying separate content WITHOUT a body -> must NOT loop clarification AND must NOT keep unapproved LLM-invented body!
    const turn2Response = await planner.processMessage({
      userMessage: 'Dùng một nội dung riêng cho công việc mới nhé',
      history: [
        { role: 'user', content: turn1UserMessage },
        {
          role: 'assistant',
          content:
            turn1Response.kind === 'clarification'
              ? turn1Response.question
              : 'Bạn muốn nội dung công việc mới là báo cáo dữ liệu hay một nội dung riêng?',
        },
      ],
      memory,
      actor: { userId: 'user_1', workspaceId: 'ws_1' },
    });

    expect(turn2Response.kind).toBe('plan');
    if (turn2Response.kind === 'plan') {
      const slackStep = turn2Response.steps.find((s) => s.id === 's_slack');
      const issueStep = turn2Response.steps.find((s) => s.id === 's_issue');
      expect(slackStep?.args.text).toContain('ORD-777');
      expect(issueStep?.args.title).toBe('Cảnh báo đơn quá hạn');
      // Requirement 5 (R1-EXT-B1-01): when user did not provide an explicit body, model-fabricated body must not be kept
      expect(issueStep?.args.body).toBeUndefined();
    }
  });

  it('4b (R1-EXT-B1-01). Turn 2 branch "report_content": binds verified report text to BOTH notification and work-item steps and validates work-item hash', async () => {
    const store = new ReportArtifactStore();
    const planner = new AIPlanner({
      toolCatalog: FULL_TEST_TOOLS,
      serviceRegistry: FULL_TEST_SERVICES,
      searchMode: 'llm',
      prefetchDirectory: false,
      reportEvidenceStore: store,
      gatherSearch: async ({ tool }) => {
        if (tool === 'mysheets.search_rows') {
          return {
            sheet: 'Orders',
            headers: ['OrderID', 'Status'],
            totalMatched: 1,
            matches: [
              {
                rowNumber: 3,
                values: ['ORD-777', 'overdue'],
                record: { OrderID: 'ORD-777', Status: 'overdue' },
              },
            ],
          };
        }
        return [];
      },
      provider: {
        name: 'mock',
        model: 'mock',
        generatePlan: async () =>
          JSON.stringify({
            kind: 'plan',
            thinking: 'Tìm dòng overdue, gửi báo cáo Slack và tạo issue GitHub chứa báo cáo',
            summary: 'Báo cáo đơn quá hạn vào Slack #dev và tạo issue GitHub',
            warnings: [],
            steps: [
              {
                id: 's_search',
                tool: 'mysheets.search_rows',
                description: 'Tìm dòng overdue',
                args: {
                  spreadsheetId: PERSONAL_SPREADSHEET_ID,
                  sheet: 'Orders',
                  query: 'overdue',
                },
                dependsOn: [],
              },
              {
                id: 's_slack',
                tool: 'slack.send_message',
                description: 'Gửi báo cáo vào Slack #dev',
                args: {
                  channel: 'C_DEV',
                  text: 'Unverified slack text #999',
                },
                dependsOn: ['s_search'],
              },
              {
                id: 's_issue',
                tool: 'github.create_issue',
                description: 'Tạo issue GitHub',
                args: {
                  repo: 'acme/web',
                  title: 'Cảnh báo đơn quá hạn',
                  body: 'Unverified issue body #999',
                },
                dependsOn: ['s_search'],
              },
            ],
          }),
      },
    });

    const memory = new WorkingMemory();
    memory.setEntity('workflow_resource_defaults', {
      mysheets: { spreadsheetId: PERSONAL_SPREADSHEET_ID, sheetName: 'Orders' },
      slack: { channelId: 'C_DEV', channelName: 'dev' },
      github: { repo: 'acme/web' },
    });
    memory.setEntity('mysheet', { id: 0, title: 'Orders', spreadsheetId: PERSONAL_SPREADSHEET_ID });

    const turn1UserMessage =
      'Tổng hợp báo cáo các dòng overdue trong bảng tính Orders gửi vào kênh Slack dev và tạo issue GitHub trên acme/web';

    const turn1Response = await planner.processMessage({
      userMessage: turn1UserMessage,
      memory,
      actor: { userId: 'user_1', workspaceId: 'ws_1' },
    });
    expect(turn1Response.kind).toBe('clarification');
    if (turn1Response.kind === 'clarification') {
      expect(turn1Response.options).toEqual([
        'Dùng báo cáo dữ liệu làm nội dung công việc mới',
        'Dùng nội dung riêng cho công việc mới',
      ]);
    }

    const turn2Reply = 'Dùng báo cáo dữ liệu làm nội dung công việc mới';
    const turn2Response = await planner.processMessage({
      userMessage: turn2Reply,
      history: [
        { role: 'user', content: turn1UserMessage },
        {
          role: 'assistant',
          content:
            turn1Response.kind === 'clarification'
              ? turn1Response.question
              : 'Bạn muốn nội dung công việc mới là báo cáo dữ liệu hay một nội dung riêng?',
        },
      ],
      memory,
      actor: { userId: 'user_1', workspaceId: 'ws_1' },
    });

    expect(turn2Response.kind).toBe('plan');
    if (turn2Response.kind === 'plan') {
      const slackStep = turn2Response.steps.find((s) => s.id === 's_slack');
      const issueStep = turn2Response.steps.find((s) => s.id === 's_issue');
      expect(slackStep?.args.text).toContain('ORD-777');
      expect(issueStep?.args.body).toContain('ORD-777');
      expect(issueStep?.args.body).not.toContain('#999');
      expect(issueStep?.args.body).toBe(slackStep?.args.text);

      // Tampering with the issue body when bound to report_content must fail validateReportEvidenceBinding
      const artifact = store.getArtifact(turn2Response.reportEvidence!.artifactId)!;
      const tamperedIssuePlan: PlanResponse = {
        ...turn2Response,
        steps: turn2Response.steps.map((s) =>
          s.id === 's_issue' ? { ...s, args: { ...s.args, body: 'Tampered unverified issue body #999' } } : s,
        ),
      };
      const guardResult = await validateReportEvidenceBinding(tamperedIssuePlan, {
        userId: 'user_1',
        workspaceId: 'ws_1',
        observedArtifact: {
          id: artifact.id,
          ownerUserId: artifact.actorUserId,
          workspaceId: artifact.workspaceId,
          contentHash: artifact.contentHash,
        },
        enforceReportGrounding: true,
        requestTexts: [turn1UserMessage, turn2Reply],
      });
      expect(guardResult.valid).toBe(false);
    }
  });

  it('4c (R1-EXT-B1-01). Turn 2 invalid clarification reply re-prompts clarification instead of guessing a branch', async () => {
    const store = new ReportArtifactStore();
    const planner = new AIPlanner({
      toolCatalog: FULL_TEST_TOOLS,
      serviceRegistry: FULL_TEST_SERVICES,
      searchMode: 'llm',
      prefetchDirectory: false,
      reportEvidenceStore: store,
      gatherSearch: async () => ({
        sheet: 'Orders',
        headers: ['OrderID', 'Status'],
        totalMatched: 1,
        matches: [{ rowNumber: 2, values: ['ORD-1', 'overdue'], record: { OrderID: 'ORD-1', Status: 'overdue' } }],
      }),
      provider: {
        name: 'mock',
        model: 'mock',
        generatePlan: async () =>
          JSON.stringify({
            kind: 'plan',
            thinking: 'Report and create issue',
            summary: 'Report and create issue',
            warnings: [],
            steps: [
              {
                id: 's_search',
                tool: 'mysheets.search_rows',
                description: 'Search overdue',
                args: { spreadsheetId: PERSONAL_SPREADSHEET_ID, sheet: 'Orders', query: 'overdue' },
                dependsOn: [],
              },
              {
                id: 's_slack',
                tool: 'slack.send_message',
                description: 'Notify Slack',
                args: { channel: 'C_DEV', text: 'Placeholder' },
                dependsOn: ['s_search'],
              },
              {
                id: 's_issue',
                tool: 'github.create_issue',
                description: 'Create GitHub issue',
                args: { repo: 'acme/web', title: 'Overdue alert', body: 'Hallucinated body' },
                dependsOn: ['s_search'],
              },
            ],
          }),
      },
    });

    const memory = new WorkingMemory();
    memory.setEntity('workflow_resource_defaults', {
      mysheets: { spreadsheetId: PERSONAL_SPREADSHEET_ID, sheetName: 'Orders' },
      slack: { channelId: 'C_DEV', channelName: 'dev' },
      github: { repo: 'acme/web' },
    });
    memory.setEntity('mysheet', { id: 0, title: 'Orders', spreadsheetId: PERSONAL_SPREADSHEET_ID });

    const turn1UserMessage =
      'Tổng hợp báo cáo các dòng overdue trong bảng tính Orders gửi vào kênh Slack dev và tạo issue GitHub trên acme/web';
    const turn1Response = await planner.processMessage({
      userMessage: turn1UserMessage,
      memory,
      actor: { userId: 'user_1', workspaceId: 'ws_1' },
    });
    expect(turn1Response.kind).toBe('clarification');

    // Invalid/ambiguous reply that chooses neither option
    const turn2Invalid = await planner.processMessage({
      userMessage: 'ok sao cũng được bạn ơi',
      history: [
        { role: 'user', content: turn1UserMessage },
        {
          role: 'assistant',
          content: turn1Response.kind === 'clarification' ? turn1Response.question : '',
        },
      ],
      memory,
      actor: { userId: 'user_1', workspaceId: 'ws_1' },
    });
    expect(turn2Invalid.kind).toBe('clarification');
    if (turn2Invalid.kind === 'clarification') {
      expect(turn2Invalid.options).toEqual([
        'Dùng báo cáo dữ liệu làm nội dung công việc mới',
        'Dùng nội dung riêng cho công việc mới',
      ]);
    }
  });

  it('7. does not weaken recipient/target allowlist or validateReportEvidenceBinding when notification text is tampered or target is ungrounded', async () => {
    const store = new ReportArtifactStore();
    const artifact = store.createArtifact({
      kind: 'sheets_summary',
      sourceTool: 'mysheets.search_rows',
      sourceLabel: 'Orders',
      items: [{ OrderID: 'ORD-501', Status: 'overdue' }],
      renderedText: 'Báo cáo bảng tính (Orders): 1 dòng dữ liệu.\n- OrderID: ORD-501 | Status: overdue',
      actor: { userId: 'user_1', workspaceId: 'ws_1' },
    });

    const userPrompt =
      'Tìm các dòng overdue trong bảng tính Orders rồi gửi báo cáo tổng hợp vào kênh Slack dev, đồng thời tạo issue GitHub trên acme/web với tiêu đề "Rà soát công nợ Q4" và nội dung "Kiểm tra các đơn hàng quá hạn"';

    const tamperedPlan: PlanResponse = {
      kind: 'plan',
      thinking: 'Tampered notification text',
      summary: 'Tampered report plan',
      warnings: [],
      steps: [
        {
          id: 's_slack',
          tool: 'slack.send_message',
          description: 'Gửi báo cáo Slack',
          args: {
            channel: 'C_DEV',
            text: 'Tampered text with invented numbers #999',
          },
          dependsOn: [],
        },
        {
          id: 's_issue',
          tool: 'github.create_issue',
          description: 'Tạo issue GitHub',
          args: {
            repo: 'acme/web',
            title: 'Rà soát công nợ Q4',
            body: 'Kiểm tra các đơn hàng quá hạn',
          },
          dependsOn: [],
        },
      ],
      reportEvidence: {
        artifactId: artifact.id,
        kind: 'sheets_summary',
        stepId: 's_slack',
        argument: 'text',
        sourceTool: 'mysheets.search_rows',
        sourceLabel: 'Orders',
        readAt: artifact.createdAt,
        itemCount: 1,
        coverage: 'complete',
        contentHash: artifact.contentHash,
      },
    };

    const guardResult = await validateReportEvidenceBinding(tamperedPlan, {
      userId: 'user_1',
      workspaceId: 'ws_1',
      observedArtifact: {
        id: artifact.id,
        ownerUserId: artifact.actorUserId,
        workspaceId: artifact.workspaceId,
        contentHash: artifact.contentHash,
      },
      enforceReportGrounding: true,
      requestTexts: [userPrompt],
    });
    expect(guardResult.valid).toBe(false);
    expect(guardResult.error).toMatch(/hash does not match|Unverified report content/i);

    // Also verify ungrounded recipient/channel is rejected by validatePlan
    const ungroundedChannelPlan: PlanResponse = {
      ...tamperedPlan,
      steps: [
        {
          id: 's_slack',
          tool: 'slack.send_message',
          description: 'Gửi báo cáo Slack',
          args: {
            channel: 'C_UNAUTHORIZED_EXTERNAL',
            text: artifact.renderedText,
          },
          dependsOn: [],
        },
        tamperedPlan.steps[1],
      ],
    };

    const validation = validatePlan(JSON.stringify(ungroundedChannelPlan), FULL_TEST_TOOLS, {
      grounding: {
        memory: {
          channel: { id: 'C_DEV', name: 'dev' },
          repository: { id: 'acme/web', fullName: 'acme/web', name: 'web' },
        },
        userTexts: [userPrompt],
      },
      reportEvidenceStore: store,
    });
    expect(validation.valid).toBe(false);
    if (!validation.valid) {
      expect(validation.layer).toBe('grounding');
    }
  });

  describe('R1-EXT-B1-02: renderSheetSummaryReport coverage and aggregation denominators', () => {
    it('8a. distinguishes totalMatched=80 from matches.length=20 and displayed=10, setting coverage="partial"', () => {
      const matches = Array.from({ length: 20 }, (_, i) => {
        const id = `ORD-${String(i + 1).padStart(3, '0')}`;
        return {
          rowNumber: i + 2,
          values: [id, 'overdue'],
          record: { OrderID: id, Status: 'overdue' },
        };
      });

      const report = renderSheetSummaryReport(
        {
          headers: ['OrderID', 'Status'],
          totalMatched: 80,
          matches,
        },
        { sheetName: 'Orders' },
      );

      expect(report.coverage).toBe('partial');
      expect(report.itemCount).toBe(80);
      expect(report.text).toContain('80');
      expect(report.text).toContain('20');
      expect(report.text).toContain('10');
      expect(report.text).toContain('ORD-001');
      expect(report.text).toContain('ORD-010');
      expect(report.text).not.toContain('ORD-011');
      expect(report.text).not.toContain('ORD-020');
    });

    it('8b. marks coverage="partial" when 20 matches are returned (totalMatched=20) but only 10 rows are rendered', () => {
      const matches = Array.from({ length: 20 }, (_, i) => {
        const id = `ORD-${String(i + 1).padStart(3, '0')}`;
        return {
          rowNumber: i + 2,
          values: [id, 'pending'],
          record: { OrderID: id, Status: 'pending' },
        };
      });

      const report = renderSheetSummaryReport(
        {
          headers: ['OrderID', 'Status'],
          totalMatched: 20,
          matches,
        },
        { sheetName: 'Orders' },
      );

      expect(report.coverage).toBe('partial');
      expect(report.itemCount).toBe(20);
      expect(report.text).toContain('ORD-001');
      expect(report.text).toContain('ORD-010');
      expect(report.text).not.toContain('ORD-011');
      expect(report.text).toMatch(/10.*dòng đầu tiên|hiển thị 10/i);
    });

    it('8c. uses matchedRows=40 (not totalRowsScanned=500) as denominator for aggregate_rows group percentages and does not invent metrics', () => {
      const report = renderSheetSummaryReport(
        {
          totalRowsScanned: 500,
          matchedRows: 40,
          groups: [
            { key: 'overdue', count: 30 },
            { key: 'paid', count: 10 },
          ],
        },
        { sheetName: 'Orders' },
      );

      expect(report.itemCount).toBe(40);
      expect(report.coverage).toBe('complete');
      expect(report.text).toContain('500');
      expect(report.text).toContain('40');
      // 30 / 40 = 75%, 10 / 40 = 25% (must NOT be 30/500 = 6% or 10/500 = 2%)
      expect(report.text).toContain('overdue: 30 (75%)');
      expect(report.text).toContain('paid: 10 (25%)');
      expect(report.text).not.toContain('(6%)');
      expect(report.text).not.toContain('(2%)');
      expect(report.text).not.toMatch(/sum|avg|min|max|Tổng\s+[A-Za-z_]+:/i);
    });

    it('8d. fails closed on inconsistent counts and marks partial coverage when group counts are a subset of matchedRows', () => {
      // totalMatched < matches.length -> fail-closed
      expect(() =>
        renderSheetSummaryReport({
          headers: ['OrderID'],
          totalMatched: 5,
          matches: Array.from({ length: 10 }, (_, i) => ({
            rowNumber: i + 2,
            values: [`ORD-${i}`],
            record: { OrderID: `ORD-${i}` },
          })),
        }),
      ).toThrow(/inconsistent|totalMatched/i);

      // totalMatched > 0 but matches is empty -> fail-closed
      expect(() =>
        renderSheetSummaryReport({
          headers: ['OrderID'],
          totalMatched: 10,
          matches: [],
        }),
      ).toThrow(/inconsistent|empty|matches/i);

      // matchedRows > totalRowsScanned -> fail-closed
      expect(() =>
        renderSheetSummaryReport({
          totalRowsScanned: 10,
          matchedRows: 40,
          groups: [{ key: 'overdue', count: 40 }],
        }),
      ).toThrow(/inconsistent|matchedRows/i);

      // sum(group.count) > matchedRows -> fail-closed
      expect(() =>
        renderSheetSummaryReport({
          totalRowsScanned: 100,
          matchedRows: 20,
          groups: [
            { key: 'overdue', count: 15 },
            { key: 'paid', count: 15 },
          ],
        }),
      ).toThrow(/inconsistent|groups|matchedRows/i);

      // sum(group.count) < matchedRows -> partial coverage explicitly marked
      const partialAgg = renderSheetSummaryReport({
        totalRowsScanned: 500,
        matchedRows: 40,
        groups: [{ key: 'overdue', count: 25 }],
      });
      expect(partialAgg.coverage).toBe('partial');
      expect(partialAgg.itemCount).toBe(40);
    });
  });
});
