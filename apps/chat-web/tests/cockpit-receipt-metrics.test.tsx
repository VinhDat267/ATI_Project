/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ReceiptMoment } from '../src/pages/Cockpit/ReceiptMoment';
import { RequestMoment } from '../src/pages/Cockpit/RequestMoments';
import { resourceDestination } from '../src/components/Cockpit';
import type { ExecutionStepInfo } from '../src/components/ExecutionProgress';
import type { PlanStep, ServiceInfo } from '../src/types';

const NINE_SERVICES: ServiceInfo[] = [
  { id: 'calendar', name: 'Google Calendar', connected: true, configured: true },
  { id: 'jira', name: 'Atlassian Jira', connected: true, configured: true },
  { id: 'github', name: 'GitHub', connected: true, configured: true },
  { id: 'trello', name: 'Trello', connected: true, configured: true },
  { id: 'notion', name: 'Notion', connected: true, configured: true },
  { id: 'sheets', name: 'Google Sheets', connected: true, configured: true },
  { id: 'gmail', name: 'Gmail', connected: true, configured: true },
  { id: 'telegram', name: 'Telegram', connected: true, configured: true },
  { id: 'slack', name: 'Slack', connected: true, configured: true },
];

describe('DEMO-01: 9-Service Receipt Metrics & Comprehensive Playbooks', () => {
  it('renders flagship 9-service, 5-service, 4-service, and scheduled playbooks in RequestMoment', () => {
    render(
      <RequestMoment
        services={NINE_SERVICES}
        loading={false}
        error={null}
        draft=""
        planning={false}
        input={{ current: null }}
        onDraft={() => {}}
        onSend={() => {}}
        onKeyDown={() => {}}
        onSettings={() => {}}
        navigate={() => {}}
        servicePrompt={(s) => s.name}
      />,
    );

    const playbooks = screen.getByTestId('multi-service-playbooks');
    expect(within(playbooks).getByText('Điều phối liên thông toàn diện 9 dịch vụ')).toBeInTheDocument();
    expect(within(playbooks).getByText('Đồng bộ phát hành Sprint qua 5 dịch vụ')).toBeInTheDocument();
    expect(within(playbooks).getByText('Ứng cứu sự cố P1 qua 4 dịch vụ')).toBeInTheDocument();
    expect(within(playbooks).getByText('Đặt lịch điểm danh lịch họp mỗi sáng 08:00')).toBeInTheDocument();
  });

  it('renders receipt metrics across all 9 services in ReceiptMoment', () => {
    const steps: ExecutionStepInfo[] = [
      {
        id: 'step_1',
        tool: 'calendar.create_event',
        description: 'Tạo lịch họp War-room',
        status: 'succeeded',
        output: {
          id: 'evt_sandbox_1',
          summary: 'War-room P1: Sự cố cổng thanh toán',
          start: '2026-10-08T09:00:00+07:00',
          end: '2026-10-08T09:30:00+07:00',
          url: 'https://calendar.google.com/calendar/event?eid=evt_sandbox_1',
        },
      },
      {
        id: 'step_2',
        tool: 'jira.create_issue',
        description: 'Tạo ticket Jira P1',
        status: 'succeeded',
        output: {
          id: '10001',
          key: 'ATI-1',
          url: 'https://sandbox.atlassian.net/browse/ATI-1',
        },
      },
      {
        id: 'step_3',
        tool: 'github.create_issue',
        description: 'Mở issue GitHub',
        status: 'succeeded',
        output: {
          id: 9001,
          number: 42,
          state: 'open',
          labels: ['bug', 'p1'],
          assignees: ['tuan-dev'],
          url: 'https://github.com/acme/web-app/issues/42',
        },
      },
      {
        id: 'step_4',
        tool: 'trello.create_card',
        description: 'Tạo thẻ Trello',
        status: 'succeeded',
        output: {
          id: 'card_created_1',
          name: 'Theo dõi khắc phục P1 cổng thanh toán',
          idMembers: ['mem_1'],
          dueComplete: false,
          url: 'https://trello.com/c/card_created_1',
        },
      },
      {
        id: 'step_5',
        tool: 'notion.create_page',
        description: 'Lập trang biên bản Notion',
        status: 'succeeded',
        output: {
          id: 'page_created_1',
          title: 'Biên bản War-room P1 cổng thanh toán',
          properties: { Status: 'In Progress', Priority: 'P1' },
          url: 'https://www.notion.so/page_created_1',
        },
      },
      {
        id: 'step_6',
        tool: 'sheets.append_rows',
        description: 'Ghi nhật ký Google Sheets',
        status: 'succeeded',
        output: {
          spreadsheetId: 'sheet_sprint_report',
          updatedRange: 'Sprint 18!A2:E2',
          updatedRows: 1,
        },
      },
      {
        id: 'step_7',
        tool: 'gmail.send_message',
        description: 'Gửi email báo cáo qua Gmail',
        status: 'succeeded',
        output: {
          id: 'msg_sent_1',
          threadId: 'thr_sent_1',
        },
      },
      {
        id: 'step_8',
        tool: 'telegram.send_message',
        description: 'Gửi cảnh báo Telegram',
        status: 'succeeded',
        output: {
          messageId: 701,
          chatId: '-1001987654321',
          sentAt: '2026-10-08T09:05:00.000Z',
        },
      },
      {
        id: 'step_9',
        tool: 'slack.send_message',
        description: 'Đăng báo cáo tổng hợp vào Slack',
        status: 'succeeded',
        output: {
          ok: true,
          channel: 'C01GENERAL',
          ts: '1700000000.000100',
          permalink: 'https://slack.com/archives/C01GENERAL/p1700000000000100',
        },
      },
    ];

    const planSteps: PlanStep[] = steps.map((s) => ({
      id: s.id,
      tool: s.tool,
      description: s.description,
      args: {},
    }));

    render(
      <ReceiptMoment
        request="Điều phối liên thông toàn diện 9 dịch vụ"
        steps={steps}
        planSteps={planSteps}
        services={NINE_SERVICES}
        destination={resourceDestination}
        onNewConversation={() => {}}
        onFollowup={() => {}}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Đã xong 9 việc trên 9 công cụ' })).toBeInTheDocument();
    expect(screen.getByTestId('calendar-receipt-metrics')).toHaveTextContent('📅 Bắt đầu: 2026-10-08T09:00:00+07:00');
    expect(screen.getByTestId('myjira-receipt-metrics')).toHaveTextContent('🎫 Mã: ATI-1');
    expect(screen.getByTestId('github-receipt-metrics')).toHaveTextContent('🐙 Issue #42');
    expect(screen.getByTestId('github-receipt-metrics')).toHaveTextContent('🏷️ Nhãn: bug, p1');
    expect(screen.getByTestId('github-receipt-metrics')).toHaveTextContent('👤 Phụ trách: tuan-dev');
    expect(screen.getByTestId('trello-receipt-metrics')).toHaveTextContent('👤 Đã gán 1 thành viên');
    expect(screen.getByTestId('notion-receipt-metrics')).toHaveTextContent('Đã cập nhật 2 thuộc tính (Status, Priority)');
    expect(screen.getByTestId('sheets-receipt-metrics')).toHaveTextContent('Đã ghi 1 dòng');
    expect(screen.getByTestId('gmail-receipt-metrics')).toHaveTextContent('✉️ Mã thư: msg_sent_1');
    expect(screen.getByTestId('telegram-receipt-metrics')).toHaveTextContent('📨 Tin nhắn #701');
  });
});
