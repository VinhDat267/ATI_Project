// Ported from PROTO-01 SettingsPage: source markup/classes and page.css retained.
import { useEffect, useState, useLayoutEffect, useRef } from 'react';
import { MainNav } from '../../components/layout/MainNav';
import { usePrototypePage } from '../../prototype/usePrototypePage';
import { ServiceLogo } from '../../components/ServiceLogo';
import { getActiveWorkspaceSummary, subscribeWorkspace } from '../../services/workspace-storage';
import type { User } from '../../types';
import { type Service } from './data';
import { useSettings } from './useSettings';
import { PersonalGmail } from './PersonalGmail';
import { PersonalMyCalendar } from './PersonalMyCalendar';
import { PersonalMySheets } from './PersonalMySheets';
import { PersonalSlack } from './PersonalSlack';
import { ScopeCandidatePicker } from './ScopeCandidatePicker';
import { TrelloConnection } from './TrelloConnection';
import { GitHubConnection } from './GitHubConnection';
import { NotionConnection } from './NotionConnection';
import { TelegramConnection } from './TelegramConnection';
import { JiraConnection } from './JiraConnection';
import {
  gmailConnectionNotice,
  mycalendarConnectionNotice,
  mysheetsConnectionNotice,
} from '../../services/gmail-connection';
import { trelloConnectionNotice } from '../../services/trello-connection';
import { githubConnectionNotice } from '../../services/github-connection';
import { notionConnectionNotice } from '../../services/notion-connection';
import { telegramConnectionNotice } from '../../services/telegram-connection';
import { jiraConnectionNotice } from '../../services/jira-connection';
import { meta } from './meta';

const SAVED_PLACEHOLDER = 'Đã lưu · nhập lại nếu muốn thay';
const WARNING_PATH = 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z';
const resultIcon = (color: string, d: string) => <svg className={`w-4 h-4 ${color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={d} /></svg>;
const RESULT = {
  saved: { box: 'p-3.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-xs leading-relaxed', icon: resultIcon('text-amber-600', WARNING_PATH) },
  success: { box: 'p-3.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 text-xs leading-relaxed', icon: resultIcon('text-[#16A34A]', 'M5 13l4 4L19 7') },
  rejected: { box: 'p-3.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-900 text-xs leading-relaxed', icon: resultIcon('text-[#DC2626]', WARNING_PATH) },
  timeout: { box: 'p-3.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-900 text-xs leading-relaxed', icon: resultIcon('text-rose-600', 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z') },
};
// getStatusBadgeHtml.
function StatusBadge({ service }: { service: Service }) {
  const timeStr = service.lastCheckTime ? ` · kiểm tra lúc ${service.lastCheckTime}` : '';
  if (!service.configured) return <span className="ps-status ps-status-neutral">{`Chưa kết nối${timeStr}`}</span>;
  if (service.statusType === 'untested') return <span className="ps-status ps-status-warning">{`Chưa kiểm tra${timeStr}`}</span>;
  if (service.statusType === 'ok') return <span className="ps-status ps-status-connected">{`Kết nối tốt${timeStr}`}</span>;
  if (service.statusType === 'failed') return <span className="ps-status ps-status-error">{`Không kết nối được${timeStr}`}</span>;
  return null;
}

// renderServiceRowHtml.
function ServiceRow({ service, onOpen }: { service: Service; onOpen: (id: string) => void }) {
  return <div
    role="button"
    tabIndex={0}
    id={`service-row-${service.id}`}
    onClick={() => onOpen(service.id)}
    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(service.id); } }}
    className="group h-full ps-panel hover:border-[#C9BBA8] dark:hover:border-[#4a4038] p-4 sm:p-5 transition-colors flex flex-wrap items-center justify-between gap-x-3 gap-y-2 cursor-pointer focus-visible:ring-2 focus-visible:ring-[#FF5701] focus-visible:v3-outline-none"
    aria-haspopup="dialog"
    aria-label={`${service.name} — bấm để xem chi tiết kết nối`}
  >
    <div className="flex items-start sm:items-center gap-3.5 min-w-0 flex-1 basis-56">
      <ServiceLogo service={service.id} className="w-6 h-6 flex-shrink-0" />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-sans font-semibold text-base text-[#1a0e08] dark:text-white">
            {service.name}
          </h3>
        </div>
        <p className="text-[13px] text-[#51463E] dark:text-[#D7CEC4] mt-0.5 line-clamp-2">
          {service.capabilities}
        </p>
      </div>
    </div>
    <div className="flex items-center justify-end gap-2 flex-shrink-0">
      <div><StatusBadge service={service} /></div>
      <div className="text-[#6A5F56] group-hover:text-[#FF5701] transition-colors">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
      </div>
    </div>
  </div>;
}

export interface SettingsPageProps { user: User | null; navigate: (path: string) => void; onLogout: () => void; authToken?: string | null }
export function SettingsPage({ user, navigate, onLogout }: SettingsPageProps) {
  usePrototypePage(meta);
  const [workspace, setWorkspace] = useState(getActiveWorkspaceSummary());
  useEffect(() => subscribeWorkspace(() => setWorkspace(getActiveWorkspaceSummary())), []);
  const { slackOAuthEnabled, list, personal, personalMyCalendar, personalMySheets, active, draft, selected, loading, loadError, refresh, canEdit, errors, results, busy, keyHelpOpen, actions } = useSettings(user);
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'google' | 'work' | 'messaging'>('all');
  const [connectedEmail, setConnectedEmail] = useState<string>();
  useEffect(() => {
    const email =
      gmailConnectionNotice.take(user?.id) ??
      mycalendarConnectionNotice.take(user?.id) ??
      mysheetsConnectionNotice.take(user?.id);
    const trelloUser = trelloConnectionNotice.take(user?.id);
    const githubUser = githubConnectionNotice.take(user?.id);
    const telegramUser = telegramConnectionNotice.take(user?.id);
    const notionWorkspace = notionConnectionNotice.take(user?.id);
    const jiraUser = jiraConnectionNotice.take(user?.id);
    if (email) setConnectedEmail(email);
    else if (trelloUser) setConnectedEmail(`@${trelloUser}`);
    else if (githubUser) setConnectedEmail(`@${githubUser}`);
    else if (telegramUser) setConnectedEmail(`@${telegramUser}`);
    else if (notionWorkspace) setConnectedEmail(`Notion: ${notionWorkspace}`);
    else if (jiraUser) setConnectedEmail(jiraUser);
  }, [user?.id]);
  const backgroundRef = useRef<HTMLDivElement>(null), containerRef = useRef<HTMLDivElement>(null), closeButtonRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(actions.closeServiceDrawer); closeRef.current = actions.closeServiceDrawer;
  useLayoutEffect(() => {
    if (!active || !containerRef.current) return;
    const id = active.id, dialog = containerRef.current, background = backgroundRef.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; background?.setAttribute('inert', ''); background?.setAttribute('aria-hidden', 'true');
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')).filter(el => !el.closest('.hidden,[hidden]'));
    const focusFirst = () => (closeButtonRef.current ?? dialog).focus(); focusFirst();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const elements = focusable(), first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const focusin = (event: FocusEvent) => { if (!dialog.contains(event.target as Node)) focusFirst(); };
    window.addEventListener('keydown', keydown); document.addEventListener('focusin', focusin);
    return () => {
      window.removeEventListener('keydown', keydown); document.removeEventListener('focusin', focusin);
      document.body.style.overflow = overflow; background?.removeAttribute('inert'); background?.removeAttribute('aria-hidden');
      document.getElementById(`service-row-${id}`)?.focus();
    };
  }, [active?.id]);
  const drawer = active ? { service: active } : null, badge = active;
  const configured = list.filter(s => s.configured), unconfigured = list.filter(s => !s.configured), okCount = configured.filter(s => s.statusType === 'ok').length;
  const hasCatalogue = list.length > 0;
  const isMemberDrawer = !canEdit, scopeLabel = active?.scopeLabel;
  const scope = draft ? { items: draft.scopes, isMember: isMemberDrawer, scopeLabel: scopeLabel ?? 'tài nguyên' } : null;
  const savedPlaceholder = !!active?.configured, hint = { visible: !!active?.hint, text: active?.hint };
  const saveError = { visible: !!errors[selected ?? ''], text: errors[selected ?? ''] };
  const scopeError = { visible: !!draft && draft.scopes.length === 0, text: `Cần ít nhất một ${scopeLabel}.` };
  const newScopeInvalid = !!active?.scopePattern && !!errors[active.id]?.startsWith('Định dạng');
  const testButton = { disabled: !active?.configured || !!busy[selected ?? ''], dim: !active?.configured, spinning: busy[selected ?? ''] === 'test' };
  const result = results[selected ?? ''] ?? { kind: null, visible: false, message: '', time: '' };
  const visibleResult = !!results[selected ?? ''];
  return <>
    <div data-cockpit-background ref={backgroundRef} className="contents" onClick={event => {
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
      if (anchor && anchor.origin === window.location.origin && !anchor.target && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(`${anchor.pathname}${anchor.search}${anchor.hash}`); }
    }}>
      {/* FE-12: thanh điều hướng chung thay thanh trên của bản mẫu. */}
      <MainNav user={user} current="settings" pageName="Kết nối dịch vụ" navigate={navigate} onLogout={onLogout} />
      {/* NỘI DUNG CHÍNH */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-8 sm:py-10">
        {/* Tiêu đề trang: phạm vi đang cấu hình và nguyên tắc an toàn trong một câu (bước 5b). */}
        <div className="ps-pagehead mb-8 sm:mb-10">
          <h1>Kết nối dịch vụ</h1>
          <p data-testid="settings-oauth-summary">
            {`${workspace.id === 'personal' ? 'Đang cấu hình kết nối cho: Không gian Cá nhân' : `Đang cấu hình kết nối cho: ${workspace.name}`}. Planora chỉ đọc và ghi ở những bảng, lịch, tệp hoặc kênh bạn chọn, và bạn ngắt kết nối được bất cứ lúc nào.`}
          </p>
        </div>
        {loading && <p role="status" className="text-xs text-[#6A5F56] mb-4">Đang tải dịch vụ...</p>}
        {loadError && <div role="alert" className="text-xs text-[#DC2626] mb-4">{loadError} <button type="button" onClick={() => void refresh()} className="underline">Thử lại</button></div>}
        {connectedEmail && <p role="status" className="text-sm text-[#1a0e08] dark:text-white mb-4">Đã kết nối {connectedEmail}</p>}
        <section aria-labelledby="heading-personal-services" className="mb-12 v3-space-y-6">
          <div className="ps-sectionhead">
            <div>
              <h2 id="heading-personal-services">Của riêng bạn</h2>
              <p className="ps-note mt-0.5">Tài khoản bạn tự liên kết; Planora chỉ dùng đúng phần dữ liệu bạn cho phép.</p>
            </div>
            <div role="tablist" aria-label="Phân nhóm dịch vụ" className="ps-segmented">
              {([
                { id: 'all', label: 'Tất cả' },
                { id: 'google', label: 'Google Workspace' },
                { id: 'work', label: 'Dự án & Mã nguồn' },
                { id: 'messaging', label: 'Tin nhắn & Thông báo' },
              ] as const).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={categoryFilter === tab.id}
                  onClick={() => setCategoryFilter(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Nhóm 1: Hệ sinh thái Google Workspace */}
          {(personal || personalMyCalendar || personalMySheets) && (
            <div className={categoryFilter !== 'all' && categoryFilter !== 'google' ? 'hidden' : 'v3-space-y-3'}>
              <h3 className="ps-grouptitle">Google Workspace</h3>
              <div className="ps-cardgrid">
                {personal && <PersonalGmail key={`gmail-${user?.id}`} selected={selected} service={personal} refresh={refresh} standalone={false} />}
                {personalMyCalendar && <PersonalMyCalendar key={`mycalendar-${user?.id}`} selected={selected} service={personalMyCalendar} refresh={refresh} navigate={navigate} standalone={false} />}
                {personalMySheets && <PersonalMySheets key={`mysheets-${user?.id}`} selected={selected} service={personalMySheets} refresh={refresh} navigate={navigate} standalone={false} />}
              </div>
            </div>
          )}

          {/* Nhóm 2: Quản lý dự án, Tài liệu & Mã nguồn */}
          <div className={categoryFilter !== 'all' && categoryFilter !== 'work' ? 'hidden' : 'v3-space-y-3'}>
            <h3 className="ps-grouptitle">Dự án, tài liệu và mã nguồn</h3>
            <div className="ps-cardgrid">
              <TrelloConnection key={`trello-${user?.id}`} user={user} selected={selected} refresh={refresh} standalone={false} />
              <GitHubConnection key={`github-${user?.id}`} user={user} selected={selected} refresh={refresh} standalone={false} />
              <JiraConnection key={`jira-${user?.id}`} user={user} selected={selected} refresh={refresh} navigate={navigate} standalone={false} />
              <NotionConnection key={`notion-${user?.id}`} user={user} selected={selected === 'notion'} refresh={refresh} standalone={false} />
            </div>
          </div>

          {/* Nhóm 3: Tin nhắn & Kênh thông báo */}
          <div className={categoryFilter !== 'all' && categoryFilter !== 'messaging' ? 'hidden' : 'v3-space-y-3'}>
            <h3 className="ps-grouptitle">Tin nhắn và thông báo</h3>
            <div className="ps-cardgrid">
              <TelegramConnection key={`telegram-${user?.id}`} user={user} selected={selected} refresh={refresh} navigate={navigate} standalone={false} />
              {slackOAuthEnabled && <PersonalSlack key={`slack-${user?.id}`} standalone={false} />}
            </div>
          </div>
        </section>
        {/* KHOÁ DỊCH VỤ DÙNG CHUNG: quản trị viên thêm khoá, cả không gian dùng. Bộ đếm chỉ đếm các dịch vụ này. */}
        {hasCatalogue && <div className="v3-space-y-6">
          <div className="ps-sectionhead">
            <div>
              <h2>Khoá dịch vụ</h2>
              <p className="ps-note mt-0.5">Khoá truy cập dùng chung cho cả không gian; quản trị viên thêm và kiểm tra.</p>
            </div>
            <span id="summary-connected-count" className="text-sm font-medium text-[#1a0e08] dark:text-white tabular-nums">
              {`${configured.length}/${list.length} đã thiết lập · ${okCount} kết nối tốt`}
            </span>
          </div>
          {/* Nhóm 1: Đã thiết lập */}
          <section aria-labelledby="heading-connected-services" className="v3-space-y-3">
            <h3 id="heading-connected-services" className="ps-grouptitle">
              Đã thiết lập <span id="badge-count-connected" className="ps-groupcount">{configured.length}</span>
            </h3>
            <div id="list-connected-services" className="ps-cardgrid" role="list">
              {configured.length === 0
                ? <div role="listitem" className="ps-panel p-5 ps-note">Chưa có dịch vụ nào được thiết lập.</div>
                : [...configured].sort((a, b) => Number(b.statusType === 'failed') - Number(a.statusType === 'failed')).map(s => <div key={s.id} role="listitem"><ServiceRow service={s} onOpen={actions.openServiceDrawer} /></div>)}
            </div>
          </section>
          {/* Nhóm 2: Chưa thiết lập */}
          <section aria-labelledby="heading-unconnected-services" className="v3-space-y-3">
            <h3 id="heading-unconnected-services" className="ps-grouptitle">
              Chưa thiết lập <span id="badge-count-unconnected" className="ps-groupcount">{unconfigured.length}</span>
            </h3>
            <div id="list-unconnected-services" className="ps-cardgrid" role="list">
              {unconfigured.length === 0
                ? <div role="listitem" className="ps-panel p-5 ps-note">{`Tất cả ${list.length} dịch vụ đều đã được thiết lập.`}</div>
                : unconfigured.map(s => <div key={s.id} role="listitem"><ServiceRow service={s} onOpen={actions.openServiceDrawer} /></div>)}
            </div>
          </section>
        </div>}
        {/* Chú thích chân trang */}
        <div className="mt-12 pt-6 border-t border-[#E8E0D6] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#6A5F56]">
          <div>
            <p>
              Planora — Nền tảng điều phối công việc liên dịch vụ · 2026
            </p>
            <p className="text-xs text-[#6A5F56] mt-0.5">
              {personal ? 'Các tích hợp cá nhân (Gmail, Google Calendar, Google Sheets, Slack, Trello, GitHub, Notion, Jira Cloud, Telegram) do mỗi thành viên tự liên kết và chọn phạm vi dữ liệu.' : 'Khoá dịch vụ là tài nguyên dùng chung của cả nhóm · Chỉ quản trị viên có quyền cập nhật'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <a href="/" className="hover:text-[#1a0e08] transition-colors">
              Không gian làm việc
            </a>
            <a href="/guide" className="hover:text-[#1a0e08] transition-colors">
              Cẩm nang
            </a>
            <a href="/privacy" className="text-[#FF5701] hover:underline font-medium transition-colors">
              Chính sách an toàn &amp; Dữ liệu
            </a>
          </div>
        </div>
      </main>
    </div>
    {drawer && draft && <>
      {/* ============================================================= */}
      {/* NGĂN CHI TIẾT DỊCH VỤ (DRAWER DIALOG / FULLSCREEN MOBILE) */}
      {/* ============================================================= */}
      <div ref={containerRef} tabIndex={-1} id="service-drawer-container" className="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="drawer-service-title">
        {/* Lớp nền mờ (Backdrop) */}
        <div id="drawer-backdrop" className={`drawer-backdrop fixed inset-0 bg-black/40 opacity-100 transition-opacity`} onClick={() => actions.closeServiceDrawer()} />
        <div className="fixed inset-y-0 right-0 max-w-full flex">
          {/* Panel ngăn chi tiết */}
          <div id="drawer-panel" className={`drawer-panel w-screen sm:max-w-xl bg-white shadow-2xl flex flex-col translate-x-0 border-l border-[#E8E0D6] transition-transform`}>
            {/* Header của ngăn chi tiết */}
            <div className="px-5 sm:px-6 py-4 border-b border-[#E8E0D6] flex items-center justify-between gap-3 bg-[#F8F4EE]">
              <div className="flex items-center gap-3 min-w-0">
                <div id="drawer-icon-container" className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
                  <ServiceLogo service={drawer.service.id} className="w-6 h-6" />
                </div>
                <div className="min-w-0">
                  <h2 id="drawer-service-title" className="font-sans text-lg font-semibold text-[#1a0e08] truncate">
                    {drawer.service.name}
                  </h2>
                  <div id="drawer-header-status-badge" className="mt-0.5">
                    {badge ? <StatusBadge service={badge} /> : null}
                  </div>
                </div>
              </div>
              <button ref={closeButtonRef} type="button" id="btn-close-drawer" onClick={() => actions.closeServiceDrawer()} className="p-2 text-[#6A5F56] hover:text-[#1a0e08] rounded-lg hover:bg-neutral-200 transition-colors" aria-label="Đóng ngăn chi tiết">
                {' '}
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
                {' '}
              </button>
            </div>
            {/* Cảnh báo thành viên thường (nếu role == 'member') */}
            <div id="drawer-member-warning" className={`${isMemberDrawer ? '' : 'hidden '}px-5 sm:px-6 py-2.5 bg-amber-50 border-b border-amber-200 text-xs text-amber-800 flex items-center gap-2`}>
              <svg className="w-4 h-4 text-amber-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>
                {"Chỉ quản trị viên thay đổi được khoá dùng chung của nhóm. Bạn vẫn có thể bấm "}
                <strong>
                  Kiểm tra kết nối
                </strong>
                {" ở mục 3."}
              </span>
            </div>
            {/* Thân ngăn chi tiết (Cuộn dọc) */}
            <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-6 v3-space-y-8" id="drawer-body">
              {/* PHẦN 1: KHOÁ TRUY CẬP */}
              <section aria-labelledby="section-keys-title" className="v3-space-y-4">
                <div className="flex items-center justify-between gap-2 border-b border-[#E8E0D6] pb-2">
                  <h3 id="section-keys-title" className="text-sm font-bold uppercase tracking-wider text-[#1a0e08] flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#1a0e08] text-white text-xs flex items-center justify-center font-bold">
                      1
                    </span>
                    <span>
                      Khoá truy cập
                    </span>
                  </h3>
                  {/* Nút toggle Lấy khoá ở đâu? */}
                  <button type="button" id="btn-toggle-key-help" aria-expanded={keyHelpOpen} aria-controls="key-help-box" onClick={() => actions.toggleKeyHelp()} className="text-xs text-[#FF5701] hover:underline font-medium inline-flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>
                      Lấy khoá ở đâu?
                    </span>
                  </button>
                </div>
                {/* Hộp hướng dẫn Lấy khoá ở đâu (Ẩn mặc định) */}
                <div id="key-help-box" className={`${keyHelpOpen ? '' : 'hidden '}bg-[#F8F4EE] p-3.5 rounded-xl border border-[#E8E0D6] text-xs text-[#51463E] leading-relaxed`}>
                  <p id="key-help-text">
                    {drawer ? drawer.service.keyHelp : 'Hướng dẫn lấy khoá...'}
                  </p>
                  <div className="mt-2.5 pt-2 border-t border-[#E8E0D6]">
                    <a id="key-help-guide-link" href={drawer.service.guideUrl ?? "/guide"} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#FF5701] hover:underline">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                      <span>
                        Mở hướng dẫn chính thức của dịch vụ →
                      </span>
                    </a>
                  </div>
                </div>
                {/* Gợi ý riêng của dịch vụ (nếu có) */}
                <div id="service-specific-hint" className={`${hint.visible ? '' : 'hidden '}text-xs text-[#6A5F56] italic bg-blue-50/70 p-2.5 rounded-lg border border-blue-100 flex items-center gap-2 text-blue-900`}>
                  <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span id="service-specific-hint-text">
                    {hint.text}
                  </span>
                </div>
                {/* Các ô nhập khoá (Dynamic), renderDrawerKeyInputs */}
                <div id="drawer-key-fields" className="v3-space-y-3.5">
                  {drawer?.service.keyInputs.map(input => {
                    const needsFormatValidation = !!input.pattern;
                    const fieldInvalid = !!input.pattern && !!draft.credentials[input.key] && !new RegExp(input.pattern).test(draft.credentials[input.key]);
                    const placeholder = savedPlaceholder ? SAVED_PLACEHOLDER : input.placeholder;
                    const locked = isMemberDrawer ? ' bg-neutral-100 cursor-not-allowed' : '';
                    return (
                      <div key={input.id}>
                        <label htmlFor={input.id} className="block text-xs font-semibold text-[#1a0e08] mb-1.5">
                          {input.label}
                          {' '}
                          <span className="text-[#FF5701]">*</span>
                        </label>
                        {input.type === 'textarea'
                          ? <textarea id={input.id} aria-label={input.label} rows={3} disabled={isMemberDrawer} value={draft.credentials[input.key] ?? ""} onChange={event => actions.onKeyInputChanged(input.key, event.target.value)} autoComplete="off" spellCheck={false} placeholder={placeholder} className={`key-input-field w-full text-xs font-mono px-3 py-2 bg-[#F8F4EE] border border-[#E8E0D6] rounded-lg text-[#1a0e08] focus:bg-white focus:v3-outline-none focus:border-[#FF5701] transition-all resize-y${locked}`} />
                          : <input type={input.type} id={input.id} aria-label={input.label} disabled={isMemberDrawer} value={draft.credentials[input.key] ?? ""} onChange={event => actions.onKeyInputChanged(input.key, event.target.value)} autoComplete="off" spellCheck={false} placeholder={placeholder} className={`key-input-field w-full text-xs sm:text-sm px-3 py-2 bg-[#F8F4EE] border border-[#E8E0D6] rounded-lg text-[#1a0e08] focus:bg-white focus:v3-outline-none focus:border-[#FF5701] transition-all${locked}${needsFormatValidation && fieldInvalid ? ' border-rose-400' : ''}`} />}
                        {needsFormatValidation ? (
                          <p id={`${input.id}-format-hint`} className={`${fieldInvalid ? '' : 'hidden '}text-[11px] text-[#DC2626] font-medium mt-1`}>
                            {input.formatHint}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
              {/* PHẦN 2: NƠI Planora ĐƯỢC PHÉP DÙNG */}
              <section aria-labelledby="section-scope-title" className="v3-space-y-4">
                <div className="border-b border-[#E8E0D6] pb-2">
                  <h3 id="section-scope-title" className="text-sm font-bold uppercase tracking-wider text-[#1a0e08] flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#1a0e08] text-white text-xs flex items-center justify-center font-bold">
                      2
                    </span>
                    <span>
                      Nơi Planora được phép dùng
                    </span>
                  </h3>
                  <p className="text-xs text-[#6A5F56] mt-1" id="scope-description-text">
                    {scopeLabel ? `Planora chỉ đọc và ghi ở những ${scopeLabel} trong danh sách này.` : 'Planora chỉ đọc và ghi ở những nơi trong danh sách này.'}
                  </p>
                </div>
                {/* Danh sách Chip các nơi được phép dùng, renderScopeChips */}
                <div>
                  <div id="scope-chips-container" className="flex flex-wrap gap-2 mb-3 min-h-[32px]">
                    {scope && scope.items.length === 0 ? (
                      <span className="text-xs text-[#6A5F56] italic py-1">{`Chưa có ${scope.scopeLabel} nào được cấp quyền.`}</span>
                    ) : scope?.items.map((item, idx) => (
                      <div key={`${idx}-${item}`} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs bg-[#F8F4EE] border border-[#E8E0D6] text-[#1a0e08] shadow-sm">
                        <span className="font-mono text-[11px] truncate max-w-[200px] sm:max-w-[260px]">{item}</span>
                        {!scope.isMember ? (
                          <button type="button" onClick={() => actions.removeScopeItem(idx)} className="text-[#6A5F56] hover:text-[#DC2626] transition-colors p-0.5 rounded-full hover:bg-neutral-200" aria-label={`Xoá mục ${item}`}>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <p id="scope-empty-error" className={`${scopeError.visible ? '' : 'hidden '}text-xs text-[#DC2626] font-medium mb-2`}>
                    {scopeError.text}
                  </p>
                </div>
                {/* Chọn nơi được dùng từ danh sách nhà cung cấp thay vì nhập ID */}
                {drawer.service.scopeCandidates && !isMemberDrawer ? (
                  <ScopeCandidatePicker serviceId={drawer.service.id} scopeLabel={scopeLabel ?? 'tài nguyên'} credentials={draft.credentials} selected={draft.scopes} onToggle={actions.toggleScopeValue} />
                ) : null}
                {/* Ô thêm mới nơi được phép dùng */}
                <div id="scope-add-form" className={`${isMemberDrawer ? 'hidden ' : ''}v3-space-y-1.5`}>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <label id="scope-input-label" htmlFor="new-scope-input" className="sr-only">
                        {scopeLabel ? `Thêm ${scopeLabel}` : 'Thêm mục mới'}
                      </label>
                      {' '}
                      <input type="text" id="new-scope-input" value={draft.newScope} onChange={event => actions.onScopeInputChanged(event.target.value)} disabled={isMemberDrawer} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); actions.addNewScopeItem(); } }} placeholder={scopeLabel ? `Nhập ${scopeLabel} mới (ví dụ)...` : 'Nhập ID mới...'} className={`w-full text-xs sm:text-sm px-3 py-2 bg-[#F8F4EE] border border-[#E8E0D6] rounded-lg text-[#1a0e08] focus:bg-white focus:v3-outline-none focus:border-[#FF5701] transition-all${newScopeInvalid ? ' border-rose-400' : ''}`} />
                    </div>
                    <button type="button" id="btn-add-scope" aria-label="Thêm" onClick={() => actions.addNewScopeItem()} className="px-3.5 py-2 text-xs sm:text-sm font-medium text-[#1a0e08] bg-[#F8F4EE] hover:bg-neutral-200 border border-[#E8E0D6] rounded-lg transition-colors flex-shrink-0">
                      {" + Thêm "}
                    </button>
                  </div>
                  <p id="new-scope-format-hint" className={`${newScopeInvalid ? '' : 'hidden '}text-[11px] text-[#DC2626] font-medium`}>
                    {drawer.service.scopeError}
                  </p>
                </div>
              </section>
              {/* KHỐI LƯU THAY ĐỔI (Trước khi kiểm tra) */}
              <div className="bg-[#F8F4EE] p-4 rounded-xl border border-[#E8E0D6] v3-space-y-3">
                <p className="text-xs text-[#51463E] leading-relaxed">
                  <strong className="text-[#1a0e08]">
                    Lưu ý khi cập nhật:
                  </strong>
                  {" Khi đổi khoá, nhập lại đủ các ô khoá bên trên. Chỉ đổi nơi được dùng thì không cần nhập lại khoá."}
                </p>
                <div id="save-validation-error" role="alert" className={`${saveError.visible ? '' : 'hidden '}text-xs text-[#DC2626] font-medium`}>
                  {saveError.text}
                </div>
                <button type="button" id="btn-save-service-changes" disabled={isMemberDrawer || !!busy[drawer.service.id]} onClick={() => void actions.saveServiceChanges()} className="ps-btn w-full">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                  </svg>
                  <span>
                    Lưu thay đổi
                  </span>
                </button>
              </div>
              {/* PHẦN 3: KIỂM TRA KẾT NỐI */}
              <section aria-labelledby="section-test-title" className="v3-space-y-4 pt-2 border-t border-[#E8E0D6]">
                <div className="border-b border-[#E8E0D6] pb-2">
                  <h3 id="section-test-title" className="text-sm font-bold uppercase tracking-wider text-[#1a0e08] flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#1a0e08] text-white text-xs flex items-center justify-center font-bold">
                      3
                    </span>
                    <span>
                      Kiểm tra kết nối
                    </span>
                  </h3>
                  <p className="text-xs text-[#6A5F56] mt-1">
                    Gửi một tín hiệu kiểm tra tới máy chủ dịch vụ để xác nhận khoá và quyền hạn vẫn hợp lệ.
                  </p>
                </div>
                {/* Nút bấm kiểm tra */}
                <div>
                  <button type="button" id="btn-run-test-connection" disabled={testButton.disabled} aria-describedby={!drawer.service.configured ? "test-unconfigured-note" : undefined} onClick={() => void actions.runTestConnection()} className={`w-full py-2.5 px-4 text-xs sm:text-sm font-semibold text-[#1a0e08] bg-white ${testButton.dim ? 'opacity-50 cursor-not-allowed' : 'hover:bg-neutral-50'} border border-[#E8E0D6] rounded-lg shadow-sm transition-all flex items-center justify-center gap-2`}>
                    {/* Icon hoặc Spinner */}
                    <svg id="test-btn-icon" className={`${testButton.spinning ? 'hidden ' : ''}w-4 h-4 text-[#FF5701]`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <svg id="test-btn-spinner" className={`${testButton.spinning ? '' : 'hidden '}w-4 h-4 animate-spin text-[#FF5701]`} fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span id="test-btn-text">
                      {testButton.spinning ? 'Đang kiểm tra kết nối...' : 'Kiểm tra kết nối'}
                    </span>
                  </button>
                  <p id="test-unconfigured-note" className={`${testButton.dim ? '' : 'hidden '}text-xs text-[#6A5F56] mt-1.5 leading-relaxed`}>
                    Lưu khoá và ít nhất một nơi được dùng trước, rồi mới kiểm tra được.
                  </p>
                </div>
                {/* Kết quả kiểm tra (aria-live="polite") */}
                <div id="test-result-box" className={`${result.kind ? RESULT[result.kind].box : 'p-3.5 rounded-xl border text-xs leading-relaxed'}${visibleResult ? '' : ' settings-result-empty'}`} aria-live="polite">
                  <div className="flex items-start gap-2.5">
                    <span id="test-result-icon" className="mt-0.5 flex-shrink-0">
                      {result.kind ? RESULT[result.kind].icon : null}
                    </span>
                    <div className="flex-1">
                      <p id="test-result-message" className="font-medium">
                        {result.message}
                      </p>
                      <p id="test-result-time" className="text-[11px] text-[#6A5F56] mt-0.5">
                        {result.time ? `Thời gian ghi nhận: ${result.time}` : null}
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </>}
  </>;
}
