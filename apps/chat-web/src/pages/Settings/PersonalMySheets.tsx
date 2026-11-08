import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ServiceInfo } from '../../types';
import { apiClient } from '../../services/api-client';
import { mysheetsSessionOwner, redirectToMySheets } from '../../services/gmail-connection';
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

export function PersonalMySheets({
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
  const [urlInput, setUrlInput] = useState('');

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
      if (window.location.hash === '#mysheets') {
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
    const owns = mysheetsSessionOwner();
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await apiClient.startMySheetsConnection();
      if (mounted.current && owns()) redirectToMySheets(result.url);
    } catch {
      if (mounted.current && owns())
        setError('Không thể cập nhật kết nối Google Sheets. Hãy kiểm tra mạng và thử lại.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const disconnect = async () => {
    if (pending.current) return;
    const owns = mysheetsSessionOwner();
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await apiClient.disconnectMySheets();
      if (mounted.current && owns()) {
        setConfirm(false);
        await refresh();
      }
    } catch {
      if (mounted.current && owns())
        setError('Không thể ngắt kết nối Google Sheets. Hãy kiểm tra mạng và thử lại.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const openSheetsPicker = () => {
    if (navigate) {
      navigate('/connections/mysheets/callback?mode=select', true);
    } else {
      window.location.assign('/connections/mysheets/callback?mode=select');
    }
  };

  const quickCreateSpreadsheet = async () => {
    if (pending.current || busy) return;
    const owns = mysheetsSessionOwner();
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await apiClient.quickCreateMySheetsSpreadsheet();
      if (mounted.current && owns()) {
        await refresh();
      }
    } catch (err: any) {
      if (mounted.current && owns()) {
        setError(
          err?.data?.error ||
            err?.message ||
            'Không thể tạo nhanh bảng tính mặc định. Vui lòng thử lại.'
        );
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const addByUrl = async () => {
    const trimmed = urlInput.trim();
    if (!trimmed || pending.current) return;
    const owns = mysheetsSessionOwner();
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const existingIds = (service.selectedSpreadsheets ?? []).map((s) => s.id);
      const nextIds = Array.from(new Set([...existingIds, trimmed]));
      await apiClient.saveMySheetsScope({ spreadsheetIds: nextIds });
      if (mounted.current && owns()) {
        setUrlInput('');
        await refresh();
      }
    } catch {
      if (mounted.current && owns()) {
        setError('Không thể thêm bảng tính từ liên kết. Hãy kiểm tra quyền truy cập và thử lại.');
      }
    } finally {
      pending.current = false;
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
      id="service-row-mysheets"
      tabIndex={-1}
      className={`${CARD_CONTAINER_CLASS} flex flex-col justify-between gap-3.5 focus-visible:ring-2 focus-visible:ring-[#FF5701] focus-visible:v3-outline-none`}
    >
      <div id="mysheets" className="hidden" />
      <div className="v3-space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-sans font-semibold text-base text-[#111827] dark:text-white flex items-center gap-2.5">
              <ServiceLogo service="mysheets" className="w-5 h-5" />
              <span>Google Sheets của bạn</span>
            </h3>
            {(status === 'scope_required' || service.email) && (
              <p className="text-xs font-medium text-[#4B5563] dark:text-[#9CA3AF] break-words mt-0.5 pl-7">
                {status === 'scope_required' && <span>Đã cấp quyền · Chưa chọn bảng tính</span>}
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
                  ? 'Chưa chọn bảng tính'
                  : status === 'reconnect_required'
                    ? 'Cần kết nối lại'
                    : 'Chưa kết nối'}
            </span>
          </span>
        </div>
        <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] leading-relaxed">
          Planora chỉ thấy những bảng tính bạn chọn trong cửa sổ của Google. Planora chỉ đọc, thêm dòng,
          cập nhật cột, xoá dòng hoặc tạo trang tính (tab) sau khi bạn phê duyệt kế hoạch, và không truy cập tệp Drive nào khác.
        </p>
        <div data-testid="mysheets-ecosystem-badges" className="flex flex-wrap items-center gap-1.5">
          <span className={CAPABILITY_PILL_CLASS}>
            Google Sheets
          </span>
          <span className={CAPABILITY_PILL_CLASS}>
            Google Docs (tài liệu Planora tạo)
          </span>
          <span className={CAPABILITY_PILL_CLASS}>
            Google Drive (thư mục Planora tạo)
          </span>
        </div>

        {status === 'connected' &&
          service.selectedSpreadsheets &&
          service.selectedSpreadsheets.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 p-2.5 rounded-xl bg-[#F8F8F6] dark:bg-[#161616] border border-[#E7E7E2] dark:border-[#2E2E2E]">
              <span className="text-xs font-medium text-[#4B5563] dark:text-[#9CA3AF]">Bảng tính được dùng:</span>
              {service.selectedSpreadsheets.map((sheet) => (
                <span
                  key={sheet.id}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800/60"
                >
                  <span>{sheet.title}</span>
                  {sheet.sheets && sheet.sheets.length > 0 && (
                    <span className="text-xs text-emerald-700 dark:text-emerald-300">({sheet.sheets.join(', ')})</span>
                  )}
                  {!sheet.canEdit && (
                    <span className="text-xs text-amber-600 dark:text-amber-300 font-semibold">(chỉ xem)</span>
                  )}
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheet.id)}/edit`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Mở bảng tính ${sheet.title} trên Google Sheets`}
                    title={`Mở ${sheet.title} trên Google Sheets`}
                    className="ml-0.5 text-emerald-700 dark:text-emerald-300 hover:text-emerald-950 underline-offset-2 hover:underline"
                  >
                    ↗
                  </a>
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

        {(status === 'scope_required' || status === 'connected') && (
          <details
            open
            className="group"
          >
            <summary className="cursor-pointer list-none inline-flex items-center gap-1.5 text-xs font-medium text-[#6B7280] dark:text-[#9CA3AF] hover:text-[#111827] dark:hover:text-white select-none">
              <span className="transition-transform group-open:rotate-90 text-[10px]">▸</span>
              <span>Dán liên kết hoặc ID Google Sheets thủ công</span>
            </summary>
            <div className="pt-2 v3-space-y-1.5">
              <label htmlFor="mysheets-settings-url-input" className="sr-only">
                Dán liên kết hoặc ID Google Sheets
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="mysheets-settings-url-input"
                  type="text"
                  value={urlInput}
                  disabled={busy}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMd.../edit"
                  className="flex-1 px-3 py-1.5 rounded-lg border border-[#E7E7E2] dark:border-[#3A3A3A] bg-white dark:bg-[#262626] text-xs text-[#111827] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#FF5701]"
                />
                <button
                  type="button"
                  className={secondary}
                  disabled={busy || !urlInput.trim()}
                  onClick={() => void addByUrl()}
                >
                  Thêm từ liên kết
                </button>
              </div>
            </div>
          </details>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2.5 border-t border-[#F3F4F6] dark:border-[#2E2E2E]">
        {status === 'not_connected' && (
          <button
            id="mysheets-action"
            type="button"
            className={button}
            disabled={busy}
            onClick={() => void connect()}
          >
            Kết nối Google Sheets
          </button>
        )}

        {status === 'scope_required' && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button
                id="mysheets-settings-quick-create"
                data-testid="mysheets-settings-quick-create"
                type="button"
                className={button}
                disabled={busy}
                onClick={() => void quickCreateSpreadsheet()}
              >
                Tạo bảng tính mặc định mới
              </button>
              <button
                id="mysheets-action"
                type="button"
                className={secondary}
                disabled={busy}
                onClick={openSheetsPicker}
              >
                Chọn bảng tính
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
            <div className="flex flex-wrap items-center gap-2">
              <button
                id="mysheets-settings-quick-create"
                data-testid="mysheets-settings-quick-create"
                type="button"
                className={secondary}
                disabled={busy}
                onClick={() => void quickCreateSpreadsheet()}
              >
                Tạo bảng tính mặc định mới
              </button>
              <button
                id="mysheets-action"
                type="button"
                className={secondary}
                disabled={busy}
                onClick={openSheetsPicker}
              >
                Chọn lại bảng tính
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

        {status === 'reconnect_required' && (
          <>
            <button
              id="mysheets-action"
              type="button"
              className={button}
              disabled={busy}
              onClick={() => void connect()}
            >
              Kết nối lại Google Sheets
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
            title="Ngắt kết nối Google Sheets?"
            returnFocusId="mysheets-action"
            onClose={() => setConfirm(false)}
          >
            <div className="p-4 sm:p-5 v3-space-y-4 text-xs sm:text-sm text-[#4B5563]">
              <p>
                Planora sẽ không thể truy cập các bảng tính này nữa. Bạn có thể kết nối lại bất cứ lúc
                nào.
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
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors shadow-sm"
                  disabled={busy}
                  onClick={() => void disconnect()}
                >
                  {busy ? 'Đang ngắt…' : 'Ngắt kết nối'}
                </button>
              </div>
            </div>
          </CockpitDialog>,
          document.body
        )}
    </>
  );
}
