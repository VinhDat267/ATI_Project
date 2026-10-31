import { useEffect, useState } from 'react';
import { slackConnectionApi, slackSessionOwner, type SlackConnection } from '../../services/slack-connection';

export function SlackReadControls({ userId, busy, value, onChange }: { userId?: string; busy: boolean; value: string | null; onChange: (value: string | null) => void }) {
  const active = value !== null;
  const [connections, setConnections] = useState<SlackConnection[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!active) return;
    let current = true;
    const owns = slackSessionOwner();
    setLoading(true); setConnections([]); setError(''); onChange('');
    slackConnectionApi.list().then(data => {
      if (!current || !owns()) return;
      const rows = data.connections.filter(row => row.status === 'active');
      setConnections(rows);
      if (rows.length === 1) onChange(rows[0].id);
    }).catch(() => { if (current && owns()) setError('Không tải được workspace. Hãy thử bật lại tra cứu.'); })
      .finally(() => { if (current && owns()) setLoading(false); });
    return () => { current = false; };
  }, [active, userId]);
  return <section aria-label="Chế độ tra cứu" className="mb-6 rounded-2xl border border-brand-border bg-white p-4 text-sm">
    <button type="button" aria-pressed={active} disabled={busy} onClick={() => onChange(active ? null : '')} className="rounded-lg border border-brand-border px-3 py-2 font-medium text-brand-text">Tra cứu Slack của bạn</button>
    {active && <div className="mt-3 space-y-2">
      {loading ? <p role="status">Đang tải workspace…</p> : connections.length ? <label className="block">Workspace Slack<select className="mt-1 block w-full min-w-0 rounded-lg border border-brand-border bg-white p-2 text-brand-text" value={value ?? ''} disabled={busy} onChange={event => onChange(event.target.value)}><option value="">Chọn workspace</option>{connections.map(row => <option key={row.id} value={row.id}>{row.workspaceName} · {row.workspaceId} · {row.slackUserLabel}</option>)}</select></label> : <p>Chưa có workspace sẵn sàng. <a href="/settings#myslack" className="underline">Kết nối Slack</a></p>}
      {error && <p role="alert">{error}</p>}
      <p className="text-xs text-brand-muted">ATI chỉ đọc sau khi bạn duyệt. Kết quả được lưu tối đa 1 ngày, trong phạm vi workspace cho phép.</p>
      {!loading && connections.length > 1 && !value && <p role="status" className="text-xs">Chọn workspace trước khi gửi yêu cầu.</p>}
    </div>}
  </section>;
}
