import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ServiceInfo } from '../../types';
import { apiClient } from '../../services/api-client';
import { mycalendarSessionOwner, redirectToMyCalendar } from '../../services/gmail-connection';
import { CockpitDialog } from '../../components/CockpitDialog';
import { ServiceLogo } from '../../components/ServiceLogo';

const button =
  'px-4 py-2 rounded-xl text-xs font-semibold bg-[#FF5701] text-white hover:bg-[#E04C00] disabled:opacity-50 transition-colors shadow-sm';
const secondary =
  'px-4 py-2 rounded-xl text-xs font-medium bg-white text-[#111827] border border-[#E7E7E2] hover:bg-neutral-50 disabled:opacity-50 transition-colors';

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

  const content = (
    <div
      ref={row}
      id="service-row-mycalendar"
      tabIndex={-1}
      className="bg-white border border-[#E7E7E2] rounded-xl p-4 sm:p-5 v3-space-y-3 focus-visible:ring-2 focus-visible:ring-[#FF5701] focus-visible:v3-outline-none"
    >
      <div id="mycalendar" />
      <h3 className="font-display font-semibold text-base text-[#111827] flex items-center gap-3">
        <ServiceLogo service="mycalendar" className="w-6 h-6" />
        Google Calendar của bạn
      </h3>
      <p className="text-xs text-[#6B7280]">
        ATI chỉ đọc sự kiện và tạo sự kiện mới trên các lịch bạn đã chọn, không sửa hay xoá sự kiện
        có sẵn, không mời người tham dự.
      </p>

      <p className="text-sm text-[#111827] break-words">
        <span>
          {status === 'connected'
            ? 'Đã kết nối'
            : status === 'scope_required'
            ? 'Đã cấp quyền · Chưa chọn lịch'
            : status === 'reconnect_required'
            ? 'Cần kết nối lại'
            : 'Chưa kết nối'}
        </span>
        {service.email && <> · {service.email}</>}
      </p>

      {service.connectedAt && (
        <p className="text-xs text-[#6B7280]">
          Kết nối lúc {new Date(service.connectedAt).toLocaleString('vi-VN')}
        </p>
      )}

      {status === 'connected' && service.selectedCalendars && service.selectedCalendars.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-xs text-[#6B7280]">Lịch được dùng:</span>
          {service.selectedCalendars.map((cal) => (
            <span
              key={cal.id}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200"
            >
              <span>{cal.summary}</span>
              {cal.primary && <span className="text-[10px] text-blue-500 font-semibold">(chính)</span>}
            </span>
          ))}
        </div>
      )}

      {status === 'reconnect_required' && (
        <p className="text-xs text-[#6B7280]">
          Quyền có thể đã bị thu hồi hoặc hết hạn sau 7 ngày ở chế độ thử nghiệm của Google. Hãy kết
          nối lại.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-1">
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
            <button
              id="mycalendar-quick-primary"
              type="button"
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
              disabled={busy}
              onClick={() => void quickSelectPrimary()}
            >
              Dùng ngay Lịch chính (1 chạm)
            </button>
            <button
              id="mycalendar-action"
              type="button"
              className={button}
              disabled={busy}
              onClick={() => void openCalendarPicker()}
            >
              Chọn lịch được dùng
            </button>
            <button
              type="button"
              className={secondary}
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
              className={secondary}
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
              className={secondary}
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
                ATI sẽ xoá token và thu hồi quyền truy cập. Hội thoại cũ vẫn còn; kế hoạch cũ không
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
                    Chọn ít nhất 1 lịch mà bạn cho phép ATI đọc và tạo sự kiện:
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
                            <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-blue-50 text-blue-700">
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
