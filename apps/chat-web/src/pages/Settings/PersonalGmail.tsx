import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ServiceInfo } from '../../types';
import { apiClient } from '../../services/api-client';
import { gmailSessionOwner, redirectToGmail } from '../../services/gmail-connection';
import { CockpitDialog } from '../../components/CockpitDialog';
import { ServiceLogo } from '../../components/ServiceLogo';

const button = 'px-4 py-2 rounded-xl text-xs font-semibold bg-brand-primary text-white hover:bg-brand-primary-hover disabled:opacity-50';
export function PersonalGmail({ service, refresh, selected }: { service: ServiceInfo; refresh: () => Promise<void>; selected: string | null }) {
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
    finally { pending.current = false; if (mounted.current && owns()) setBusy(false); }
  };
  const status = service.personalStatus ?? 'not_connected';
  return <section aria-labelledby="heading-personal-services" className="mb-8">
    <h2 id="heading-personal-services" className="text-xs font-bold uppercase tracking-wider text-brand-muted mb-3.5">Của riêng bạn</h2>
    <div ref={row} id="service-row-gmail" tabIndex={-1} className="bg-white border border-brand-border rounded-xl p-4 sm:p-5 v3-space-y-3 focus-visible:ring-2 focus-visible:ring-brand-primary">
      <h3 className="font-display font-semibold text-base text-brand-text flex items-center gap-3"><ServiceLogo service="gmail" className="w-6 h-6" />Gmail</h3>
      <p className="text-xs text-brand-muted">Chỉ bạn dùng được hộp thư này. ATI được đọc, soạn, gửi, gắn nhãn và chuyển thư vào thùng rác; không xoá vĩnh viễn.</p>
      <p className="text-sm text-brand-text break-words">{status === 'connected' ? 'Đã kết nối' : status === 'reconnect_required' ? 'Cần kết nối lại' : 'Chưa kết nối'}{service.email && <> · {service.email}</>}</p>
      {service.connectedAt && <p className="text-xs text-brand-muted">Kết nối lúc {new Date(service.connectedAt).toLocaleString('vi-VN')}</p>}
      {status === 'reconnect_required' && <p className="text-xs text-brand-muted">Quyền có thể đã bị thu hồi hoặc hết hạn sau 7 ngày ở chế độ thử nghiệm của Google. Hãy kết nối lại.</p>}
      <button id="gmail-action" type="button" className={button} disabled={busy} onClick={() => status === 'connected' ? setConfirm(true) : void act(false)}>{status === 'connected' ? 'Ngắt kết nối' : status === 'reconnect_required' ? 'Kết nối lại' : 'Kết nối Gmail'}</button>
      {busy && <p role="status" className="text-xs text-brand-muted">{status === 'connected' ? 'Đang ngắt kết nối…' : 'Đang chuyển hướng tới Google…'}</p>}
      {error && <p role="alert" className="text-xs text-brand-danger">{error}</p>}
    </div>
    {confirm && createPortal(<CockpitDialog title="Ngắt kết nối Gmail?" returnFocusId="gmail-action" onClose={() => { if (!busy) setConfirm(false); }}>
      <div className="p-5 v3-space-y-4"><p className="text-sm">ATI sẽ xoá token và thu hồi quyền truy cập. Hội thoại cũ vẫn còn; kế hoạch cũ không thể dùng kết nối đã ngắt.</p><button className={button} disabled={busy} onClick={() => setConfirm(false)}>Tiếp tục kết nối</button>{' '}<button className={button} disabled={busy} onClick={() => void act(true)}>Xác nhận ngắt kết nối</button>{error && <p role="alert">{error}</p>}</div>
    </CockpitDialog>, document.body)}
  </section>;
}
