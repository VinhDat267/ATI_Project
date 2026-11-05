import { describe, it, expect } from 'vitest';
import {
  renderGithubPrsReport,
  renderGithubIssueAgingReport,
  renderJiraProgressReport,
  renderSheetSummaryReport,
  parseFactualNumber,
  formatFactualNumber,
  sanitizeReportString,
} from '../src/reports/renderers.js';
import { ALL_TOOLS, type PlanResponse, type ReportEvidence } from '@wap/tool-schemas';
import { validatePlan } from '../src/validator.js';
import { ReportArtifactStore } from '../src/reports/artifacts.js';

describe('Deterministic Report Renderers (FLOW-05)', () => {
  describe('Factual Number Parsing & Formatting', () => {
    it('parses US number formatting correctly', () => {
      expect(parseFactualNumber('1,234.56')).toBe(1234.56);
      expect(parseFactualNumber('$1,234.50')).toBe(1234.50);
      expect(parseFactualNumber('1234.5')).toBe(1234.5);
    });

    it('parses VN number formatting correctly', () => {
      expect(parseFactualNumber('1.234,56')).toBe(1234.56);
      expect(parseFactualNumber('1.234,50 ₫')).toBe(1234.50);
      expect(parseFactualNumber('500.000 VND')).toBe(500000);
      expect(parseFactualNumber('12,5')).toBe(12.5);
    });

    it('parses negative numbers and accounting parentheses correctly', () => {
      expect(parseFactualNumber('-100.50')).toBe(-100.50);
      expect(parseFactualNumber('- 1.234,50')).toBe(-1234.50);
      expect(parseFactualNumber('(500)')).toBe(-500);
      expect(parseFactualNumber('(1,250.75)')).toBe(-1250.75);
    });

    it('handles blank, empty, and invalid cells safely', () => {
      expect(parseFactualNumber('')).toBeNull();
      expect(parseFactualNumber('   ')).toBeNull();
      expect(parseFactualNumber(null)).toBeNull();
      expect(parseFactualNumber(undefined)).toBeNull();
      expect(parseFactualNumber('N/A')).toBeNull();
      expect(parseFactualNumber('chưa có')).toBeNull();
    });

    it('formats numbers by locale', () => {
      expect(formatFactualNumber(1234.5, 'en')).toBe('1,234.5');
      // In vi-VN locale, separator is dot for thousands and comma for decimal
      const viFormatted = formatFactualNumber(1234.5, 'vi');
      expect(viFormatted).toMatch(/1[.,\s]?234[,.]5/);
    });
  });

  describe('renderGithubIssueAgingReport', () => {
    const fixedClock = '2026-11-04T13:00:00.000Z'; // Reference clock

    it('calculates issue age in days relative to reference clock', () => {
      const issues = [
        {
          id: 'iss_1',
          number: 101,
          title: 'Memory leak in worker pool',
          url: 'https://github.com/acme/api/issues/101',
          repo: 'acme/api',
          createdAt: '2026-10-21T13:00:00.000Z', // 14 days ago
        },
        {
          id: 'iss_2',
          number: 102,
          title: 'Update readme docs',
          url: 'https://github.com/acme/api/issues/102',
          repo: 'acme/api',
          createdAt: '2026-11-02T13:00:00.000Z', // 2 days ago
        },
        {
          id: 'iss_3',
          number: 103,
          title: 'Flaky OAuth callback test',
          url: 'https://github.com/acme/api/issues/103',
          repo: 'acme/api',
          createdAt: '2026-10-25T13:00:00.000Z', // 10 days ago
        },
      ];

      const report = renderGithubIssueAgingReport(issues, {
        repo: 'acme/api',
        agingDays: 7,
        clock: fixedClock,
      });

      expect(report.itemCount).toBe(2); // Only #101 (14 days) and #103 (10 days)
      expect(report.text).toContain('Báo cáo GitHub Issue tồn đọng (acme/api');
      expect(report.text).toContain('#101: Memory leak in worker pool');
      expect(report.text).toContain('14 ngày');
      expect(report.text).toContain('#103: Flaky OAuth callback test');
      expect(report.text).toContain('10 ngày');
      expect(report.text).not.toContain('#102'); // 2 days old -> not aging
    });

    it('renders clean message when no issues exceed aging threshold', () => {
      const issues = [
        {
          id: 'iss_1',
          number: 201,
          title: 'Recent issue',
          url: 'https://github.com/acme/api/issues/201',
          repo: 'acme/api',
          createdAt: '2026-11-03T13:00:00.000Z', // 1 day ago
        },
      ];

      const report = renderGithubIssueAgingReport(issues, {
        repo: 'acme/api',
        agingDays: 7,
        clock: fixedClock,
      });

      expect(report.itemCount).toBe(0);
      expect(report.text).toContain('Hiện không có issue nào tồn đọng quá 7 ngày');
    });

    it('throws when input is not an array', () => {
      expect(() => renderGithubIssueAgingReport(null as any)).toThrow();
      expect(() => renderGithubIssueAgingReport({} as any)).toThrow();
    });
  });

  describe('renderJiraProgressReport', () => {
    it('summarizes Jira sprint issues grouped by status and notes manual per-turn approval', () => {
      const issues = [
        { key: 'FE-1', title: 'Login with Google OAuth', status: 'Done', url: 'https://jira.acme.com/browse/FE-1' },
        { key: 'FE-2', title: 'Session expiration dialog', status: 'Done', url: 'https://jira.acme.com/browse/FE-2' },
        { key: 'FE-3', title: 'Add dark mode toggle', status: 'In Progress', url: 'https://jira.acme.com/browse/FE-3' },
        { key: 'FE-4', title: 'Audit bundle size', status: 'To Do', url: 'https://jira.acme.com/browse/FE-4' },
      ];

      const report = renderJiraProgressReport(issues, {
        projectKey: 'FE',
        sprintName: 'Sprint 24',
      });

      expect(report.itemCount).toBe(4);
      expect(report.text).toContain('Báo cáo tiến độ Jira Sprint (Sprint 24 - FE)');
      expect(report.text).toContain('Duyệt từng lượt trước khi gửi');
      expect(report.text).toContain('Done: 2');
      expect(report.text).toContain('In Progress: 1');
      expect(report.text).toContain('To Do: 1');
      expect(report.text).toContain('[FE-1] Login with Google OAuth');
      expect(report.text).toContain('[FE-3] Add dark mode toggle');
    });

    it('renders clean message when sprint has 0 issues', () => {
      const report = renderJiraProgressReport([], { projectKey: 'FE' });
      expect(report.itemCount).toBe(0);
      expect(report.text).toContain('Hiện không có ticket nào');
    });

    it('throws when input is not an array', () => {
      expect(() => renderJiraProgressReport(null as any)).toThrow();
    });
  });

  describe('renderSheetSummaryReport', () => {
    it('summarizes sheet rows grouped by status column with percentage and metric sum', () => {
      const records = [
        { 'Tên việc': 'Viết test unit', 'Trạng thái': 'Done', 'Giờ làm': '8' },
        { 'Tên việc': 'Review PR', 'Trạng thái': 'Done', 'Giờ làm': '4' },
        { 'Tên việc': 'Debug memory leak', 'Trạng thái': 'In Progress', 'Giờ làm': '12' },
        { 'Tên việc': 'Refactor CSS', 'Trạng thái': 'To Do', 'Giờ làm': '6' },
      ];

      const report = renderSheetSummaryReport(
        { records },
        {
          spreadsheetTitle: 'Kế hoạch Q4',
          sheetName: 'Tasks',
          groupBy: 'Trạng thái',
          metricColumn: 'Giờ làm',
          locale: 'vi',
        }
      );

      expect(report.itemCount).toBe(4);
      expect(report.text).toContain('Báo cáo tổng hợp số liệu Google Sheets (Kế hoạch Q4 - Tasks)');
      expect(report.text).toContain('Tổng số dòng đã đối chiếu: 4');
      expect(report.text).toContain('Done: 2 (50%)');
      expect(report.text).toContain('In Progress: 1 (25%)');
      expect(report.text).toContain('To Do: 1 (25%)');
      expect(report.text).toContain('Tổng Giờ làm: 30');
    });

    it('handles aggregate_rows output structure cleanly', () => {
      const aggregateData = {
        totalRowsScanned: 50,
        matchedRows: 50,
        groups: [
          { key: 'Hoàn thành', count: 35 },
          { key: 'Đang làm', count: 10 },
          { key: 'Chưa bắt đầu', count: 5 },
        ],
      };

      const report = renderSheetSummaryReport(aggregateData, {
        spreadsheetTitle: 'Bảng theo dõi KPI',
        sheetName: 'Tháng 11',
      });

      expect(report.itemCount).toBe(50);
      expect(report.text).toContain('Báo cáo tổng hợp số liệu Google Sheets (Bảng theo dõi KPI - Tháng 11)');
      expect(report.text).toContain('Hoàn thành: 35 (70%)');
      expect(report.text).toContain('Đang làm: 10 (20%)');
      expect(report.text).toContain('Chưa bắt đầu: 5 (10%)');
    });

    it('sanitizes long group keys and ignores blank or invalid values', () => {
      const records = [
        { 'Category': '<script>alert(1)</script>' + 'A'.repeat(400), 'Value': '100' },
        { 'Category': 'Valid Group', 'Value': 'invalid_number' },
        { 'Category': 'Valid Group', 'Value': null },
        { 'Category': 'Valid Group', 'Value': '200' },
      ];

      const report = renderSheetSummaryReport(
        { records },
        {
          spreadsheetTitle: 'Finance',
          groupBy: 'Category',
          metricColumn: 'Value',
        }
      );

      expect(report.itemCount).toBe(4);
      expect(report.text).not.toContain('<script>');
      expect(report.text).toContain('Tổng Value: 300'); // 100 + 200, invalid and null ignored
    });

    it('throws when input is invalid or missing', () => {
      expect(() => renderSheetSummaryReport(null as any)).toThrow();
      expect(() => renderSheetSummaryReport('invalid' as any)).toThrow();
    });
  });

  describe('Grounding Layer 5b Validator with All Report Kinds', () => {
    it('validates Jira progress report evidence and rejects unverified Jira progress reports', () => {
      const ungroundedJiraPlan: PlanResponse = {
        kind: 'plan',
        thinking: 'Báo cáo tiến độ Jira Sprint cho team',
        summary: 'Báo cáo tiến độ Jira Sprint',
        warnings: [],
        steps: [
          {
            id: 's1',
            tool: 'slack.send_message',
            description: 'Gửi báo cáo vào Slack',
            args: {
              channel: 'C_DEV',
              text: 'Báo cáo tiến độ Jira Sprint (FE): Tổng số 10 ticket (5 Done, 3 In Progress, 2 To Do).',
            },
            dependsOn: [],
          },
        ],
      };

      const result = validatePlan(JSON.stringify(ungroundedJiraPlan), ALL_TOOLS, {
        requireGroundedResources: false,
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.layer).toBe('grounding');
        expect(result.error).toContain('Report content must be grounded');
      }
    });

    it('validates Sheets summary report evidence and rejects unverified Sheets reports', () => {
      const ungroundedSheetsPlan: PlanResponse = {
        kind: 'plan',
        thinking: 'Báo cáo số liệu Google Sheets cho team',
        summary: 'Báo cáo số liệu Google Sheets',
        warnings: [],
        steps: [
          {
            id: 's1',
            tool: 'slack.send_message',
            description: 'Gửi báo cáo vào Slack',
            args: {
              channel: 'C_DEV',
              text: 'Báo cáo số liệu Google Sheets (Tasks): Tổng số 25 dòng, 15 Done, 10 Pending.',
            },
            dependsOn: [],
          },
        ],
      };

      const result = validatePlan(JSON.stringify(ungroundedSheetsPlan), ALL_TOOLS, {
        requireGroundedResources: false,
      });

      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.layer).toBe('grounding');
        expect(result.error).toContain('Report content must be grounded');
      }
    });

    it('accepts grounded Jira report plan when reportEvidence matches artifact store', () => {
      const store = new ReportArtifactStore();
      const renderedText = 'Báo cáo tiến độ Jira Sprint (FE): Tổng số 3 ticket. (Duyệt từng lượt trước khi gửi - Manual Approval Required)\n- [FE-1] Test issue (Done)';
      const artifact = store.createArtifact({
        kind: 'jira_progress',
        sourceTool: 'myjira.search_issues',
        sourceLabel: 'Jira Project FE',
        items: [{ key: 'FE-1', title: 'Test issue', status: 'Done' }],
        renderedText,
        actor: { userId: 'u1', workspaceId: 'w1' },
      });

      const groundedPlan: PlanResponse = {
        kind: 'plan',
        thinking: 'Báo cáo tiến độ Jira',
        summary: 'Gửi báo cáo Jira có nguồn',
        warnings: [],
        steps: [
          {
            id: 's_post',
            tool: 'slack.send_message',
            description: 'Gửi Slack',
            args: {
              channel: 'C_DEV',
              text: renderedText,
            },
            dependsOn: [],
          },
        ],
        reportEvidence: {
          artifactId: artifact.id,
          kind: 'jira_progress',
          stepId: 's_post',
          argument: 'text',
          sourceTool: 'myjira.search_issues',
          sourceLabel: 'Jira Project FE',
          readAt: artifact.createdAt,
          itemCount: 1,
          coverage: 'complete',
          contentHash: artifact.contentHash,
        },
      };

      const result = validatePlan(JSON.stringify(groundedPlan), ALL_TOOLS, {
        requireGroundedResources: false,
        reportEvidenceStore: store,
      });

      expect(result.valid).toBe(true);
    });
  });
});
