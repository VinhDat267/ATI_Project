import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { GMAIL_TOOLS, type ScheduleRunView, type ScheduleView } from '@wap/tool-schemas';
import { resourceDestination } from '../src/components/Cockpit';
import { PlanMoment } from '../src/pages/Cockpit/PlanMoment';
import { ReceiptMoment } from '../src/pages/Cockpit/ReceiptMoment';
import { PreviewContents } from '../src/pages/Cockpit/PreviewContents';
import { PreviewModal } from '../src/pages/Cockpit/PreviewModal';
import { RecoveryMoment } from '../src/pages/Cockpit/RecoveryMoment';
import { ScheduleActions } from '../src/pages/Cockpit/ScheduleActions';
import { ScheduleMoment } from '../src/pages/Cockpit/ScheduleMoment';
import {
  isUncertainSheetsDeliveryRun,
  SheetsDeliveryRecoveryControl,
} from '../src/pages/Cockpit/ScheduleRunRecovery';
import { operation, servicePalette } from '../src/pages/Cockpit/presentation';
import { WorkflowFlowCanvas } from '../src/components/WorkflowFlowCanvas';
import { LandingPage } from '../src/pages/Landing/LandingPage';
import { PrivacyPage } from '../src/pages/Privacy/PrivacyPage';
import { SettingsPage } from '../src/pages/Settings/SettingsPage';
import { apiClient } from '../src/services/api-client';
import { authStorage } from '../src/services/auth-storage';
import type { ExecutionSnapshot, PlanStep, User } from '../src/types';

afterEach(() => { cleanup(); vi.restoreAllMocks(); authStorage.clearStoredTokens(); window.history.replaceState({}, '', '/'); });
const thread = 'gmail-thread-1';
const labels = { [thread]: 'Họp nhóm ATI', Label_1: 'Quan trọng', INBOX: 'Hộp thư đến' };
const step = (tool: string, args: PlanStep['args']): PlanStep => ({ id: tool.split('.')[1]!, tool, description: 'Việc Gmail', args });
const reply = step('gmail.reply', { threadId: thread, to: ['lan@example.com'], body: 'Mình đồng ý' });
const trash = step('gmail.trash_thread', { threadId: thread });
const relabel = step('gmail.modify_thread_labels', { threadId: thread, addLabelIds: ['Label_1'], removeLabelIds: ['INBOX'] });

it.each([
  ['gmail.send_message', 'Gửi thư', 'Đã gửi thư'], ['gmail.reply', 'Trả lời thư', 'Đã gửi trả lời'], ['gmail.forward', 'Chuyển tiếp thư', 'Đã chuyển tiếp'],
  ['gmail.create_draft', 'Tạo thư nháp', 'Đã tạo thư nháp'], ['gmail.modify_thread_labels', 'Đổi nhãn', 'Đã đổi nhãn'],
  ['gmail.batch_modify_threads', 'Đổi nhãn hàng loạt', 'Đã đổi nhãn hàng loạt'],
  ['gmail.trash_thread', 'Chuyển vào thùng rác', 'Đã chuyển vào thùng rác'], ['gmail.create_label', 'Tạo nhãn', 'Đã tạo nhãn'],
])('names what %s does on the plan card and while it runs', (tool, action, done) => {
  expect(operation(tool)).toMatchObject({ action, done });
});
it('declares an action for every Gmail write tool instead of guessing "Cập nhật"', () => {
  for (const tool of GMAIL_TOOLS.filter(t => t.sideEffect === 'write')) expect(operation(tool.name).action, tool.name).not.toBe('Cập nhật');
});
it('defines complete Gmail badge, previewBadge and receiptHover tokens without undefined classes', () => {
  const palette = servicePalette('gmail');
  expect(palette.badge).toBeTruthy();
  expect(palette.previewBadge).toBeTruthy();
  expect(palette.receiptHover).toBeTruthy();
  render(<PreviewModal step={reply} services={[]} labels={labels} sender="own@gmail.test" destination={resourceDestination} onClose={() => {}} />);
  expect(document.getElementById('preview-service-tag')?.className).not.toContain('undefined');
});

it('shows the thread a Gmail step acts on as its destination, including batch threadIds and direct recipients', () => {
  expect(resourceDestination(reply, labels)).toBe('Họp nhóm ATI');
  expect(resourceDestination(trash, labels)).toBe('Họp nhóm ATI');
  // Labels are what the step applies, not where it writes.
  expect(resourceDestination(relabel, labels)).toBe('Họp nhóm ATI');
  expect(resourceDestination(trash, {})).toBe('Luồng thư · chưa có tên trong dữ liệu');
  const batch = step('gmail.batch_modify_threads', { threadIds: ['gmail-thread-1', 'gmail-thread-2'], removeLabelIds: ['UNREAD'] });
  expect(resourceDestination(batch, { ...labels, 'gmail-thread-2': 'Báo cáo tuần' })).toBe('Họp nhóm ATI, Báo cáo tuần');
  expect(resourceDestination(batch, {})).toBe('Luồng thư · chưa có tên trong dữ liệu');
  const send = step('gmail.send_message', { to: ['khachhang@agency.vn', 'pm@agency.vn'], subject: 'Báo giá', body: 'Nội dung' });
  expect(resourceDestination(send, {})).toBe('khachhang@agency.vn, pm@agency.vn');
});

it('displays Gmail account attribution in ReceiptMoment (Moment 6) and extracts Gmail scopes in WorkflowFlowCanvas', () => {
  render(
    <ReceiptMoment
      request="Trả lời email"
      steps={[{ id: reply.id, tool: reply.tool, description: reply.description, status: 'succeeded', duration: '0,4 giây' }]}
      planSteps={[reply]}
      services={[]}
      labels={labels}
      gmailConnection={{ credentialId: 'c', email: 'own@gmail.test' }}
      destination={resourceDestination}
      onNewConversation={() => {}}
      onFollowup={() => {}}
    />
  );
  expect(screen.getAllByText(/own@gmail\.test \(Gmail của bạn\)/).length).toBeGreaterThanOrEqual(1);
  cleanup();

  const batch = step('gmail.batch_modify_threads', { threadIds: ['gmail-thread-1', 'gmail-thread-2'], removeLabelIds: ['UNREAD'] });
  render(<WorkflowFlowCanvas steps={[batch]} resourceLabels={{ ...labels, 'gmail-thread-2': 'Báo cáo tuần' }} mode="preview" />);
  fireEvent.click(screen.getByTestId('workflow-node-gmail'));
  expect(screen.getByText('Phạm vi: Họp nhóm ATI')).toBeTruthy();
  expect(screen.getByText('Phạm vi: Báo cáo tuần')).toBeTruthy();
});

it('labels reply and trash cards with their real action and thread on the approval screen', () => {
  const plan = { id: 'plan', convId: 'conv', summary: 'Thư', status: 'pending' as const, resourceLabels: labels, steps: [reply, trash],
    connections: { gmail: { credentialId: 'c', email: 'own@gmail.test' } } };
  render(<PlanMoment runtimeMode="sandbox" plan={plan} services={[]} destination={resourceDestination} onPreview={() => {}} onApprove={() => {}} onCancel={() => {}} onEdit={() => {}} inlineComposer={null} />);
  const [replyCard, trashCard] = [...document.querySelectorAll('#plan-cards-container article')] as HTMLElement[];
  expect(within(replyCard!).getByText('Trả lời thư')).toBeTruthy();
  expect(within(replyCard!).getByText('Đích đến: Họp nhóm ATI')).toBeTruthy();
  expect(within(trashCard!).getByText('Chuyển vào thùng rác')).toBeTruthy();
  expect(within(trashCard!).getByText('Đích đến: Họp nhóm ATI')).toBeTruthy();
  expect(screen.queryByText('Cập nhật')).toBeNull();
});

it('previews a trash step by thread title, never by a raw thread ID', () => {
  render(<PreviewContents step={trash} destination="" labels={labels} />);
  expect(screen.getByText('Luồng thư')).toBeTruthy();
  expect(screen.getByText('Họp nhóm ATI')).toBeTruthy();
  expect(screen.getByText(/chuyển vào Thùng rác của Gmail/)).toBeTruthy();
  expect(screen.queryByText('threadId')).toBeNull();
  expect(document.body.textContent).not.toContain(thread);
});
it('previews label changes by label name', () => {
  render(<PreviewContents step={relabel} destination="" labels={labels} />);
  expect(screen.getByText('Thêm nhãn')).toBeTruthy(); expect(screen.getByText('Quan trọng')).toBeTruthy();
  expect(screen.getByText('Bỏ nhãn')).toBeTruthy(); expect(screen.getByText('Hộp thư đến')).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/Label_1|addLabelIds|removeLabelIds/);
});
it('says when a thread has no title in the data instead of passing the ID off as one', () => {
  render(<PreviewContents step={trash} destination="" labels={{}} />);
  expect(screen.getByText(/gmail-thread-1 · chưa có tiêu đề trong dữ liệu/)).toBeTruthy();
});

it('offers the sent folder only while a send is unknown, not after a known failure', () => {
  const plan = { id: 'plan', convId: 'conv', summary: 'Thư', status: 'failed' as const, steps: [reply], connections: { gmail: { credentialId: 'c', email: 'own@gmail.test' } } };
  const snapshot: ExecutionSnapshot = { plan, execution: { status: 'failed', pausedStepId: reply.id }, steps: [{ stepId: reply.id, tool: reply.tool, status: 'failed' }], recoveryActions: ['retry', 'skip', 'stop'] };
  render(<RecoveryMoment moment={7} snapshot={snapshot} steps={[{ id: reply.id, tool: reply.tool, description: 'Thư', status: 'failed' }]} services={[]} controls={null} />);
  expect(screen.queryByRole('link', { name: 'Mở thư mục Đã gửi' })).toBeNull();
});

it.each([false, true])('shows the Gmail data section of /privacy only when Gmail is enabled: %s', async enabled => {
  vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox', gmailEnabled: enabled });
  render(<PrivacyPage navigate={() => {}} />);
  await waitFor(() => expect(apiClient.getRuntime).toHaveBeenCalled());
  await act(async () => {});
  if (enabled) expect(within(await screen.findByRole('region', { name: 'Dữ liệu Gmail' })).getByText('Hộp thư Gmail bạn kết nối')).toBeTruthy();
  else expect(screen.queryByText('Hộp thư Gmail bạn kết nối')).toBeNull();
});

it('keeps the connection with a secondary "Giữ kết nối" button in the disconnect dialog', async () => {
  const member: User = { id: 'member', email: 'ati@example.test', name: 'Thành viên', role: 'member' };
  authStorage.setStoredTokens({ accessToken: 'a', refreshToken: 'ar', user: member });
  vi.spyOn(apiClient, 'getServices').mockResolvedValue({ canConfigure: false, services: [{ id: 'gmail', name: 'Gmail', connection: 'personal', personalStatus: 'connected', connected: true, configured: true, email: 'own@gmail.test' }] } as never);
  const disconnect = vi.spyOn(apiClient, 'disconnectGmail').mockResolvedValue({ success: true });
  render(<SettingsPage user={member} navigate={() => {}} onLogout={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ngắt kết nối' }));
  const dialog = await screen.findByRole('dialog', { name: 'Ngắt kết nối Gmail?' });
  const keep = within(dialog).getByRole('button', { name: 'Giữ kết nối' });
  expect(keep.className).not.toContain('#FF5701');
  expect(within(dialog).getByRole('button', { name: 'Xác nhận ngắt kết nối' }).className).toContain('#FF5701');
  expect(within(dialog).queryByRole('button', { name: 'Tiếp tục kết nối' })).toBeNull();
  fireEvent.click(keep);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(disconnect).not.toHaveBeenCalled();
});

it('lists Gmail with the services on the landing page, outside the hidden demo step', async () => {
  vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({ runtimeMode: 'sandbox', gmailEnabled: true });
  render(<LandingPage navigate={() => {}} />);
  const card = (await screen.findByText('Gmail · Của riêng bạn')).closest('div')!;
  expect(card.closest('[data-od-id="integrations-section"]')).not.toBeNull();
  expect(card.closest('#stage-panel-2')).toBeNull();
});

it('D1-16: always renders exact attachment omission warning on gmail.forward preview without filenames, and never on non-forward tools', () => {
  const forwardStep = step('gmail.forward', {
    threadId: thread,
    to: ['director@example.com'],
    note: 'Nhờ anh xem giúp',
  });
  render(<PreviewContents step={forwardStep} destination="Họp nhóm ATI" labels={labels} />);
  expect(
    screen.getByText('Chỉ chuyển tiếp văn bản; tệp đính kèm gốc không được gửi.')
  ).toBeInTheDocument();
  cleanup();

  for (const nonForwardTool of ['gmail.send_message', 'gmail.reply', 'gmail.create_draft'] as const) {
    const otherStep = step(nonForwardTool, {
      ...(nonForwardTool !== 'gmail.send_message' ? { threadId: thread } : {}),
      to: ['director@example.com'],
      subject: 'Re: Họp nhóm ATI',
      body: 'Nội dung thư',
    });
    render(<PreviewContents step={otherStep} destination="Họp nhóm ATI" labels={labels} />);
    expect(
      screen.queryByText('Chỉ chuyển tiếp văn bản; tệp đính kèm gốc không được gửi.')
    ).toBeNull();
    cleanup();
  }
});

it('D1-15: reuses GmailPreview inline on PlanMoment before approval with To/Cc/Bcc, provenance, warnings, note, full body, send-vs-draft, drift/subject guidance, and zero DOM credentials', () => {
  const multilineBody = Array.from({ length: 8 }, (_, idx) => `Dòng nội dung số ${idx + 1}`).join('\n');
  const forwardWithRecipients = step('gmail.forward', {
    threadId: thread,
    to: ['user@example.test'],
    cc: ['thread@example.test'],
    bcc: ['audit@example.test'],
    note: 'Chuyển tiếp biên bản họp cho ban điều hành',
    body: multilineBody,
  });
  const threadedDraft = step('gmail.create_draft', {
    threadId: thread,
    to: ['lan@example.com'],
    body: 'Nháp trả lời chi tiết trước khi gửi',
  });
  const richLabels = {
    ...labels,
    'recipient:user@example.test': 'user',
    'recipient:thread@example.test': 'thread:Họp nhóm ATI',
  };
  const onPreview = vi.fn();
  const plan = {
    id: 'plan-gmail-inline',
    convId: 'conv-1',
    summary: 'Chuyển tiếp và tạo nháp',
    status: 'pending' as const,
    resourceLabels: richLabels,
    connections: { gmail: { credentialId: 'secret-cred-uuid-999', email: 'own@gmail.test' } },
    steps: [forwardWithRecipients, threadedDraft],
  };

  render(
    <PlanMoment
      runtimeMode="live"
      plan={plan}
      services={[]}
      destination={resourceDestination}
      onPreview={onPreview}
      onApprove={() => {}}
      onCancel={() => {}}
      onEdit={() => {}}
      inlineComposer={null}
    />
  );

  // Single consistent Gmail renderer: inline GmailPreview cards exist before clicking Xem trước; no duplicate truncated step-inline-payload
  expect(screen.queryByTestId('step-inline-payload')).toBeNull();
  const cards = [...document.querySelectorAll('#plan-cards-container article')] as HTMLElement[];
  expect(cards).toHaveLength(2);

  const [forwardCard, draftCard] = cards;
  expect(within(forwardCard!).getByTestId('gmail-preview-card')).toBeInTheDocument();
  expect(within(forwardCard!).getByText('user@example.test')).toBeInTheDocument();
  expect(within(forwardCard!).getByText('thread@example.test')).toBeInTheDocument();
  expect(within(forwardCard!).getByText('audit@example.test')).toBeInTheDocument();
  expect(within(forwardCard!).getByText('bạn đã gõ')).toBeInTheDocument();
  expect(within(forwardCard!).getByText("lấy từ luồng thư 'Họp nhóm ATI'")).toBeInTheDocument();
  expect(within(forwardCard!).getByText('chưa có nhãn nguồn; hãy kiểm lại')).toBeInTheDocument();
  expect(within(forwardCard!).getByRole('alert')).toHaveTextContent(/có thể bị giả mạo/);
  expect(
    within(forwardCard!).getByText('Chỉ chuyển tiếp văn bản; tệp đính kèm gốc không được gửi.')
  ).toBeInTheDocument();
  expect(
    within(forwardCard!).getByText('Chuyển tiếp biên bản họp cho ban điều hành')
  ).toBeInTheDocument();
  const bodyNode = within(forwardCard!).getByText(/Dòng nội dung số 8/);
  expect(bodyNode.className).not.toContain('line-clamp-2');
  expect(within(forwardCard!).getByText(/tin nhắn đã gửi mới nhất/i)).toBeInTheDocument();
  expect(within(forwardCard!).getByText(/Gửi thư thật tới người nhận/i)).toBeInTheDocument();

  // Draft card distinguishes draft creation from immediate sending and discloses latest-delivered + custom-subject standalone draft guidance
  expect(within(draftCard!).getByTestId('gmail-preview-card')).toBeInTheDocument();
  expect(within(draftCard!).getByText(/Chỉ tạo thư nháp trong Gmail; chưa gửi/i)).toBeInTheDocument();
  expect(within(draftCard!).getByText(/tin nhắn đã gửi mới nhất/i)).toBeInTheDocument();
  expect(within(draftCard!).getByText(/thư nháp độc lập mới nếu muốn đổi tiêu đề/i)).toBeInTheDocument();

  // Detailed modal preview trigger remains keyboard-focusable and operational before Duyệt kế hoạch
  const previewButtons = screen.getAllByRole('button', { name: 'Xem trước' });
  expect(previewButtons).toHaveLength(2);
  previewButtons[0]!.focus();
  expect(previewButtons[0]).toHaveFocus();
  fireEvent.click(previewButtons[0]!);
  expect(onPreview).toHaveBeenCalledWith(forwardWithRecipients);

  // Zero credentials/tokens in DOM even when technical JSON panel is opened
  fireEvent.click(screen.getByRole('button', { name: /Chi tiết kỹ thuật/i }));
  expect(document.body.textContent).not.toContain('secret-cred-uuid-999');
  expect(document.body.textContent).not.toContain('credentialId');

  cleanup();

  // Draft-only plan attribution chip does not mislabel draft creation as "Gửi từ:"
  const draftOnlyPlan = { ...plan, steps: [threadedDraft] };
  render(
    <PlanMoment
      runtimeMode="live"
      plan={draftOnlyPlan}
      services={[]}
      destination={resourceDestination}
      onPreview={() => {}}
      onApprove={() => {}}
      onCancel={() => {}}
      onEdit={() => {}}
      inlineComposer={null}
    />
  );
  expect(screen.queryByText(/^Gửi từ:/)).toBeNull();
  expect(screen.getByText(/Tạo thư nháp tại: own@gmail\.test/)).toBeInTheDocument();
});

it.each([false, true])(
  'D1-13: reconciles PrivacyPage personal Calendar/Sheets opt-in, interactive vs recurring auto digest, configured AI provider, post-disconnect retention, and conditional revoke (flags=%s)',
  async (flagsEnabled) => {
    vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({
      runtimeMode: 'live',
      gmailEnabled: flagsEnabled,
      mycalendarEnabled: flagsEnabled,
      mysheetsEnabled: flagsEnabled,
    });
    render(<PrivacyPage navigate={() => {}} />);
    await waitFor(() => expect(apiClient.getRuntime).toHaveBeenCalled());
    await act(async () => {});

    const main = screen.getByRole('main');
    const text = main.textContent ?? '';
    expect(text).toMatch(/Khi chưa kết nối dịch vụ cá nhân,\s*Planora không truy cập Drive hay lịch cá nhân/i);
    expect(text).not.toMatch(/sẽ bị thu hồi hoàn toàn/i);
    expect(text).toMatch(/Google Calendar|Google Sheets/);
    expect(text).toMatch(/Duyệt kế hoạch/);
    expect(text).toMatch(/định kỳ.*xác nhận một lần|xác nhận một lần.*định kỳ/i);
    expect(text).toMatch(/xoá ngay token|bị xoá ngay/i);
    expect(text).toMatch(/nỗ lực tốt nhất|có điều kiện/i);
    expect(text).toMatch(/vẫn lưu lại|vẫn được giữ lại/i);

    if (flagsEnabled) {
      const gmailRegion = screen.getByRole('region', { name: 'Dữ liệu Gmail' });
      expect(gmailRegion).not.toHaveTextContent(/9router/i);
      expect(gmailRegion).toHaveTextContent(/nhà cung cấp mô hình AI bên thứ ba đã cấu hình/);
      expect(gmailRegion).toHaveTextContent(/nỗ lực tốt nhất/);
      expect(gmailRegion).toHaveTextContent(/vẫn được giữ lại sau khi ngắt kết nối/);
    }
  }
);

it('B2: displays confirmed completedThreadIds, failedThreadId, causeCategory, and non-rerun guidance on batch UNKNOWN without crashing on malformed error.details', () => {
  const batchStep = step('gmail.batch_modify_threads', {
    threadIds: ['gmail-thread-1', 'gmail-thread-2', 'gmail-thread-3'],
    addLabelIds: ['Label_1'],
  });
  const basePlan = {
    id: 'plan-batch',
    convId: 'conv-batch',
    summary: 'Gắn nhãn hàng loạt',
    status: 'reconciliation_required' as const,
    resourceLabels: { ...labels, 'gmail-thread-2': 'Báo cáo tuần' },
    connections: { gmail: { credentialId: 'c1', email: 'own@gmail.test' } },
    steps: [batchStep],
  };
  const validSnapshot: ExecutionSnapshot = {
    plan: basePlan,
    execution: { status: 'reconciliation_required', pausedStepId: batchStep.id },
    recoveryActions: ['skip', 'stop'],
    steps: [
      {
        stepId: batchStep.id,
        tool: batchStep.tool,
        status: 'unknown',
        error: {
          category: 'UNKNOWN',
          message: 'Token expired mid-batch',
          details: {
            requestSent: true,
            completedThreadIds: ['gmail-thread-1', 'gmail-thread-2'],
            failedThreadId: 'gmail-thread-3',
            causeCategory: 'AUTH_ERROR',
          },
        } as unknown as ExecutionSnapshot['steps'][number]['error'],
      },
    ],
  };
  const execSteps = [
    { id: batchStep.id, tool: batchStep.tool, description: 'Đổi nhãn 3 luồng thư', status: 'unknown' as const },
  ];

  for (const moment of [8, 9] as const) {
    render(<RecoveryMoment moment={moment} snapshot={validSnapshot} steps={execSteps} services={[]} controls={null} />);
    expect(screen.queryByRole('button', { name: /Thử lại|Sửa rồi|Làm tiếp/ })).toBeNull();
    const detailsBox = screen.getByTestId('batch-unknown-details');
    expect(detailsBox).toHaveTextContent('Họp nhóm ATI (gmail-thread-1)');
    expect(detailsBox).toHaveTextContent('Báo cáo tuần (gmail-thread-2)');
    expect(detailsBox).toHaveTextContent('gmail-thread-3');
    expect(detailsBox).toHaveTextContent('AUTH_ERROR');
    expect(screen.getByText(/không chạy lại toàn bộ lô/i)).toBeInTheDocument();
    expect(screen.queryByText(/dừng kế hoạch rồi gửi lại yêu cầu/i)).toBeNull();
    cleanup();
  }

  // Malformed / absent error.details guard checks
  const malformedCases: unknown[] = [
    undefined,
    null,
    'corrupted-string',
    { completedThreadIds: [], failedThreadId: '', causeCategory: 12345 },
    { completedThreadIds: [null, 99, '  ', 'raw-thread-ok'], failedThreadId: { bad: true }, causeCategory: ['x'] },
  ];
  for (const rawDetails of malformedCases) {
    const guardedSnapshot: ExecutionSnapshot = {
      ...validSnapshot,
      plan: { ...basePlan, resourceLabels: {} },
      steps: [
        {
          stepId: batchStep.id,
          tool: batchStep.tool,
          status: 'unknown',
          error: (rawDetails === undefined
            ? 'Plain error string'
            : { message: 'Interrupted', details: rawDetails }) as unknown as ExecutionSnapshot['steps'][number]['error'],
        },
      ],
    };
    render(<RecoveryMoment moment={8} snapshot={guardedSnapshot} steps={execSteps} services={[]} controls={null} />);
    expect(screen.queryByRole('button', { name: /Thử lại|Sửa rồi|Làm tiếp/ })).toBeNull();
    expect(document.body.textContent).not.toContain('[object Object]');
    expect(document.body.textContent).not.toContain('undefined');
    expect(screen.getByText(/không chạy lại toàn bộ lô/i)).toBeInTheDocument();
    const detailsCard = screen.getByTestId('batch-unknown-details');
    if (Array.isArray((rawDetails as { completedThreadIds?: unknown })?.completedThreadIds) && (rawDetails as { completedThreadIds: unknown[] }).completedThreadIds.includes('raw-thread-ok')) {
      expect(detailsCard).toHaveTextContent('raw-thread-ok');
    } else {
      expect(detailsCard.textContent).not.toContain('gmail-thread-1');
    }
    cleanup();
  }
});

it('shows uncertain Telegram delivery recovery controls on TELEGRAM_DELIVERY_UNKNOWN runs', () => {
  const unknownRun: ScheduleRunView = {
    id: 'run-tg-unknown',
    scheduleId: 'sched-tg-1',
    trigger: 'scheduled',
    dueAt: '2026-11-10T01:00:00.000Z',
    createdAt: '2026-11-10T01:00:00.000Z',
    state: 'needs_attention',
    missedCount: 1,
    convId: 'conv-tg-1',
    planId: null,
    planStatus: null,
    error: 'TELEGRAM_DELIVERY_UNKNOWN: Network reset after Telegram send',
    deliveryStartedAt: '2026-11-10T01:00:05.000Z',
    deliveryResolution: null,
  };

  expect(isUncertainSheetsDeliveryRun(unknownRun)).toBe(true);
  render(
    <SheetsDeliveryRecoveryControl
      run={unknownRun}
      scheduleStatus="active"
      onResolved={() => {}}
    />,
  );
  expect(screen.getByTestId('sheets-delivery-recovery-panel')).toBeInTheDocument();
  expect(screen.getByTestId('btn-resolve-mark-sent')).toBeInTheDocument();
  expect(screen.getByTestId('btn-resolve-retry-new-run')).toBeInTheDocument();
});

it('supports telegram_digest reauthorize CTA, locked Gmail query display, and includeAiSummary opt-out toggle', async () => {
  const pausedTgSchedule: ScheduleView = {
    id: 'sched-tg-reauth',
    convId: 'conv-tg-reauth',
    version: 3,
    name: 'Bản tin Gmail sáng',
    request: 'Mỗi sáng 8h tóm tắt email hóa đơn chưa đọc gửi Telegram',
    recurrence: { type: 'daily', time: '08:00' },
    services: ['gmail', 'telegram'],
    status: 'paused',
    pauseReason: 'Kết nối Gmail của chủ lịch không còn hoạt động hoặc cần kết nối lại.',
    nextRuns: [],
    lastRun: null,
    kind: 'telegram_digest',
    approvalMode: 'auto_digest',
  };
  const navigate = vi.fn();
  vi.spyOn(apiClient, 'reauthorizeSchedulePreview').mockResolvedValue({
    proposalMessageId: 'msg-reauth-1',
    convId: 'conv-tg-reauth',
    scheduleId: pausedTgSchedule.id,
    baseVersion: 3,
    expiresAt: '2026-11-15T01:00:00.000Z',
  } as any);

  render(
    <ScheduleActions
      schedule={pausedTgSchedule}
      navigate={navigate}
      onChanged={() => {}}
      onConflict={async () => {}}
    />,
  );
  const reauthBtn = screen.getByTestId('btn-reauthorize-schedule-preview');
  fireEvent.click(reauthBtn);
  await waitFor(() =>
    expect(apiClient.reauthorizeSchedulePreview).toHaveBeenCalledWith('sched-tg-reauth'),
  );
  expect(navigate).toHaveBeenCalledWith('/c/conv-tg-reauth');
  cleanup();

  const confirmSpy = vi.spyOn(apiClient, 'confirmSchedule').mockResolvedValue({
    schedule: { ...pausedTgSchedule, status: 'active', pauseReason: null, version: 4 },
  } as any);

  render(
    <ScheduleMoment
      convId="conv-tg-1"
      message={{
        id: 'msg-tg-prop-1',
        role: 'assistant',
        content: '',
        metadata: {
          type: 'schedule_proposal',
          services: ['gmail', 'telegram'],
          nextRuns: ['2026-11-15T01:00:00.000Z'],
          previous: null,
          proposal: {
            kind: 'schedule',
            action: 'create',
            name: 'Bản tin Gmail sáng',
            request: 'Mỗi sáng 8h tóm tắt email hóa đơn gửi Telegram của tôi',
            recurrence: { type: 'daily', time: '08:00' },
            summary: 'Bản tin Gmail sáng',
          },
          digestCandidate: {
            canAutoDigest: true,
            configHash: 'hash-1',
            config: {
              credentialId: 'tg-cred-1',
              telegramUserId: '777',
              username: 'owner',
              chatId: '777',
              chatTitle: 'Telegram của tôi',
              sourceBindingVersion: 1,
              sources: [
                {
                  service: 'gmail',
                  tool: 'gmail.search_threads',
                  args: { query: 'in:inbox is:unread (hóa đơn OR invoice)' },
                  label: 'Email chưa đọc (owner@example.test)',
                },
              ],
              recurrence: { type: 'daily', time: '08:00' },
              timeZone: 'Asia/Ho_Chi_Minh',
            },
          },
        } as any,
      }}
    />,
  );

  fireEvent.click(document.getElementById('schedule-mode-auto-digest')!);
  expect(screen.getByTestId('gmail-digest-locked-query')).toHaveTextContent(
    'in:inbox is:unread (hóa đơn OR invoice)',
  );
  const aiCheckbox = screen.getByTestId('checkbox-telegram-include-ai-summary') as HTMLInputElement;
  expect(aiCheckbox.checked).toBe(true);
  fireEvent.click(aiCheckbox);
  expect(aiCheckbox.checked).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
  await waitFor(() =>
    expect(confirmSpy).toHaveBeenCalledWith('conv-tg-1', 'msg-tg-prop-1', {
      approvalMode: 'auto_digest',
      includeAiSummary: false,
    }),
  );
});

it('renders previews and account chips for gmail.update_draft, gmail.send_draft, and gmail.forward with includeAttachments: true', () => {
  const forwardWithAtt = step('gmail.forward', {
    threadId: thread,
    to: ['director@example.com'],
    note: 'Gửi kèm báo giá gốc',
    includeAttachments: true,
  });
  render(<PreviewContents step={forwardWithAtt} destination="Họp nhóm ATI" labels={labels} />);
  expect(screen.getByTestId('gmail-forward-attachment-included')).toBeInTheDocument();
  expect(screen.queryByTestId('gmail-forward-attachment-warning')).toBeNull();
  cleanup();

  const updateDraft = step('gmail.update_draft', {
    draftId: 'draft-1',
    to: ['lan@example.com'],
    subject: 'Báo giá mới',
    body: 'Nội dung sửa đổi',
  });
  const draftPlan = {
    id: 'plan-draft-up',
    convId: 'conv-draft-up',
    summary: 'Sửa nháp',
    status: 'pending' as const,
    resourceLabels: { 'draft-1': 'Báo giá Q4', 'recipient:lan@example.com': 'user' },
    connections: { gmail: { credentialId: 'c1', email: 'own@gmail.test' } },
    steps: [updateDraft],
  };
  render(
    <PlanMoment
      runtimeMode="live"
      plan={draftPlan}
      services={[]}
      destination={resourceDestination}
      onPreview={() => {}}
      onApprove={() => {}}
      onCancel={() => {}}
      onEdit={() => {}}
      inlineComposer={null}
    />,
  );
  expect(screen.getByText('Tạo thư nháp tại: own@gmail.test')).toBeInTheDocument();
  expect(screen.getByTestId('gmail-delivery-mode')).toHaveTextContent(/chỉ cập nhật nội dung thư nháp/i);
  expect(screen.getByText('Báo giá Q4')).toBeInTheDocument();
  cleanup();

  const sendDraft = step('gmail.send_draft', { draftId: 'draft-1' });
  render(
    <PlanMoment
      runtimeMode="live"
      plan={{ ...draftPlan, id: 'plan-draft-send', steps: [sendDraft] }}
      services={[]}
      destination={resourceDestination}
      onPreview={() => {}}
      onApprove={() => {}}
      onCancel={() => {}}
      onEdit={() => {}}
      inlineComposer={null}
    />,
  );
  expect(screen.getByText('Gửi từ: own@gmail.test')).toBeInTheDocument();
  expect(screen.getByTestId('gmail-draft-send-recipient-note')).toBeInTheDocument();
});
