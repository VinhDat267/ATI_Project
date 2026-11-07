import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ServiceInfo } from '../../types';
import { apiClient } from '../../services/api-client';
import { gmailSessionOwner, redirectToGmail } from '../../services/gmail-connection';
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
  const badgeTone =
    status === 'connected' ? 'connected' : status === 'reconnect_required' ? 'warning' : 'neutral';
  const statusDotClass =
    status === 'connected'
      ? 'bg-[#16A34A]'
      : status === 'reconnect_required'
        ? 'bg-amber-500'
        : 'bg-[#9CA3AF]';

  const rowContent = (
    <div ref={row} id="service-row-gmail" tabIndex={-1} className={`${CARD_CONTAINER_CLASS} flex flex-col justify-between gap-3.5 focus-visible:ring-2 focus-visible:ring-[#FF5701] focus-visible:v3-outline-none`}>
      <div id="gmail" className="hidden" />
      <div className="v3-space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-sans font-semibold text-base text-[#111827] dark:text-white flex items-center gap-2.5">
              <ServiceLogo service="gmail" className="w-5 h-5" />
              <span>Gmail</span>
            </h3>
            {service.email && (
              <p className="text-xs font-medium text-[#4B5563] dark:text-[#9CA3AF] break-words mt-0.5 pl-7">{service.email}</p>
            )}
          </div>
          <span className={connectionBadgeClass(badgeTone)}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusDotClass}`} />
            <span>{status === 'connected' ? 'Đã kết nối' : status === 'reconnect_required' ? 'Cần kết nối lại' : 'Chưa kết nối'}</span>
          </span>
        </div>
        <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF] leading-relaxed">Chỉ bạn dùng được hộp thư này. Planora được đọc, soạn, gửi, gắn nhãn và chuyển thư vào thùng rác; không xoá vĩnh viễn.</p>
        <div data-testid="gmail-capabilities" className="flex flex-wrap gap-1.5">
          {GMAIL_CAPABILITIES.map(cap => (
            <span key={cap} className={CAPABILITY_PILL_CLASS}>
              <span>{cap}</span>
            </span>
          ))}
        </div>
        {status === 'connected' && service.email && (
          <div className="flex flex-wrap items-center gap-1.5 p-2.5 rounded-xl bg-[#F8F8F6] dark:bg-[#161616] border border-[#E7E7E2] dark:border-[#2E2E2E]">
            <span className="text-xs font-medium text-[#4B5563] dark:text-[#9CA3AF]">Hộp thư được dùng:</span>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800/60">
              <span>{service.email}</span>
            </span>
          </div>
        )}
        {status === 'reconnect_required' && <p className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">Quyền có thể đã bị thu hồi hoặc hết hạn sau 7 ngày ở chế độ thử nghiệm của Google. Hãy kết nối lại.</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-[#F3F4F6] dark:border-[#2E2E2E]">
        <button id="gmail-action" type="button" className={status === 'connected' ? `${DANGER_GHOST_BTN} ml-auto` : button} disabled={busy} onClick={() => status === 'connected' ? setConfirm(true) : void act(false)}>{status === 'connected' ? 'Ngắt kết nối' : status === 'reconnect_required' ? 'Kết nối lại' : 'Kết nối Gmail'}</button>
        {busy && <p role="status" className="text-xs text-[#6B7280] dark:text-[#9CA3AF]">{status === 'connected' ? 'Đang ngắt kết nối…' : 'Đang chuyển hướng tới Google…'}</p>}
        {error && <p role="alert" className="text-xs text-[#DC2626] w-full">{error}</p>}
      </div>
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
