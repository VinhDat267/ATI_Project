// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import {
  RequestMoment,
  extractPlaybookVariables,
  applyPlaybookVariables,
} from '../../src/pages/Cockpit/RequestMoments';
import { PlanMoment } from '../../src/pages/Cockpit/PlanMoment';
import { PreviewContents } from '../../src/pages/Cockpit/PreviewContents';
import { ReceiptMoment } from '../../src/pages/Cockpit/ReceiptMoment';
import { PersonalMySheets } from '../../src/pages/Settings/PersonalMySheets';
import { PersonalMyCalendar } from '../../src/pages/Settings/PersonalMyCalendar';
import { resourceDestination } from '../../src/components/Cockpit';
import { apiClient } from '../../src/services/api-client';
import { authStorage } from '../../src/services/auth-storage';
import { toolDefinition } from '../../src/services/tool-definitions';
import presentation from '../../src/assets/cockpit-services.json';
import type { ActivePlan, PlanStep, ServiceInfo } from '../../src/types';

describe('1-Click Parameterized Playbooks & Extended Slack/GitHub Catalog', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('extracts and applies {{biến_số}} placeholders cleanly', () => {
    const template =
      'Tạo cuộc họp Google Meet cho {{tên_dự_án}} mời {{email_khách}} và lưu vào thư mục {{tên_dự_án}}';
    expect(extractPlaybookVariables(template)).toEqual(['tên_dự_án', 'email_khách']);

    const partial = applyPlaybookVariables(template, { tên_dự_án: 'Fintech Q4' });
    expect(partial).toBe(
      'Tạo cuộc họp Google Meet cho Fintech Q4 mời {{email_khách}} và lưu vào thư mục Fintech Q4',
    );

    const full = applyPlaybookVariables(template, {
      tên_dự_án: 'Fintech Q4',
      email_khách: 'ceo@partner.vn',
    });
    expect(full).toBe(
      'Tạo cuộc họp Google Meet cho Fintech Q4 mời ceo@partner.vn và lưu vào thư mục Fintech Q4',
    );
  });

  it('resolves slack.read_messages and github.list_pull_requests in toolDefinition and cockpit-services.json', () => {
    expect(toolDefinition('slack.read_messages')?.service).toBe('slack');
    expect(toolDefinition('github.list_pull_requests')?.service).toBe('github');
    expect((presentation.operations as Record<string, any>)['slack.read_messages']).toBeDefined();
    expect((presentation.operations as Record<string, any>)['github.list_pull_requests']).toBeDefined();
  });

  it('renders Quick Variable Fill Bar with variable chips, reset button, and Enter-to-save Custom Playbook 1-Click', () => {
    const services: ServiceInfo[] = [
      { id: 'mycalendar', name: 'Google Calendar', configured: true, connected: true, connectionStatus: 'healthy' },
      { id: 'mysheets', name: 'Google Sheets', configured: true, connected: true, connectionStatus: 'healthy' },
      { id: 'gmail', name: 'Gmail', configured: true, connected: true, connectionStatus: 'healthy' },
    ];
    let currentDraft = '';
    const onDraft = vi.fn((val: string) => {
      currentDraft = val;
    });
    const onSend = vi.fn();
    const inputRef = createRef<HTMLTextAreaElement>();

    const { rerender } = render(
      <RequestMoment
        services={services}
        loading={false}
        error={null}
        draft={currentDraft}
        planning={false}
        input={inputRef}
        onDraft={onDraft}
        onSend={onSend}
        onKeyDown={() => {}}
        onSettings={() => {}}
        navigate={() => {}}
        servicePrompt={(s) => `Dùng ${s.name}`}
      />,
    );

    // Verify variable chips appear on parameterized playbook cards
    expect(screen.getAllByTestId('playbook-var-chip').length).toBeGreaterThan(0);

    const googlePlaybookBtn = screen.getByRole('button', {
      name: /Hệ sinh thái Google Workspace/i,
    });
    fireEvent.click(googlePlaybookBtn);
    expect(onDraft).toHaveBeenCalled();

    rerender(
      <RequestMoment
        services={services}
        loading={false}
        error={null}
        draft={currentDraft}
        planning={false}
        input={inputRef}
        onDraft={onDraft}
        onSend={onSend}
        onKeyDown={() => {}}
        onSettings={() => {}}
        navigate={() => {}}
        servicePrompt={(s) => `Dùng ${s.name}`}
      />,
    );

    expect(screen.getByTestId('playbook-variables-bar')).toBeDefined();
    const projectInput = screen.getByLabelText('Biến số tên_dự_án');
    fireEvent.change(projectInput, { target: { value: 'AI Hub 2026' } });
    expect(currentDraft).toContain('AI Hub 2026');

    // Reset button restores template placeholders
    fireEvent.click(screen.getByTestId('btn-reset-playbook-variables'));
    expect(currentDraft).toContain('{{tên_dự_án}}');

    // Save as custom 1-Click Playbook via Enter key
    const saveBtn = screen.getByTestId('btn-save-playbook');
    fireEvent.click(saveBtn);

    const titleInput = screen.getByLabelText('Tên Playbook 1-Click');
    fireEvent.change(titleInput, { target: { value: 'Playbook Khởi động Dự án VIP' } });
    fireEvent.keyDown(titleInput, { key: 'Enter' });

    expect(screen.getByTestId('custom-playbooks-section')).toBeDefined();
    expect(screen.getByText('Playbook Khởi động Dự án VIP')).toBeDefined();
  });

  it('renders Google Workspace (Meet/Docs/Drive), GitHub PR, and Slack Read step pills in PlanMoment and clear resourceDestination', () => {
    const steps: PlanStep[] = [
      {
        id: 'step_1',
        tool: 'mycalendar.schedule_meet',
        description: 'Tạo phòng họp Google Meet cho dự án Q4',
        args: {
          calendarId: 'primary',
          title: 'Kickoff Q4',
          start: '2026-11-05T09:00:00+07:00',
          end: '2026-11-05T10:00:00+07:00',
          attendees: ['lan@example.com', 'minh@example.com'],
          sendInvites: true,
        },
      },
      {
        id: 'step_2',
        tool: 'mysheets.create_drive_folder',
        description: 'Tạo thư mục dự án trên Google Drive',
        args: { name: 'Hồ sơ Dự án Q4' },
      },
      {
        id: 'step_3',
        tool: 'mysheets.create_doc',
        description: 'Soạn biên bản họp Google Docs',
        args: {
          title: 'Biên bản Kickoff Q4',
          content: '# Nội dung chính\n- Thống nhất lộ trình',
          folderId: { $ref: 'step_2.output.id' },
        },
      },
      {
        id: 'step_4',
        tool: 'github.list_pull_requests',
        description: 'Kiểm tra danh sách Pull Request đang mở',
        args: { repo: 'VinhDat267/ATI_Project', state: 'open' },
      },
      {
        id: 'step_5',
        tool: 'slack.read_messages',
        description: 'Đọc tin nhắn gần nhất trên kênh #general',
        args: { channel: 'C01GENERAL', limit: 5 },
      },
    ];

    expect(resourceDestination(steps[1]!)).toContain('Hồ sơ Dự án Q4');
    expect(resourceDestination(steps[2]!)).toContain('Biên bản Kickoff Q4');

    const plan: ActivePlan = {
      id: 'plan-gw-1',
      summary: 'Khởi động dự án với Google Workspace, GitHub và Slack',
      steps,
    };

    render(
      <PlanMoment
        runtimeMode="live"
        plan={plan}
        services={[
          { id: 'mycalendar', name: 'Google Calendar', configured: true, connected: true, connectionStatus: 'healthy' },
          { id: 'mysheets', name: 'Google Sheets', configured: true, connected: true, connectionStatus: 'healthy' },
          { id: 'github', name: 'GitHub', configured: true, connected: true, connectionStatus: 'healthy' },
          { id: 'slack', name: 'Slack', configured: true, connected: true, connectionStatus: 'healthy' },
        ]}
        destination={(step, labels) => resourceDestination(step, labels)}
        onPreview={() => {}}
        onApprove={() => {}}
        onCancel={() => {}}
        onEdit={() => {}}
        inlineComposer={null}
      />,
    );

    expect(screen.getByText(/🎥 Google Meet/i)).toBeDefined();
    expect(screen.getByText(/👥 2 khách mời/i)).toBeDefined();
    expect(screen.getAllByTestId('google-workspace-step-pills').length).toBe(2);
    expect(screen.getByText(/📁 Thư mục Google Drive mới/i)).toBeDefined();
    expect(screen.getByText(/📝 Tài liệu Google Docs/i)).toBeDefined();
    expect(screen.getByText(/🔀 Pull Requests/i)).toBeDefined();
    expect(screen.getByText(/💬 Đọc 5 tin nhắn/i)).toBeDefined();
  });

  it('renders dedicated Google Docs and Google Drive preview frames in PreviewContents', () => {
    const docStep: PlanStep = {
      id: 'step_doc',
      tool: 'mysheets.create_doc',
      description: 'Tạo biên bản họp trên Google Docs',
      args: {
        title: 'Biên bản họp Sprint 12',
        content: '1. Mục tiêu Sprint\n2. Phân công công việc',
        folderId: 'folder-123',
      },
    };
    const { unmount } = render(
      <PreviewContents
        step={docStep}
        destination="Thư mục Dự án · Biên bản họp Sprint 12"
        labels={{ 'folder-123': 'Thư mục Dự án' }}
      />,
    );
    expect(screen.getByTestId('google-doc-preview')).toBeDefined();
    expect(screen.getByText('Biên bản họp Sprint 12')).toBeDefined();
    expect(screen.getByText(/1\. Mục tiêu Sprint/)).toBeDefined();
    unmount();

    const driveStep: PlanStep = {
      id: 'step_drive',
      tool: 'mysheets.create_drive_folder',
      description: 'Tạo thư mục Google Drive',
      args: { name: 'Tài liệu Khách hàng VIP' },
    };
    render(<PreviewContents step={driveStep} destination="Google Drive · Tài liệu Khách hàng VIP" />);
    expect(screen.getByTestId('google-drive-preview')).toBeDefined();
    expect(screen.getByText('Tài liệu Khách hàng VIP')).toBeDefined();
  });

  it('renders ReceiptMoment metrics pills for Google Docs, Google Drive, Google Meet, GitHub PRs, and Slack Read', () => {
    const planSteps: PlanStep[] = [
      { id: 's1', tool: 'mycalendar.schedule_meet', description: 'Tạo phòng họp Meet', args: {} },
      { id: 's2', tool: 'mysheets.create_drive_folder', description: 'Tạo thư mục Drive', args: { name: 'Folder A' } },
      { id: 's3', tool: 'mysheets.create_doc', description: 'Tạo tài liệu Docs', args: { title: 'Doc A', content: 'Hi' } },
      { id: 's4', tool: 'slack.read_messages', description: 'Đọc tin Slack', args: { channel: 'C1' } },
    ];
    const execSteps = [
      {
        id: 's1',
        tool: 'mycalendar.schedule_meet',
        description: 'Tạo phòng họp Meet',
        status: 'succeeded' as const,
        output: {
          id: 'ev1',
          title: 'Họp Q4',
          start: '2026-11-05T09:00:00+07:00',
          end: '2026-11-05T10:00:00+07:00',
          meetLink: 'https://meet.google.com/abc-defg-hij',
          attendeesCount: 3,
          url: 'https://calendar.google.com/calendar/event?eid=ev1',
        },
      },
      {
        id: 's2',
        tool: 'mysheets.create_drive_folder',
        description: 'Tạo thư mục Drive',
        status: 'succeeded' as const,
        output: { id: 'f1', title: 'Folder A', url: 'https://drive.google.com/drive/folders/f1' },
      },
      {
        id: 's3',
        tool: 'mysheets.create_doc',
        description: 'Tạo tài liệu Docs',
        status: 'succeeded' as const,
        output: { id: 'd1', title: 'Doc A', url: 'https://docs.google.com/document/d/d1/edit' },
      },
      {
        id: 's4',
        tool: 'slack.read_messages',
        description: 'Đọc tin Slack',
        status: 'succeeded' as const,
        output: {
          channel: 'C1',
          messages: [
            { ts: '1700000001.000100', user: 'U1', text: 'Báo cáo tiến độ hôm nay' },
            { ts: '1700000002.000100', user: 'U2', text: 'Đã hoàn thành PR #275' },
          ],
        },
      },
    ];

    render(
      <ReceiptMoment
        steps={execSteps}
        planSteps={planSteps}
        services={[
          { id: 'mycalendar', name: 'Google Calendar', configured: true, connected: true, connectionStatus: 'healthy' },
          { id: 'mysheets', name: 'Google Sheets', configured: true, connected: true, connectionStatus: 'healthy' },
          { id: 'slack', name: 'Slack', configured: true, connected: true, connectionStatus: 'healthy' },
        ]}
        destination={(step) => resourceDestination(step)}
        onNewConversation={() => {}}
        onFollowup={() => {}}
      />,
    );

    expect(screen.getByText(/🎥 Đã tạo phòng họp Google Meet/i)).toBeDefined();
    expect(screen.getByText(/👥 3 khách mời/i)).toBeDefined();
    expect(screen.getByText(/📁 Thư mục Drive: Folder A/i)).toBeDefined();
    expect(screen.getByText(/📝 Tài liệu Docs: Doc A/i)).toBeDefined();
    expect(screen.getByTestId('slack-receipt-metrics')).toBeDefined();
    expect(screen.getByText(/💬 Đã đọc 2 tin nhắn/i)).toBeDefined();
  });

  it('allows 1-Click Quick Spreadsheet Creation directly inside PersonalMySheets settings and shows ecosystem capability pills', async () => {
    authStorage.setStoredTokens({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      user: { id: 'u1', email: 'vinhdat@example.com', name: 'Vinh Dat', role: 'member' },
    });
    const spy = vi.spyOn(apiClient, 'quickCreateMySheetsSpreadsheet').mockResolvedValue({
      email: 'vinhdat@example.com',
      createdSpreadsheet: {
        id: 'sheet-auto-1',
        title: 'ATI Workspace — Bảng theo dõi công việc',
        canEdit: true,
      },
      selectedSpreadsheets: [
        { id: 'sheet-auto-1', title: 'ATI Workspace — Bảng theo dõi công việc', canEdit: true },
      ],
    });
    const refresh = vi.fn().mockResolvedValue(undefined);

    render(
      <PersonalMySheets
        service={{
          id: 'mysheets',
          name: 'Google Sheets của bạn',
          configured: false,
          connected: false,
          connectionStatus: 'unconfigured',
          personalStatus: 'scope_required',
          email: 'vinhdat@example.com',
        }}
        refresh={refresh}
        selected={null}
      />,
    );

    expect(screen.getByTestId('mysheets-ecosystem-badges')).toBeDefined();
    const quickBtn = screen.getByTestId('mysheets-settings-quick-create');
    fireEvent.click(quickBtn);

    await waitFor(() => {
      expect(spy).toHaveBeenCalledTimes(1);
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    render(
      <PersonalMyCalendar
        service={{
          id: 'mycalendar',
          name: 'Google Calendar của bạn',
          configured: true,
          connected: true,
          connectionStatus: 'healthy',
          personalStatus: 'connected',
          email: 'vinhdat@example.com',
        }}
        refresh={refresh}
        selected={null}
      />,
    );
    expect(screen.getByTestId('mycalendar-ecosystem-badges')).toBeDefined();
  });
});
