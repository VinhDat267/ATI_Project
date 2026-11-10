// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MYCALENDAR_SCOPE } from '../../../packages/tool-schemas/src/mycalendar';
import { PrivacyPage } from '../src/pages/Privacy/PrivacyPage';
import { apiClient } from '../src/services/api-client';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CALENDAR-AUDIT-09 — Google Calendar OAuth scope & revocation disclosure on PrivacyPage', () => {
  it('discloses actual runtime OAuth scopes (calendar.readonly and calendar.events), distinguishes Google OAuth grant from app allowlist, and avoids unqualified absolute revocation claims', async () => {
    const runtimeScopes = MYCALENDAR_SCOPE.split(/\s+/).filter(Boolean);
    expect(runtimeScopes).toContain('https://www.googleapis.com/auth/calendar.events');
    expect(runtimeScopes).toContain('https://www.googleapis.com/auth/calendar.readonly');
    expect(runtimeScopes).not.toContain('https://www.googleapis.com/auth/calendar.calendarlist.readonly');

    vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({
      runtimeMode: 'sandbox',
      gmailEnabled: true,
      mycalendarEnabled: true,
    });

    render(<PrivacyPage navigate={() => {}} />);
    await waitFor(() => expect(apiClient.getRuntime).toHaveBeenCalled());

    const calSection = await screen.findByRole('region', { name: /Dữ liệu Google Calendar/i });
    const sectionText = calSection.textContent ?? '';

    // 1. Must disclose both runtime OAuth scopes requested in MYCALENDAR_SCOPE
    expect(sectionText).toContain('calendar.readonly');
    expect(sectionText).toContain('calendar.events');
    expect(sectionText).not.toContain('calendar.calendarlist.readonly');

    // 2. Must distinguish Google OAuth scope grant from Planora's application allowlist of selected calendars
    expect(sectionText).toMatch(/danh sách lịch được phép|các lịch bạn đã chọn|lịch đã chọn/i);

    // 3. Must NOT make the false unqualified promise that token & access are "completely revoked"
    expect(sectionText).not.toMatch(/sẽ bị thu hồi hoàn toàn/i);
    expect(sectionText).toMatch(/xoá token|xóa token/i);
    expect(sectionText).toMatch(/Google Account|tài khoản Google/i);
  });

  it('XSVC-B (Combined Google Privacy Disclosure): keeps #mycalendar and #mysheets regions intact and aligns the shared Google overview callout for both personal Sheets and personal Calendar', async () => {
    vi.spyOn(apiClient, 'getRuntime').mockResolvedValue({
      runtimeMode: 'sandbox',
      gmailEnabled: true,
      mycalendarEnabled: true,
      mysheetsEnabled: true,
    });

    render(<PrivacyPage navigate={() => {}} />);
    await waitFor(() => expect(apiClient.getRuntime).toHaveBeenCalled());

    const calSection = await screen.findByRole('region', { name: /Dữ liệu Google Calendar của bạn/i });
    const sheetsSection = await screen.findByRole('region', { name: /Bảng tính Google Sheets của bạn/i });

    expect(calSection).toHaveTextContent('calendar.readonly');
    expect(calSection).toHaveTextContent('calendar.events');
    expect(calSection).not.toHaveTextContent('calendar.calendarlist.readonly');
    expect(calSection.textContent ?? '').not.toMatch(/sẽ bị thu hồi hoàn toàn/i);

    expect(sheetsSection).toHaveTextContent('drive.file');
    expect(sheetsSection).toHaveTextContent('mysheets.list_drive_files');
    expect(sheetsSection).toHaveTextContent('mysheets.get_doc');
    expect(sheetsSection).toHaveTextContent('ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS=false');
    expect(sheetsSection).toHaveTextContent('includeAiSummary = false');

    const overviewHeading = screen.getByText('Quyền truy cập Google');
    const overviewCardText = overviewHeading.closest('div')?.parentElement?.textContent ?? '';
    expect(overviewCardText).toMatch(/Khi chưa kết nối dịch vụ cá nhân, Planora không truy cập Drive hay lịch cá nhân/i);
    expect(overviewCardText).toContain('drive.file');
    expect(overviewCardText).toContain('calendar.readonly');
    expect(overviewCardText).toContain('calendar.events');
    expect(overviewCardText).toMatch(/các lịch bạn đã chọn|danh sách lịch đã chọn/i);
  });
});
