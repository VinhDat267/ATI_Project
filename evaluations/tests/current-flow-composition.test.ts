import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ALL_TOOLS,
  GMAIL_TOOLS,
  MYCALENDAR_TOOLS,
  MYSHEETS_TOOLS,
  MYJIRA_TOOLS,
  type PlanResponse,
  type PlannerResponse,
} from '@wap/tool-schemas';

const PRODUCTION_CATALOG = [
  ...ALL_TOOLS,
  ...GMAIL_TOOLS,
  ...MYCALENDAR_TOOLS,
  ...MYSHEETS_TOOLS,
  ...MYJIRA_TOOLS,
];
import { validatePlan } from '@wap/planner';
import {
  renderGithubPrsReport,
  renderGithubIssueAgingReport,
  renderJiraProgressReport,
  renderSheetSummaryReport,
} from '@wap/planner';
import { ReportArtifactStore } from '@wap/planner';
import { WorkingMemory } from '@wap/planner';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('FLOW-05: Six Core Workflow Compositions & 36 Audit Regression Suite', () => {
  let casesData: any;
  let artifactStore: ReportArtifactStore;

  beforeEach(() => {
    artifactStore = new ReportArtifactStore();
    const casesPath = join(__dirname, '../current-flows/cases.json');
    casesData = JSON.parse(readFileSync(casesPath, 'utf8'));
  });

  describe('36 Regression Oracle Suite (cases.json)', () => {
    it('contains exactly 36 diverse cases across 12 jobs (3 per job)', () => {
      expect(casesData.totalCases).toBe(36);
      expect(casesData.cases.length).toBe(36);

      const jobCounts: Record<string, number> = {};
      for (const c of casesData.cases) {
        jobCounts[c.jobId] = (jobCounts[c.jobId] ?? 0) + 1;
        expect(['explicit', 'natural', 'underspecified']).toContain(c.variant);
        expect(c.prompt).toBeTruthy();
        expect(Array.isArray(c.services)).toBe(true);
        expect(['plan', 'clarification', 'refusal']).toContain(c.expectedKind);
      }

      // Exactly 12 jobs, each with 3 variants
      const jobIds = Object.keys(jobCounts);
      expect(jobIds.length).toBe(12);
      for (const jId of jobIds) {
        expect(jobCounts[jId]).toBe(3);
      }
    });

    it('covers all 6 prioritized production workflows with explicit plan requirements', () => {
      const coreJobIds = casesData.supportedCoreJobs;
      expect(coreJobIds).toEqual(['OFF-02', 'OFF-03', 'PM-01', 'PM-03', 'DEV-02', 'DEV-04']);

      for (const jId of coreJobIds) {
        const explicitCase = casesData.cases.find(
          (c: any) => c.jobId === jId && c.variant === 'explicit'
        );
        expect(explicitCase).toBeDefined();
        expect(explicitCase.expectedKind).toBe('plan');
        expect(Array.isArray(explicitCase.expectedTools)).toBe(true);
        expect(explicitCase.expectedTools.length).toBeGreaterThan(0);
      }
    });
  });

  describe('OFF-02: Calendar/Meet + Docs in target folder + Gmail notification', () => {
    it('composes schedule_meet, create_doc in target folder, and send_email with verified attendee', () => {
      const off02Plan: PlanResponse = {
        kind: 'plan',
        thinking: 'Tạo Google Meet, tạo Google Docs biên bản trong folder và gửi link qua Gmail',
        summary: 'Tạo lịch họp Google Meet và tài liệu Docs, gửi link tới lan@example.com',
        warnings: [],
        steps: [
          {
            id: 's_meet',
            tool: 'mycalendar.schedule_meet',
            description: 'Tạo cuộc họp Google Meet lúc 9h ngày mai',
            args: {
              calendarId: 'primary',
              summary: 'Khởi động dự án',
              start: '2026-11-05T09:00:00+07:00',
              end: '2026-11-05T10:00:00+07:00',
              attendees: ['lan@example.com'],
            },
            dependsOn: [],
          },
          {
            id: 's_doc',
            tool: 'mysheets.create_doc',
            description: 'Tạo tài liệu Google Docs biên bản họp trong thư mục đã chọn',
            args: {
              title: 'Biên bản & Đề xuất Khởi động dự án',
              folderId: 'folder_proj_123',
            },
            dependsOn: [],
          },
          {
            id: 's_mail',
            tool: 'gmail.send_message',
            description: 'Gửi email thông báo kèm link Meet và Docs',
            args: {
              to: ['lan@example.com'],
              subject: 'Thông tin cuộc họp & Biên bản khởi động dự án',
              body: {
                $template: 'Chào Lan,\nLink họp: ${s_meet.output.meetLink}\nLink tài liệu Docs: ${s_doc.output.url}',
              },
            },
            dependsOn: ['s_meet', 's_doc'],
          },
        ],
      };

      const result = validatePlan(JSON.stringify(off02Plan), PRODUCTION_CATALOG, {
        requireGroundedResources: false,
      });

      expect(result.valid).toBe(true);
      if (result.valid) {
        const parsed = result.parsed as PlanResponse;
        expect(parsed.steps.length).toBe(3);
        expect(parsed.steps[0].tool).toBe('mycalendar.schedule_meet');
        expect(parsed.steps[1].tool).toBe('mysheets.create_doc');
        expect(parsed.steps[2].tool).toBe('gmail.send_message');
      }
    });

    it('requires clarification when Lan email address or meeting time is missing', () => {
      const memory = new WorkingMemory();
      // Natural prompt without email
      const naturalCase = casesData.cases.find((c: any) => c.id === 'OFF-02-natural');
      expect(naturalCase.expectedKind).toBe('clarification');
      expect(naturalCase.expectedClarificationTopics).toContain('email Lan');
    });
  });

  describe('OFF-03: Google Sheets reading -> deterministic report -> Slack', () => {
    it('renders factual sheet_summary and binds verified reportEvidence', () => {
      const sheetData = {
        records: [
          { 'Tên việc': 'Viết API gateway', 'Trạng thái': 'Done' },
          { 'Tên việc': 'Tối ưu query DB', 'Trạng thái': 'Done' },
          { 'Tên việc': 'Audit bảo mật', 'Trạng thái': 'In Progress' },
          { 'Tên việc': 'Viết tài liệu', 'Trạng thái': 'To Do' },
        ],
      };

      const rendered = renderSheetSummaryReport(sheetData, {
        spreadsheetTitle: 'Frontend Tasks',
        sheetName: 'Tasks',
        groupBy: 'Trạng thái',
      });

      expect(rendered.itemCount).toBe(4);
      expect(rendered.text).toContain('Done: 2 (50%)');
      expect(rendered.text).toContain('In Progress: 1 (25%)');

      // Create artifact in store
      const artifact = artifactStore.createArtifact({
        kind: 'sheet_summary',
        sourceTool: 'mysheets.read_range',
        sourceLabel: 'Frontend Tasks!Tasks',
        items: sheetData.records,
        renderedText: rendered.text,
        actor: { userId: 'u_hanh', workspaceId: 'w_prod' },
      });

      const off03Plan: PlanResponse = {
        kind: 'plan',
        thinking: 'Đọc dữ liệu Google Sheets và gửi báo cáo số liệu vào Slack',
        summary: 'Báo cáo số liệu Google Sheets Frontend Tasks gửi Slack #general',
        warnings: [],
        steps: [
          {
            id: 's_post',
            tool: 'slack.send_message',
            description: 'Gửi báo cáo số liệu vào Slack',
            args: {
              channel: 'C_GENERAL',
              text: rendered.text,
            },
            dependsOn: [],
          },
        ],
        reportEvidence: {
          artifactId: artifact.id,
          kind: 'sheet_summary',
          stepId: 's_post',
          argument: 'text',
          sourceTool: 'mysheets.read_range',
          sourceLabel: 'Frontend Tasks!Tasks',
          readAt: artifact.createdAt,
          itemCount: rendered.itemCount,
          coverage: rendered.coverage,
          contentHash: artifact.contentHash,
        },
      };

      const result = validatePlan(JSON.stringify(off03Plan), ALL_TOOLS, {
        requireGroundedResources: false,
        reportEvidenceStore: artifactStore,
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('PM-01: Trello card + member assignment + due date + Slack', () => {
    it('creates Trello card with member assignment Minh and posts link to Slack', () => {
      const pm01Plan: PlanResponse = {
        kind: 'plan',
        thinking: 'Tạo thẻ Trello danh sách To Do gán Minh và báo Slack #frontend',
        summary: 'Tạo thẻ Trello Sửa lỗi đăng nhập gán Minh và thông báo Slack',
        warnings: [],
        steps: [
          {
            id: 's_card',
            tool: 'trello.create_card',
            description: 'Tạo thẻ Sửa lỗi đăng nhập trên bảng Trello Frontend',
            args: {
              listId: 'list_todo_1',
              title: 'Sửa lỗi đăng nhập',
              desc: 'Giao việc cho Minh',
              due: '2026-11-06T17:00:00+07:00',
              idMembers: ['member_minh_1'],
            },
            dependsOn: [],
          },
          {
            id: 's_slack',
            tool: 'slack.send_message',
            description: 'Thông báo việc đã tạo vào kênh Slack #frontend',
            args: {
              channel: 'C_FRONTEND',
              text: {
                $template: 'Đã tạo việc cho Minh: Sửa lỗi đăng nhập (Hạn: 06/11 17:00). Link: ${s_card.output.url}',
              },
            },
            dependsOn: ['s_card'],
          },
        ],
      };

      const result = validatePlan(JSON.stringify(pm01Plan), ALL_TOOLS, {
        requireGroundedResources: false,
      });

      expect(result.valid).toBe(true);
      if (result.valid) {
        const parsed = result.parsed as PlanResponse;
        expect(parsed.steps[0].tool).toBe('trello.create_card');
        expect(parsed.steps[0].args?.idMembers).toEqual(['member_minh_1']);
      }
    });
  });

  describe('PM-03: Jira Sprint progress summary to Slack', () => {
    it('renders Jira Sprint issues and enforces single-turn manual review note', () => {
      const issues = [
        { key: 'FE-101', title: 'Fix Google OAuth token refresh', status: 'Done' },
        { key: 'FE-102', title: 'Dark mode contrast audit', status: 'In Progress' },
        { key: 'FE-103', title: 'Sprint 24 burn-down report', status: 'To Do' },
      ];

      const rendered = renderJiraProgressReport(issues, {
        projectKey: 'FE',
        sprintName: 'Sprint 24',
      });

      expect(rendered.itemCount).toBe(3);
      expect(rendered.text).toContain('Duyệt từng lượt trước khi gửi - Manual Approval Required');

      const artifact = artifactStore.createArtifact({
        kind: 'jira_progress',
        sourceTool: 'myjira.search_issues',
        sourceLabel: 'Jira Site site_123 / FE',
        items: issues,
        renderedText: rendered.text,
        actor: { userId: 'u_minh', workspaceId: 'w_prod' },
      });

      const pm03Plan: PlanResponse = {
        kind: 'plan',
        thinking: 'Tổng hợp tiến độ Sprint Jira và gửi Slack',
        summary: 'Báo cáo tiến độ Sprint 24 Jira (FE) gửi Slack #general',
        warnings: [],
        steps: [
          {
            id: 's_slack',
            tool: 'slack.send_message',
            description: 'Gửi báo cáo tiến độ Jira vào Slack',
            args: {
              channel: 'C_GENERAL',
              text: rendered.text,
            },
            dependsOn: [],
          },
        ],
        reportEvidence: {
          artifactId: artifact.id,
          kind: 'jira_progress',
          stepId: 's_slack',
          argument: 'text',
          sourceTool: 'myjira.search_issues',
          sourceLabel: 'Jira Site site_123 / FE',
          readAt: artifact.createdAt,
          itemCount: rendered.itemCount,
          coverage: rendered.coverage,
          contentHash: artifact.contentHash,
        },
      };

      const result = validatePlan(JSON.stringify(pm03Plan), ALL_TOOLS, {
        requireGroundedResources: false,
        reportEvidenceStore: artifactStore,
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('DEV-02: GitHub open PRs grounded report to Slack', () => {
    it('renders open PRs report and verifies SHA-256 hash match against artifact', () => {
      const prs = [
        { number: 45, title: 'Upgrade Tailwind CSS v4', html_url: 'https://github.com/acme/web/pull/45' },
        { number: 46, title: 'Fix mobile responsiveness in RequestMoments', html_url: 'https://github.com/acme/web/pull/46' },
      ];

      const rendered = renderGithubPrsReport(prs, { repo: 'acme/web' });
      expect(rendered.itemCount).toBe(2);

      const artifact = artifactStore.createArtifact({
        kind: 'github_prs',
        sourceTool: 'github.list_pull_requests',
        sourceLabel: 'GitHub acme/web',
        items: prs,
        renderedText: rendered.text,
        actor: { userId: 'u_quan', workspaceId: 'w_prod' },
      });

      const dev02Plan: PlanResponse = {
        kind: 'plan',
        thinking: 'Liệt kê PR đang mở và gửi Slack #frontend',
        summary: 'Báo cáo 2 Pull Request đang mở trong acme/web gửi Slack',
        warnings: [],
        steps: [
          {
            id: 's_post',
            tool: 'slack.send_message',
            description: 'Gửi báo cáo PR vào Slack #frontend',
            args: {
              channel: 'C_FRONTEND',
              text: rendered.text,
            },
            dependsOn: [],
          },
        ],
        reportEvidence: {
          artifactId: artifact.id,
          kind: 'github_prs',
          stepId: 's_post',
          argument: 'text',
          sourceTool: 'github.list_pull_requests',
          sourceLabel: 'GitHub acme/web',
          readAt: artifact.createdAt,
          itemCount: rendered.itemCount,
          coverage: rendered.coverage,
          contentHash: artifact.contentHash,
        },
      };

      const result = validatePlan(JSON.stringify(dev02Plan), ALL_TOOLS, {
        requireGroundedResources: false,
        reportEvidenceStore: artifactStore,
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('DEV-04: GitHub issue aging report to Slack', () => {
    it('evaluates issue age against fixed clock reference and renders aging report', () => {
      const fixedClock = '2026-11-04T13:00:00.000Z';
      const issues = [
        {
          id: 'i1',
          number: 12,
          title: 'Webhook retry backoff logic error',
          url: 'https://github.com/acme/api/issues/12',
          repo: 'acme/api',
          createdAt: '2026-10-20T10:00:00.000Z', // 15 days ago (> 7)
        },
        {
          id: 'i2',
          number: 14,
          title: 'Add typing for payment webhook',
          url: 'https://github.com/acme/api/issues/14',
          repo: 'acme/api',
          createdAt: '2026-11-03T10:00:00.000Z', // 1 day ago (< 7)
        },
      ];

      const rendered = renderGithubIssueAgingReport(issues, {
        repo: 'acme/api',
        agingDays: 7,
        clock: fixedClock,
      });

      expect(rendered.itemCount).toBe(1); // Only #12
      expect(rendered.text).toContain('#12: Webhook retry backoff logic error');
      expect(rendered.text).toContain('15 ngày');

      const artifact = artifactStore.createArtifact({
        kind: 'github_issue_aging',
        sourceTool: 'github.list_issues',
        sourceLabel: 'GitHub acme/api',
        items: issues,
        renderedText: rendered.text,
        actor: { userId: 'u_dung', workspaceId: 'w_prod' },
      });

      const dev04Plan: PlanResponse = {
        kind: 'plan',
        thinking: 'Tổng hợp issue GitHub tồn đọng quá 7 ngày và gửi Slack',
        summary: 'Báo cáo issue tồn đọng acme/api gửi Slack #general',
        warnings: [],
        steps: [
          {
            id: 's_post',
            tool: 'slack.send_message',
            description: 'Gửi báo cáo issue tồn đọng vào Slack',
            args: {
              channel: 'C_GENERAL',
              text: rendered.text,
            },
            dependsOn: [],
          },
        ],
        reportEvidence: {
          artifactId: artifact.id,
          kind: 'github_issue_aging',
          stepId: 's_post',
          argument: 'text',
          sourceTool: 'github.list_issues',
          sourceLabel: 'GitHub acme/api',
          readAt: artifact.createdAt,
          itemCount: rendered.itemCount,
          coverage: rendered.coverage,
          contentHash: artifact.contentHash,
        },
      };

      const result = validatePlan(JSON.stringify(dev04Plan), ALL_TOOLS, {
        requireGroundedResources: false,
        reportEvidenceStore: artifactStore,
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('WorkingMemory & Context Preservation across Multi-turn Interaction', () => {
    it('preserves clarified entities in WorkingMemory from turn 1 to turn 2 without hallucinating', () => {
      const memory = new WorkingMemory();

      // Turn 1: user provided Lan name but no email or meeting time
      memory.setEntity('person', 'Lan');
      memory.setEntity('meeting_title', 'Khởi động dự án');

      // User supplies email in follow-up turn
      memory.setEntity('attendee_email', 'lan@example.com');
      memory.setEntity('meeting_time', '2026-11-05T09:00:00+07:00');

      const snapshot = memory.toJSON();
      expect(snapshot['attendee_email']).toBe('lan@example.com');
      expect(snapshot['meeting_title']).toBe('Khởi động dự án');
      expect(snapshot['person']).toBe('Lan');

      // Restore in turn 2
      const memoryTurn2 = new WorkingMemory();
      memoryTurn2.fromJSON(snapshot);
      expect(memoryTurn2.getEntity('attendee_email')).toBe('lan@example.com');
      expect(memoryTurn2.getEntity('person')).toBe('Lan');
    });
  });
});
