import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ALL_TOOLS, MYSHEETS_TOOLS } from '@wap/tool-schemas';
import { SettingsPage } from '../src/pages/Settings/SettingsPage';
import { RefusalMoment } from '../src/pages/Responses/ResponseMoment';
import { PlanMoment } from '../src/pages/Cockpit/PlanMoment';
import { ReceiptMoment } from '../src/pages/Cockpit/ReceiptMoment';
import { RecoveryMoment } from '../src/pages/Cockpit/RecoveryMoment';
import { PrivacyPage } from '../src/pages/Privacy/PrivacyPage';
import { GuidePage } from '../src/pages/Guide/GuidePage';
import { LandingPage } from '../src/pages/Landing/LandingPage';
import { MySheetsCallbackView } from '../src/views/MySheetsCallbackView';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';
import * as connection from '../src/services/gmail-connection';
import * as googlePickerModule from '../src/services/google-picker';
import { MYSHEETS_PROMPTS, MYSHEETS_SCHEDULE_PROMPT } from '../src/pages/Guide/mysheets-data';
import { SAMPLE_PROMPTS } from '../src/pages/Guide/data';
import type { ActivePlan, ChatMessage, ExecutionSnapshot, PlanStep, ServiceInfo, User } from '../src/types';

const member: User = { id: 'member-1', email: 'user@example.test', name: 'Thành viên', role: 'member' };
const CONV_ID = '11111111-2222-4333-8444-555555555555';

const mysheetsService = (
  personalStatus: 'not_connected' | 'scope_required' | 'connected' | 'reconnect_required' = 'not_connected',
  extra: Partial<ServiceInfo> = {}
): ServiceInfo => ({
  id: 'mysheets',
  name: 'Google Sheets của bạn',
  connection: 'personal',
  personalStatus,
  connected: personalStatus === 'connected',
  configured: personalStatus === 'connected',
  email: personalStatus === 'not_connected' ? undefined : 'user@gmail.com',
  connectedAt: personalStatus === 'not_connected' ? undefined : '2026-10-28T02:00:00Z',
  tools: ['mysheets.list_spreadsheets', 'mysheets.list_sheets', 'mysheets.read_range', 'mysheets.append_rows'],
  selectedSpreadsheets:
    personalStatus === 'connected'
      ? [
          { id: 'sheet-1', title: 'Việc của tôi', canEdit: true },
          { id: 'sheet-2', title: 'KPI quý 4', canEdit: false },
        ]
      : [],
  ...extra,
});

beforeEach(() => {
  window.history.replaceState({}, '', '/settings');
  localStorage.clear();
  authStorage.setStoredTokens({ accessToken: 'access-1', refreshToken: 'refresh-1', user: member });
  vi.spyOn(connection, 'redirectToMySheets').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  authStorage.clearStoredTokens();
});

describe('MySheetsCallbackView', () => {
  const sampleSpreadsheets = [
    { id: 'sheet-1', title: 'Việc của tôi', canEdit: true },
    { id: 'sheet-2', title: 'KPI quý 4', canEdit: false },
  ];

  it('exchanges OAuth code, opens picker, saves scope and navigates to returnTo', async () => {
    const navigate = vi.fn();
    window.history.replaceState({}, '', `/connections/mysheets/callback?code=CODE123&state=STATE456`);

    vi.spyOn(apiClient, 'completeMySheetsConnection').mockResolvedValue({
      email: 'user@gmail.com',
      returnTo: `/c/${CONV_ID}`,
    });
    vi.spyOn(apiClient, 'createMySheetsPickerSession').mockResolvedValue({
      mode: 'google',
      accessToken: 'token-123',
      expiresAt: '2026-10-28T03:00:00Z',
      developerKey: 'dev-key-123',
      appId: '1234567890',
    });
    vi.spyOn(googlePickerModule, 'openGooglePicker').mockResolvedValue(['sheet-1', 'sheet-2']);
    vi.spyOn(apiClient, 'saveMySheetsScope').mockResolvedValue({
      email: 'user@gmail.com',
      selectedSpreadsheets: sampleSpreadsheets,
    });

    render(
      <MySheetsCallbackView
        navigate={navigate}
        input={{ code: 'CODE123', state: 'STATE456', returnTo: `/c/${CONV_ID}` }}
      />
    );

    // Strips query before paint
    expect(window.location.search).toBe('');

    // Wait for callback view to render
    await screen.findByText(/Đã xác thực tài khoản/i);
    expect(apiClient.completeMySheetsConnection).toHaveBeenCalledTimes(1);
    expect(apiClient.completeMySheetsConnection).toHaveBeenCalledWith({ code: 'CODE123', state: 'STATE456' });

    // Disclaimer rendered
    expect(screen.getByText(/ATI chỉ thấy những bảng tính bạn chọn trong cửa sổ của Google/i)).toBeTruthy();

    // Click Choose spreadsheets button
    const chooseBtn = screen.getByRole('button', { name: /Chọn bảng tính trong Google Drive/i });
    fireEvent.click(chooseBtn);

    await waitFor(() => {
      expect(apiClient.createMySheetsPickerSession).toHaveBeenCalledTimes(1);
      expect(googlePickerModule.openGooglePicker).toHaveBeenCalledTimes(1);
      expect(apiClient.saveMySheetsScope).toHaveBeenCalledWith({ spreadsheetIds: ['sheet-1', 'sheet-2'] });
    });

    // Check selected spreadsheets rendered with read-only badge
    expect(await screen.findByText('Việc của tôi')).toBeTruthy();
    expect(screen.getByText('KPI quý 4')).toBeTruthy();
    expect(screen.getByText('Chỉ xem')).toBeTruthy();

    // Click finish button
    const doneButton = screen.getByRole('button', { name: /Xong, quay lại hội thoại/i });
    expect(doneButton).toBeEnabled();
    fireEvent.click(doneButton);

    expect(navigate).toHaveBeenCalledWith(`/c/${CONV_ID}`, true);
  });

  it('allows removing spreadsheets when multiple remain and prevents removing the last one', async () => {
    const navigate = vi.fn();
    vi.spyOn(apiClient, 'getMySheetsSpreadsheets').mockResolvedValue({
      email: 'user@gmail.com',
      selectedSpreadsheets: [sampleSpreadsheets[0], sampleSpreadsheets[1]],
    });
    const saveScopeSpy = vi.spyOn(apiClient, 'saveMySheetsScope').mockResolvedValue({
      email: 'user@gmail.com',
      selectedSpreadsheets: [sampleSpreadsheets[0]],
    });

    render(
      <MySheetsCallbackView
        navigate={navigate}
        input={{ mode: 'select' }}
      />
    );

    expect(await screen.findByText('Việc của tôi')).toBeTruthy();
    expect(screen.getByText('KPI quý 4')).toBeTruthy();

    // Remove the second spreadsheet
    const removeBtns = screen.getAllByRole('button', { name: /Bỏ/i });
    expect(removeBtns).toHaveLength(2);
    fireEvent.click(removeBtns[1]);

    expect(saveScopeSpy).toHaveBeenCalledWith({
      spreadsheetIds: [sampleSpreadsheets[0].id],
    });

    // After removing, only 1 remains, and its remove button is disabled
    expect(await screen.findByText(/Cần giữ lại ít nhất 1 bảng tính/)).toBeTruthy();
    const lastRemoveBtn = screen.getByRole('button', { name: /Bỏ/i });
    expect(lastRemoveBtn).toBeDisabled();
  });

  it('strictly validates returnTo and falls back to /settings?mysheets=connected#mysheets on open redirect', async () => {
    const navigate = vi.fn();
    vi.spyOn(apiClient, 'completeMySheetsConnection').mockResolvedValue({
      email: 'user@gmail.com',
      returnTo: '//evil.example/c/hack',
    });
    vi.spyOn(apiClient, 'createMySheetsPickerSession').mockResolvedValue({
      mode: 'google',
      accessToken: 'token-123',
      expiresAt: '2026-10-28T03:00:00Z',
      developerKey: 'dev-key-123',
      appId: '1234567890',
    });
    vi.spyOn(googlePickerModule, 'openGooglePicker').mockResolvedValue(['sheet-1']);
    vi.spyOn(apiClient, 'saveMySheetsScope').mockResolvedValue({
      email: 'user@gmail.com',
      selectedSpreadsheets: [sampleSpreadsheets[0]],
    });

    render(
      <MySheetsCallbackView
        navigate={navigate}
        input={{ code: 'CODE123', state: 'STATE456', returnTo: '//evil.example/c/hack' }}
      />
    );

    await screen.findByText(/Đã xác thực tài khoản/i);
    const chooseBtn = screen.getByRole('button', { name: /Chọn bảng tính trong Google Drive/i });
    fireEvent.click(chooseBtn);

    const doneBtn = await screen.findByRole('button', { name: 'Xong' });
    expect(doneBtn.textContent).not.toContain('quay lại hội thoại');

    fireEvent.click(doneBtn);
    expect(navigate).toHaveBeenCalledWith('/settings?mysheets=connected#mysheets', true);
  });

  it('provides secondary button to return to settings leaving connection in current state', async () => {
    const navigate = vi.fn();
    vi.spyOn(apiClient, 'getMySheetsSpreadsheets').mockResolvedValue({
      email: 'user@gmail.com',
      selectedSpreadsheets: [],
    });

    render(<MySheetsCallbackView navigate={navigate} input={{ mode: 'select' }} />);
    await screen.findByText(/Đã xác thực tài khoản/i);

    const laterButton = screen.getByRole('button', { name: /Để sau/i });
    fireEvent.click(laterButton);

    expect(navigate).toHaveBeenCalledWith('/settings#mysheets', true);
  });
});

describe('SettingsPage - mysheets section', () => {
  function setupServices(service: ServiceInfo) {
    vi.spyOn(apiClient, 'getServices').mockResolvedValue({
      services: [service],
      canConfigure: false,
    });
  }

  it('renders not_connected state with connect button', async () => {
    setupServices(mysheetsService('not_connected'));
    render(<SettingsPage user={member} navigate={() => {}} onLogout={() => {}} />);

    const personal = await screen.findByRole('region', { name: 'Của riêng bạn' });
    expect(within(personal).getByText(/Google Sheets của bạn/i)).toBeTruthy();
    expect(within(personal).getByText('Chưa kết nối')).toBeTruthy();
    expect(within(personal).getByRole('button', { name: /Kết nối Google Sheets/i })).toBeTruthy();
  });

  it('renders scope_required state with email and Choose Spreadsheets button', async () => {
    setupServices(mysheetsService('scope_required'));
    render(<SettingsPage user={member} navigate={() => {}} onLogout={() => {}} />);

    const personal = await screen.findByRole('region', { name: 'Của riêng bạn' });
    expect(within(personal).getByText(/Đã cấp quyền · Chưa chọn bảng tính/i)).toBeTruthy();
    expect(within(personal).getByText(/user@gmail.com/i)).toBeTruthy();
    expect(within(personal).getByRole('button', { name: /Chọn bảng tính/i })).toBeTruthy();
    expect(within(personal).getByRole('button', { name: /Ngắt kết nối/i })).toBeTruthy();
  });

  it('renders connected state with selected spreadsheets, reselect button and disconnect confirmation', async () => {
    setupServices(mysheetsService('connected'));
    vi.spyOn(apiClient, 'disconnectMySheets').mockResolvedValue({ ok: true });

    render(<SettingsPage user={member} navigate={() => {}} onLogout={() => {}} />);

    const personal = await screen.findByRole('region', { name: 'Của riêng bạn' });
    expect(within(personal).getByText('Đã kết nối')).toBeTruthy();
    expect(within(personal).getByText(/user@gmail.com/i)).toBeTruthy();
    expect(within(personal).getByText('Việc của tôi')).toBeTruthy();
    expect(within(personal).getByText('KPI quý 4')).toBeTruthy();
    expect(within(personal).getByText(/\(chỉ xem\)/i)).toBeTruthy();
    expect(within(personal).getByRole('button', { name: /Chọn lại bảng tính/i })).toBeTruthy();

    const disconnectBtn = within(personal).getByRole('button', { name: 'Ngắt kết nối' });
    fireEvent.click(disconnectBtn);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Ngắt kết nối Google Sheets\?/i)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Ngắt kết nối' }));
    await waitFor(() => {
      expect(apiClient.disconnectMySheets).toHaveBeenCalledTimes(1);
    });
  });

  it('renders reconnect_required state with reconnect button', async () => {
    setupServices(mysheetsService('reconnect_required'));
    render(<SettingsPage user={member} navigate={() => {}} onLogout={() => {}} />);

    const personal = await screen.findByRole('region', { name: 'Của riêng bạn' });
    expect(within(personal).getByText(/Cần kết nối lại/i)).toBeTruthy();
    expect(within(personal).getByText(/user@gmail.com/i)).toBeTruthy();
    expect(within(personal).getByRole('button', { name: /Kết nối lại Google Sheets/i })).toBeTruthy();
  });
});

describe('Cockpit RefusalMoment', () => {
  const refusalMessage: ChatMessage = {
    id: 'msg-refusal-1',
    role: 'assistant',
    content: 'Từ chối yêu cầu: Google Sheets của bạn chưa được kết nối.',
    metadata: {
      type: 'refusal',
      reason: 'Google Sheets của bạn chưa được kết nối.',
      unavailableServices: [{ id: 'mysheets', name: 'Google Sheets của bạn' }],
    },
  };

  it('renders Connect button when not_connected and calls startMySheetsConnection with returnTo', async () => {
    const startSpy = vi.spyOn(apiClient, 'startMySheetsConnection').mockResolvedValue({ url: 'https://accounts.google.com/auth' });
    const service = mysheetsService('not_connected');

    render(
      <RefusalMoment
        message={refusalMessage}
        request="Thêm việc vào bảng tính"
        services={[service]}
        canConfigure={false}
        connectFromChat
        conversationId={CONV_ID}
        navigate={() => {}}
        onEdit={() => {}}
      />
    );

    const link = screen.getByRole('link', { name: /Kết nối Google Sheets/i });
    fireEvent.click(link);

    await waitFor(() => {
      expect(startSpy).toHaveBeenCalledWith({ returnTo: `/c/${CONV_ID}` });
    });
  });

  it('renders Choose Spreadsheets button when scope_required and navigates to callback mode=select', async () => {
    const navigate = vi.fn();
    const service = mysheetsService('scope_required');

    render(
      <RefusalMoment
        message={refusalMessage}
        request="Thêm việc vào bảng tính"
        services={[service]}
        canConfigure={false}
        connectFromChat
        conversationId={CONV_ID}
        navigate={navigate}
        onEdit={() => {}}
      />
    );

    const link = screen.getByRole('link', { name: /Chọn bảng tính/i });
    fireEvent.click(link);

    expect(navigate).toHaveBeenCalledWith(`/connections/mysheets/callback?mode=select&returnTo=%2Fc%2F${CONV_ID}`);
  });

  it('renders Reconnect button when reconnect_required', async () => {
    const startSpy = vi.spyOn(apiClient, 'startMySheetsConnection').mockResolvedValue({ url: 'https://accounts.google.com/auth' });
    const service = mysheetsService('reconnect_required');

    render(
      <RefusalMoment
        message={refusalMessage}
        request="Thêm việc vào bảng tính"
        services={[service]}
        canConfigure={false}
        connectFromChat
        conversationId={CONV_ID}
        navigate={() => {}}
        onEdit={() => {}}
      />
    );

    const link = screen.getByRole('link', { name: /Kết nối lại Google Sheets/i });
    fireEvent.click(link);

    await waitFor(() => {
      expect(startSpy).toHaveBeenCalledWith({ returnTo: `/c/${CONV_ID}` });
    });
  });

  it('renders Resend button when service is connected', () => {
    const onResend = vi.fn();
    const service = mysheetsService('connected');

    render(
      <RefusalMoment
        message={refusalMessage}
        request="Thêm việc vào bảng tính"
        services={[service]}
        canConfigure={false}
        connectFromChat
        conversationId={CONV_ID}
        navigate={() => {}}
        onEdit={() => {}}
        onResend={onResend}
      />
    );

    expect(screen.getByText(/Google Sheets của bạn đã được kết nối\. Bạn có thể gửi lại yêu cầu/i)).toBeTruthy();
    const resendBtn = screen.getByRole('button', { name: /Gửi lại yêu cầu/i });
    fireEvent.click(resendBtn);

    expect(onResend).toHaveBeenCalledWith('Thêm việc vào bảng tính');
  });
});

describe('Cockpit PlanMoment & ReceiptMoment', () => {
  const plan: ActivePlan = {
    id: 'plan-1',
    summary: 'Đọc và thêm việc vào Google Sheets của bạn',
    connections: {
      mysheets: {
        credentialId: 'cred-1',
        email: 'user@gmail.com',
        allowedSpreadsheets: [{ id: 'sheet-1', title: 'Việc của tôi', canEdit: true }],
      },
    },
    resourceLabels: {
      'sheet-1': 'Việc của tôi',
    },
    steps: [
      {
        id: 'step-1',
        tool: 'mysheets.read_range',
        description: 'Đọc dòng tiêu đề',
        args: {
          spreadsheetId: 'sheet-1',
          range: 'Tasks!A1:D1',
        },
      },
      {
        id: 'step-2',
        tool: 'mysheets.append_rows',
        description: 'Thêm dòng việc mới',
        args: {
          spreadsheetId: 'sheet-1',
          sheetTitle: 'Tasks',
          rows: [['Chuẩn bị slide bảo vệ', '05/11']],
        },
      },
    ],
  };

  it('renders personal account info and read_range title in PlanMoment', () => {
    const destination = (step: PlanStep, labels?: Record<string, string>) =>
      labels?.[String(step.args.spreadsheetId)] ?? String(step.args.spreadsheetId);

    render(
      <PlanMoment
        plan={plan}
        services={[mysheetsService('connected')]}
        destination={destination}
        onPreview={() => {}}
        onApprove={() => {}}
        onCancel={() => {}}
        onEdit={() => {}}
        inlineComposer={null}
        runtimeMode="sandbox"
      />
    );

    expect(screen.getByText(/Tài khoản: user@gmail\.com \(Google Sheets của bạn\)/i)).toBeTruthy();
    expect(screen.getByText(/Đọc từ bảng tính của bạn: Việc của tôi/i)).toBeTruthy();
  });

  it('renders safe outcome url on ReceiptMoment', () => {
    const destination = (step: PlanStep, labels?: Record<string, string>) =>
      labels?.[String(step.args.spreadsheetId)] ?? String(step.args.spreadsheetId);

    const executionStep = {
      id: 'step-2',
      tool: 'mysheets.append_rows',
      description: 'Thêm dòng việc mới',
      status: 'succeeded' as const,
      output: {
        spreadsheetId: 'sheet-1',
        spreadsheetTitle: 'Việc của tôi',
        sheetTitle: 'Tasks',
        appendedRows: 1,
        url: 'https://docs.google.com/spreadsheets/d/sheet-1/edit',
      },
      duration: '0,4 giây',
    };

    render(
      <ReceiptMoment
        request="Thêm việc vào bảng tính"
        steps={[executionStep]}
        planSteps={plan.steps}
        labels={plan.resourceLabels}
        services={[mysheetsService('connected')]}
        mysheetsConnection={plan.connections?.mysheets}
        destination={destination}
        onNewConversation={() => {}}
        onFollowup={() => {}}
        servicePrompt={() => ''}
        onSettings={() => {}}
        servicesLoading={false}
        servicesError={null}
      />
    );

    expect(screen.getByText(/Tài khoản: user@gmail\.com \(Google Sheets của bạn\)/i)).toBeTruthy();
    const link = screen.getByRole('link', { name: /Mở bảng tính/i });
    expect(link).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/sheet-1/edit');
    expect(link).toHaveAttribute('target', '_blank');
  });
});

describe('Cockpit RecoveryMoment', () => {
  it('renders spreadsheet check url when mysheets.append_rows status is unknown', () => {
    const snapshot: ExecutionSnapshot = {
      execution: {
        status: 'reconciliation_required',
        pausedStepId: 'step-1',
      },
      plan: {
        id: 'plan-1',
        convId: CONV_ID,
        status: 'reconciliation_required',
        summary: 'Thêm dòng vào Google Sheets',
        connections: {
          mysheets: {
            credentialId: 'cred-1',
            email: 'user@gmail.com',
            allowedSpreadsheets: [{ id: 'sheet-1', title: 'Việc của tôi', canEdit: true }],
          },
        },
        resourceLabels: { 'sheet-1': 'Việc của tôi' },
        steps: [
          {
            id: 'step-1',
            tool: 'mysheets.append_rows',
            description: 'Thêm dòng việc mới',
            args: { spreadsheetId: 'sheet-1', sheetTitle: 'Tasks', rows: [['Việc 1']] },
          },
        ],
      },
      steps: [
        {
          stepId: 'step-1',
          tool: 'mysheets.append_rows',
          status: 'unknown',
        },
      ],
      recoveryActions: ['skip', 'stop'],
    };

    const steps = [
      {
        id: 'step-1',
        tool: 'mysheets.append_rows',
        status: 'unknown' as const,
        description: 'Thêm dòng việc mới',
      },
    ];

    render(
      <RecoveryMoment
        moment={8}
        request="Thêm việc vào bảng tính"
        snapshot={snapshot}
        steps={steps}
        services={[mysheetsService('connected')]}
        controls={null}
      />
    );

    expect(screen.getByText(/Hãy tự kiểm tra trên Google Sheets của user@gmail\.com rồi chọn Bỏ qua hoặc Dừng/i)).toBeTruthy();
    const link = screen.getByRole('link', { name: /Mở Google Sheets/i });
    expect(link).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/sheet-1/edit');
  });
});

describe('PrivacyPage with mysheetsEnabled', () => {
  it('displays Google Sheets privacy section when enabled', async () => {
    vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({
      runtimeMode: 'sandbox',
      mysheetsEnabled: true,
    });

    render(<PrivacyPage navigate={() => {}} />);
    await waitFor(() => expect(apiClient.getRuntime).toHaveBeenCalled());

    expect(await screen.findByRole('region', { name: /Bảng tính Google Sheets của bạn/i })).toBeTruthy();
  });
});

describe('GuidePage and LandingPage with mysheetsEnabled', () => {
  it('uses only available tools in sample catalogues', () => {
    const enabled = new Set([...ALL_TOOLS, ...MYSHEETS_TOOLS].map(tool => tool.name));
    for (const prompt of [...SAMPLE_PROMPTS, ...MYSHEETS_PROMPTS, MYSHEETS_SCHEDULE_PROMPT]) {
      for (const tool of prompt.tools) {
        expect(enabled.has(tool)).toBe(true);
      }
    }
  });

  it.each([false, true])('gates Google Sheets guide, sample prompts and landing card on mysheetsEnabled: %s', async enabled => {
    vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({
      runtimeMode: 'sandbox',
      mysheetsEnabled: enabled,
    });

    const guide = render(<GuidePage navigate={() => {}} />);
    await waitFor(() => expect(apiClient.getRuntime).toHaveBeenCalled());

    if (enabled) {
      fireEvent.click(await screen.findByRole('button', { name: 'Google Sheets của bạn' }));
      expect(within(document.getElementById('service-guide-detail')!).getByRole('heading', { name: 'Google Sheets của bạn' })).toBeTruthy();
      expect(screen.getByRole('link', { name: /Kết nối Google Sheets/ })).toBeTruthy();
      expect(screen.getByText('Google OAuth · không nhập khoá')).toBeTruthy();
    } else {
      expect(screen.queryByRole('button', { name: 'Google Sheets của bạn' })).toBeNull();
    }

    fireEvent.click(document.getElementById('tab-btn-prompts')!);
    if (enabled) {
      expect(await screen.findByText('Thêm việc vào bảng tính cá nhân')).toBeTruthy();
    } else {
      expect(screen.queryByText('Thêm việc vào bảng tính cá nhân')).toBeNull();
    }

    guide.unmount();
    render(<LandingPage navigate={() => {}} />);
    if (enabled) {
      expect(await screen.findByText('Google Sheets · Của riêng bạn')).toBeTruthy();
      expect(screen.getByRole('link', { name: /Cách kết nối và mẫu câu Google Sheets/i })).toHaveAttribute(
        'href',
        '/guide?service=mysheets'
      );
    } else {
      expect(screen.queryByText('Google Sheets · Của riêng bạn')).toBeNull();
    }
  });
});
