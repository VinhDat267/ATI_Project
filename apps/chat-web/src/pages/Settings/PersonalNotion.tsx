import { useEffect, useState } from 'react';
import { notionConnectionApi as api, openNotionAuthorization, type NotionConnection } from '../../services/notion-connection';
import { gmailSessionOwner } from '../../services/gmail-connection';
type Selection = { connectionId: string; version: number; choices: Array<{ id: string; title: string }>; selected: string[]; hasMore: boolean };
export function PersonalNotion() {
  const [rows, setRows] = useState<NotionConnection[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [selection, setSelection] = useState<Selection | null>(null), [query, setQuery] = useState('');
  useEffect(() => {
    let mounted = true; const owns = gmailSessionOwner();
    api.list().then(data => { if (mounted && owns()) setRows(data.connections); }).catch(() => { if (mounted && owns()) setError('Chưa tải được kết nối Notion. Hãy tải lại trang.'); }).finally(() => { if (mounted && owns()) setLoading(false); });
    return () => { mounted = false; };
  }, []);
  const perform = async (operation: () => Promise<void>, id: string) => {
    const owns = gmailSessionOwner(); setBusy(id); setError(''); setNotice('');
    try { await operation(); } catch { if (owns()) setError('Chưa hoàn tất được thao tác Notion. Hãy kiểm tra quyền, tải lại hoặc kết nối lại.'); }
    finally { if (owns()) setBusy(''); }
  };
  const start = () => perform(async () => { const owns = gmailSessionOwner(), result = await api.start(); if (owns()) openNotionAuthorization(result.url); }, 'connect');
  const choose = (row: NotionConnection, search = '') => perform(async () => {
    const owns = gmailSessionOwner(), result = await api.databases(row.id, search);
    if (owns()) setSelection(current => ({ connectionId: row.id, version: result.identityVersion, choices: result.databases,
      selected: current?.connectionId === row.id && current.version === result.identityVersion ? current.selected : row.allowedDatabases, hasMore: result.hasMore }));
  }, row.id);
  const save = () => selection && perform(async () => {
    const owns = gmailSessionOwner(), saved = await api.select(selection.connectionId, selection.version, selection.selected);
    if (owns()) { setRows(old => old.map(row => row.id === saved.id ? saved : row)); setSelection(null); setNotice('Đã lưu database được dùng. Công cụ Notion cá nhân chưa được mở trong đợt này.'); }
  }, selection.connectionId);
  const disconnect = (row: NotionConnection) => perform(async () => {
    const owns = gmailSessionOwner(), result = await api.disconnect(row.id);
    if (owns()) { setRows(old => old.filter(value => value.id !== row.id)); setSelection(null); setNotice(result.revoked ? 'Đã ngắt kết nối và thu hồi quyền Notion.' : 'Đã ngắt trong ATI. Hãy gỡ quyền integration trong Notion để xác nhận thu hồi.'); }
  }, row.id);
  return <section id="mynotion" aria-labelledby="mynotion-title" className="my-6 p-5 bg-white border border-[#E7E7E2] rounded-xl v3-space-y-4">
    <h2 id="mynotion-title" className="font-display text-xl font-semibold">Notion của bạn</h2>
    <p className="text-sm">Cấp quyền cho integration rồi chọn database đã chia sẻ. Mỗi workspace được lưu riêng.</p>
    <p className="text-sm text-[#6B7280]">Đợt này thiết lập kết nối và phạm vi. Công cụ Notion cá nhân chưa được mở; kết nối dùng chung của nhóm vẫn độc lập.</p>
    {loading ? <p role="status">Đang tải Notion…</p> : rows.length === 0 && <p>Chưa kết nối workspace nào.</p>}
    <ul className="v3-space-y-3">{rows.map(row => <li key={row.id} className="border border-[#E7E7E2] rounded-lg p-3 break-words">
      <h3 className="font-semibold">{row.workspaceName}</h3><p className="text-xs">{row.workspaceId}</p>
      <p>{row.status === 'reconnect_required' ? 'Cần kết nối lại' : row.status === 'scope_required' ? 'Đã cấp quyền · Chưa chọn database' : `Đã chọn ${row.allowedDatabases.length} database`}</p>
      <div className="flex flex-wrap gap-3 mt-2">
        {row.status !== 'reconnect_required' && <button type="button" disabled={!!busy} onClick={() => { setQuery(''); void choose(row); }} className="text-[#FF5701] underline">Chọn database {row.workspaceName}</button>}
        <button type="button" disabled={!!busy} aria-label={`Ngắt kết nối ${row.workspaceName}`} onClick={() => void disconnect(row)} className="text-[#FF5701] underline">Ngắt kết nối</button>
      </div>
      {selection?.connectionId === row.id && <fieldset className="mt-4 v3-space-y-3" disabled={!!busy}>
        <legend>Database được dùng (tối đa 10)</legend>
        <label className="block">Tìm database<input value={query} onChange={e => setQuery(e.target.value)} className="border border-[#E7E7E2] rounded p-2 w-full" /></label>
        <button type="button" onClick={() => void choose(row, query)} className="text-[#FF5701] underline">Tìm</button>
        {selection.hasMore && <p>Kết quả còn nữa. Hãy tìm theo tên để thu hẹp.</p>}
        {selection.choices.length === 0 && <p>Chưa tìm thấy database. Hãy chia sẻ database với integration ở Notion rồi tìm lại.</p>}
        {selection.choices.map(value => <label key={value.id} className="flex items-start gap-2 break-words"><input type="checkbox" checked={selection.selected.includes(value.id)} disabled={!selection.selected.includes(value.id) && selection.selected.length >= 10} onChange={e => setSelection(current => current ? { ...current, selected: e.target.checked ? [...new Set([...current.selected, value.id])] : current.selected.filter(id => id !== value.id) } : null)} />{value.title}</label>)}
        <button type="button" disabled={!selection.selected.length || !!busy} onClick={() => void save()} className="bg-[#FF5701] text-white px-4 py-2 rounded-lg">Lưu database được dùng</button>
      </fieldset>}
    </li>)}</ul>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <button type="button" disabled={!!busy || loading} onClick={() => void start()} className="bg-[#FF5701] text-white px-4 py-2 rounded-lg">Kết nối workspace Notion</button>
  </section>;
}
