import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ServiceInfo } from '../../types';
import { apiClient } from '../../services/api-client';
import { mysheetsSessionOwner, redirectToMySheets } from '../../services/gmail-connection';
import { CockpitDialog } from '../../components/CockpitDialog';
import { ServiceLogo } from '../../components/ServiceLogo';

const button =
  'px-4 py-2.5 rounded-xl text-xs font-semibold bg-[var(--planora-primary)] text-[var(--planora-on-primary)] hover:bg-[var(--planora-primary-hover)] disabled:opacity-50 transition-all shadow-xs focus-visible:outline-2 focus-visible:outline-[var(--planora-primary)]';
const secondary =
  'px-4 py-2.5 rounded-xl text-xs font-medium bg-[var(--planora-paper)] text-[var(--planora-text)] border border-[var(--planora-border-strong)] hover:bg-[var(--planora-surface-inset)] disabled:opacity-50 transition-colors';

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

  const status = service.personalStatus ?? 'not_connected';

  const content = (
    <div
      ref={row}
      id="service-row-mysheets"
      tabIndex={-1}
      className="bg-[var(--planora-paper)] border border-[var(--planora-divider)] rounded-xl p-4 sm:p-5 v3-space-y-3.5 shadow-xs focus-visible:ring-2 focus-visible:ring-[var(--planora-primary)] focus-visible:v3-outline-none"
    >
      <div id="mysheets" />
      <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
        <h3 className="font-display font-semibold text-base text-[var(--planora-text)] flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] flex items-center justify-center flex-shrink-0">
            <ServiceLogo service="mysheets" className="w-5 h-5" />
          </div>
          <span>Google Sheets của bạn</span>
        </h3>
      </div>

      <p className="text-xs text-[var(--planora-muted)] leading-relaxed">
        Planora chỉ thấy những bảng tính bạn chọn trong cửa sổ của Google. Planora đọc các ô và thêm dòng
        mới, không sửa hay xoá ô có sẵn, không tạo bảng tính mới.
      </p>

      <p className="text-sm font-medium text-[var(--planora-text)] break-words">
        <span>
          {status === 'connected'
            ? 'Đã kết nối'
            : status === 'scope_required'
            ? 'Đã cấp quyền · Chưa chọn bảng tính'
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

      {status === 'connected' &&
        service.selectedSpreadsheets &&
        service.selectedSpreadsheets.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-xs text-[var(--planora-muted)]">Bảng tính được dùng:</span>
            {service.selectedSpreadsheets.map((sheet) => (
              <span
                key={sheet.id}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
              >
                <span>{sheet.title}</span>
                {!sheet.canEdit && (
                  <span className="text-[10px] text-amber-700 dark:text-amber-300 font-semibold">(chỉ xem)</span>
                )}
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
            <button
              id="mysheets-action"
              type="button"
              className={button}
              disabled={busy}
              onClick={openSheetsPicker}
            >
              Chọn bảng tính
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
              id="mysheets-action"
              type="button"
              className={secondary}
              disabled={busy}
              onClick={openSheetsPicker}
            >
              Chọn lại bảng tính
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
            title="Ngắt kết nối Google Sheets?"
            returnFocusId="mysheets-action"
            onClose={() => {
              if (!busy) setConfirm(false);
            }}
          >
            <div className="p-4 sm:p-5 v3-space-y-4 text-xs sm:text-sm text-[var(--planora-text)]">
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
                  className={button}
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
export default PersonalMySheets;
