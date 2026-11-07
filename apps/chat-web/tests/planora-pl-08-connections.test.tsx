import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionCallbackFrame } from '../src/planora/layout/ConnectionCallbackFrame';
import { SettingsPage } from '../src/pages/Settings/SettingsPage';
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
          /ATI chỉ thấy những bảng tính bạn chọn trong cửa sổ của Google/i
        )
      ).toBeInTheDocument();
    });
  });
});
