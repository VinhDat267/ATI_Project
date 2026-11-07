import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ServiceInfo } from '../../types';
import { apiClient } from '../../services/api-client';
import { mycalendarSessionOwner, redirectToMyCalendar } from '../../services/gmail-connection';
import { CockpitDialog } from '../../components/CockpitDialog';
import { ServiceLogo } from '../../components/ServiceLogo';

const button =
  'px-4 py-2.5 rounded-xl text-xs font-semibold bg-[var(--planora-primary)] text-[var(--planora-on-primary)] hover:bg-[var(--planora-primary-hover)] disabled:opacity-50 transition-all shadow-xs focus-visible:outline-2 focus-visible:outline-[var(--planora-primary)]';
const secondary =
  'px-4 py-2.5 rounded-xl text-xs font-medium bg-[var(--planora-paper)] text-[var(--planora-text)] border border-[var(--planora-border-strong)] hover:bg-[var(--planora-surface-inset)] disabled:opacity-50 transition-colors';

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
      className="bg-[var(--planora-paper)] border border-[var(--planora-divider)] rounded-xl p-4 sm:p-5 v3-space-y-3.5 shadow-xs focus-visible:ring-2 focus-visible:ring-[var(--planora-primary)] focus-visible:v3-outline-none"
    >
      <div id="mycalendar" />
      <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
        <h3 className="font-display font-semibold text-base text-[var(--planora-text)] flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] flex items-center justify-center flex-shrink-0">
            <ServiceLogo service="mycalendar" className="w-5 h-5" />
          </div>
          <span>Google Calendar của bạn</span>
        </h3>
      </div>

      <p className="text-xs text-[var(--planora-muted)] leading-relaxed">
        Planora chỉ đọc sự kiện và tạo sự kiện mới trên các lịch bạn đã chọn, không sửa hay xoá sự kiện
        có sẵn, không mời người tham dự.
      </p>

      <p className="text-sm font-medium text-[var(--planora-text)] break-words">
        <span>
          {status === 'connected'
            ? 'Đã kết nối'
            : status === 'scope_required'
            ? 'Đã cấp quyền · Chưa chọn lịch'
            : status === 'reconnect_required'
            ? 'Cần kết nối lại'
            : 'Chưa kết nối'}
        </span>
        {service.email && <span className="text-[var(--planora-muted)] font-normal"> · {service.email}</span>}
      </p>

      {service.connectedAt && (
        <p className="text-xs text-[var(--planora-muted)]">
          Kết nối lúc {new Date(service.connectedAt).toLocaleString('vi-VN')}
        </p>
      )}

      {status === 'connected' && service.selectedCalendars && service.selectedCalendars.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-xs text-[var(--planora-muted)]">Lịch được dùng:</span>
          {service.selectedCalendars.map((cal) => (
            <span
              key={cal.id}
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
            >
              <span>{cal.summary}</span>
              {cal.primary && <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">(chính)</span>}
            </span>
          ))}
        </div>
      )}

      {status === 'reconnect_required' && (
        <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 p-2.5 rounded-lg border border-amber-200 dark:border-amber-800">
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
              className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-[var(--planora-primary)] text-[var(--planora-on-primary,#FFFFFF)] hover:opacity-90 disabled:opacity-50 transition-all shadow-xs focus-visible:outline-2 focus-visible:outline-[var(--planora-primary)]"
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
        <p role="status" className="text-xs text-[var(--planora-muted)] flex items-center gap-2">
          <svg className="w-3.5 h-3.5 animate-spin text-[var(--planora-primary)]" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>{status === 'connected' ? 'Đang cập nhật…' : 'Đang chuyển hướng tới Google…'}</span>
        </p>
      )}

      {error && (
        <p role="alert" className="text-xs text-[var(--planora-error-text,#DC2626)] font-medium">
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
            className="text-xs font-bold uppercase tracking-wider text-[var(--planora-muted)] mb-3.5"
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
              <p className="text-sm text-[var(--planora-text)]">
                Planora sẽ xoá token và thu hồi quyền truy cập. Hội thoại cũ vẫn còn; kế hoạch cũ không
                thể dùng kết nối đã ngắt.
              </p>
              <div className="flex items-center justify-end gap-3 pt-2">
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
                <p role="alert" className="text-xs text-[var(--planora-error-text,#DC2626)]">
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
                <p role="status" className="text-sm text-[var(--planora-muted)]">
                  Đang tải danh sách lịch…
                </p>
              ) : (
                <>
                  <p className="text-xs text-[var(--planora-muted)]">
                    Chọn ít nhất 1 lịch mà bạn cho phép Planora đọc và tạo sự kiện:
                  </p>
                  <div className="v3-space-y-2">
                    {calendars.map((cal) => (
                      <label
                        key={cal.id}
                        className="flex items-start gap-3 p-3 rounded-lg border border-[var(--planora-divider)] hover:bg-[var(--planora-surface-inset)] cursor-pointer"
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
                          className="mt-0.5 text-[var(--planora-primary)] rounded border-[var(--planora-border-strong)] focus:ring-[var(--planora-primary)]"
                        />
                        <div className="min-w-0 text-xs">
                          <span className="font-semibold text-[var(--planora-text)]">{cal.summary}</span>
                          {cal.primary && (
                            <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                              Lịch chính
                            </span>
                          )}
                          {cal.id !== cal.summary && (
                            <p className="text-[11px] text-[var(--planora-muted)] font-mono">{cal.id}</p>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>

                  {checkedIds.length === 0 && (
                    <p role="alert" className="text-xs text-[var(--planora-error-text,#DC2626)]">
                      Vui lòng chọn ít nhất 1 lịch để tiếp tục.
                    </p>
                  )}

                  {pickerError && (
                    <p role="alert" className="text-xs text-[var(--planora-error-text,#DC2626)]">
                      {pickerError}
                    </p>
                  )}

                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setPickerOpen(false)}
                      className={secondary}
                    >
                      Đóng
                    </button>
                    <button
                      type="button"
                      disabled={checkedIds.length === 0 || busy}
                      onClick={() => void saveCalendars()}
                      className={button}
                    >
                      {busy ? 'Đang lưu…' : 'Lưu lịch được dùng'}
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
export default PersonalMyCalendar;
