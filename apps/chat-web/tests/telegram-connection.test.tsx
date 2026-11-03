/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { TelegramConnection } from '../src/pages/Settings/TelegramConnection';
import { TelegramCallbackView } from '../src/views/TelegramCallbackView';
import { apiClient } from '../src/services/api-client';
import { PlanMoment } from '../src/pages/Cockpit/PlanMoment';
import { PreviewModal } from '../src/pages/Cockpit/PreviewModal';
import { ResponseMoment } from '../src/pages/Responses/ResponseMoment';
import { ReceiptMoment } from '../src/pages/Cockpit/ReceiptMoment';
import { GuidePage } from '../src/pages/Guide/GuidePage';
import { GUIDE_OAUTH_SHOWCASE_CARDS } from '../src/pages/Guide/data';
import { resourceDestination } from '../src/components/Cockpit';
import { SettingsPage } from '../src/pages/Settings/SettingsPage';
import { telegramConnectionNotice } from '../src/services/telegram-connection';
import { authStorage } from '../src/services/auth-storage';
import type { ActivePlan, User } from '../src/types';

describe('Task 9: Telegram 1-Click Pairing UI, Settings & Cockpit Moments', () => {
  const adminUser: User = { id: 'u-admin', email: 'admin@example.com', name: 'Admin', role: 'admin' };
  const memberUser: User = { id: 'u-member', email: 'member@example.com', name: 'Member', role: 'member' };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  describe('1. TelegramConnection component & SettingsPage', () => {
    it('renders not_connected with button #telegram-connect labeled "Kết nối Telegram" and no botToken or chatId text inputs', async () => {
      vi.spyOn(apiClient, 'getTelegramConnection').mockResolvedValue({
        status: 'not_connected',
        botUsername: 'ati_assistant_bot',
        chats: [],
        selectedChats: [],
      });

      render(<TelegramConnection user={memberUser} refresh={vi.fn()} navigate={vi.fn()} />);

      expect(await screen.findByText('Chưa kết nối')).toBeInTheDocument();
      const connectBtn = screen.getByRole('button', { name: 'Kết nối Telegram' });
      expect(connectBtn).toBeInTheDocument();
      expect(connectBtn).toHaveAttribute('id', 'telegram-connect');

      expect(screen.queryByLabelText(/bot token/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/chat id/i)).not.toBeInTheDocument();
      expect(document.querySelector('input[name="botToken"]')).toBeNull();
    });

    it('renders connected user with friendly chat names, allows opening #telegram-scope, selecting 1-10 chats, refreshing and saving scope', async () => {
      vi.spyOn(apiClient, 'getTelegramConnection').mockResolvedValue({
        status: 'connected',
        botUsername: 'ati_assistant_bot',
        telegramUserId: '777001',
        username: 'an_nguyen',
        displayName: 'Nguyễn Văn An',
        chats: [
          { chatId: '777001', title: 'Telegram của tôi (Nguyễn Văn An)', type: 'private', member: true },
          { chatId: '-100999888', title: 'Đội Sản Phẩm', type: 'supergroup', member: true },
          { chatId: '-100999777', title: 'Kênh Cảnh Báo', type: 'supergroup', member: true },
        ],
        selectedChats: [
          { chatId: '777001', title: 'Telegram của tôi (Nguyễn Văn An)', type: 'private', member: true },
        ],
      });
      const refreshChatsSpy = vi.spyOn(apiClient, 'getTelegramChats').mockResolvedValue({
        chats: [
          { chatId: '777001', title: 'Telegram của tôi (Nguyễn Văn An)', type: 'private', member: true },
          { chatId: '-100999888', title: 'Đội Sản Phẩm', type: 'supergroup', member: true },
          { chatId: '-100999777', title: 'Kênh Cảnh Báo', type: 'supergroup', member: true },
        ],
        selectedChatIds: ['777001'],
      });
      const saveScopeSpy = vi.spyOn(apiClient, 'saveTelegramScope').mockResolvedValue({
        status: 'connected',
        selectedChats: [
          { chatId: '777001', title: 'Telegram của tôi (Nguyễn Văn An)', type: 'private', member: true },
          { chatId: '-100999888', title: 'Đội Sản Phẩm', type: 'supergroup', member: true },
        ],
      });

      render(<TelegramConnection user={memberUser} refresh={vi.fn()} navigate={vi.fn()} />);

      expect(await screen.findByText(/@an_nguyen/)).toBeInTheDocument();
      expect(screen.getByText('Telegram của tôi (Nguyễn Văn An)')).toBeInTheDocument();

      const editBtn = screen.getByRole('button', { name: /Chọn chat \/ nhóm/i });
      expect(editBtn).toHaveAttribute('id', 'telegram-edit-scope');
      fireEvent.click(editBtn);

      const scopeBox = await screen.findByTestId('telegram-scope');
      expect(scopeBox).toHaveAttribute('id', 'telegram-scope');

      const refreshBtn = screen.getByRole('button', { name: /Làm mới danh sách/i });
      expect(refreshBtn).toHaveAttribute('id', 'telegram-refresh-chats');
      fireEvent.click(refreshBtn);
      await waitFor(() => expect(refreshChatsSpy).toHaveBeenCalledTimes(1));

      const groupCheckbox = await screen.findByRole('checkbox', { name: /Đội Sản Phẩm/i });
      expect(groupCheckbox).not.toBeChecked();
      fireEvent.click(groupCheckbox);
      expect(groupCheckbox).toBeChecked();

      const saveBtn = screen.getByRole('button', { name: /Lưu danh sách chat/i });
      expect(saveBtn).toHaveAttribute('id', 'telegram-save-scope');
      expect(saveBtn).not.toBeDisabled();
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(saveScopeSpy).toHaveBeenCalledWith(['777001', '-100999888']);
      });
    });

    it('hides telegram from shared services list and displays telegramConnectionNotice on SettingsPage', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (url === '/api/services') {
          return new Response(
            JSON.stringify({
              services: [
                {
                  id: 'telegram',
                  name: 'Telegram',
                  connection: 'personal',
                  personalStatus: 'connected',
                  username: 'an_nguyen',
                  connected: true,
                  configured: true,
                  tools: ['telegram.send_message', 'telegram.get_chat', 'telegram.list_chats'],
                },
                {
                  id: 'slack',
                  name: 'Slack',
                  connected: false,
                  configured: false,
                  connectionStatus: 'unconfigured',
                  tools: ['slack.send_message'],
                },
              ],
              canConfigure: true,
            })
          );
        }
        throw new Error(`Unexpected endpoint: ${url}`);
      }));
      vi.spyOn(apiClient, 'getTrelloConnection').mockResolvedValue({ status: 'not_connected', boards: [] });
      vi.spyOn(apiClient, 'getGitHubConnection').mockResolvedValue({ status: 'not_connected', repos: [] });
      vi.spyOn(apiClient, 'getTelegramConnection').mockResolvedValue({
        status: 'connected',
        username: 'an_nguyen',
        chats: [{ chatId: '777001', title: 'Telegram của tôi (An)', type: 'private', member: true }],
        selectedChats: [{ chatId: '777001', title: 'Telegram của tôi (An)', type: 'private', member: true }],
      });
      authStorage.setStoredTokens({ user: adminUser });
      telegramConnectionNotice.set('an_nguyen');

      render(<SettingsPage user={adminUser} navigate={vi.fn()} onLogout={vi.fn()} />);

      expect(await screen.findByText('Đã kết nối @an_nguyen')).toBeInTheDocument();
      expect(document.getElementById('service-row-telegram')).not.toBeNull();
      // Shared list only contains slack (1 item), not telegram
      expect(document.getElementById('badge-count-unconnected')).toHaveTextContent('1');
    });
  });

  describe('2. TelegramCallbackView', () => {
    it('handles TELEGRAM_PAIRING_PENDING and navigates to returnTo once Start is verified in Telegram', async () => {
      const completeSpy = vi
        .spyOn(apiClient, 'completeTelegramConnection')
        .mockRejectedValueOnce(
          Object.assign(new Error('Chưa nhận được tín hiệu nhấn Start từ Telegram.'), {
            status: 409,
            code: 'TELEGRAM_PAIRING_PENDING',
            data: { error: { code: 'TELEGRAM_PAIRING_PENDING' } },
          })
        )
        .mockResolvedValueOnce({
          status: 'connected',
          telegramUserId: '777001',
          username: 'an_nguyen',
          displayName: 'Nguyễn Văn An',
          chats: [{ chatId: '777001', title: 'Telegram của tôi (Nguyễn Văn An)', type: 'private', member: true }],
          selectedChats: [{ chatId: '777001', title: 'Telegram của tôi (Nguyễn Văn An)', type: 'private', member: true }],
          returnTo: '/c/11111111-2222-3333-4444-555555555555',
        });

      authStorage.setStoredTokens({ accessToken: 'tok-1', user: memberUser });
      const navigateSpy = vi.fn();

      render(
        <TelegramCallbackView
          navigate={navigateSpy}
          input={{
            state: 'state_abc123',
            botUsername: 'ati_assistant_bot',
            deepLinkUrl: 'https://t.me/ati_assistant_bot?start=ati_state_abc123',
            groupDeepLinkUrl: 'https://t.me/ati_assistant_bot?startgroup=ati_state_abc123',
          }}
        />
      );

      // Link to open Telegram bot is shown
      const openBotLink = await screen.findByRole('link', { name: /Mở Telegram và bấm Start/i });
      expect(openBotLink).toHaveAttribute('href', 'https://t.me/ati_assistant_bot?start=ati_state_abc123');

      // Initial check gets TELEGRAM_PAIRING_PENDING, shows verify button
      const verifyBtn = await screen.findByRole('button', { name: /Tôi đã bấm Start trên Telegram/i });
      expect(verifyBtn).toHaveAttribute('id', 'telegram-verify-pairing');

      // User clicks verify button after pressing Start in Telegram
      fireEvent.click(verifyBtn);

      await waitFor(() => {
        expect(completeSpy).toHaveBeenCalledTimes(2);
        expect(navigateSpy).toHaveBeenCalledWith('/c/11111111-2222-3333-4444-555555555555', true);
      });
    });
  });

  describe('3. RefusalMoment, PlanMoment and ReceiptMoment with Telegram', () => {
    it('RefusalMoment renders #telegram-connect calling startTelegramConnection with returnTo and navigates to callback view', async () => {
      const startSpy = vi.spyOn(apiClient, 'startTelegramConnection').mockResolvedValue({
        state: 'state_xyz',
        botUsername: 'ati_assistant_bot',
        deepLinkUrl: 'https://t.me/ati_assistant_bot?start=ati_state_xyz',
        groupDeepLinkUrl: 'https://t.me/ati_assistant_bot?startgroup=ati_state_xyz',
      });
      const navigateSpy = vi.fn();

      render(
        <ResponseMoment
          request="Gửi báo cáo vào Telegram của tôi"
          conversationId="11111111-2222-3333-4444-555555555555"
          unavailableServices={[{ id: 'telegram', name: 'Telegram' }]}
          reason="Tài khoản của bạn chưa Kết nối Telegram."
          services={[]}
          connectFromChat={false}
          navigate={navigateSpy}
        />
      );

      const connectBtn = await screen.findByRole('link', { name: /Kết nối Telegram/i });
      expect(connectBtn).toHaveAttribute('id', 'telegram-connect');

      fireEvent.click(connectBtn);
      await waitFor(() => {
        expect(startSpy).toHaveBeenCalledWith({
          returnTo: '/c/11111111-2222-3333-4444-555555555555',
        });
        expect(navigateSpy).toHaveBeenCalledWith(
          expect.stringContaining('/connections/telegram/callback?state=state_xyz')
        );
      });
    });

    it('RefusalMoment renders "Chọn chat Telegram" and navigates to /settings#telegram when personalStatus is needs_scope', async () => {
      const navigateSpy = vi.fn();

      render(
        <ResponseMoment
          request="Gửi báo cáo vào Telegram của tôi"
          conversationId="11111111-2222-3333-4444-555555555555"
          unavailableServices={[{ id: 'telegram', name: 'Telegram' }]}
          reason="Bạn chưa chọn cuộc trò chuyện Telegram."
          services={[
            {
              id: 'telegram',
              name: 'Telegram',
              configured: false,
              connected: false,
              connection: 'personal',
              personalStatus: 'needs_scope',
              username: 'an_nguyen',
              tools: [],
            } as any,
          ]}
          connectFromChat={false}
          navigate={navigateSpy}
        />
      );

      expect(await screen.findByText(/Đã kết nối · Chưa chọn chat · @an_nguyen/)).toBeInTheDocument();
      const chooseChatBtn = await screen.findByRole('link', { name: /Chọn chat Telegram/i });
      expect(chooseChatBtn).toHaveAttribute('id', 'telegram-connect');
      fireEvent.click(chooseChatBtn);
      expect(navigateSpy).toHaveBeenCalledWith('/settings#telegram');
    });

    it('PlanMoment and ReceiptMoment display @username from connections.telegram and chat title from resourceLabels', () => {
      const plan: ActivePlan = {
        id: 'p-tg-1',
        summary: 'Gửi báo cáo vào Telegram',
        steps: [
          {
            id: 'step_1',
            tool: 'telegram.list_chats',
            description: 'Tìm chat Telegram của tôi',
            args: { query: 'Telegram của tôi' },
          },
          {
            id: 'step_2',
            tool: 'telegram.send_message',
            description: 'Gửi tin nhắn báo cáo',
            args: { chatId: { $ref: 'step_1.output[0].id' }, text: 'Báo cáo sáng' },
            chatId: '777001',
            dependsOn: ['step_1'],
          },
        ],
        connections: {
          telegram: {
            credentialId: 'cred-tg-1',
            telegramUserId: '777001',
            username: 'an_nguyen',
            chatIds: ['777001'],
          },
        },
        resourceLabels: {
          '777001': 'Telegram của tôi (Nguyễn Văn An)',
        },
      };

      const { unmount } = render(
        <PlanMoment
          request="Gửi báo cáo vào Telegram của tôi"
          runtimeMode="sandbox"
          inlineComposer={null}
          plan={plan}
          services={[{ id: 'telegram', name: 'Telegram', configured: true, connected: true, tools: [] } as any]}
          destination={resourceDestination}
          onPreview={vi.fn()}
          onApprove={vi.fn()}
          onCancel={vi.fn()}
          onEdit={vi.fn()}
        />
      );

      expect(screen.getByText(/Tài khoản: @an_nguyen \(Telegram của bạn\)/)).toBeInTheDocument();
      expect(screen.getByText(/Telegram của tôi \(Nguyễn Văn An\)/)).toBeInTheDocument();

      unmount();

      render(
        <ReceiptMoment
          request="Gửi báo cáo vào Telegram của tôi"
          steps={[
            {
              id: 'step_2',
              tool: 'telegram.send_message',
              description: 'Gửi tin nhắn báo cáo',
              status: 'succeeded',
              duration: '110ms',
              output: { messageId: 42, chatId: '777001', date: 1730500000, text: 'Báo cáo sáng' },
            },
          ]}
          planSteps={plan.steps}
          labels={plan.resourceLabels}
          telegramConnection={plan.connections?.telegram}
          services={[{ id: 'telegram', name: 'Telegram', configured: true, connected: true, tools: [] } as any]}
          destination={resourceDestination}
          onNewConversation={vi.fn()}
          onFollowup={vi.fn()}
        />
      );

      expect(screen.getByText(/Tài khoản: @an_nguyen \(Telegram của bạn\)/)).toBeInTheDocument();
      expect(screen.getByText(/Telegram của tôi \(Nguyễn Văn An\)/)).toBeInTheDocument();
    });

    it('FE-1/FE-2/FE-3/FE-5: auto-verifies on window focus, filters chats with X/10 badge, previews & renders telegram.read_messages results, and updates GuidePage 1-Click UI', async () => {
      // 1. FE-1: TelegramCallbackView auto-verifies when window regains focus during pendingPairing
      const completeSpy = vi
        .spyOn(apiClient, 'completeTelegramConnection')
        .mockRejectedValueOnce(
          Object.assign(new Error('Pending'), {
            status: 409,
            code: 'TELEGRAM_PAIRING_PENDING',
          })
        )
        .mockResolvedValueOnce({
          status: 'connected',
          telegramUserId: '777001',
          username: 'an_nguyen',
          displayName: 'An Nguyen',
          chats: [{ chatId: '777001', title: 'Telegram của tôi (An)', type: 'private', member: true }],
          selectedChats: [{ chatId: '777001', title: 'Telegram của tôi (An)', type: 'private', member: true }],
        });

      authStorage.setStoredTokens({ accessToken: 'tok-1', user: memberUser });
      const navCallback = vi.fn();
      const { unmount: unmountCb } = render(
        <TelegramCallbackView
          navigate={navCallback}
          input={{
            state: 'state_focus_1',
            botUsername: 'ati_cnhn_bot',
            deepLinkUrl: 'https://t.me/ati_cnhn_bot?start=ati_state_focus_1',
          }}
        />
      );

      expect(await screen.findByText(/@ati_cnhn_bot/)).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: /Tôi đã bấm Start trên Telegram/i })).toBeInTheDocument();

      // Simulate user switching back from Telegram app to browser tab
      fireEvent(window, new Event('focus'));
      await waitFor(() => {
        expect(completeSpy).toHaveBeenCalledTimes(2);
        expect(navCallback).toHaveBeenCalledWith('/settings#telegram', true);
      });
      unmountCb();

      // 2. FE-2: TelegramConnection renders needs_scope badge, X/10 counter, and chat filter input
      vi.spyOn(apiClient, 'getTelegramConnection').mockResolvedValue({
        status: 'needs_scope',
        botUsername: 'ati_cnhn_bot',
        telegramUserId: '777001',
        username: 'an_nguyen',
        chats: [
          { chatId: '777001', title: 'Telegram của tôi (An)', type: 'private', member: true },
          { chatId: '-1001', title: 'Nhóm Kỹ Thuật', type: 'supergroup', username: 'eng_team', member: true },
          { chatId: '-1002', title: 'Nhóm Kinh Doanh', type: 'group', member: true },
          { chatId: '-1003', title: 'Kênh Thông Báo', type: 'channel', member: true },
        ],
        selectedChats: [],
      });

      const { unmount: unmountConn } = render(
        <TelegramConnection user={memberUser} refresh={vi.fn()} navigate={vi.fn()} />
      );

      expect(await screen.findByText('Chưa chọn chat')).toBeInTheDocument();
      expect(screen.getByText(/Đã chọn 0 \/ 10/)).toBeInTheDocument();

      const filterInput = screen.getByPlaceholderText(/Tìm nhanh chat hoặc nhóm/i);
      fireEvent.change(filterInput, { target: { value: 'Kỹ Thuật' } });
      expect(screen.getByText('Nhóm Kỹ Thuật')).toBeInTheDocument();
      expect(screen.queryByText('Nhóm Kinh Doanh')).not.toBeInTheDocument();
      unmountConn();

      // 3. FE-3: PlanMoment, PreviewModal, and ReceiptMoment for telegram.read_messages
      const readStep = {
        id: 'step_read_tg',
        tool: 'telegram.read_messages',
        description: 'Đọc tin nhắn nhóm Kỹ Thuật',
        args: { chatId: '-1001', query: 'deploy', limit: 5 },
      };

      const { unmount: unmountPreview } = render(
        <PreviewModal
          step={readStep}
          services={[{ id: 'telegram', name: 'Telegram', configured: true, connected: true, tools: [] } as any]}
          labels={{ '-1001': 'Nhóm Kỹ Thuật' }}
          destination={resourceDestination}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByText('Nhóm Kỹ Thuật')).toBeInTheDocument();
      expect(screen.getByText('deploy')).toBeInTheDocument();
      unmountPreview();

      const { unmount: unmountReceipt } = render(
        <ReceiptMoment
          request="Đọc tin nhắn nhóm Kỹ Thuật"
          steps={[
            {
              id: 'step_read_tg',
              tool: 'telegram.read_messages',
              description: 'Đọc tin nhắn nhóm Kỹ Thuật',
              status: 'succeeded',
              duration: '95ms',
              output: {
                chatId: '-1001',
                chatTitle: 'Nhóm Kỹ Thuật',
                messages: [
                  {
                    messageId: 101,
                    date: '2026-11-03T01:00:00.000Z',
                    senderName: 'Nguyễn Văn An',
                    text: 'Đã chốt lịch deploy bản v3.2',
                    pinned: true,
                  },
                ],
              },
            },
          ]}
          planSteps={[readStep]}
          labels={{ '-1001': 'Nhóm Kỹ Thuật' }}
          services={[{ id: 'telegram', name: 'Telegram', configured: true, connected: true, tools: [] } as any]}
          destination={resourceDestination}
          onNewConversation={vi.fn()}
          onFollowup={vi.fn()}
        />
      );
      expect(screen.getByText(/✓ Đã đọc tin nhắn/)).toBeInTheDocument();
      expect(screen.getByText('Nguyễn Văn An')).toBeInTheDocument();
      expect(screen.getByText('Đã chốt lịch deploy bản v3.2')).toBeInTheDocument();
      unmountReceipt();

      // 4. FE-5: GuidePage & GUIDE_OAUTH_SHOWCASE_CARDS include Telegram 1-Click
      expect(GUIDE_OAUTH_SHOWCASE_CARDS.some((c) => c.service === 'telegram')).toBe(true);
      window.history.replaceState({}, '', '/guide?service=telegram');
      const { unmount: unmountGuide } = render(<GuidePage navigate={vi.fn()} user={memberUser} />);
      expect(screen.getByRole('link', { name: /Kết nối Telegram 1-Click →/i })).toBeInTheDocument();
      unmountGuide();
    });
  });
});
