import { describe, expect, it } from 'vitest';
import { requiresReportEvidence } from '../src/report-evidence.js';
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
  ])('requires verified source for %s', (text) => expect(requiresReportEvidence([text])).toBe(true));
  it.each([
    'Create GitHub issue, Trello card and notify Slack',
    'Create an issue in GitHub acme/web with title Fix report generator and send its link to Slack #dev',
    'Update issue #41 in GitHub acme/web with body Add summary tests and send its link to Slack #dev',
    'Chuyển card c2, gán member_7, báo #general và gắn nhãn bug cho issue #12 của acme/app.',
    'Đọc bảng tính Khách hàng rồi gửi email báo giá cho họ qua Gmail',
    'Gửi Slack #dev nguyên văn "Báo cáo PR: hiện có 999 PR #999"',
    'Send Slack #dev exactly this message: "Report: 999 open pull requests"',
  ])('preserves ordinary user-authored action %s', (text) => expect(requiresReportEvidence([text])).toBe(false));
});
