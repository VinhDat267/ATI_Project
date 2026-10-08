import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../../services/api-client';
import { userErrorMessage } from '../../services/user-error';
import type { ServiceInfo, User } from '../../types';
import { serviceView } from './data';

type Draft = { credentials: Record<string, string>; scopes: string[]; newScope: string };
type Feedback = { kind: 'saved' | 'success' | 'rejected' | 'timeout'; message: string; time: string };
export function useSettings(user: User | null) {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, Feedback>>({});
  const [busy, setBusy] = useState<Record<string, 'save' | 'test'>>({});
  const [keyHelpOpen, setKeyHelpOpen] = useState(false);
  const epoch = useRef(0), read = useRef(0), pending = useRef(new Set<string>());
  const controllers = useRef(new Set<AbortController>());
  const list = services.map(serviceView);
  const active = list.find(s => s.id === selected);
  const draft = active ? drafts[active.id] ?? { credentials: {}, scopes: active.allowedScope ?? [], newScope: '' } : null;
  const updateDraft = (id: string, update: (current: Draft) => Draft) => setDrafts(current => ({ ...current, [id]: update(current[id] ?? { credentials: {}, scopes: services.find(s => s.id === id)?.allowedScope ?? [], newScope: '' }) }));
  const refresh = useCallback(async () => {
    const owner = epoch.current, request = ++read.current;
    try {
      const data = await apiClient.getServices();
      if (!Array.isArray(data?.services)) throw new Error('Không tải được danh mục dịch vụ.');
      if (owner === epoch.current && request === read.current) { setServices(data.services); setCanEdit(data.canConfigure === true); setLoadError(null); }
    } catch (error) {
      if (owner === epoch.current && request === read.current) setLoadError(userErrorMessage(error));
    } finally { if (owner === epoch.current && request === read.current) setLoading(false); }
  }, []);
  useEffect(() => {
    epoch.current++; setServices([]); setCanEdit(false); setDrafts({}); setErrors({}); setResults({}); setBusy({}); pending.current.clear(); setLoading(true); void refresh();
    return () => { epoch.current++; read.current++; for (const controller of controllers.current) controller.abort(); controllers.current.clear(); };
  }, [user?.id, refresh]);
  const openServiceDrawer = useCallback((id: string) => { setSelected(id); setKeyHelpOpen(false); }, []);
  useEffect(() => {
    const sync = () => {
      const id = window.location.hash.slice(1);
      setSelected(services.some(s => s.id === id) ? id : null); setKeyHelpOpen(false);
    };
    if (window.location.hash) sync(); window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  // Re-read a deep link after the asynchronous catalogue first arrives, without
  // reopening a drawer on each metadata refresh.
  }, [services.length]);
  const closeServiceDrawer = () => {
    setSelected(null);
    if (window.location.hash) window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
  };
  const clearFeedback = (id: string) => { setErrors(e => ({ ...e, [id]: '' })); setResults(r => { const next = { ...r }; delete next[id]; return next; }); };
  const addNewScopeItem = () => {
    if (!active || !draft || !canEdit) return;
    const value = draft.newScope.trim();
    if (!value) return;
    if (active.scopePattern && !new RegExp(active.scopePattern).test(value)) { setErrors(e => ({ ...e, [active.id]: active.scopeError ?? 'Định dạng nơi được dùng không hợp lệ.' })); return; }
    updateDraft(active.id, d => ({ ...d, scopes: d.scopes.includes(value) ? d.scopes : [...d.scopes, value], newScope: '' })); setErrors(e => ({ ...e, [active.id]: '' }));
  };
  const saveServiceChanges = async () => {
    if (!active || !draft || !canEdit || pending.current.has(active.id)) return;
    const id = active.id, owner = epoch.current;
    const credentials = Object.fromEntries(active.keyInputs.map(f => [f.key, draft.credentials[f.key] ?? '']));
    const scopes = [...draft.scopes];
    let error = '';
    if (scopes.length === 0) error = 'Cần ít nhất một nơi được dùng trước khi lưu.';
    else if (active.scopePattern && scopes.some(s => !new RegExp(active.scopePattern!).test(s))) error = active.scopeError ?? 'Định dạng nơi được dùng không hợp lệ.';
    else { const invalid = active.keyInputs.find(field => field.pattern && credentials[field.key] && !new RegExp(field.pattern).test(credentials[field.key])); if (invalid) error = invalid.formatHint; }
    const changingKeys = Object.values(credentials).some(v => v !== '');
    if (!error && (changingKeys || !active.configured) && Object.values(credentials).some(v => !v.trim())) error = 'Muốn đổi khoá, nhập lại đủ các ô khoá.';
    if (error) { setErrors(e => ({ ...e, [id]: error })); return; }
    clearFeedback(id); pending.current.add(id); setBusy(b => ({ ...b, [id]: 'save' }));
    try {
      const data = changingKeys || !active.configured ? await apiClient.saveCredentials(id, credentials, scopes) : await apiClient.saveServiceScope(id, scopes);
      if (data?.success !== true) throw new Error(data?.error || data?.message || 'Không thể lưu cấu hình');
      if (owner !== epoch.current) return;
      // W3-00b: only this service and values still equal to the submission.
      setDrafts(current => {
        const own = current[id]; if (!own) return current;
        return { ...current, [id]: { ...own, credentials: Object.fromEntries(Object.entries(own.credentials).filter(([key, value]) => value !== credentials[key])) } };
      });
      setServices(current => current.map(s => s.id === id ? { ...s, configured: true, connectionStatus: 'unchecked', lastCheckedAt: null, allowedScope: scopes } : s));
      const message = /^Credentials saved/.test(data.message) ? 'Đã lưu khoá' : /^Allowed scope saved/.test(data.message) ? 'Đã lưu nơi được dùng' : data.message || 'Đã lưu thay đổi';
      setResults(r => ({ ...r, [id]: { kind: 'saved', message: `${message}. Trạng thái hiện tại: Chưa kiểm tra.`, time: '' } }));
      await refresh();
    } catch (error) { if (owner === epoch.current) setErrors(e => ({ ...e, [id]: userErrorMessage(error) })); }
    finally { if (owner === epoch.current) { pending.current.delete(id); setBusy(b => { const next = { ...b }; delete next[id]; return next; }); } }
  };
  const runTestConnection = async () => {
    if (!active?.configured || pending.current.has(active.id)) return;
    const id = active.id, owner = epoch.current, controller = new AbortController();
    controllers.current.add(controller); pending.current.add(id); clearFeedback(id); setBusy(b => ({ ...b, [id]: 'test' }));
    const timer = window.setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), 10_000);
    try {
      const data = await apiClient.testConnection(id, controller.signal);
      // JSON parsing may have been interrupted after response headers arrived.
      // ApiClient's malformed-body fallback must not turn that abort into a
      // generic provider rejection instead of the measured ten-second timeout.
      if (controller.signal.aborted) throw controller.signal.reason;
      if (owner !== epoch.current) return;
      const kind = data.success ? 'success' : /10\s*giây|timeout|timed out/i.test(data.message) ? 'timeout' : 'rejected';
      const message = /^Successfully connected/.test(data.message) ? 'Kết nối tốt' : /^Provider rejected/.test(data.message) ? 'Khoá truy cập bị từ chối. Vui lòng kiểm tra lại quyền.' : data.message === 'Service connection verification failed' ? 'Không thể xác nhận kết nối. Kiểm tra lại khoá, quyền và kết nối mạng.' : data.message;
      setResults(r => ({ ...r, [id]: { kind, message: `${message}${data.success && typeof data.latencyMs === 'number' ? ` (${data.latencyMs} ms)` : ''}`, time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) } }));
      await refresh();
    } catch (error) {
      if (owner !== epoch.current) return;
      const timeout = controller.signal.aborted;
      setResults(r => ({ ...r, [id]: { kind: timeout ? 'timeout' : 'rejected', message: timeout ? 'Không nhận được phản hồi sau 10 giây. Thử lại sau.' : userErrorMessage(error), time: '' } }));
      await refresh();
    } finally {
      window.clearTimeout(timer); controllers.current.delete(controller);
      if (owner === epoch.current) { pending.current.delete(id); setBusy(b => { const next = { ...b }; delete next[id]; return next; }); }
    }
  };
  return { list, active, draft, selected, loading, loadError, refresh, canEdit, errors, results, busy, keyHelpOpen,
    actions: { openServiceDrawer, closeServiceDrawer, toggleKeyHelp: () => setKeyHelpOpen(o => !o), addNewScopeItem,
      removeScopeItem: (index: number) => { if (active && canEdit) updateDraft(active.id, d => ({ ...d, scopes: d.scopes.filter((_, i) => i !== index) })); },
      onKeyInputChanged: (key: string, value: string) => { if (active && canEdit) updateDraft(active.id, d => ({ ...d, credentials: { ...d.credentials, [key]: value } })); },
      onScopeInputChanged: (value: string) => { if (active && canEdit) { updateDraft(active.id, d => ({ ...d, newScope: value })); setErrors(e => ({ ...e, [active.id]: '' })); } },
      saveServiceChanges, runTestConnection,
    } };
}
