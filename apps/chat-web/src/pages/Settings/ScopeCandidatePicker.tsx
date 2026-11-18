import { useState } from 'react';
import { apiClient } from '../../services/api-client';

type Candidate = { id: string; label: string; warning?: string };

/**
 * Lets an admin tick allowed resources (e.g. chat channels) loaded from the provider
 * instead of typing raw IDs. Uses credentials typed in the form (first-time setup)
 * or the stored credential when the form is empty.
 */
export function ScopeCandidatePicker(props: {
  serviceId: string;
  scopeLabel: string;
  credentials: Record<string, string>;
  selected: string[];
  disabled?: boolean;
  onToggle: (id: string) => void;
}) {
  const [items, setItems] = useState<Candidate[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const typed = Object.fromEntries(Object.entries(props.credentials).filter(([, v]) => typeof v === 'string' && v.trim()));
      const data = await apiClient.getScopeCandidates(props.serviceId, Object.keys(typed).length ? typed : undefined);
      setItems(data.items); setTruncated(Boolean(data.truncated));
    } catch (err: any) {
      setError(err?.message || 'Không tải được danh sách.');
    } finally { setLoading(false); }
  };

  const q = filter.trim().toLowerCase();
  const shown = (items ?? []).filter(c => !q || c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
  const byId = new Map((items ?? []).map(c => [c.id, c]));
  const warnSelected = props.selected.some(id => byId.get(id)?.warning);

  return (
    <div data-testid="scope-candidate-picker" className="v3-space-y-2 rounded-lg border border-[#E8E0D6] p-3 bg-white dark:bg-[#1A1613] dark:border-[#3a312a]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[#51463E] dark:text-[#A39A90]">{`Chọn ${props.scopeLabel} từ danh sách thay vì nhập ID.`}</p>
        <button type="button" disabled={props.disabled || loading} onClick={() => void load()}
          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[#E8E0D6] bg-[#F8F4EE] hover:bg-neutral-200 disabled:opacity-50 flex-shrink-0">
          {loading ? 'Đang tải…' : items ? 'Tải lại' : 'Tải danh sách'}
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-[#DC2626] font-medium">{error}</p>}
      {items && items.length === 0 && <p className="text-xs text-[#6A5F56] italic">Không tìm thấy mục nào mà khoá này truy cập được.</p>}
      {items && items.length > 8 && (
        <input type="search" aria-label="Lọc danh sách" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Lọc theo tên…"
          className="w-full text-xs px-3 py-1.5 bg-[#F8F4EE] border border-[#E8E0D6] rounded-lg" />
      )}
      {shown.length > 0 && (
        <ul className="max-h-56 overflow-y-auto v3-space-y-1" aria-label="Danh sách có thể chọn">
          {shown.map(c => (
            <li key={c.id}>
              <label className="flex flex-wrap items-center gap-2 text-xs py-1 cursor-pointer">
                <input type="checkbox" checked={props.selected.includes(c.id)} disabled={props.disabled} onChange={() => props.onToggle(c.id)} aria-label={c.label} />
                <span className="font-medium">{c.label}</span>
                <span className="font-mono text-[10px] text-[#6A5F56]">{c.id}</span>
                {c.warning && <span className="text-[10px] text-amber-700">{c.warning}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
      {truncated && <p className="text-[11px] text-[#6A5F56]">Danh sách bị cắt bớt; dùng ô lọc hoặc nhập ID thủ công bên dưới.</p>}
      {warnSelected && <p className="text-[11px] text-amber-700">Có mục đã chọn đang có cảnh báo: thao tác sẽ báo lỗi cho tới khi xử lý.</p>}
    </div>
  );
}
