import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AIPlanner,
  MockLLMProvider,
  ReportArtifactStore,
  routeIntent,
  validatePlan,
  WorkingMemory,
} from '@wap/planner';
import {
  ALL_TOOLS,
  GITHUB_OAUTH_TOOLS,
  TRELLO_OAUTH_TOOLS,
  NOTION_OAUTH_TOOLS,
  TELEGRAM_OAUTH_TOOLS,
  GMAIL_TOOLS,
  MYCALENDAR_TOOLS,
  MYSHEETS_TOOLS,
  MYJIRA_TOOLS,
  GMAIL_SERVICE,
  MYCALENDAR_SERVICE,
  MYSHEETS_SERVICE,
  MYJIRA_SERVICE,
  SERVICE_REGISTRY,
  type PlanResponse,
} from '@wap/tool-schemas';
import {
  renderGithubIssueAgingReport,
  renderGithubPrsReport,
  renderJiraProgressReport,
  renderSheetSummaryReport,
} from '../../packages/planner/src/reports/renderers.js';
import { validateReportEvidenceBinding } from '../../apps/chat-api/src/services/report-evidence-guard.js';
import { fixtureSearch } from '../golden-v2/fixtures.js';
import { LIVE_SERVICES, checkLiveService } from '../live-execution/live-services.js';
import { readLiveConfig } from '../live-execution/harness.js';

// This suite verifies fixture-based planner composition, not native workflow acceptance.
// Preflight is a separate opt-in diagnostic; normal tests never load live credentials.

const CASES_PATH = resolve(__dirname, '../current-flows/cases.json');
const testTools = [
  ...ALL_TOOLS.filter((t) => !['calendar', 'sheets', 'jira'].includes(t.service)),
  ...GITHUB_OAUTH_TOOLS,
  ...TRELLO_OAUTH_TOOLS,
  ...NOTION_OAUTH_TOOLS,
  ...TELEGRAM_OAUTH_TOOLS,
  ...GMAIL_TOOLS,
  ...MYCALENDAR_TOOLS,
  ...MYSHEETS_TOOLS,
  ...MYJIRA_TOOLS,
];
const allCatalogTools = [
  ...ALL_TOOLS,
  ...GITHUB_OAUTH_TOOLS,
  ...TRELLO_OAUTH_TOOLS,
  ...NOTION_OAUTH_TOOLS,
  ...TELEGRAM_OAUTH_TOOLS,
  ...GMAIL_TOOLS,
  ...MYCALENDAR_TOOLS,
  ...MYSHEETS_TOOLS,
  ...MYJIRA_TOOLS,
];

describe('FLOW-07: Offline composition and simulated planner context (not live certification)', () => {
  describe('Optional preflight diagnostic (does not certify workflow execution)', () => {
    it.skipIf(process.env.ATI_FLOW_PREFLIGHT !== '1')('probes read-only reachability across all registered connectors and identifies blockers without shared fallbacks', async () => {
      const config = readLiveConfig(process.env);
      const results: Record<string, { status: 'OK' | 'BLOCKED' | 'NOT_RUN'; detail: string }> = {};

      for (const def of LIVE_SERVICES) {
        if (config.skipped[def.id]) {
          results[def.id] = { status: 'NOT_RUN', detail: config.skipped[def.id] };
          continue;
        }

        try {
          const adapter = def.createAdapter(config.services[def.id]);
          const count = await checkLiveService(def.id, adapter);
          results[def.id] = { status: 'OK', detail: `${count} allowlisted resources reachable` };
        } catch (err: any) {
          results[def.id] = { status: 'BLOCKED', detail: err?.message || String(err) };
        }
      }

      if (Object.keys(config.services).length > 0) {
        // Assert that healthy configured live services are verified
        if (config.services['slack']) expect(results['slack']?.status).toBe('OK');
        if (config.services['github']) expect(results['github']?.status).toBe('OK');
        if (config.services['calendar']) expect(results['calendar']?.status).toBe('OK');
        if (config.services['sheets']) expect(results['sheets']?.status).toBe('OK');
        if (config.services['jira']) expect(results['jira']?.status).toBe('OK');
        if (config.services['telegram']) expect(results['telegram']?.status).toBe('OK');

        // Assert that failing services are explicitly marked as named blockers and NOT masked
        if (config.services['notion']) {
          expect(['OK', 'BLOCKED']).toContain(results['notion']?.status);
          expect(results['notion']?.detail).toBeTruthy();
        }
      } else {
        // In CI sandbox without live .env credentials, unconfigured connectors must remain NOT_RUN (never faked as OK)
        for (const def of LIVE_SERVICES) {
          expect(results[def.id]?.status).toBe('NOT_RUN');
          expect(results[def.id]?.detail).toBeTruthy();
        }
      }
    }, 30000);
  });

  describe('Dataset shape and router smoke checks (runtime oracle NOT_RUN)', () => {
    const data = JSON.parse(readFileSync(CASES_PATH, 'utf8'));
    const cases = data.cases as Array<{
      id: string;
      jobId: string;
      variant: 'explicit' | 'natural' | 'underspecified';
      prompt: string;
      services: string[];
      expectedKind: 'plan' | 'clarification' | 'refusal';
      expectedTools?: string[];
      expectedClarificationTopics?: string[];
      reasoning?: string;
    }>;

    it('contains all 36 test cases across 12 jobs and 3 variants', () => {
      expect(cases).toHaveLength(36);
      const variants = new Set(cases.map((c) => c.variant));
      expect(variants).toEqual(new Set(['explicit', 'natural', 'underspecified']));
    });

    it.each(cases)('checks dataset metadata and catalog for $id ($jobId - $variant), not runtime output', (c) => {
      const fullRegistry = [
        ...SERVICE_REGISTRY,
        GMAIL_SERVICE,
        MYCALENDAR_SERVICE,
        MYSHEETS_SERVICE,
        MYJIRA_SERVICE,
      ];
      const routed = routeIntent(c.prompt, allCatalogTools, fullRegistry);
      expect(routed.services.length).toBeGreaterThan(0);

      if (c.expectedKind === 'plan') {
        expect(c.expectedTools).toBeDefined();
        expect(c.expectedTools!.length).toBeGreaterThan(0);
        // Ensure all tools are defined in tool catalogs
        for (const tool of c.expectedTools!) {
          const found = allCatalogTools.find((t) => t.name === tool);
          expect(found, `Tool ${tool} must exist in catalog`).toBeDefined();
        }
      } else if (c.expectedKind === 'clarification') {
        expect(c.expectedClarificationTopics).toBeDefined();
        expect(c.expectedClarificationTopics!.length).toBeGreaterThan(0);
      } else if (c.expectedKind === 'refusal') {
        expect(c.reasoning).toBeDefined();
      }
    });
  });

  describe('6 Core Workflows × 3 offline planner runs with controlled model responses', () => {
    const fullRegistry = [
      ...SERVICE_REGISTRY,
      GMAIL_SERVICE,
      MYCALENDAR_SERVICE,
      MYSHEETS_SERVICE,
      MYJIRA_SERVICE,
    ];
    const workflows = [
      { id: 'OFF-02', name: 'Google Meet + Docs + Gmail', kind: 'standard' },
      { id: 'OFF-03', name: 'Google Sheets Summary + Slack', kind: 'sheets_summary' },
      { id: 'PM-01', name: 'Trello Card + Due + Member + Slack', kind: 'standard' },
      { id: 'PM-03', name: 'Jira Sprint Progress + Slack', kind: 'jira_progress' },
      { id: 'DEV-02', name: 'GitHub PRs Review + Slack', kind: 'github_prs' },
      { id: 'DEV-04', name: 'GitHub Issue Aging + Slack', kind: 'github_issues' },
    ];

    workflows.forEach((wf) => {
      describe(`Workflow ${wf.id}: ${wf.name}`, () => {
        for (let run = 1; run <= 3; run++) {
          it(`Run ${run}/3: executes AIPlanner.processMessage + fixtureSearch + ReportArtifactStore + validateReportEvidenceBinding`, async () => {
            const provider = new MockLLMProvider();
            const reportEvidenceStore = new ReportArtifactStore();
            const memory = new WorkingMemory();
            memory.setEntity('workflow_resource_defaults', {
              github: { repo: 'acme/web' },
              slack: { channelId: 'C_FE' },
              trello: { boardId: 'board_fe', listId: 'list_fe_todo' },
              myjira: { siteId: 'acme-site', projectKey: 'WEB' },
              mycalendar: { calendarId: 'owner@example.test' },
              mysheets: { spreadsheetId: 'spreadsheet_sales_q4', folderId: 'folder_drive_789' },
            });
            memory.setEntity('member', { id: 'member_minh', name: 'Minh', boardId: 'board_fe' });

            let userMessage = '';
            if (wf.id === 'OFF-02') {
              userMessage = `Tạo lịch họp Google Meet lúc 9h ngày mai với lan@example.com, tạo Google Docs biên bản và gửi Gmail lần ${run}`;
              provider.setPlanResponses([
                {
                  kind: 'plan',
                  thinking: `Lập kế hoạch tạo Google Meet, Docs và gửi email mời người tham dự lần ${run}`,
                  summary: `Tạo lịch họp, Docs và gửi email lần ${run}`,
                  warnings: [],
                  steps: [
                    {
                      id: 's_meet',
                      tool: 'mycalendar.schedule_meet',
                      description: 'Tạo liên kết Google Meet cho cuộc họp',
                      dependsOn: [],
                      args: {
                        calendarId: 'owner@example.test',
                        summary: `Họp lập kế hoạch dự án ${run}`,
                        start: '2026-11-05T09:00:00+07:00',
                        end: '2026-11-05T10:00:00+07:00',
                        attendees: ['lan@example.com'],
                      },
                    },
                    {
                      id: 's_doc',
                      tool: 'mysheets.create_doc',
                      description: 'Tạo tài liệu Google Docs biên bản',
                      dependsOn: [],
                      args: {
                        title: `Biên bản cuộc họp ${run}`,
                        content: '1. Thống nhất mục tiêu\n2. Phân công đầu việc',
                        folderId: 'folder_drive_789',
                      },
                    },
                    {
                      id: 's_mail',
                      tool: 'gmail.send_message',
                      description: 'Gửi thư mời và link tài liệu qua Gmail',
                      dependsOn: ['s_meet', 's_doc'],
                      args: {
                        to: ['lan@example.com'],
                        subject: `Biên bản và Link họp ${run}`,
                        body: 'Chào Lan, link họp là $step_1.output.meetLink và tài liệu tại $step_2.output.url',
                      },
                    },
                  ],
                },
              ]);
            } else if (wf.id === 'OFF-03') {
              userMessage = `Đọc bảng tính Báo cáo doanh số Q4 từ Google Sheets và gửi báo cáo tổng hợp lên Slack #frontend lần ${run}`;
              provider.setPlanResponses([
                {
                  kind: 'plan',
                  thinking: `Tổng hợp số liệu từ Google Sheets và tạo báo cáo lên Slack lần ${run}`,
                  summary: `Báo cáo tổng hợp bảng tính Google Sheets lên Slack lần ${run}`,
                  warnings: [],
                  steps: [
                    {
                      id: 's_read',
                      tool: 'mysheets.read_range',
                      description: 'Đọc dữ liệu bảng tính Google Sheets',
                      dependsOn: [],
                      args: {
                        spreadsheetId: 'spreadsheet_sales_q4',
                        range: 'Sheet1!A1:B4',
                        headerAware: true,
                      },
                    },
                    {
                      id: 's_slack',
                      tool: 'slack.send_message',
                      description: 'Gửi báo cáo tóm tắt số liệu lên kênh Slack',
                      dependsOn: ['s_read'],
                      args: {
                        channel: 'C_FE',
                        text: 'Placeholder sẽ được ghi đè bởi renderer thực tế',
                      },
                    },
                  ],
                },
              ]);
            } else if (wf.id === 'PM-01') {
              userMessage = `Tạo thẻ việc Trello trên bảng Frontend danh sách To Do giao cho Minh kèm hạn chót và báo lên kênh Slack #frontend lần ${run}`;
              provider.setPlanResponses([
                {
                  kind: 'plan',
                  thinking: `Tạo thẻ việc Trello giao cho Minh kèm hạn chót và thông báo Slack lần ${run}`,
                  summary: `Tạo thẻ Trello và báo Slack lần ${run}`,
                  warnings: [],
                  steps: [
                    {
                      id: 's_card',
                      tool: 'trello.create_card',
                      description: 'Tạo thẻ việc trên Trello với hạn chót và gán thành viên',
                      dependsOn: [],
                      args: {
                        listId: 'list_fe_todo',
                        title: `Task giao Minh lần ${run}`,
                        due: '2026-11-06T17:00:00+07:00',
                        idMembers: ['member_minh'],
                      },
                    },
                    {
                      id: 's_notify',
                      tool: 'slack.send_message',
                      description: 'Gửi thông báo giao việc vào kênh Slack',
                      dependsOn: ['s_card'],
                      args: {
                        channel: 'C_FE',
                        text: 'Đã giao thẻ cho Minh: $step_1.output.url, hạn: 2026-11-06 17:00',
                      },
                    },
                  ],
                },
              ]);
            } else if (wf.id === 'PM-03') {
              userMessage = `Tra cứu tiến độ Jira dự án WEB trên Acme Jira và gửi báo cáo tổng hợp lên Slack #frontend lần ${run}`;
              provider.setPlanResponses([
                {
                  kind: 'plan',
                  thinking: `Tra cứu danh sách issue Jira và tạo báo cáo tiến độ lần ${run}`,
                  summary: `Báo cáo tiến độ Jira dự án WEB lên Slack lần ${run}`,
                  warnings: [],
                  steps: [
                    {
                      id: 's_jira',
                      tool: 'myjira.search_issues',
                      description: 'Tìm kiếm danh sách issue của dự án WEB',
                      dependsOn: [],
                      args: {
                        siteId: 'acme-site',
                        projectKey: 'WEB',
                        query: 'WEB',
                      },
                    },
                    {
                      id: 's_slack',
                      tool: 'slack.send_message',
                      description: 'Gửi báo cáo tiến độ Jira vào kênh Slack',
                      dependsOn: ['s_jira'],
                      args: {
                        channel: 'C_FE',
                        text: 'Placeholder báo cáo tiến độ Jira',
                      },
                    },
                  ],
                },
              ]);
            } else if (wf.id === 'DEV-02') {
              userMessage = `Lấy danh sách Pull Request đang mở trên repo acme/web và gửi báo cáo tổng hợp lên Slack #frontend lần ${run}`;
              provider.setPlanResponses([
                {
                  kind: 'plan',
                  thinking: `Lấy danh sách PR đang mở trên GitHub và tạo báo cáo nhắc review lần ${run}`,
                  summary: `Báo cáo tổng hợp PR GitHub acme/web lên Slack lần ${run}`,
                  warnings: [],
                  steps: [
                    {
                      id: 's_prs',
                      tool: 'github.list_pull_requests',
                      description: 'Lấy danh sách PR đang mở trên acme/web',
                      dependsOn: [],
                      args: { repo: 'acme/web', state: 'open' },
                    },
                    {
                      id: 's_slack',
                      tool: 'slack.send_message',
                      description: 'Gửi báo cáo tổng hợp PR lên kênh Slack',
                      dependsOn: ['s_prs'],
                      args: {
                        channel: 'C_FE',
                        text: 'Placeholder PR #999 tự bịa sẽ bị ghi đè',
                      },
                    },
                  ],
                },
              ]);
            } else {
              userMessage = `Tìm các issue GitHub tồn đọng trên repo acme/web và gửi báo cáo tổng hợp lên Slack #frontend lần ${run}`;
              provider.setPlanResponses([
                {
                  kind: 'plan',
                  thinking: `Tìm kiếm các issue GitHub tồn đọng lâu ngày và tạo báo cáo cảnh báo lần ${run}`,
                  summary: `Báo cáo tổng hợp issue tồn đọng GitHub acme/web lên Slack lần ${run}`,
                  warnings: [],
                  steps: [
                    {
                      id: 's_issues',
                      tool: 'github.list_issues',
                      description: 'Tìm kiếm các issue mở trên acme/web',
                      dependsOn: [],
                      args: { repo: 'acme/web', state: 'open' },
                    },
                    {
                      id: 's_slack',
                      tool: 'slack.send_message',
                      description: 'Gửi báo cáo phân tích issue tồn đọng lên Slack',
                      dependsOn: ['s_issues'],
                      args: {
                        channel: 'C_FE',
                        text: 'Placeholder issue #999 tự bịa sẽ bị ghi đè',
                      },
                    },
                  ],
                },
              ]);
            }

            const planner = new AIPlanner({
              provider,
              toolCatalog: testTools,
              gatherSearch: fixtureSearch,
              serviceRegistry: fullRegistry,
              reportEvidenceStore,
            });

            const res = await planner.processMessage({
              userMessage,
              memory,
              actor: { userId: `user_accept_${run}`, workspaceId: 'ws_accept' },
            });

            expect(res.kind).toBe('plan');
            if (res.kind !== 'plan') return;

            if (wf.kind !== 'standard') {
              expect(res.reportEvidence).toBeDefined();
              expect(res.reportEvidence?.kind).toBe(wf.kind);
              const art = reportEvidenceStore.getArtifact(res.reportEvidence!.artifactId);
              expect(art).toBeDefined();

              const guardCheck = await validateReportEvidenceBinding(res, {
                userId: `user_accept_${run}`,
                workspaceId: 'ws_accept',
                enforceReportGrounding: true,
                observedArtifact: {
                  id: art!.id,
                  ownerUserId: art!.actorUserId,
                  workspaceId: art!.workspaceId,
                  contentHash: art!.contentHash,
                },
              });
              expect(guardCheck.valid, guardCheck.error).toBe(true);
            }
          });
        }
      });
    });
  });

  describe('6 simulated persona context tests (not app history or real participants)', () => {
    const personas = [
      {
        id: 'persona_lan',
        name: 'Lan hành chính',
        role: 'Hành chính / Quản trị văn phòng',
        jobs: ['OFF-01', 'OFF-02'],
        turn1: {
          prompt: 'Tạo Google Meet lúc 9h ngày mai với Lan (lan@example.com) và tạo Google Docs biên bản',
          entities: { attendee_email: 'lan@example.com', folder_id: 'folder_lan_123' },
        },
        turn2: {
          prompt: 'Gửi link cuộc họp và tài liệu vừa tạo cho Lan qua Gmail nhé',
          reusedEntities: ['attendee_email'],
        },
      },
      {
        id: 'persona_hanh',
        name: 'Hạnh vận hành số liệu',
        role: 'Data Analyst / Vận hành dữ liệu',
        jobs: ['OFF-03', 'OFF-04'],
        turn1: {
          prompt: 'Đọc bảng tính Doanh số Q4 từ Google Sheets và tổng hợp doanh thu theo khu vực',
          entities: { spreadsheet_id: 'spreadsheet_sales_q4', channel_id: 'C_FE' },
        },
        turn2: {
          prompt: 'Gửi kết quả bảng tính đó lên kênh Slack #frontend',
          reusedEntities: ['spreadsheet_id', 'channel_id'],
        },
      },
      {
        id: 'persona_minh',
        name: 'Minh PM',
        role: 'Project Manager',
        jobs: ['PM-01', 'PM-03'],
        turn1: {
          prompt: 'Tạo thẻ Trello trên bảng Frontend danh sách To Do, giao cho Minh và đặt hạn thứ Sáu 17h',
          entities: { trello_list_id: 'list_fe_todo', member_id: 'member_minh', due_date: '2026-11-06T17:00:00' },
        },
        turn2: {
          prompt: 'Báo vào Slack #frontend rằng thẻ đó đã được giao kèm hạn chót',
          reusedEntities: ['trello_list_id', 'member_id'],
        },
      },
      {
        id: 'persona_an',
        name: 'An trực ca',
        role: 'On-call / Operations Specialist',
        jobs: ['PM-02', 'PM-04'],
        turn1: {
          prompt: 'Kiểm tra các issue Jira có độ ưu tiên High và Blocker của dự án WEB',
          entities: { jira_project: 'WEB', priority: 'High,Blocker' },
        },
        turn2: {
          prompt: 'Gửi danh sách blocker Jira vừa tìm được vào kênh #frontend',
          reusedEntities: ['jira_project'],
        },
      },
      {
        id: 'persona_quan',
        name: 'Quân dev mới',
        role: 'Junior Software Engineer',
        jobs: ['DEV-01', 'DEV-02'],
        turn1: {
          prompt: 'Lấy danh sách các pull request đang mở trên repo acme/web',
          entities: { github_repo: 'acme/web', pr_filter: 'open' },
        },
        turn2: {
          prompt: 'Tổng hợp các pull request đó và gửi thông báo nhắc review vào Slack #frontend',
          reusedEntities: ['github_repo'],
        },
      },
      {
        id: 'persona_dung',
        name: 'Dũng tech lead',
        role: 'Engineering Lead',
        jobs: ['DEV-03', 'DEV-04'],
        turn1: {
          prompt: 'Tìm các issue GitHub tồn đọng trên 14 ngày chưa được xử lý trên repo acme/web',
          entities: { github_repo: 'acme/web', aging_days: '14' },
        },
        turn2: {
          prompt: 'Gửi báo cáo phân tích issue tồn đọng đó vào kênh #frontend',
          reusedEntities: ['github_repo', 'aging_days'],
        },
      },
    ];

    it.each(personas)('simulates persona $name ($role) with continuous WorkingMemory across turns', async (persona) => {
      const memory = new WorkingMemory();
      memory.setEntity('workflow_resource_defaults', {
        github: { repo: 'acme/web' },
        slack: { channelId: 'C_FE' },
        trello: { boardId: 'board_fe', listId: 'list_fe_todo' },
        myjira: { siteId: 'acme-site', projectKey: 'WEB' },
        mycalendar: { calendarId: 'owner@example.test' },
        mysheets: { spreadsheetId: 'spreadsheet_sales_q4', folderId: 'folder_drive_789' },
      });

      // Turn 1: Ingest entities from user prompt
      for (const [key, value] of Object.entries(persona.turn1.entities)) {
        memory.setEntity(key, value);
      }

      const provider = new MockLLMProvider();
      const source = persona.id === 'persona_hanh'
        ? { tool: 'mysheets.read_range', args: { spreadsheetId: 'spreadsheet_sales_q4', range: 'Sheet1!A1:B4', headerAware: true } }
        : persona.id === 'persona_quan'
          ? { tool: 'github.list_pull_requests', args: { repo: 'acme/web', state: 'open' } }
          : persona.id === 'persona_an'
            ? { tool: 'myjira.search_issues', args: { siteId: 'acme-site', projectKey: 'WEB', query: 'WEB' } }
          : persona.id === 'persona_dung'
            ? { tool: 'github.list_issues', args: { repo: 'acme/web', state: 'open' } }
            : null;
      const sourceSteps = source ? [{ id: 'source', ...source, description: 'Read controlled fixture source', dependsOn: [] }] : [];
      provider.setPlanResponses([
        {
          kind: 'plan',
          thinking: `Xử lý yêu cầu lượt 1 cho ${persona.name}`,
          summary: `Kế hoạch lượt 1 cho ${persona.name}`,
          warnings: [],
          steps: [
            ...sourceSteps,
            {
              id: 's_turn1',
              tool: 'slack.send_message',
              description: 'Thông báo kết quả xử lý lượt 1',
              dependsOn: source ? ['source'] : [],
              args: { channel: 'C_FE', text: `Đã xử lý bước 1 cho ${persona.name}` },
            },
          ],
        },
        {
          kind: 'plan',
          thinking: `Xử lý yêu cầu lượt 2 cho ${persona.name} sử dụng WorkingMemory`,
          summary: `Kế hoạch lượt 2 cho ${persona.name}`,
          warnings: [],
          steps: [
            ...sourceSteps,
            {
              id: 's_turn2',
              tool: 'slack.send_message',
              description: 'Gửi kết quả lượt 2 dựa trên ngữ cảnh đã lưu',
              dependsOn: source ? ['source'] : [],
              args: { channel: 'C_FE', text: `Hoàn tất bước 2 cho ${persona.name}` },
            },
          ],
        },
      ]);

      const fullRegistry = [
        ...SERVICE_REGISTRY,
        GMAIL_SERVICE,
        MYCALENDAR_SERVICE,
        MYSHEETS_SERVICE,
        MYJIRA_SERVICE,
      ];
      const planner = new AIPlanner({
        provider,
        toolCatalog: testTools,
        gatherSearch: fixtureSearch,
        serviceRegistry: fullRegistry,
      });

      const t1Start = performance.now();
      const turn1Res = await planner.processMessage({
        userMessage: `${persona.turn1.prompt} và báo Slack #frontend`,
        memory,
        actor: { userId: persona.id, workspaceId: 'ws_persona' },
      });
      const turn1ElapsedMs = Math.max(1, Math.round(performance.now() - t1Start));
      expect(turn1Res.kind).toBe('plan');

      // Assert entities were remembered
      const turn1Snapshot = memory.toJSON();
      for (const [key, value] of Object.entries(persona.turn1.entities)) {
        expect(turn1Snapshot[key]).toBe(value);
      }

      const t2Start = performance.now();
      const turn2Res = await planner.processMessage({
        userMessage: `${persona.turn2.prompt} vào Slack #frontend`,
        memory,
        history: [
          { role: 'user', content: `${persona.turn1.prompt} và báo Slack #frontend` },
          { role: 'assistant', content: JSON.stringify(turn1Res) },
        ],
        actor: { userId: persona.id, workspaceId: 'ws_persona' },
      });
      const turn2ElapsedMs = Math.max(1, Math.round(performance.now() - t2Start));
      expect(turn2Res.kind).toBe('plan');

      // Turn 2: Follow-up request relies on existing memory entities
      for (const reusedKey of persona.turn2.reusedEntities) {
        const rememberedValue = memory.getEntity(reusedKey);
        expect(rememberedValue, `Entity ${reusedKey} must be preserved across turns for persona ${persona.name}`).toBeDefined();
      }

      // Simulated persona telemetry recorded
      const telemetry = {
        personaId: persona.id,
        personaName: persona.name,
        isSimulated: true, // Explicitly annotated per spec
        setupMs: 120,
        turn1ElapsedMs,
        turn2ElapsedMs,
        totalTokens: 1450,
        clarificationCount: 0,
        editsCount: 0,
      };

      expect(telemetry.isSimulated).toBe(true);
      expect(telemetry.turn2ElapsedMs).toBeLessThan(2000);
    });
  });
});
