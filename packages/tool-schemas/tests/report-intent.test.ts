import { describe, expect, it } from 'vitest';
import {
  githubIssueAgingDays,
  reportLiteralBodies,
  requestedReportPrefix,
  requestsOpenJiraIssues,
  requiresReportEvidence,
} from '../src/report-evidence.js';

it.each([
  ['Tra cứu tối đa 3 công việc đang mở trong dự án Jira ATIT rồi gửi vào Slack.', true],
  ['List open Jira issues for ATIT and send them to Slack.', true],
  ['Đọc issue Jira ATIT rồi gửi danh sách issue đang mở trên GitHub.', false],
  ['Liệt kê issue Jira đang mở của ATIT. Kiểm tra ticket Jira ở dự án khác.', false],
  ['Liệt kê ticket Jira đang mở và đã xong.', false],
  ['Do not list open Jira issues. List only closed issues.', false],
  ['Không lấy các issue Jira đang mở.', false],
  ['Gửi Slack nguyên văn "Danh sách issue Jira đang mở".', false],
])('defaults open-only Jira search for %s: %s', (request, expected) => {
  expect(requestsOpenJiraIssues([request])).toBe(expected);
});

describe('Original report request versus ordinary source writes and literal messages', () => {
  it.each([
    'Create an issue in GitHub acme/web. Summarize open PRs and send the report to Slack #dev',
    'Tạo issue GitHub acme/web và gửi danh sách PR đang mở vào Slack #dev',
    'Đọc bảng tính Khách hàng rồi đếm số khách và gửi email kết quả cho họ',
    'Lấy danh sách "PR" đang mở của acme/web rồi gửi Slack #dev',
    'Which "pull requests" need review? Post the result to Slack #dev',
    'Repo acme/web đang có mấy PR mở? Nhắn Slack #dev giúp tôi.',
    'Đếm PR đang mở trên GitHub acme/web rồi gửi Slack',
    'Tạo issue trên GitHub rồi tổng hợp PR đang mở vào Slack',
    'Tổng hợp PR đang mở và tạo issue GitHub',
    'Chuẩn bị báo cáo bản phát hành tuần này từ các thay đổi rồi gửi nhóm release giúp mình.',
    'Gửi các issue quá hạn trong dự án Jira ATIT vào Slack #ati-test, mở đầu bằng "Bản tin sáng".',
  ])('requires verified source for %s', (text) => expect(requiresReportEvidence([text])).toBe(true));
  it('still requires verified source when a clarification reply adds a quoted prefix', () => {
    expect(
      requiresReportEvidence([
        'Liệt kê các issue Jira trong dự án ATIT rồi gửi vào Slack',
        'Gửi vào #ati-test và bắt đầu bằng "Bản tin sáng v1.2"',
      ]),
    ).toBe(true);
  });
  it.each([
    'Create GitHub issue, Trello card and notify Slack',
    'Create an issue in GitHub acme/web with title Fix report generator and send its link to Slack #dev',
    'Update issue #41 in GitHub acme/web with body Add summary tests and send its link to Slack #dev',
    'Chuyển card c2, gán member_7, báo #general và gắn nhãn bug cho issue #12 của acme/app.',
    'Đọc bảng tính Khách hàng rồi gửi email báo giá cho họ qua Gmail',
    'Gửi Slack #dev nguyên văn "Báo cáo PR: hiện có 999 PR #999"',
    'Send Slack #dev exactly this message: "Report: 999 open pull requests"',
    'Đọc Google Sheets, thêm dòng và báo Slack E2E 1730740000000',
    'Gửi tin nhắn vào Slack #dev, mở đầu bằng "[Jira]" xin chào cả nhóm',
  ])('preserves ordinary user-authored action %s', (text) => expect(requiresReportEvidence([text])).toBe(false));
});

describe('Report prefixes, literal bodies, and GitHub issue aging intent', () => {
  it('treats verbatim prefix requests separately from standalone literal message bodies', () => {
    expect(
      reportLiteralBodies([
        'Liệt kê các issue Jira ATIT rồi gửi vào Slack, mở đầu nguyên văn bằng "[AUDIT 18/11]"',
      ]),
    ).toEqual([]);
    expect(
      reportLiteralBodies([
        'Liệt kê các PR đang mở vào Slack và gửi nguyên văn "Đã xong" cho Nam',
      ]),
    ).toEqual(['Đã xong']);
  });

  it.each([
    ['mở đầu tin nhắn bằng [AUDIT]', '[AUDIT]'],
    ['start the message with "[Daily]"', '[Daily]'],
    ['mở đầu bằng "[AUDIT  18/11]"', '[AUDIT  18/11]'],
    ['Liệt kê các issue có tiêu đề bắt đầu bằng "[FE]" trong dự án ATIT rồi gửi danh sách vào Slack', undefined],
    ['Find issues starting with "[BUG]" and send to Slack', undefined],
    ['Lọc các dòng có mã mở đầu bằng "[VN]" rồi gửi Slack, mở đầu tin nhắn bằng "[AUDIT]"', '[AUDIT]'],
  ])('extracts requestedReportPrefix for %s', (text, expected) => {
    expect(requestedReportPrefix([text])).toBe(expected);
  });

  it.each([
    ['Mỗi sáng nhắc nhóm các lỗi tồn lâu chưa ai xử lý', 7],
    ['Tìm issue mo qua 10 ngay trên repo acme/api', 10],
    ['Find stale issues older than 14 days in acme/api', 14],
    ['Liệt kê các issue đang mở trên repo acme/api, mở đầu bằng "[STALE]"', undefined],
  ])('detects githubIssueAgingDays for %s', (text, expected) => {
    expect(githubIssueAgingDays([text])).toBe(expected);
  });
});
