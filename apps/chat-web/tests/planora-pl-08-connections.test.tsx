import { describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ConnectionCallbackFrame } from '../src/planora/layout/ConnectionCallbackFrame';
import { SettingsPage } from '../src/pages/Settings/SettingsPage';
import { PersonalMySheets } from '../src/pages/Settings/PersonalMySheets';
import { GmailCallbackView } from '../src/views/GmailCallbackView';
import { MyCalendarCallbackView } from '../src/views/MyCalendarCallbackView';
import { MySheetsCallbackView } from '../src/views/MySheetsCallbackView';
import { apiClient } from '../src/services/api-client';
import type { User, ServiceInfo } from '../src/types';

describe('PL-08 Planora Settings & Google Connections (Business-First UX v2.0)', () => {
  const testUser: User = {
    id: 'user-pl08',
    name: 'Planora User',
    email: 'user@planora.test',
    role: 'admin',
  };

  describe('1. ConnectionCallbackFrame Layout & Presentation', () => {
    it('renders Planora brand monogram, serif title, status badge and loading text without muting state', () => {
      render(
        <ConnectionCallbackFrame
          serviceId="gmail"
          serviceName="Gmail"
          title="Kết nối Gmail"
          subtitle="Tài khoản doanh nghiệp: user@company.com"
          badge="KẾT NỐI HỘP THƯ DOANH NGHIỆP"
          statusType="pending"
          statusLabel="Đang xử lý"
          loading={true}
          loadingText="Đang hoàn tất kết nối Gmail…"
          onBackToSettings={() => {}}
          backToSettingsLabel="Về Kết nối dịch vụ"
        >
          <div data-testid="callback-child-content">Nội dung thao tác kết nối</div>
        </ConnectionCallbackFrame>
      );

      // Planora brand wordmark & monogram
      expect(screen.getAllByText('planora').length).toBeGreaterThanOrEqual(1);

      // Heading and badge
      expect(screen.getByRole('heading', { level: 1, name: 'Kết nối Gmail' })).toBeInTheDocument();
      expect(screen.getAllByText('KẾT NỐI HỘP THƯ DOANH NGHIỆP').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Tài khoản doanh nghiệp: user@company.com')).toBeInTheDocument();

      // Status badge and loading status
      expect(screen.getByText('Đang xử lý')).toBeInTheDocument();
      const statusElements = screen.getAllByRole('status');
      expect(
        statusElements.some((el) => el.textContent?.includes('Đang hoàn tất kết nối Gmail…'))
      ).toBe(true);

      // Custom children
      expect(screen.getByTestId('callback-child-content')).toHaveTextContent('Nội dung thao tác kết nối');

      // Return action
      expect(screen.getByRole('button', { name: 'Về Kết nối dịch vụ' })).toBeInTheDocument();
    });

    it('renders error role=alert cleanly when error is provided', () => {
      render(
        <ConnectionCallbackFrame
          serviceId="mycalendar"
          serviceName="Google Calendar"
          title="Chọn lịch Google Calendar"
          statusType="error"
          statusLabel="Thất bại"
          error="Link kết nối đã hết hạn hoặc không hợp lệ. Vui lòng thử lại."
          onBackToSettings={() => {}}
        />
      );

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Link kết nối đã hết hạn hoặc không hợp lệ. Vui lòng thử lại.'
      );
      expect(screen.getByText('Thất bại')).toBeInTheDocument();
    });

    it('enforces aria-hidden="true" on 100% of SVG vector icons for a11y compliance', () => {
      const { container } = render(
        <ConnectionCallbackFrame
          serviceId="mysheets"
          serviceName="Google Sheets"
          title="Chọn bảng tính Google Sheets"
          statusType="success"
          statusLabel="Đã xác thực"
          onBackToSettings={() => {}}
        >
          <p>Nội dung kiểm tra SVG</p>
        </ConnectionCallbackFrame>
      );

      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThan(0);
      svgs.forEach((svg) => {
        expect(svg).toHaveAttribute('aria-hidden', 'true');
      });
    });
  });

  describe('2. Dynamic Catalogue Service Count (No Hardcoded 8 Services)', () => {
    it('counts services dynamically from server catalogue data instead of hardcoding 8 services', async () => {
      const mockServices: ServiceInfo[] = [
        {
          id: 'notion',
          name: 'Notion',
          connection: 'shared',
          connected: true,
          configured: true,
          connectionStatus: 'healthy',
          lastCheckedAt: '2026-11-07T08:00:00Z',
          tools: ['notion.create_page'],
          allowedScope: ['notion-db-1'],
        },
        {
          id: 'slack',
          name: 'Slack',
          connection: 'shared',
          connected: false,
          configured: false,
          connectionStatus: 'unconfigured',
          lastCheckedAt: null,
          tools: ['slack.post_message'],
          allowedScope: [],
        },
        {
          id: 'jira',
          name: 'Jira',
          connection: 'shared',
          connected: false,
          configured: false,
          connectionStatus: 'unconfigured',
          lastCheckedAt: null,
          tools: ['jira.create_issue'],
          allowedScope: [],
        },
      ];

      vi.spyOn(apiClient, 'getServices').mockResolvedValue({
        services: mockServices,
        canConfigure: true,
      });

      render(<SettingsPage user={testUser} navigate={vi.fn()} onLogout={vi.fn()} />);

      // Exactly 1 configured out of 3 catalogue services: "1 / 3 dịch vụ đã thiết lập · 1 kết nối tốt"
      expect(
        await screen.findByText('1 / 3 dịch vụ đã thiết lập · 1 kết nối tốt')
      ).toBeInTheDocument();

      // Does not contain any hardcoded "8 dịch vụ" claim
      expect(screen.queryByText(/8 dịch vụ/)).not.toBeInTheDocument();
    });
  });

  describe('3. Business-First UX & Anchor Preservation', () => {
    it('preserves technical anchors #gmail, #mycalendar, #mysheets on personal service rows', async () => {
      vi.spyOn(apiClient, 'getServices').mockResolvedValue({
        services: [
          {
            id: 'gmail',
            name: 'Gmail',
            connection: 'personal',
            connected: true,
            configured: true,
            personalStatus: 'connected',
            email: 'user@planora.test',
            tools: ['gmail.send_message'],
          },
          {
            id: 'mycalendar',
            name: 'Google Calendar',
            connection: 'personal',
            connected: true,
            configured: true,
            personalStatus: 'connected',
            email: 'user@planora.test',
            selectedCalendars: [{ id: 'cal-1', summary: 'Lịch làm việc', primary: true }],
            tools: ['mycalendar.create_event'],
          },
          {
            id: 'mysheets',
            name: 'Google Sheets',
            connection: 'personal',
            connected: true,
            configured: true,
            personalStatus: 'connected',
            email: 'user@planora.test',
            selectedSpreadsheets: [{ id: 'sheet-1', title: 'Bảng theo dõi KPI', canEdit: true }],
            tools: ['mysheets.append_rows'],
          },
        ],
        canConfigure: true,
      });

      const { container } = render(
        <SettingsPage user={testUser} navigate={vi.fn()} onLogout={vi.fn()} />
      );

      // Verify DOM IDs for anchor links
      expect(await screen.findByText(/Bảng theo dõi KPI/)).toBeInTheDocument();
      expect(container.querySelector('#service-row-gmail')).toBeInTheDocument();
      expect(container.querySelector('#service-row-mycalendar')).toBeInTheDocument();
      expect(container.querySelector('#service-row-mysheets')).toBeInTheDocument();
      expect(container.querySelector('#mycalendar')).toBeInTheDocument();
      expect(container.querySelector('#mysheets')).toBeInTheDocument();
    });

    it('uses business-oriented language for Gmail, Calendar, and Sheets without raw OAuth jargon', async () => {
      vi.spyOn(apiClient, 'getServices').mockResolvedValue({
        services: [
          {
            id: 'gmail',
            name: 'Gmail',
            connection: 'personal',
            connected: false,
            configured: false,
            personalStatus: 'not_connected',
            tools: ['gmail.send_message'],
          },
          {
            id: 'mycalendar',
            name: 'Google Calendar',
            connection: 'personal',
            connected: false,
            configured: false,
            personalStatus: 'not_connected',
            tools: ['mycalendar.create_event'],
          },
          {
            id: 'mysheets',
            name: 'Google Sheets',
            connection: 'personal',
            connected: false,
            configured: false,
            personalStatus: 'not_connected',
            tools: ['mysheets.append_rows'],
          },
        ],
        canConfigure: true,
      });

      render(<SettingsPage user={testUser} navigate={vi.fn()} onLogout={vi.fn()} />);

      // Business benefits copy
      expect(
        await screen.findByText(/Chỉ bạn dùng được hộp thư này\. Planora được đọc, soạn, gửi, gắn nhãn/i)
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /Planora chỉ đọc sự kiện và tạo sự kiện mới trên các lịch bạn đã chọn, không sửa hay xoá sự kiện có sẵn/i
        )
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /Planora chỉ thấy những bảng tính bạn chọn trong cửa sổ của Google/i
        )
      ).toBeInTheDocument();
    });
  });

  describe('4. Review Findings F1-F4 & P3-1 Verification', () => {
    it('uses Planora primary tokens and on-primary color on action buttons without agentic orange #FF5701 (F1)', async () => {
      vi.spyOn(apiClient, 'getServices').mockResolvedValue({
        services: [
          {
            id: 'gmail',
            name: 'Gmail',
            connection: 'personal',
            connected: false,
            configured: false,
            personalStatus: 'not_connected',
            tools: ['gmail.send_message'],
          },
          {
            id: 'notion',
            name: 'Notion',
            connection: 'shared',
            connected: false,
            configured: false,
            credentialFields: [{ key: 'token', label: 'Token', type: 'password' }],
            tools: ['notion.read_database'],
          },
        ],
        canConfigure: true,
      });

      render(<SettingsPage user={testUser} navigate={vi.fn()} onLogout={vi.fn()} />);

      const connectGmailBtn = await screen.findByRole('button', { name: 'Kết nối Gmail' });
      expect(connectGmailBtn.className).toContain('bg-[var(--planora-primary)]');
      expect(connectGmailBtn.className).toContain('text-[var(--planora-on-primary)]');
      expect(connectGmailBtn.className).not.toContain('#FF5701');

      // Open Notion drawer to check Save button
      const notionCard = await screen.findByText('Notion');
      fireEvent.click(notionCard);

      const dialog = await screen.findByRole('dialog', { name: 'Notion' });
      const saveBtn = within(dialog).getByRole('button', { name: 'Lưu thay đổi' });
      expect(saveBtn.className).toContain('bg-[var(--planora-primary)]');
      expect(saveBtn.className).toContain('text-[var(--planora-on-primary)]');
      expect(saveBtn.className).not.toContain('#FF5701');
    });

    it('enforces vector SVGs with aria-hidden="true" on context pill without raw emoji (F3)', async () => {
      vi.spyOn(apiClient, 'getServices').mockResolvedValue({
        services: [],
        canConfigure: true,
      });

      const { container } = render(<SettingsPage user={testUser} navigate={vi.fn()} onLogout={vi.fn()} />);
      await screen.findByRole('heading', { level: 1, name: 'Kết nối dịch vụ' });

      const pill = container.querySelector('div.mb-4.inline-flex.items-center');
      expect(pill).toBeInTheDocument();
      expect(pill?.textContent).not.toContain('👤');
      expect(pill?.textContent).not.toContain('🏢');

      const pillSvg = pill?.querySelector('svg');
      expect(pillSvg).toHaveAttribute('aria-hidden', 'true');
    });

    it('does not leak legacy "ATI" branding in scope descriptions and metadata (F3)', async () => {
      vi.spyOn(apiClient, 'getServices').mockResolvedValue({
        services: [
          {
            id: 'notion',
            name: 'Notion',
            connection: 'shared',
            connected: true,
            configured: true,
            credentialFields: [{ key: 'token', label: 'Token', type: 'password' }],
            scopeLabel: 'Database ID',
            allowedScope: ['db-1'],
            tools: ['notion.read_database'],
          },
        ],
        canConfigure: true,
      });

      render(<SettingsPage user={testUser} navigate={vi.fn()} onLogout={vi.fn()} />);
      await screen.findByRole('heading', { level: 1, name: 'Kết nối dịch vụ' });

      // Open drawer to inspect scope description
      const notionCard = await screen.findByText('Notion');
      fireEvent.click(notionCard);

      const dialog = await screen.findByRole('dialog', { name: 'Notion' });
      const scopeDesc = dialog.querySelector('#scope-description-text');
      expect(scopeDesc?.textContent).toContain('Planora chỉ đọc và ghi');
      expect(scopeDesc?.textContent).not.toContain('ATI');
    });

    it('guards disconnect dialog against premature close when disconnect request is busy (P3-1)', async () => {
      let resolveDisconnect: () => void = () => {};
      const disconnectPromise = new Promise<{ success: boolean }>((resolve) => {
        resolveDisconnect = () => resolve({ success: true });
      });
      vi.spyOn(apiClient, 'disconnectMySheets').mockReturnValue(disconnectPromise as any);

      render(
        <PersonalMySheets
          service={{
            id: 'mysheets',
            name: 'Google Sheets',
            connection: 'personal',
            connected: true,
            configured: true,
            personalStatus: 'connected',
            email: 'user@sheets.test',
            tools: ['mysheets.append_rows'],
          }}
          refresh={vi.fn()}
          selected={null}
        />
      );

      // Open disconnect modal
      const disconnectBtn = screen.getByRole('button', { name: 'Ngắt kết nối' });
      fireEvent.click(disconnectBtn);

      const dialog = await screen.findByRole('dialog', { name: 'Ngắt kết nối Google Sheets?' });
      expect(dialog).toBeInTheDocument();

      // Click Confirm disconnect inside dialog to start busy request
      const confirmBtn = within(dialog).getByRole('button', { name: 'Ngắt kết nối' });
      act(() => {
        fireEvent.click(confirmBtn);
      });

      // Dialog is now busy ('Đang ngắt…')
      expect(screen.getByText('Đang ngắt…')).toBeInTheDocument();

      // Trigger Escape key (CockpitDialog onClose) while busy
      act(() => {
        fireEvent.keyDown(window, { key: 'Escape' });
      });

      // Dialog MUST remain open because busy === true
      expect(screen.getByRole('dialog', { name: 'Ngắt kết nối Google Sheets?' })).toBeInTheDocument();

      // Once resolved, dialog closes
      await act(async () => {
        resolveDisconnect();
      });
      cleanup();
    });

    it('renders exactly one return action and no nested error boxes on callback views (F4)', () => {
      // 1. GmailCallbackView with error
      const { container: gmailContainer } = render(
        <GmailCallbackView navigate={vi.fn()} input={{ error: 'access_denied' }} />
      );
      // Exactly 1 back to settings button
      const gmailBackButtons = screen.getAllByRole('button', { name: 'Về Kết nối dịch vụ' });
      expect(gmailBackButtons).toHaveLength(1);
      expect(gmailContainer.querySelectorAll('a[href="/settings"]')).toHaveLength(0);
      cleanup();

      // 2. MyCalendarCallbackView with error
      const { container: calContainer } = render(
        <MyCalendarCallbackView navigate={vi.fn()} input={{ error: 'access_denied' }} />
      );
      // Clean single alert, no nested red-50 error box
      expect(calContainer.querySelector('.bg-red-50')).toBeNull();
      // Exactly 1 back to settings button in footer
      expect(screen.getByRole('button', { name: 'Về trang Cài đặt' })).toBeInTheDocument();
      cleanup();

      // 3. MySheetsCallbackView with error
      const { container: sheetsContainer } = render(
        <MySheetsCallbackView navigate={vi.fn()} input={{ error: 'access_denied' }} />
      );
      // Clean single alert, no nested red-50 error box
      expect(sheetsContainer.querySelector('.bg-red-50')).toBeNull();
      expect(screen.getByRole('button', { name: 'Về trang Cài đặt' })).toBeInTheDocument();
      cleanup();
    });
  });
});
