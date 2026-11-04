import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ServiceInfo } from '../../types';
import { apiClient } from '../../services/api-client';
import { gmailSessionOwner, redirectToGmail } from '../../services/gmail-connection';
import { CockpitDialog } from '../../components/CockpitDialog';
import { ServiceLogo } from '../../components/ServiceLogo';

const button = 'px-4 py-2 rounded-xl text-xs font-semibold bg-[#FF5701] text-white hover:bg-[#E04C00] disabled:opacity-50 transition-colors shadow-sm';
const secondary = 'px-4 py-2 rounded-xl text-xs font-medium bg-white text-[#111827] border border-[#E7E7E2] hover:bg-neutral-50 disabled:opacity-50 transition-colors';
const GMAIL_CAPABILITIES = [
  'Đọc & tóm tắt thư',
  'Soạn nháp & gửi thư',
  'Gắn nhãn hàng loạt',
  'Bản tin tự động Telegram',
];

export function PersonalGmail({ service, refresh, selected, standalone = true }: { service: ServiceInfo; refresh: () => Promise<void>; selected: string | null; standalone?: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirm, setConfirm] = useState(false);
  const mounted = useRef(false), pending = useRef(false);
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const focus = () => { if (window.location.hash === '#gmail') { row.current?.scrollIntoView?.({ block: 'center' }); row.current?.focus(); } };
    focus(); window.addEventListener('hashchange', focus); window.addEventListener('popstate', focus);
    return () => { window.removeEventListener('hashchange', focus); window.removeEventListener('popstate', focus); };
  // Run after a shared drawer's layout cleanup has restored its old opener.
  }, [selected]);
  const act = async (disconnect: boolean) => {
    if (pending.current) return;
    const owns = gmailSessionOwner(); pending.current = true; setBusy(true); setError('');
    try {
      if (disconnect) {
        await apiClient.disconnectGmail();
        if (mounted.current && owns()) { setConfirm(false); await refresh(); }
      } else {
        const result = await apiClient.startGmailConnection();
        if (mounted.current && owns()) redirectToGmail(result.url);
      }
    } catch { if (mounted.current && owns()) setError('Không thể cập nhật kết nối Gmail. Hãy kiểm tra mạng và thử lại.'); }
    // The pending gate prevents a newer action from starting. Clear its spinner
    // even when the old session lost ownership; results/redirects stay guarded.
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const status = service.personalStatus ?? 'not_connected';
  const statusBadgeClass =
    status === 'connected'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : status === 'reconnect_required'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-neutral-100 text-[#6B7280] border-[#E7E7E2]';
  const statusDotClass =
    status === 'connected'
      ? 'bg-[#16A34A]'
      : status === 'reconnect_required'
        ? 'bg-amber-500'
        : 'bg-[#9CA3AF]';

  const rowContent = (
    <div ref={row} id="service-row-gmail" tabIndex={-1} className="bg-white border border-[#E7E7E2] rounded-xl p-4 sm:p-5 v3-space-y-3 focus-visible:ring-2 focus-visible:ring-[#FF5701] focus-visible:v3-outline-none">
      <div id="gmail" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display font-semibold text-base text-[#111827] flex items-center gap-3"><ServiceLogo service="gmail" className="w-6 h-6" />Gmail</h3>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${statusBadgeClass}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${statusDotClass}`} />
          <span>{status === 'connected' ? 'Đã kết nối' : status === 'reconnect_required' ? 'Cần kết nối lại' : 'Chưa kết nối'}</span>
        </span>
      </div>
      <p className="text-xs text-[#6B7280]">Chỉ bạn dùng được hộp thư này. Planora được đọc, soạn, gửi, gắn nhãn và chuyển thư vào thùng rác; không xoá vĩnh viễn.</p>
      <p className="text-sm text-[#111827] break-words">{status === 'connected' ? 'Đã kết nối' : status === 'reconnect_required' ? 'Cần kết nối lại' : 'Chưa kết nối'}{service.email && <> · {service.email}</>}</p>
      {status === 'connected' && (
        <div data-testid="gmail-capabilities" className="flex flex-wrap gap-1.5 pt-0.5">
          {GMAIL_CAPABILITIES.map(cap => (
            <span key={cap} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-[#F8F8F6] border border-[#E7E7E2] text-[#111827]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
              <span>{cap}</span>
            </span>
          ))}
        </div>
      )}
      {service.connectedAt && <p className="text-xs text-[#6B7280]">Kết nối lúc {new Date(service.connectedAt).toLocaleString('vi-VN')}</p>}
      {status === 'reconnect_required' && <p className="text-xs text-[#6B7280]">Quyền có thể đã bị thu hồi hoặc hết hạn sau 7 ngày ở chế độ thử nghiệm của Google. Hãy kết nối lại.</p>}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button id="gmail-action" type="button" className={button} disabled={busy} onClick={() => status === 'connected' ? setConfirm(true) : void act(false)}>{status === 'connected' ? 'Ngắt kết nối' : status === 'reconnect_required' ? 'Kết nối lại' : 'Kết nối Gmail'}</button>
      </div>
      {busy && <p role="status" className="text-xs text-[#6B7280]">{status === 'connected' ? 'Đang ngắt kết nối…' : 'Đang chuyển hướng tới Google…'}</p>}
      {error && <p role="alert" className="text-xs text-[#DC2626]">{error}</p>}
    </div>
  );
  return <>
    {standalone ? (
      <section aria-labelledby="heading-personal-services" className="mb-8">
        <h2 id="heading-personal-services" className="text-xs font-bold uppercase tracking-wider text-[#6B7280] mb-3.5">Của riêng bạn</h2>
        {rowContent}
      </section>
    ) : rowContent}
    {confirm && createPortal(<CockpitDialog title="Ngắt kết nối Gmail?" returnFocusId="gmail-action" onClose={() => { if (!busy) setConfirm(false); }}>
      <div className="p-5 v3-space-y-4"><p className="text-sm">Planora sẽ xoá token và thu hồi quyền truy cập. Hội thoại cũ vẫn còn; kế hoạch cũ không thể dùng kết nối đã ngắt.</p><button className={secondary} disabled={busy} onClick={() => setConfirm(false)}>Giữ kết nối</button>{' '}<button className={button} disabled={busy} onClick={() => void act(true)}>Xác nhận ngắt kết nối</button>{error && <p role="alert">{error}</p>}</div>
    </CockpitDialog>, document.body)}
  </>;
}
