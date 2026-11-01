import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MyCalendarCallbackInput } from '../routes';
import { apiClient } from '../services/api-client';
import { subscribeAuthTokens } from '../services/auth-storage';
import {
  mycalendarSessionOwner,
  mycalendarCallbackError,
  mycalendarConnectionNotice,
  conversationReturnPath,
} from '../services/gmail-connection';
import { usePrototypePage } from '../prototype/usePrototypePage';

const meta = {
  id: 'mycalendar-callback',
  title: 'Chọn lịch Google Calendar — ATI',
  htmlClass: '',
  bodyClass: 'min-h-screen bg-[#F8F8F6] text-[#111827] antialiased',
  css: '',
};

interface CalendarOption {
  id: string;
  summary: string;
  timeZone?: string;
  primary?: boolean;
  accessRole?: 'owner' | 'writer';
}

export function MyCalendarCallbackView({
  navigate,
  input,
}: {
  navigate: (path: string, replace?: boolean) => void;
  input?: MyCalendarCallbackInput;
}) {
  usePrototypePage(meta);

  // Strip query parameters before paint so OAuth code/state never linger in the URL bar
  useLayoutEffect(() => {
    window.history.replaceState(window.history.state, '', '/connections/mycalendar/callback');
  }, []);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [email, setEmail] = useState('');
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const callback = useRef(input);
  const owns = useRef(mycalendarSessionOwner());
  const invalidated = useRef(false);
  const mounted = useRef(true);
  const executionStarted = useRef(false);
  const returnToRef = useRef<string | null>(conversationReturnPath(input?.returnTo));

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeAuthTokens((tokens) => {
      if (!tokens.accessToken || !owns.current()) invalidated.current = true;
    });
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (
        event.key === null ||
        (['wap_access_token', 'wap_refresh_token', 'wap_user'].includes(event.key) &&
          (!owns.current() || event.newValue === null))
      ) {
        invalidated.current = true;
      }
    };
    window.addEventListener('storage', onStorage);
    const cleanup = () => {
      mounted.current = false;
      unsubscribe();
      window.removeEventListener('storage', onStorage);
    };

    const live = () => mounted.current && !invalidated.current && owns.current();
    const data = callback.current;

    if (executionStarted.current) return cleanup;
    executionStarted.current = true;

    if (data?.mode === 'select') {
      // Re-selection mode without running OAuth again
      apiClient
        .listMyCalendarCalendars()
        .then((result) => {
          if (!live()) return;
          setEmail(result.email);
          setCalendars(result.calendars);
          if (Array.isArray(result.selectedCalendarIds) && result.selectedCalendarIds.length > 0) {
            setSelectedIds(result.selectedCalendarIds);
          } else {
            const primaryCal = result.calendars.find((c) => c.primary) ?? result.calendars[0];
            setSelectedIds(primaryCal ? [primaryCal.id] : []);
          }
          setLoading(false);
        })
        .catch((reason) => {
          if (!live()) return;
          setError(mycalendarCallbackError(reason?.data?.code ?? reason?.code));
          setLoading(false);
        });
    } else {
      // OAuth redirect callback mode
      if (data?.error) {
        setError('Bạn đã huỷ kết nối Google Calendar.');
        setLoading(false);
      } else if (!data?.code || !data?.state) {
        setError(mycalendarCallbackError('MYCALENDAR_STATE_INVALID'));
        setLoading(false);
      } else if (live()) {
        apiClient
          .completeMyCalendarConnection(data.code, data.state)
          .then((result) => {
            if (!live()) return;
            setEmail(result.email);
            setCalendars(result.calendars);
            if (result.returnTo) {
              returnToRef.current = conversationReturnPath(result.returnTo);
            }
            if (Array.isArray(result.selectedCalendars) && result.selectedCalendars.length > 0) {
              setSelectedIds(result.selectedCalendars.map((c) => c.id));
            } else {
              const primaryCal = result.calendars.find((c) => c.primary) ?? result.calendars[0];
              setSelectedIds(primaryCal ? [primaryCal.id] : []);
            }
            setLoading(false);
          })
          .catch((reason) => {
            if (!live()) return;
            setError(mycalendarCallbackError(reason?.data?.code ?? reason?.code));
            setLoading(false);
          });
      }
    }

    return cleanup;
  }, []);

  const toggleCalendar = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSave = async () => {
    if (!mounted.current || invalidated.current || !owns.current() || selectedIds.length === 0 || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      await apiClient.saveMyCalendarScope(selectedIds);
      if (!mounted.current || invalidated.current || !owns.current()) return;
      mycalendarConnectionNotice.set(email);
      const target = returnToRef.current ?? '/settings#mycalendar';
      navigate(target, true);
    } catch (err: any) {
      if (mounted.current && !invalidated.current && owns.current()) {
        setSaveError(
          err?.data?.error ||
            err?.message ||
            'Không thể lưu danh sách lịch đã chọn. Vui lòng thử lại.'
        );
        setSaving(false);
      }
    }
  };

  const handleQuickSelectPrimary = async () => {
    if (!mounted.current || invalidated.current || !owns.current() || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      const res = await apiClient.selectPrimaryMyCalendar();
      if (!mounted.current || invalidated.current || !owns.current()) return;
      mycalendarConnectionNotice.set(res.email || email);
      const target = returnToRef.current ?? '/settings#mycalendar';
      navigate(target, true);
    } catch (err: any) {
      if (mounted.current && !invalidated.current && owns.current()) {
        setSaveError(
          err?.data?.error ||
            err?.message ||
            'Không thể chọn nhanh Lịch chính. Vui lòng thử lại.'
        );
        setSaving(false);
      }
    }
  };

  const handleLater = () => {
    navigate('/settings#mycalendar', true);
  };

  const hasValidReturn = Boolean(returnToRef.current);

  return (
    <main className="max-w-xl mx-auto px-4 py-16 text-[#111827] v3-space-y-6">
      <div className="v3-space-y-2">
        <h1 className="font-display text-2xl sm:text-3xl font-semibold">
          Chọn lịch Google Calendar cho phép ATI sử dụng
        </h1>
        {email && (
          <p className="text-sm text-[#4B5563]">
            Đã xác thực tài khoản <strong>{email}</strong>
          </p>
        )}
      </div>

      {loading && <p role="status">Đang tải danh sách lịch từ Google…</p>}

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-[#DC2626] v3-space-y-3">
          <p role="alert">{error}</p>
          <a
            href="/settings#mycalendar"
            onClick={(event) => {
              event.preventDefault();
              navigate('/settings#mycalendar', true);
            }}
            className="inline-block text-[#FF5701] underline font-medium"
          >
            Về trang Cài đặt
          </a>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="p-3.5 sm:p-4 rounded-xl bg-blue-50 border border-blue-200 text-xs sm:text-sm text-blue-900 leading-relaxed">
            ATI chỉ có thể đọc sự kiện và tạo sự kiện mới trên những lịch bạn chọn dưới đây. ATI
            không thể sửa hay xoá sự kiện có sẵn và không gửi lời mời cho người khác.
          </div>

          <div className="v3-space-y-2.5" role="group" aria-label="Danh sách lịch ghi được">
            {calendars.map((cal) => {
              const isChecked = selectedIds.includes(cal.id);
              return (
                <label
                  key={cal.id}
                  className={`flex items-start justify-between p-3.5 sm:p-4 bg-white border rounded-xl transition-all cursor-pointer shadow-sm gap-3 ${
                    isChecked
                      ? 'border-[#FF5701] ring-1 ring-[#FF5701]'
                      : 'border-[#E7E7E2] hover:border-neutral-300'
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleCalendar(cal.id)}
                      className="w-4 h-4 mt-0.5 text-[#FF5701] rounded border-[#E7E7E2] focus:ring-[#FF5701]"
                      aria-label={cal.summary}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-[#111827] break-words">
                          {cal.summary}
                        </span>
                        {cal.primary && (
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-100">
                            Lịch chính
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-neutral-100 text-neutral-600">
                          {cal.accessRole === 'owner' ? 'Chủ sở hữu' : 'Có quyền ghi'}
                        </span>
                      </div>
                      {cal.id !== cal.summary && (
                        <p className="text-xs text-[#6B7280] font-mono mt-0.5 break-all">
                          {cal.id}
                        </p>
                      )}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          {selectedIds.length === 0 && (
            <p role="alert" className="text-xs font-medium text-[#DC2626]">
              Vui lòng chọn ít nhất 1 lịch để tiếp tục.
            </p>
          )}

          {saveError && (
            <p role="alert" className="text-xs font-medium text-[#DC2626]">
              {saveError}
            </p>
          )}

          <div className="pt-2 flex flex-col sm:flex-row items-center gap-3 flex-wrap">
            {calendars.length > 0 && (
              <button
                id="mycalendar-quick-primary"
                type="button"
                disabled={saving}
                onClick={() => void handleQuickSelectPrimary()}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                Dùng ngay Lịch chính (1 chạm)
              </button>
            )}
            <button
              type="button"
              disabled={selectedIds.length === 0 || saving}
              onClick={handleSave}
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-[#FF5701] text-white hover:bg-[#E04C00] disabled:opacity-50 transition-colors shadow-sm"
            >
              {saving
                ? 'Đang lưu…'
                : hasValidReturn
                ? 'Lưu lịch được dùng & quay lại hội thoại'
                : 'Lưu lịch được dùng'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleLater}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium bg-white text-[#4B5563] border border-[#E7E7E2] hover:bg-neutral-50 transition-colors"
            >
              Để sau (về trang Cài đặt)
            </button>
          </div>
        </>
      )}
    </main>
  );
}
