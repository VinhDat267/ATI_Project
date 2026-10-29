import { useEffect, useState } from 'react';
import { slackConnectionApi, openSlackAuthorization, type SlackConnection } from '../../services/slack-connection';
import { gmailSessionOwner } from '../../services/gmail-connection';
export function PersonalSlack() {
  const [rows, setRows] = useState<SlackConnection[]>([]), [visible, setVisible] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState('');
  useEffect(() => {
    let mounted = true; const owns = gmailSessionOwner();
    slackConnectionApi.list().then(data => { if (mounted && owns() && Array.isArray(data.connections)) { setRows(data.connections); setVisible(true); } }).catch(() => { /* Disabled route remains invisible. */ });
    return () => { mounted = false; };
  }, []);
  if (!visible) return null;
  const start = async () => {
    const owns = gmailSessionOwner(); setBusy('connect'); setError('');
    try { const data = await slackConnectionApi.start(); if (owns()) openSlackAuthorization(data.url); }
    catch { if (owns()) setError('Không mở được trang kết nối Slack. Hãy thử lại.'); }
    finally { if (owns()) setBusy(''); }
  };
  const disconnect = async (row: SlackConnection) => {
    const owns = gmailSessionOwner(); setBusy(row.id); setError(''); setNotice('');
    try {
      const result = await slackConnectionApi.disconnect(row.id), data = await slackConnectionApi.list();
      if (owns()) { setRows(data.connections); setNotice(result.revoked ? 'Đã ngắt kết nối và thu hồi quyền Slack.' : 'Đã ngắt trong ATI. Chưa xác nhận thu hồi ở Slack; hãy gỡ quyền ứng dụng trong Slack.'); }
    } catch { if (owns()) setError('Chưa ngắt được kết nối Slack. Hãy thử lại.'); }
    finally { if (owns()) setBusy(''); }
  };
  return <section id="myslack" aria-labelledby="myslack-title" className="my-6 p-5 bg-white border border-[#E7E7E2] rounded-xl v3-space-y-4">
    <h2 id="myslack-title" className="font-display text-xl font-semibold">Slack của bạn</h2>
    <p className="text-sm">Kết nối từng workspace bằng tài khoản Slack của bạn. Mỗi workspace được quản lý riêng.</p>
    <p className="text-sm text-[#6B7280]">Chờ cho phép xử lý dữ liệu: ATI chưa đọc tin hoặc đưa nội dung Slack vào AI.</p>
    {rows.length === 0 && <p>Chưa kết nối workspace nào.</p>}
    <ul className="v3-space-y-3">{rows.map(row => <li key={row.id} className="border border-[#E7E7E2] rounded-lg p-3 break-words">
      <h3 className="font-semibold">{row.workspaceName}</h3><p className="text-xs">{row.workspaceId} · {row.actorId}</p>
      <p className="text-sm">{row.status === 'reconnect_required' ? 'Cần kết nối lại' : 'Đã kết nối'}</p>
      {row.missingScopes.length > 0 && <p className="text-sm">Một số quyền chưa được cấp. Kết nối lại để xem và cấp bổ sung.</p>}
      <button type="button" disabled={!!busy} aria-label={`Ngắt kết nối ${row.workspaceName}`} onClick={() => void disconnect(row)} className="mt-2 text-[#FF5701] underline">Ngắt kết nối</button>
    </li>)}</ul>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <button type="button" disabled={!!busy} onClick={() => void start()} className="bg-[#FF5701] text-white px-4 py-2 rounded-lg">{busy === 'connect' ? 'Đang mở Slack…' : 'Kết nối workspace Slack'}</button>
  </section>;
}
