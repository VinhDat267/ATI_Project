import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ServiceInfo } from '../../types';
import { apiClient } from '../../services/api-client';
import { gmailSessionOwner, redirectToGmail } from '../../services/gmail-connection';
import { CockpitDialog } from '../../components/CockpitDialog';
import { ServiceLogo } from '../../components/ServiceLogo';

const button =
  'px-4 py-2.5 rounded-xl text-xs font-semibold bg-[#FF5701] text-[var(--planora-on-primary,#FFFFFF)] hover:bg-[#E04C00] disabled:opacity-50 transition-all shadow-xs focus-visible:outline-2 focus-visible:outline-[var(--planora-primary)]';
const secondary =
  'px-4 py-2.5 rounded-xl text-xs font-medium bg-[var(--planora-paper)] text-[var(--planora-text)] border border-[var(--planora-border)] hover:bg-[var(--planora-surface-inset)] disabled:opacity-50 transition-colors';

export function PersonalGmail({
  service,
  refresh,
  selected,
  standalone = true,
}: {
  service: ServiceInfo;
  refresh: () => Promise<void>;
  selected: string | null;
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
      if (window.location.hash === '#gmail') {
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

  const act = async (disconnect: boolean) => {
    if (pending.current) return;
    const owns = gmailSessionOwner();
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (disconnect) {
        await apiClient.disconnectGmail();
        if (mounted.current && owns()) {
          setConfirm(false);
          await refresh();
        }
      } else {
        const result = await apiClient.startGmailConnection();
        if (mounted.current && owns()) redirectToGmail(result.url);
      }
    } catch {
      if (mounted.current && owns())
        setError('Không thể cập nhật kết nối Gmail. Hãy kiểm tra mạng và thử lại.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const status = service.personalStatus ?? 'not_connected';

  const rowContent = (
    <div
      ref={row}
      id="service-row-gmail"
      tabIndex={-1}
      className="bg-[var(--planora-paper)] border border-[var(--planora-border)] rounded-xl p-4 sm:p-5 v3-space-y-3.5 shadow-xs focus-visible:ring-2 focus-visible:ring-[var(--planora-primary)] focus-visible:v3-outline-none"
    >
      <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
        <h3 className="font-display font-semibold text-base text-[var(--planora-text)] flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] flex items-center justify-center flex-shrink-0">
            <ServiceLogo service="gmail" className="w-5 h-5" />
          </div>
          <span>Gmail</span>
        </h3>

        <div>
          {status === 'connected' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" aria-hidden="true" />
              <span>Đã kết nối</span>
            </span>
          )}
          {status === 'reconnect_required' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden="true" />
              <span>Cần kết nối lại</span>
            </span>
          )}
          {status === 'not_connected' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--planora-surface-inset)] text-[var(--planora-muted)] border border-[var(--planora-divider)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--planora-muted)]" aria-hidden="true" />
              <span>Chưa kết nối</span>
            </span>
          )}
        </div>
      </div>

      <p className="text-xs text-[var(--planora-muted)] leading-relaxed">
        Chỉ bạn dùng được hộp thư này. Planora được đọc, soạn, gửi, gắn nhãn và chuyển thư vào thùng rác; không xoá vĩnh viễn.
      </p>

      <p className="text-sm font-medium text-[var(--planora-text)] break-words">
        <span>{status === 'connected' ? 'Đã kết nối' : status === 'reconnect_required' ? 'Cần kết nối lại' : 'Chưa kết nối'}</span>
        {service.email && <span className="text-[var(--planora-muted)] font-normal"> · {service.email}</span>}
      </p>

      {service.connectedAt && (
        <p className="text-xs text-[var(--planora-muted)]">
          Kết nối lúc {new Date(service.connectedAt).toLocaleString('vi-VN')}
        </p>
      )}

      {status === 'reconnect_required' && (
        <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 p-2.5 rounded-lg border border-amber-200 dark:border-amber-800">
          Quyền có thể đã bị thu hồi hoặc hết hạn sau 7 ngày ở chế độ thử nghiệm của Google. Hãy kết nối lại.
        </p>
      )}

      <div className="pt-1">
        <button
          id="gmail-action"
          type="button"
          className={button}
          disabled={busy}
          onClick={() => (status === 'connected' ? setConfirm(true) : void act(false))}
        >
          {status === 'connected'
            ? 'Ngắt kết nối'
            : status === 'reconnect_required'
            ? 'Kết nối lại'
            : 'Kết nối Gmail'}
        </button>
      </div>

      {busy && (
        <p role="status" className="text-xs text-[var(--planora-muted)] flex items-center gap-2">
          <svg className="w-3.5 h-3.5 animate-spin text-[var(--planora-primary)]" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>{status === 'connected' ? 'Đang ngắt kết nối…' : 'Đang chuyển hướng tới Google…'}</span>
        </p>
      )}

      {error && <p role="alert" className="text-xs text-[var(--planora-error-text,#DC2626)] font-medium">{error}</p>}
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
          {rowContent}
        </section>
      ) : (
        rowContent
      )}

      {confirm &&
        createPortal(
          <CockpitDialog
            title="Ngắt kết nối Gmail?"
            returnFocusId="gmail-action"
            onClose={() => {
              if (!busy) setConfirm(false);
            }}
          >
            <div className="p-5 v3-space-y-4">
              <p className="text-sm text-[var(--planora-text)]">
                Planora sẽ xoá token và thu hồi quyền truy cập. Hội thoại cũ vẫn còn; kế hoạch cũ không thể dùng kết nối đã ngắt.
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
                  onClick={() => void act(true)}
                >
                  Xác nhận ngắt kết nối
                </button>
              </div>
              {error && <p role="alert" className="text-xs text-[var(--planora-error-text,#DC2626)]">{error}</p>}
            </div>
          </CockpitDialog>,
          document.body
        )}
    </>
  );
}
export default PersonalGmail;
