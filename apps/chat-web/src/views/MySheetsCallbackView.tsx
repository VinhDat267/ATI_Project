import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MySheetsCallbackInput } from '../routes';
import type { MySheetsPickerSession, PersonalSpreadsheetItem } from '../types';
import { apiClient } from '../services/api-client';
import { subscribeAuthTokens } from '../services/auth-storage';
import {
  mysheetsSessionOwner,
  mysheetsCallbackError,
  mysheetsConnectionNotice,
  conversationReturnPath,
} from '../services/gmail-connection';
import { openGooglePicker } from '../services/google-picker';
import { FakeSheetsPicker } from '../components/FakeSheetsPicker';
import { usePrototypePage } from '../prototype/usePrototypePage';

const meta = {
  id: 'mysheets-callback',
  title: 'Chọn bảng tính Google Sheets — ATI',
  htmlClass: '',
  bodyClass: 'min-h-screen bg-[#F8F8F6] text-[#111827] antialiased',
  css: '',
};

export function MySheetsCallbackView({
  navigate,
  input,
}: {
  navigate: (path: string, replace?: boolean) => void;
  input?: MySheetsCallbackInput;
}) {
  usePrototypePage(meta);

  // Strip query parameters before paint so OAuth code/state never linger in the URL bar
  useLayoutEffect(() => {
    window.history.replaceState(window.history.state, '', '/connections/mysheets/callback');
  }, []);

  const [loading, setLoading] = useState(true);
  const [openingPicker, setOpeningPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [email, setEmail] = useState('');
  const [spreadsheets, setSpreadsheets] = useState<PersonalSpreadsheetItem[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [fakePickerSession, setFakePickerSession] = useState<{
    accessToken: string;
    fakePickerBaseUrl: string;
  } | null>(null);

  const callback = useRef(input);
  const owns = useRef(mysheetsSessionOwner());
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
        .getMySheetsSpreadsheets()
        .then((result) => {
          if (!live()) return;
          setEmail(result.email);
          setSpreadsheets(result.selectedSpreadsheets ?? []);
          setLoading(false);
        })
        .catch((reason) => {
          if (!live()) return;
          setError(mysheetsCallbackError(reason?.data?.code ?? reason?.code));
          setLoading(false);
        });
    } else {
      // OAuth redirect callback mode
      if (data?.error) {
        setError('Bạn đã huỷ kết nối Google Sheets.');
        setLoading(false);
      } else if (!data?.code || !data?.state) {
        setError(mysheetsCallbackError('MYSHEETS_STATE_INVALID'));
        setLoading(false);
      } else if (live()) {
        apiClient
          .completeMySheetsConnection({ code: data.code, state: data.state })
          .then((result) => {
            if (!live()) return;
            setEmail(result.email);
            if (result.returnTo) {
              returnToRef.current = conversationReturnPath(result.returnTo);
            }
            setSpreadsheets([]);
            setLoading(false);
          })
          .catch((reason) => {
            if (!live()) return;
            setError(mysheetsCallbackError(reason?.data?.code ?? reason?.code));
            setLoading(false);
          });
      }
    }

    return cleanup;
  }, []);

  const handleOpenPicker = async () => {
    if (openingPicker || saving || !mounted.current || invalidated.current || !owns.current()) return;
    setOpeningPicker(true);
    setSaveError('');
    try {
      const session: MySheetsPickerSession = await apiClient.createMySheetsPickerSession();
      if (!mounted.current || invalidated.current || !owns.current()) return;

      if (session.mode === 'fake') {
        setFakePickerSession({
          accessToken: session.accessToken,
          fakePickerBaseUrl: session.fakePickerBaseUrl,
        });
        setOpeningPicker(false);
        return;
      }

      if (session.mode === 'google') {
        const remainingCapacity = Math.max(1, 10 - spreadsheets.length);
        const pickedIds = await openGooglePicker(
          {
            accessToken: session.accessToken,
            developerKey: session.developerKey,
            appId: session.appId,
          },
          remainingCapacity
        );

        if (!mounted.current || invalidated.current || !owns.current()) return;
        if (pickedIds && pickedIds.length > 0) {
          await handleSavePickedIds(pickedIds);
        }
      }
    } catch (err: any) {
      if (mounted.current && !invalidated.current && owns.current()) {
        setSaveError(
          err?.data?.error ||
            err?.message ||
            'Không mở được cửa sổ chọn file của Google. Kiểm tra kết nối mạng hoặc trình chặn quảng cáo, rồi thử lại.'
        );
      }
    } finally {
      if (mounted.current) setOpeningPicker(false);
    }
  };

  const handleSavePickedIds = async (newIds: string[]) => {
    const existingIds = spreadsheets.map((s) => s.id);
    const combinedIds = Array.from(new Set([...existingIds, ...newIds]));
    if (combinedIds.length === 0) return;

    setSaving(true);
    setSaveError('');
    try {
      const result = await apiClient.saveMySheetsScope({ spreadsheetIds: combinedIds });
      if (!mounted.current || invalidated.current || !owns.current()) return;
      setSpreadsheets(result.selectedSpreadsheets ?? []);
    } catch (err: any) {
      if (mounted.current && !invalidated.current && owns.current()) {
        setSaveError(
          err?.data?.error ||
            err?.message ||
            'Không thể lưu danh sách bảng tính đã chọn. Vui lòng thử lại.'
        );
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const handleAddFromUrl = async () => {
    const raw = urlInput.trim();
    if (!raw || saving || spreadsheets.length >= 10) return;
    await handleSavePickedIds([raw]);
    if (mounted.current) setUrlInput('');
  };

  const handleRemoveSpreadsheet = async (id: string) => {
    if (spreadsheets.length <= 1) {
      setSaveError('Cần giữ lại ít nhất 1 bảng tính. Để huỷ toàn bộ quyền truy cập, hãy ngắt kết nối tại Cài đặt.');
      return;
    }
    const remaining = spreadsheets.filter((s) => s.id !== id);
    if (remaining.length === 0) return;

    setSaving(true);
    setSaveError('');
    try {
      const result = await apiClient.saveMySheetsScope({
        spreadsheetIds: remaining.map((s) => s.id),
      });
      if (!mounted.current || invalidated.current || !owns.current()) return;
      setSpreadsheets(result.selectedSpreadsheets ?? []);
    } catch (err: any) {
      if (mounted.current && !invalidated.current && owns.current()) {
        setSaveError(
          err?.data?.error ||
            err?.message ||
            'Không thể cập nhật danh sách bảng tính. Vui lòng thử lại.'
        );
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const handleDone = () => {
    if (spreadsheets.length === 0) return;
    if (email) mysheetsConnectionNotice.set(email);
    const target = returnToRef.current ?? '/settings?mysheets=connected#mysheets';
    navigate(target, true);
  };

  const handleLater = () => {
    navigate('/settings#mysheets', true);
  };

  const hasValidReturn = Boolean(returnToRef.current);

  return (
    <main className="max-w-xl mx-auto px-4 py-16 text-[#111827] v3-space-y-6">
      <div className="v3-space-y-2">
        <h1 className="font-display text-2xl sm:text-3xl font-semibold">
          Chọn bảng tính cho ATI
        </h1>
        {email && (
          <p className="text-sm text-[#4B5563]">
            Đã xác thực tài khoản <strong>{email}</strong>
          </p>
        )}
      </div>

      {loading && <p role="status">Đang tải thông tin kết nối từ Google…</p>}

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-[#DC2626] v3-space-y-3">
          <p role="alert">{error}</p>
          <a
            href="/settings#mysheets"
            onClick={(event) => {
              event.preventDefault();
              navigate('/settings#mysheets', true);
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
            ATI chỉ thấy những bảng tính bạn chọn trong cửa sổ của Google. ATI đọc các ô và thêm
            dòng mới, không sửa hay xoá ô có sẵn, không tạo bảng tính mới.
          </div>

          <div className="v3-space-y-3">
            <button
              type="button"
              disabled={openingPicker || saving || spreadsheets.length >= 10}
              onClick={handleOpenPicker}
              className="px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-white text-[#111827] border border-[#E7E7E2] hover:bg-neutral-50 disabled:opacity-50 transition-colors shadow-sm inline-flex items-center gap-2"
            >
              <svg className="w-4 h-4 text-[#188038]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" />
              </svg>
              <span>
                {spreadsheets.length === 0
                  ? 'Chọn bảng tính trong Google Drive'
                  : 'Thêm bảng tính'}
              </span>
            </button>

            {email && (
              <p className="text-xs text-[#6B7280]">
                Trình duyệt cần đang đăng nhập đúng tài khoản <strong>{email}</strong>.
              </p>
            )}

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
              <input
                type="text"
                aria-label="Dán liên kết hoặc ID Google Sheets"
                placeholder="Dán liên kết hoặc ID Google Sheets..."
                value={urlInput}
                disabled={saving || spreadsheets.length >= 10}
                onChange={(e) => setUrlInput(e.target.value)}
                className="flex-1 px-3 py-2 rounded-xl text-xs sm:text-sm bg-white border border-[#E7E7E2] text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#FF5701]"
              />
              <button
                type="button"
                disabled={!urlInput.trim() || saving || spreadsheets.length >= 10}
                onClick={() => void handleAddFromUrl()}
                className="px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium bg-white text-[#111827] border border-[#E7E7E2] hover:bg-neutral-50 disabled:opacity-50 transition-colors"
              >
                Thêm từ liên kết
              </button>
            </div>
          </div>

          {spreadsheets.length > 0 && (
            <div
              className="v3-space-y-2.5 pt-2"
              role="group"
              aria-label="Danh sách bảng tính đã chọn"
            >
              <h2 className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider">
                Bảng tính đã chọn ({spreadsheets.length}/10):
              </h2>
              {spreadsheets.map((sheet) => (
                <div
                  key={sheet.id}
                  className="flex items-center justify-between p-3.5 sm:p-4 bg-white border border-[#E7E7E2] rounded-xl shadow-sm gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-[#111827] break-words">
                        {sheet.title}
                      </span>
                      {!sheet.canEdit && (
                        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          Chỉ xem
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#6B7280] font-mono mt-0.5 break-all">
                      {sheet.id}
                    </p>
                    {sheet.sheets && sheet.sheets.length > 0 && (
                      <p className="text-xs text-[#4B5563] mt-1">
                        Tabs: {sheet.sheets.join(', ')}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={saving || spreadsheets.length <= 1}
                    onClick={() => handleRemoveSpreadsheet(sheet.id)}
                    aria-label={`Bỏ bảng tính ${sheet.title}`}
                    title={spreadsheets.length <= 1 ? 'Không thể bỏ bảng tính cuối cùng. Cần giữ lại ít nhất 1 bảng tính.' : `Bỏ ${sheet.title}`}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    Bỏ
                  </button>
                </div>
              ))}
              {spreadsheets.length === 1 && (
                <p className="text-xs text-[#6B7280] pt-1">
                  Cần giữ lại ít nhất 1 bảng tính. Để huỷ toàn bộ quyền truy cập, hãy{' '}
                  <a
                    href="/settings#mysheets"
                    onClick={(e) => {
                      e.preventDefault();
                      navigate('/settings#mysheets', true);
                    }}
                    className="text-[#FF5701] underline font-medium"
                  >
                    ngắt kết nối tại Cài đặt
                  </a>.
                </p>
              )}
            </div>
          )}

          {spreadsheets.length === 0 && (
            <p role="alert" className="text-xs font-medium text-[#DC2626]">
              Hãy chọn ít nhất 1 bảng tính để tiếp tục.
            </p>
          )}

          {saveError && (
            <p role="alert" className="text-xs font-medium text-[#DC2626]">
              {saveError}
            </p>
          )}

          <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
            <button
              type="button"
              disabled={spreadsheets.length === 0 || saving}
              onClick={handleDone}
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-[#FF5701] text-white hover:bg-[#E04C00] disabled:opacity-50 transition-colors shadow-sm"
            >
              {saving
                ? 'Đang lưu…'
                : hasValidReturn
                ? 'Xong, quay lại hội thoại'
                : 'Xong'}
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

      {fakePickerSession && (
        <FakeSheetsPicker
          accessToken={fakePickerSession.accessToken}
          fakePickerBaseUrl={fakePickerSession.fakePickerBaseUrl}
          maxItems={10}
          initialSelectedIds={spreadsheets.map((s) => s.id)}
          onSelect={async (pickedIds) => {
            setFakePickerSession(null);
            await handleSavePickedIds(pickedIds);
          }}
          onCancel={() => setFakePickerSession(null)}
        />
      )}
    </main>
  );
}
