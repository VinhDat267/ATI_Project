// @vitest-environment jsdom
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PersonalCalendarAdapter } from '../../../packages/tool-adapters/src/calendar/personal-calendar-adapter';
import { PlanMoment } from '../src/pages/Cockpit/PlanMoment';
import { PreviewContents } from '../src/pages/Cockpit/PreviewContents';
import type { ActivePlan, PlanStep, ServiceInfo } from '../src/types';

interface CapturedProviderRequest {
  method: string;
  pathname: string;
  sendUpdates: string | null;
  conferenceDataVersion: string | null;
  body: Record<string, unknown> | null;
}

const connectedCalendarService: ServiceInfo = {
  id: 'mycalendar',
  name: 'Google Calendar của bạn',
  connection: 'personal',
  personalStatus: 'connected',
  connected: true,
  configured: true,
  email: 'user@gmail.com',
  connectedAt: '2026-11-10T02:00:00Z',
  tools: ['mycalendar.create_event', 'mycalendar.schedule_meet', 'mycalendar.update_event', 'mycalendar.delete_event'],
  selectedCalendars: [{ id: 'user@gmail.com', summary: 'Lịch chính', primary: true, accessRole: 'owner' }],
};

function buildPlan(step: PlanStep): ActivePlan {
  return {
    id: 'plan-cal-rem-c-07',
    status: 'pending',
    summary: 'Kiểm tra đồng bộ hiển thị lời mời họp và múi giờ với tham số gọi Google Calendar API.',
    resourceLabels: { 'user@gmail.com': 'Lịch chính' },
    steps: [step],
  };
}

function renderPlanMomentWithStep(step: PlanStep) {
  return render(
    <PlanMoment
      plan={buildPlan(step)}
      services={[connectedCalendarService]}
      destination={(s, labels) => labels?.[String(s.args.calendarId)] ?? String(s.args.calendarId)}
      onPreview={vi.fn()}
      onApprove={vi.fn()}
      onCancel={vi.fn()}
      onEdit={vi.fn()}
      inlineComposer={null}
      runtimeMode="sandbox"
    />,
  );
}

describe('CALENDAR-AUDIT-07 — Invitation preview & optional timeZone parity with PersonalCalendarAdapter transport', () => {
  let server: http.Server;
  let apiBaseUrl = '';
  const capturedRequests: CapturedProviderRequest[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const parsedUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
        let parsedBody: Record<string, unknown> | null = null;
        if (raw.trim().length > 0) {
          try {
            parsedBody = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            parsedBody = null;
          }
        }
        capturedRequests.push({
          method: req.method ?? 'GET',
          pathname: parsedUrl.pathname,
          sendUpdates: parsedUrl.searchParams.get('sendUpdates'),
          conferenceDataVersion: parsedUrl.searchParams.get('conferenceDataVersion'),
          body: parsedBody,
        });

        if (req.method === 'DELETE') {
          res.writeHead(204);
          res.end();
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'evt_fixture_07',
            status: 'confirmed',
            summary: parsedBody?.summary ?? 'Fixture Event',
            start: parsedBody?.start ?? { dateTime: '2026-11-12T09:00:00+07:00' },
            end: parsedBody?.end ?? { dateTime: '2026-11-12T10:00:00+07:00' },
            htmlLink: 'https://calendar.google.com/calendar/event?eid=evt_fixture_07',
            hangoutLink: 'https://meet.google.com/abc-defg-hij',
            attendees: parsedBody?.attendees ?? [],
          }),
        );
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as AddressInfo;
    apiBaseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(() => {
    capturedRequests.length = 0;
    cleanup();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function createAdapter() {
    return new PersonalCalendarAdapter({
      userId: 'user-cal-rem-c',
      allowedScope: { calendars: ['user@gmail.com'] },
      tokens: {
        getAccessToken: async () => 'token-local-fixture',
      },
      apiBaseUrl,
    });
  }

  it('does NOT claim email invitations are sent when attendees are present and sendInvites is undefined (matches adapter sendUpdates=none)', async () => {
    const step: PlanStep = {
      id: 'step-07-undef',
      tool: 'mycalendar.create_event',
      description: 'Tạo cuộc họp thiết kế kiến trúc',
      args: {
        calendarId: 'user@gmail.com',
        summary: 'Họp thiết kế kiến trúc',
        start: '2026-11-12T09:00:00+07:00',
        end: '2026-11-12T10:00:00+07:00',
        attendees: ['alice@example.com', 'bob@example.com'],
      },
    };

    const adapter = createAdapter();
    await adapter.execute(step.tool, step.args);
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]?.sendUpdates).toBe('none');
    expect(capturedRequests[0]?.body?.attendees).toEqual([
      { email: 'alice@example.com' },
      { email: 'bob@example.com' },
    ]);

    const { unmount } = renderPlanMomentWithStep(step);
    expect(screen.getByText(/2 khách mời/i)).toBeInTheDocument();
    expect(screen.queryByText(/📨\s*Gửi email mời họp/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Không gửi email mời họp/i)).toBeInTheDocument();
    unmount();

    render(<PreviewContents step={step} destination="Lịch chính" />);
    expect(screen.getByText(/alice@example\.com/i)).toBeInTheDocument();
    expect(screen.getByText(/bob@example\.com/i)).toBeInTheDocument();
    expect(screen.queryByText(/📨\s*Gửi email mời họp/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Không gửi email mời họp/i)).toBeInTheDocument();
  });

  it('shows explicit non-invite disclosure when attendees are present and sendInvites is false (matches adapter sendUpdates=none)', async () => {
    const step: PlanStep = {
      id: 'step-07-false',
      tool: 'mycalendar.create_event',
      description: 'Tạo cuộc họp nội bộ',
      args: {
        calendarId: 'user@gmail.com',
        summary: 'Họp nội bộ',
        start: '2026-11-12T11:00:00+07:00',
        end: '2026-11-12T12:00:00+07:00',
        attendees: ['alice@example.com'],
        sendInvites: false,
      },
    };

    const adapter = createAdapter();
    await adapter.execute(step.tool, step.args);
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]?.sendUpdates).toBe('none');

    const { unmount } = renderPlanMomentWithStep(step);
    expect(screen.getByText(/1 khách mời/i)).toBeInTheDocument();
    expect(screen.getByText(/Không gửi email mời họp/i)).toBeInTheDocument();
    expect(screen.queryByText(/📨\s*Gửi email mời họp/i)).not.toBeInTheDocument();
    unmount();

    render(<PreviewContents step={step} destination="Lịch chính" />);
    expect(screen.getByText(/alice@example\.com/i)).toBeInTheDocument();
    expect(screen.getByText(/Không gửi email mời họp/i)).toBeInTheDocument();
    expect(screen.queryByText(/📨\s*Gửi email mời họp/i)).not.toBeInTheDocument();
  });

  it('shows email invitation pill and preview badge ONLY when attendees are present and sendInvites is strictly true (matches adapter sendUpdates=all)', async () => {
    const step: PlanStep = {
      id: 'step-07-true',
      tool: 'mycalendar.create_event',
      description: 'Tạo cuộc họp khách hàng',
      args: {
        calendarId: 'user@gmail.com',
        summary: 'Họp khách hàng',
        start: '2026-11-12T14:00:00+07:00',
        end: '2026-11-12T15:00:00+07:00',
        attendees: ['client@example.com', 'pm@example.com'],
        sendInvites: true,
      },
    };

    const adapter = createAdapter();
    await adapter.execute(step.tool, step.args);
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]?.sendUpdates).toBe('all');

    const { unmount } = renderPlanMomentWithStep(step);
    expect(screen.getByText(/2 khách mời/i)).toBeInTheDocument();
    expect(screen.getByText(/📨\s*Gửi email mời họp/i)).toBeInTheDocument();
    expect(screen.queryByText(/Không gửi email mời họp/i)).not.toBeInTheDocument();
    unmount();

    render(<PreviewContents step={step} destination="Lịch chính" />);
    expect(screen.getByText(/client@example\.com/i)).toBeInTheDocument();
    expect(screen.getByText(/pm@example\.com/i)).toBeInTheDocument();
    expect(screen.getByText(/📨\s*Gửi email mời họp/i)).toBeInTheDocument();
    expect(screen.queryByText(/Không gửi email mời họp/i)).not.toBeInTheDocument();
  });

  it.each([undefined, false, true] as const)(
    'does NOT render misleading invitation pills or raw OtherArguments when attendees are absent (sendInvites=%s)',
    async (sendInvitesValue) => {
      const step: PlanStep = {
        id: `step-07-no-attendees-${String(sendInvitesValue)}`,
        tool: 'mycalendar.create_event',
        description: 'Tập trung cá nhân',
        args: {
          calendarId: 'user@gmail.com',
          summary: 'Tập trung cá nhân',
          start: '2026-11-12T16:00:00+07:00',
          end: '2026-11-12T17:00:00+07:00',
          ...(sendInvitesValue !== undefined ? { sendInvites: sendInvitesValue } : {}),
        },
      };

      const adapter = createAdapter();
      await adapter.execute(step.tool, step.args);
      expect(capturedRequests).toHaveLength(1);
      expect(capturedRequests[0]?.sendUpdates).toBe(sendInvitesValue === true ? 'all' : 'none');
      expect(capturedRequests[0]?.body?.attendees).toBeUndefined();

      const { unmount } = renderPlanMomentWithStep(step);
      expect(screen.queryByText(/khách mời/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Gửi email mời họp/i)).not.toBeInTheDocument();
      unmount();

      render(<PreviewContents step={step} destination="Lịch chính" />);
      expect(screen.queryByText(/Gửi email mời họp/i)).not.toBeInTheDocument();
    },
  );

  it('maintains parity for mycalendar.schedule_meet and mycalendar.update_event when sendInvites is omitted vs true, and displays explicit optional timeZone without browser-zone inference', async () => {
    const meetStepOmitted: PlanStep = {
      id: 'step-07-meet',
      tool: 'mycalendar.schedule_meet',
      description: 'Tạo lịch họp Google Meet định kỳ',
      args: {
        calendarId: 'user@gmail.com',
        summary: 'Sync thiết kế sản phẩm',
        start: '2026-11-13T09:00:00+07:00',
        end: '2026-11-13T09:30:00+07:00',
        attendees: ['designer@example.com'],
        recurrence: 'WEEKLY',
        timeZone: 'Asia/Ho_Chi_Minh',
      },
    };

    const adapter = createAdapter();
    await adapter.execute(meetStepOmitted.tool, {
      calendarId: 'user@gmail.com',
      summary: 'Sync thiết kế sản phẩm',
      start: '2026-11-13T09:00:00+07:00',
      end: '2026-11-13T09:30:00+07:00',
      attendees: ['designer@example.com'],
      recurrence: 'WEEKLY',
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    expect(capturedRequests[0]?.sendUpdates).toBe('none');
    expect(capturedRequests[0]?.conferenceDataVersion).toBe('1');

    const { unmount } = renderPlanMomentWithStep( meetStepOmitted );
    expect(screen.queryByText(/📨\s*Gửi email mời họp/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Không gửi email mời họp/i)).toBeInTheDocument();
    expect(screen.getByText(/Múi giờ:\s*Asia\/Ho_Chi_Minh/i)).toBeInTheDocument();
    unmount();

    const { unmount: unmountPreview } = render(
      <PreviewContents step={meetStepOmitted} destination="Lịch chính" />,
    );
    expect(screen.getByText(/designer@example\.com/i)).toBeInTheDocument();
    expect(screen.getByText(/Không gửi email mời họp/i)).toBeInTheDocument();
    expect(screen.getByText(/Múi giờ:\s*Asia\/Ho_Chi_Minh/i)).toBeInTheDocument();
    unmountPreview();

    const updateStepWithoutTz: PlanStep = {
      id: 'step-07-update',
      tool: 'mycalendar.update_event',
      description: 'Dời lịch review',
      args: {
        calendarId: 'user@gmail.com',
        eventId: 'evt_101',
        summary: 'Dời lịch review',
        start: '2026-11-13T14:00:00+07:00',
        end: '2026-11-13T15:00:00+07:00',
        attendees: ['reviewer@example.com'],
      },
    };

    await adapter.execute(updateStepWithoutTz.tool, updateStepWithoutTz.args);
    expect(capturedRequests[1]?.sendUpdates).toBe('none');

    const { unmount: unmountUpdatePlan } = renderPlanMomentWithStep(updateStepWithoutTz);
    expect(screen.getByText(/Không gửi email mời họp/i)).toBeInTheDocument();
    expect(screen.queryByText(/Múi giờ:/i)).not.toBeInTheDocument();
    unmountUpdatePlan();

    render(<PreviewContents step={updateStepWithoutTz} destination="Lịch chính" />);
    expect(screen.queryByText(/Múi giờ:/i)).not.toBeInTheDocument();
  });
});
