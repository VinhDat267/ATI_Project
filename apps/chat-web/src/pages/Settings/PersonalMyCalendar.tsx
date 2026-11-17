import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ServiceInfo } from '../../types';
import { apiClient } from '../../services/api-client';
import { mycalendarSessionOwner, redirectToMyCalendar } from '../../services/gmail-connection';
import { CockpitDialog } from '../../components/CockpitDialog';
import { ServiceLogo } from '../../components/ServiceLogo';
import {
  CAPABILITY_PILL_CLASS,
  CARD_CONTAINER_CLASS,
  DANGER_GHOST_BTN,
  PRIMARY_CONNECT_BTN,
  SECONDARY_ACTION_BTN,
  connectionBadgeClass,
} from './ServiceConnectionCard';

const button = PRIMARY_CONNECT_BTN;
const secondary = SECONDARY_ACTION_BTN;

interface CalendarItem {
  id: string;
  summary: string;
  timeZone?: string;
  primary?: boolean;
  accessRole?: 'owner' | 'writer';
}

interface CalendarTriggerItem {
  id: string;
  name: string;
  triggerType: 'pre_meeting_reminder' | 'event_change_watch';
  calendarIds: string[];
  leadMinutes: number;
  destination: { service: string; channelId: string; channelName?: string; credentialId?: string };
  status: 'active' | 'paused' | 'blocked';
  pauseReason: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
}

interface TriggerDestinationItem {
  key: string;
  service: string;
  channelId: string;
  channelName: string;
  credentialId?: string;
  label: string;
}

export function PersonalMyCalendar({
  service,
  refresh,
  selected,
  navigate,
  standalone = true,
}: {
  service: ServiceInfo;
  refresh: () => Promise<void>;
  selected: string | null;
  navigate?: (path: string, replace?: boolean) => void;
  standalone?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [calendars, setCalendars] = useState<CalendarItem[]>([]);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [pickerError, setPickerError] = useState('');
  const [triggersOpen, setTriggersOpen] = useState(false);
  const [triggersLoading, setTriggersLoading] = useState(false);
  const [triggersBusy, setTriggersBusy] = useState(false);
  const [triggers, setTriggers] = useState<CalendarTriggerItem[]>([]);
  const [triggerDestinations, setTriggerDestinations] = useState<TriggerDestinationItem[]>([]);
  const [triggerError, setTriggerError] = useState('');
  const [triggerNotice, setTriggerNotice] = useState('');
  const [newTriggerName, setNewTriggerName] = useState('');
  const [newTriggerType, setNewTriggerType] = useState<'pre_meeting_reminder' | 'event_change_watch'>('pre_meeting_reminder');
  const [newTriggerLead, setNewTriggerLead] = useState(15);
  const [newTriggerDestKey, setNewTriggerDestKey] = useState('');
  const [newTriggerCalIds, setNewTriggerCalIds] = useState<string[]>([]);

  const mounted = useRef(false);
  const pending = useRef(false);
  const row = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const focus = () => {
      if (window.location.hash === '#mycalendar') {
        row.current?.scrollIntoView?.({ block: 'center' });
        row.current?.focus();
      }
    };
    focus();
    window.addEventListener('hashchange', focus);
    window.addEventListener('popstate', focus);
    return () => {
      window.removeEventListener('hashchange', focus);
      window.removeEventListener('popstate', focus);
    };
  }, [selected]);

  const connect = async () => {
    if (pending.current) return;
    const owns = mycalendarSessionOwner();
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await apiClient.startMyCalendarConnection();
      if (mounted.current && owns()) redirectToMyCalendar(result.url);
    } catch {
      if (mounted.current && owns())
        setError('Không thể cập nhật kết nối Google Calendar. Hãy kiểm tra mạng và thử lại.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const disconnect = async () => {
    if (pending.current) return;
    const owns = mycalendarSessionOwner();
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await apiClient.disconnectMyCalendar();
      if (mounted.current && owns()) {
        setConfirm(false);
        await refresh();
      }
    } catch {
      if (mounted.current && owns())
        setError('Không thể ngắt kết nối Google Calendar. Hãy kiểm tra mạng và thử lại.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const openCalendarPicker = async () => {
    if (navigate) {
      navigate('/connections/mycalendar/callback?mode=select', true);
      return;
    }
    setPickerOpen(true);
    setLoadingCalendars(true);
    setPickerError('');
    try {
      const result = await apiClient.listMyCalendarCalendars();
      if (!mounted.current) return;
      setCalendars(result.calendars);
      if (Array.isArray(result.selectedCalendarIds) && result.selectedCalendarIds.length > 0) {
        setCheckedIds(result.selectedCalendarIds);
      } else {
        const primaryCal = result.calendars.find((c) => c.primary) ?? result.calendars[0];
        setCheckedIds(primaryCal ? [primaryCal.id] : []);
      }
    } catch (err: any) {
      if (mounted.current) {
        setPickerError(err?.message || 'Không thể tải danh sách lịch từ Google.');
      }
    } finally {
      if (mounted.current) setLoadingCalendars(false);
    }
  };

  const quickSelectPrimary = async () => {
    if (pending.current || busy) return;
    const owns = mycalendarSessionOwner();
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await apiClient.selectPrimaryMyCalendar();
      if (mounted.current && owns()) {
        await refresh();
      }
    } catch (err: any) {
      if (mounted.current && owns()) {
        setError(err?.message || 'Không thể chọn nhanh Lịch chính. Vui lòng thử lại.');
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const saveCalendars = async () => {
    if (checkedIds.length === 0 || busy) return;
    setBusy(true);
    setPickerError('');
    try {
      await apiClient.saveMyCalendarScope(checkedIds);
      if (mounted.current) {
        setPickerOpen(false);
        await refresh();
      }
    } catch (err: any) {
      if (mounted.current) {
        setPickerError(err?.message || 'Không thể lưu danh sách lịch. Vui lòng thử lại.');
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const loadTriggers = async () => {
    const fn = (apiClient as any).listMyCalendarTriggers;
    if (typeof fn !== 'function') return;
    setTriggersLoading(true);
    setTriggerError('');
    try {
      const data = await fn.call(apiClient);
      if (!mounted.current) return;
      const destList: TriggerDestinationItem[] = Array.isArray(data?.destinations) ? data.destinations : [];
      setTriggers(Array.isArray(data?.triggers) ? data.triggers : []);
      setTriggerDestinations(destList);
      if (destList.length > 0 && !destList.some((d) => d.key === newTriggerDestKey)) {
        setNewTriggerDestKey(destList[0]!.key);
      }
      if (newTriggerCalIds.length === 0 && Array.isArray(service.selectedCalendars) && service.selectedCalendars.length > 0) {
        setNewTriggerCalIds(service.selectedCalendars.map((c) => c.id));
      }
    } catch (err: any) {
      if (mounted.current) {
        setTriggerError(err?.message || 'Không tải được danh sách cảnh báo lịch.');
      }
    } finally {
      if (mounted.current) setTriggersLoading(false);
    }
  };

  const toggleTriggersPanel = async () => {
    const next = !triggersOpen;
    setTriggersOpen(next);
    if (next) {
      await loadTriggers();
    }
  };

  const createTriggerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (triggersBusy) return;
    const cleanName = newTriggerName.trim();
    if (!cleanName) {
      setTriggerError('Vui lòng nhập tên cảnh báo.');
      return;
    }
    const calIds =
      newTriggerCalIds.length > 0
        ? newTriggerCalIds
        : (service.selectedCalendars ?? []).map((c) => c.id);
    if (calIds.length === 0) {
      setTriggerError('Vui lòng chọn ít nhất 1 lịch làm việc.');
      return;
    }
    const chosenDest = triggerDestinations.find((d) => d.key === newTriggerDestKey) ?? triggerDestinations[0];
    if (!chosenDest) {
      setTriggerError('Cần kết nối Slack hoặc Telegram trước khi tạo cảnh báo.');
      return;
    }

    setTriggersBusy(true);
    setTriggerError('');
    setTriggerNotice('');
    try {
      const res = await (apiClient as any).createMyCalendarTrigger({
        name: cleanName,
        triggerType: newTriggerType,
        calendarIds: calIds,
        leadMinutes: newTriggerType === 'pre_meeting_reminder' ? Number(newTriggerLead) || 15 : 15,
        destination: {
          service: chosenDest.service,
          channelId: chosenDest.channelId,
          channelName: chosenDest.channelName,
          ...(chosenDest.credentialId ? { credentialId: chosenDest.credentialId } : {}),
        },
      });
      if (!mounted.current) return;
      if (res?.trigger) {
        setTriggers((prev) => [res.trigger, ...prev]);
      }
      setNewTriggerName('');
      setTriggerNotice('Đã bật cảnh báo tự động cho Google Calendar.');
    } catch (err: any) {
      if (mounted.current) {
        setTriggerError(err?.message || 'Không tạo được quy tắc cảnh báo lịch.');
      }
    } finally {
      if (mounted.current) setTriggersBusy(false);
    }
  };

  const runTriggerNow = async (triggerId: string) => {
    if (triggersBusy) return;
    setTriggersBusy(true);
    setTriggerError('');
    setTriggerNotice('');
    try {
      const res = await (apiClient as any).runMyCalendarTriggerNow(triggerId);
      if (!mounted.current) return;
      if (res?.trigger) {
        setTriggers((prev) => prev.map((t) => (t.id === triggerId ? res.trigger : t)));
      }
      const sent = Number(res?.result?.notificationsSent ?? 0);
      if (res?.result?.baselineSeeded) {
        setTriggerNotice('Đã ghi nhận danh sách sự kiện gốc; thay đổi tiếp theo sẽ được gửi cảnh báo.');
      } else if (sent > 0) {
        setTriggerNotice(`Đã gửi ${sent} thông báo cảnh báo tới kênh nhận.`);
      } else {
        setTriggerNotice('Đã kiểm tra lịch: hiện chưa có sự kiện nào cần báo.');
      }
    } catch (err: any) {
      if (mounted.current) {
        setTriggerError(err?.message || 'Không thể chạy kiểm tra cảnh báo.');
      }
    } finally {
      if (mounted.current) setTriggersBusy(false);
    }
  };

  const toggleTriggerStatus = async (item: CalendarTriggerItem) => {
    if (triggersBusy) return;
    const nextStatus = item.status === 'active' ? 'paused' : 'active';
    setTriggersBusy(true);
    setTriggerError('');
    setTriggerNotice('');
    try {
      const res = await (apiClient as any).updateMyCalendarTrigger(item.id, { status: nextStatus });
      if (!mounted.current) return;
      if (res?.trigger) {
        setTriggers((prev) => prev.map((t) => (t.id === item.id ? res.trigger : t)));
      }
      setTriggerNotice(nextStatus === 'active' ? 'Đã bật lại cảnh báo.' : 'Đã tạm dừng cảnh báo.');
    } catch (err: any) {
      if (mounted.current) {
        setTriggerError(err?.message || 'Không cập nhật được trạng thái cảnh báo.');
      }
    } finally {
      if (mounted.current) setTriggersBusy(false);
    }
  };

  const removeTrigger = async (triggerId: string) => {
    if (triggersBusy) return;
    setTriggersBusy(true);
    setTriggerError('');
    setTriggerNotice('');
    try {
      await (apiClient as any).deleteMyCalendarTrigger(triggerId);
      if (!mounted.current) return;
      setTriggers((prev) => prev.filter((t) => t.id !== triggerId));
      setTriggerNotice('Đã xoá quy tắc cảnh báo.');
    } catch (err: any) {
      if (mounted.current) {
        setTriggerError(err?.message || 'Không xoá được quy tắc cảnh báo.');
      }
    } finally {
      if (mounted.current) setTriggersBusy(false);
    }
  };

  const status = service.personalStatus ?? 'not_connected';
  const badgeTone =
    status === 'connected'
      ? 'connected'
      : status === 'scope_required' || status === 'reconnect_required'
        ? 'warning'
        : 'neutral';

  const content = (
    <div
      ref={row}
      id="service-row-mycalendar"
      tabIndex={-1}
      className={`${CARD_CONTAINER_CLASS} flex flex-col justify-between gap-3.5 focus-visible:ring-2 focus-visible:ring-[#FF5701] focus-visible:v3-outline-none`}
    >
      <div id="mycalendar" className="hidden" />
      <div className="v3-space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-sans font-semibold text-base text-[#111827] dark:text-white flex items-center gap-2.5">
              <ServiceLogo service="mycalendar" className="w-5 h-5" />
              <span>Google Calendar của bạn</span>
            </h3>
            {(status === 'scope_required' || service.email) && (
              <p className="text-xs font-medium text-[#4B5563] dark:text-[#9CA3AF] break-words mt-0.5 pl-7">
                {status === 'scope_required' && <span>Đã cấp quyền · Chưa chọn lịch</span>}
                {status === 'scope_required' && service.email && ' · '}
                {service.email}
              </p>
            )}
          </div>
          <span className={connectionBadgeClass(badgeTone)}>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                badgeTone === 'connected'
                  ? 'bg-[#16A34A]'
                  : badgeTone === 'warning'
                    ? 'bg-amber-500'
                    : 'bg-[#9CA3AF]'
              }`}
            />
            <span>
              {status === 'connected'
                ? 'Đã kết nối'
                : status === 'scope_required'
                  ? 'Chưa chọn lịch'
                  : status === 'reconnect_required'
                    ? 'Cần kết nối lại'
                    : 'Chưa kết nối'}
            </span>
          </span>
        </div>
        <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] leading-relaxed">
          Planora chỉ đọc sự kiện, tìm khung giờ trống và tạo, cập nhật hoặc huỷ sự kiện trên các lịch bạn
          đã chọn sau khi bạn duyệt kế hoạch (không tự ý gửi lời mời cho người khác).
        </p>
        <div data-testid="mycalendar-ecosystem-badges" className="flex flex-wrap items-center gap-1.5">
          <span className={CAPABILITY_PILL_CLASS}>
            Google Calendar
          </span>
          <span className={CAPABILITY_PILL_CLASS}>
            Phòng họp Google Meet
          </span>
          <span className={CAPABILITY_PILL_CLASS}>
            Mời khách theo phê duyệt
          </span>
        </div>

        {status === 'connected' && service.selectedCalendars && service.selectedCalendars.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 p-2.5 rounded-xl bg-[#F8F8F6] dark:bg-[#0E1528] border border-[#E7E7E2] dark:border-[#293653]">
            <span className="text-xs font-medium text-[#4B5563] dark:text-[#9CA3AF]">Lịch được dùng:</span>
            {service.selectedCalendars.map((cal) => (
              <span
                key={cal.id}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-200 border border-blue-200 dark:border-blue-800/60"
              >
                <span>{cal.summary}</span>
                {cal.primary && <span className="text-xs text-blue-500 dark:text-blue-300 font-semibold">(chính)</span>}
              </span>
            ))}
          </div>
        )}

        {status === 'reconnect_required' && (
          <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
            Quyền có thể đã bị thu hồi hoặc hết hạn sau 7 ngày ở chế độ thử nghiệm của Google. Hãy kết
            nối lại.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-[#F3F4F6] dark:border-[#293653]">
        {status === 'not_connected' && (
          <button
            id="mycalendar-action"
            type="button"
            className={button}
            disabled={busy}
            onClick={() => void connect()}
          >
            Kết nối Google Calendar
          </button>
        )}

        {status === 'scope_required' && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button
                id="mycalendar-quick-primary"
                type="button"
                className={button}
                disabled={busy}
                onClick={() => void quickSelectPrimary()}
              >
                Dùng ngay Lịch chính
              </button>
              <button
                id="mycalendar-action"
                type="button"
                className={secondary}
                disabled={busy}
                onClick={() => void openCalendarPicker()}
              >
                Chọn lịch được dùng
              </button>
            </div>
            <button
              type="button"
              className={DANGER_GHOST_BTN}
              disabled={busy}
              onClick={() => setConfirm(true)}
            >
              Ngắt kết nối
            </button>
          </>
        )}

        {status === 'connected' && (
          <>
            <button
              type="button"
              aria-expanded={triggersOpen}
              aria-controls="mycalendar-triggers-panel"
              className={secondary}
              disabled={busy}
              onClick={() => void toggleTriggersPanel()}
            >
              Cảnh báo & Nhắc lịch tự động{triggers.length > 0 ? ` (${triggers.length})` : ''}
            </button>
            <button
              id="mycalendar-action"
              type="button"
              className={secondary}
              disabled={busy}
              onClick={() => void openCalendarPicker()}
            >
              Chọn lại lịch được dùng
            </button>
            <button
              type="button"
              className={DANGER_GHOST_BTN}
              disabled={busy}
              onClick={() => setConfirm(true)}
            >
              Ngắt kết nối
            </button>
          </>
        )}

        {status === 'reconnect_required' && (
          <>
            <button
              id="mycalendar-action"
              type="button"
              className={button}
              disabled={busy}
              onClick={() => void connect()}
            >
              Kết nối lại Google Calendar
            </button>
            <button
              type="button"
              className={DANGER_GHOST_BTN}
              disabled={busy}
              onClick={() => setConfirm(true)}
            >
              Ngắt kết nối
            </button>
          </>
        )}
      </div>

      {busy && (
        <p role="status" className="text-xs text-[#6B7280]">
          {status === 'connected' ? 'Đang cập nhật…' : 'Đang chuyển hướng tới Google…'}
        </p>
      )}

      {error && (
        <p role="alert" className="text-xs text-[#DC2626]">
          {error}
        </p>
      )}

      {status === 'connected' && triggersOpen && (
        <div
          id="mycalendar-triggers-panel"
          data-testid="mycalendar-triggers-section"
          className="mt-1 pt-3 border-t border-[#E7E7E2] dark:border-[#293653] v3-space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 id="mycalendar-triggers-heading" className="text-sm font-semibold text-[#111827] dark:text-white">
                Cảnh báo sự kiện chủ động
              </h4>
              <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                Tự động nhắc trước giờ họp hoặc báo ngay khi lịch họp có thay đổi.
              </p>
            </div>
          </div>

          <div aria-live="polite" className="min-h-[1rem]">
            {triggerNotice && (
              <p className="text-xs font-medium text-[#15803D] dark:text-[#86EFAC] bg-[#F0FDF4] dark:bg-emerald-950/40 border border-[#BBF7D0] dark:border-emerald-800/60 rounded-lg px-3 py-2">
                {triggerNotice}
              </p>
            )}
          </div>

          {triggerError && (
            <p role="alert" className="text-xs text-[#DC2626] bg-[#FEF2F2] border border-[#FECACA] rounded-lg px-3 py-2">
              {triggerError}
            </p>
          )}

          {triggersLoading ? (
            <progress aria-label="Đang tải danh sách cảnh báo" className="w-full h-1.5" />
          ) : (
            <div className="v3-space-y-2.5">
              {triggers.length === 0 ? (
                <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                  Chưa có quy tắc cảnh báo nào được thiết lập.
                </p>
              ) : (
                <ul className="v3-space-y-2">
                  {triggers.map((item) => (
                    <li
                      key={item.id}
                      className="p-3 rounded-xl border border-[#E7E7E2] dark:border-[#293653] bg-[#F8F8F6] dark:bg-[#0E1528] flex flex-wrap items-start justify-between gap-2"
                    >
                      <div className="min-w-0 v3-space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-[#111827] dark:text-white">{item.name}</span>
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-800 border border-blue-200">
                            {item.triggerType === 'pre_meeting_reminder'
                              ? `Nhắc trước ${item.leadMinutes} phút`
                              : 'Theo dõi đổi / huỷ lịch'}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                              item.status === 'active'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : item.status === 'paused'
                                  ? 'bg-neutral-100 text-neutral-700 border-neutral-200'
                                  : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}
                          >
                            {item.status === 'active'
                              ? 'Đang bật'
                              : item.status === 'paused'
                                ? 'Tạm dừng'
                                : 'Cần kiểm tra'}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#4B5563] dark:text-[#9CA3AF]">
                          Gửi tới: {item.destination.channelName || item.destination.channelId}
                        </p>
                        {item.pauseReason && (
                          <p className="text-[11px] text-[#DC2626]">{item.pauseReason}</p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          className={secondary}
                          disabled={triggersBusy}
                          onClick={() => void runTriggerNow(item.id)}
                        >
                          Chạy thử ngay
                        </button>
                        <button
                          type="button"
                          className={secondary}
                          disabled={triggersBusy}
                          onClick={() => void toggleTriggerStatus(item)}
                        >
                          {item.status === 'active' ? 'Tạm dừng' : 'Bật lại'}
                        </button>
                        <button
                          type="button"
                          className={DANGER_GHOST_BTN}
                          disabled={triggersBusy}
                          onClick={() => void removeTrigger(item.id)}
                        >
                          Xoá cảnh báo
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <form
                aria-labelledby="mycalendar-triggers-heading"
                onSubmit={(e) => void createTriggerSubmit(e)}
                className="p-3 rounded-xl border border-[#E7E7E2] dark:border-[#293653] bg-white dark:bg-[#11192E] v3-space-y-3"
              >
                <div className="flex flex-col gap-1">
                  <label htmlFor="mycal-trigger-name" className="text-xs font-semibold text-[#111827] dark:text-white">
                    Tên cảnh báo <span aria-hidden="true">*</span>
                  </label>
                  <input
                    id="mycal-trigger-name"
                    name="triggerName"
                    type="text"
                    required
                    maxLength={120}
                    value={newTriggerName}
                    onChange={(e) => setNewTriggerName(e.target.value)}
                    placeholder="Ví dụ: Nhắc họp Sprint trước 15 phút"
                    className="w-full rounded-lg border border-[#D1D5DB] dark:border-[#293653] bg-white dark:bg-[#0E1528] px-3 py-1.5 text-xs text-[#111827] dark:text-[#F1F5F9]"
                  />
                </div>

                <fieldset className="v3-space-y-1.5">
                  <legend className="text-xs font-semibold text-[#111827] dark:text-white mb-1">
                    Chế độ theo dõi
                  </legend>
                  <div className="flex flex-wrap items-center gap-4 text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      <input
                        id="mycal-trigger-type-pre"
                        type="radio"
                        name="triggerType"
                        value="pre_meeting_reminder"
                        checked={newTriggerType === 'pre_meeting_reminder'}
                        onChange={() => setNewTriggerType('pre_meeting_reminder')}
                      />
                      <label htmlFor="mycal-trigger-type-pre">Nhắc trước giờ họp</label>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <input
                        id="mycal-trigger-type-watch"
                        type="radio"
                        name="triggerType"
                        value="event_change_watch"
                        checked={newTriggerType === 'event_change_watch'}
                        onChange={() => setNewTriggerType('event_change_watch')}
                      />
                      <label htmlFor="mycal-trigger-type-watch">Theo dõi đổi / huỷ lịch</label>
                    </span>
                  </div>
                </fieldset>

                {newTriggerType === 'pre_meeting_reminder' && (
                  <div className="flex flex-col gap-1">
                    <label htmlFor="mycal-trigger-lead" className="text-xs font-semibold text-[#111827] dark:text-white">
                      Nhắc trước (phút)
                    </label>
                    <input
                      id="mycal-trigger-lead"
                      name="leadMinutes"
                      type="number"
                      min={1}
                      max={1440}
                      value={newTriggerLead}
                      onChange={(e) => setNewTriggerLead(Math.max(1, Math.min(1440, Number(e.target.value) || 15)))}
                      className="w-28 rounded-lg border border-[#D1D5DB] dark:border-[#293653] bg-white dark:bg-[#0E1528] px-3 py-1.5 text-xs text-[#111827] dark:text-[#F1F5F9]"
                    />
                  </div>
                )}

                {service.selectedCalendars && service.selectedCalendars.length > 1 && (
                  <fieldset className="v3-space-y-1.5">
                    <legend className="text-xs font-semibold text-[#111827] dark:text-white mb-1">
                      Lịch được theo dõi
                    </legend>
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      {service.selectedCalendars.map((cal) => {
                        const checkboxId = `mycal-trig-cal-${cal.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
                        const checked = newTriggerCalIds.includes(cal.id);
                        return (
                          <span key={cal.id} className="inline-flex items-center gap-1.5">
                            <input
                              id={checkboxId}
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setNewTriggerCalIds((prev) =>
                                  prev.includes(cal.id) ? prev.filter((id) => id !== cal.id) : [...prev, cal.id],
                                )
                              }
                            />
                            <label htmlFor={checkboxId}>{cal.summary}</label>
                          </span>
                        );
                      })}
                    </div>
                  </fieldset>
                )}

                <div className="flex flex-col gap-1">
                  <label htmlFor="mycal-trigger-dest" className="text-xs font-semibold text-[#111827] dark:text-white">
                    Kênh nhận cảnh báo
                  </label>
                  {triggerDestinations.length > 0 ? (
                    <select
                      id="mycal-trigger-dest"
                      name="destinationKey"
                      value={newTriggerDestKey}
                      onChange={(e) => setNewTriggerDestKey(e.target.value)}
                      className="w-full rounded-lg border border-[#D1D5DB] dark:border-[#293653] bg-white dark:bg-[#0E1528] px-3 py-1.5 text-xs text-[#111827] dark:text-[#F1F5F9]"
                    >
                      {triggerDestinations.map((dest) => (
                        <option key={dest.key} value={dest.key}>
                          {dest.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">
                      Hãy kết nối Slack hoặc Telegram ở trang này để chọn kênh nhận thông báo.
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="submit"
                    className={button}
                    disabled={triggersBusy || triggerDestinations.length === 0}
                  >
                    {triggersBusy ? 'Đang xử lý…' : 'Tạo cảnh báo'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      {standalone ? (
        <section aria-labelledby="heading-personal-services" className="mb-8">
          <h2
            id="heading-personal-services"
            className="text-xs font-bold uppercase tracking-wider text-[#6B7280] mb-3.5"
          >
            Của riêng bạn
          </h2>
          {content}
        </section>
      ) : (
        content
      )}

      {confirm &&
        createPortal(
          <CockpitDialog
            title="Ngắt kết nối Google Calendar?"
            returnFocusId="mycalendar-action"
            onClose={() => {
              if (!busy) setConfirm(false);
            }}
          >
            <div className="p-5 v3-space-y-4">
              <p className="text-sm">
                Planora sẽ xoá token và thu hồi quyền truy cập. Hội thoại cũ vẫn còn; kế hoạch cũ không
                thể dùng kết nối đã ngắt.
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className={secondary}
                  disabled={busy}
                  onClick={() => setConfirm(false)}
                >
                  Giữ kết nối
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() => void disconnect()}
                >
                  Xác nhận ngắt kết nối
                </button>
              </div>
              {error && (
                <p role="alert" className="text-xs text-[#DC2626]">
                  {error}
                </p>
              )}
            </div>
          </CockpitDialog>,
          document.body
        )}

      {pickerOpen &&
        createPortal(
          <CockpitDialog
            title="Chọn lịch Google Calendar được dùng"
            returnFocusId="mycalendar-action"
            onClose={() => {
              if (!busy) setPickerOpen(false);
            }}
          >
            <div className="p-5 v3-space-y-4 max-h-[75vh] overflow-y-auto">
              {loadingCalendars ? (
                <p role="status" className="text-sm text-[#4B5563]">
                  Đang tải danh sách lịch…
                </p>
              ) : (
                <>
                  <p className="text-xs text-[#6B7280]">
                    Chọn ít nhất 1 lịch mà bạn cho phép Planora đọc và tạo sự kiện:
                  </p>
                  <div className="v3-space-y-2">
                    {calendars.map((cal) => (
                      <label
                        key={cal.id}
                        className="flex items-start gap-3 p-3 rounded-lg border border-[#E7E7E2] hover:bg-neutral-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checkedIds.includes(cal.id)}
                          onChange={() =>
                            setCheckedIds((prev) =>
                              prev.includes(cal.id)
                                ? prev.filter((i) => i !== cal.id)
                                : [...prev, cal.id]
                            )
                          }
                          className="mt-0.5 text-[#FF5701] rounded border-[#E7E7E2] focus:ring-[#FF5701]"
                        />
                        <div className="min-w-0 text-xs">
                          <span className="font-semibold text-[#111827]">{cal.summary}</span>
                          {cal.primary && (
                            <span className="ml-2 px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-700">
                              Lịch chính
                            </span>
                          )}
                          {cal.id !== cal.summary && (
                            <p className="text-[11px] text-[#6B7280] font-mono">{cal.id}</p>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>

                  {checkedIds.length === 0 && (
                    <p role="alert" className="text-xs text-[#DC2626]">
                      Vui lòng chọn ít nhất 1 lịch để tiếp tục.
                    </p>
                  )}

                  {pickerError && (
                    <p role="alert" className="text-xs text-[#DC2626]">
                      {pickerError}
                    </p>
                  )}

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="button"
                      disabled={checkedIds.length === 0 || busy}
                      onClick={() => void saveCalendars()}
                      className={button}
                    >
                      {busy ? 'Đang lưu…' : 'Lưu lịch được dùng'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setPickerOpen(false)}
                      className={secondary}
                    >
                      Đóng
                    </button>
                  </div>
                </>
              )}
            </div>
          </CockpitDialog>,
          document.body
        )}
    </>
  );
}
