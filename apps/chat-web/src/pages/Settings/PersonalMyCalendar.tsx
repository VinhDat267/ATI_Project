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
          <div className="flex flex-wrap items-center gap-1.5 p-2.5 rounded-xl bg-[#F8F8F6] dark:bg-[#161616] border border-[#E7E7E2] dark:border-[#2E2E2E]">
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

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-[#F3F4F6] dark:border-[#2E2E2E]">
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
