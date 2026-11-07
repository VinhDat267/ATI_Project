// Planora SettingsPage (PL-08): Business-First UX v2.0
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
import { TrelloConnection } from './TrelloConnection';
import { GitHubConnection } from './GitHubConnection';
import { TelegramConnection } from './TelegramConnection';
import { JiraConnection } from './JiraConnection';
import { gmailConnectionNotice } from '../../services/gmail-connection';
import { trelloConnectionNotice } from '../../services/trello-connection';
import { githubConnectionNotice } from '../../services/github-connection';
import { telegramConnectionNotice } from '../../services/telegram-connection';
import { jiraConnectionNotice } from '../../services/jira-connection';
import { meta } from './meta';
import './page.css';

const SAVED_PLACEHOLDER = 'Đã lưu · nhập lại nếu muốn thay';
const WARNING_PATH =
  'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z';
const resultIcon = (color: string, d: string) => (
  <svg className={`w-4 h-4 ${color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={d} />
  </svg>
);
const RESULT = {
  saved: {
    box: 'p-3.5 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 text-xs leading-relaxed',
    icon: resultIcon('text-amber-600', WARNING_PATH),
  },
  success: {
    box: 'p-3.5 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 text-xs leading-relaxed',
    icon: resultIcon('text-[#16A34A]', 'M5 13l4 4L19 7'),
  },
  rejected: {
    box: 'p-3.5 rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200 text-xs leading-relaxed',
    icon: resultIcon('text-[#DC2626]', WARNING_PATH),
  },
  timeout: {
    box: 'p-3.5 rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200 text-xs leading-relaxed',
    icon: resultIcon('text-rose-600', 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'),
  },
};

function StatusBadge({ service }: { service: Service }) {
  const timeStr = service.lastCheckTime ? ` · kiểm tra lúc ${service.lastCheckTime}` : '';
  if (!service.configured) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--planora-surface-inset)] text-[var(--planora-muted)] border border-[var(--planora-divider)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--planora-muted)]" aria-hidden="true" />
        <span>{`Chưa kết nối${timeStr}`}</span>
      </span>
    );
  }
  if (service.statusType === 'untested') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden="true" />
        <span>{`Chưa kiểm tra${timeStr}`}</span>
      </span>
    );
  }
  if (service.statusType === 'ok') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
        <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" aria-hidden="true" />
        <span>{`Kết nối tốt${timeStr}`}</span>
      </span>
    );
  }
  if (service.statusType === 'failed') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
        <span className="w-1.5 h-1.5 rounded-full bg-[#DC2626]" aria-hidden="true" />
        <span>{`Không kết nối được${timeStr}`}</span>
      </span>
    );
  }
  return null;
}

function ServiceRow({ service, onOpen }: { service: Service; onOpen: (id: string) => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      id={`service-row-${service.id}`}
      onClick={() => onOpen(service.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(service.id);
        }
      }}
      className="group bg-[var(--planora-paper)] hover:bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] hover:border-[var(--planora-primary)] rounded-xl p-4 sm:p-5 transition-all shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--planora-primary)] focus-visible:v3-outline-none"
      aria-haspopup="dialog"
      aria-label={`${service.name} — bấm để xem chi tiết kết nối`}
    >
      <div className="flex items-start sm:items-center gap-3.5 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
          <ServiceLogo service={service.id} className="w-6 h-6" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-display font-semibold text-base text-[var(--planora-text)] group-hover:text-[var(--planora-primary)] transition-colors">
              {service.name}
            </h3>
          </div>
          <p className="text-xs text-[var(--planora-muted)] mt-0.5 line-clamp-1 sm:line-clamp-2">
            {service.capabilities}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between sm:justify-end gap-3 flex-shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-[var(--planora-divider)]">
        <div>
          <StatusBadge service={service} />
        </div>
        <div className="text-[var(--planora-muted)] group-hover:text-[var(--planora-primary)] transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </div>
  );
}

export interface SettingsPageProps {
  user: User | null;
  navigate: (path: string) => void;
  onLogout: () => void;
  authToken?: string | null;
}

export function SettingsPage({ user, navigate, onLogout }: SettingsPageProps) {
  usePrototypePage(meta);
  const [workspace, setWorkspace] = useState(getActiveWorkspaceSummary());
  useEffect(() => subscribeWorkspace(() => setWorkspace(getActiveWorkspaceSummary())), []);
  const {
    list,
    personal,
    personalMyCalendar,
    personalMySheets,
    active,
    draft,
    selected,
    loading,
    loadError,
    refresh,
    canEdit,
    errors,
    results,
    busy,
    keyHelpOpen,
    actions,
  } = useSettings(user);
  const [connectedEmail, setConnectedEmail] = useState<string>();

  useEffect(() => {
    const email = gmailConnectionNotice.take(user?.id);
    const trelloUser = trelloConnectionNotice.take(user?.id);
    const githubUser = githubConnectionNotice.take(user?.id);
    const telegramUser = telegramConnectionNotice.take(user?.id);
    const jiraUser = jiraConnectionNotice.take(user?.id);
    if (email) setConnectedEmail(email);
    else if (trelloUser) setConnectedEmail(`@${trelloUser}`);
    else if (githubUser) setConnectedEmail(`@${githubUser}`);
    else if (telegramUser) setConnectedEmail(`@${telegramUser}`);
    else if (jiraUser) setConnectedEmail(jiraUser);
  }, [user?.id]);

  const backgroundRef = useRef<HTMLDivElement>(null),
    containerRef = useRef<HTMLDivElement>(null),
    closeButtonRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(actions.closeServiceDrawer);
  closeRef.current = actions.closeServiceDrawer;

  useLayoutEffect(() => {
    if (!active || !containerRef.current) return;
    const id = active.id,
      dialog = containerRef.current,
      background = backgroundRef.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    background?.setAttribute('inert', '');
    background?.setAttribute('aria-hidden', 'true');
    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.closest('.hidden,[hidden]'));
    const focusFirst = () => (closeButtonRef.current ?? dialog).focus();
    focusFirst();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const elements = focusable(),
        first = elements[0],
        last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const focusin = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) focusFirst();
    };
    window.addEventListener('keydown', keydown);
    document.addEventListener('focusin', focusin);
    return () => {
      window.removeEventListener('keydown', keydown);
      document.removeEventListener('focusin', focusin);
      document.body.style.overflow = overflow;
      background?.removeAttribute('inert');
      background?.removeAttribute('aria-hidden');
      document.getElementById(`service-row-${id}`)?.focus();
    };
  }, [active?.id]);

  const drawer = active ? { service: active } : null,
    badge = active;
  const configured = list.filter((s) => s.configured),
    unconfigured = list.filter((s) => !s.configured),
    okCount = configured.filter((s) => s.statusType === 'ok').length;
  const hasCatalogue = list.length > 0;
  const totalServices = list.length;
  const isMemberDrawer = !canEdit,
    scopeLabel = active?.scopeLabel;
  const scope = draft
    ? { items: draft.scopes, isMember: isMemberDrawer, scopeLabel: scopeLabel ?? 'tài nguyên' }
    : null;
  const savedPlaceholder = !!active?.configured,
    hint = { visible: !!active?.hint, text: active?.hint };
  const saveError = { visible: !!errors[selected ?? ''], text: errors[selected ?? ''] };
  const scopeError = {
    visible: !!draft && draft.scopes.length === 0,
    text: `Cần ít nhất một ${scopeLabel}.`,
  };
  const newScopeInvalid =
    !!active?.scopePattern && !!errors[active.id]?.startsWith('Định dạng');
  const testButton = {
    disabled: !active?.configured || !!busy[selected ?? ''],
    dim: !active?.configured,
    spinning: busy[selected ?? ''] === 'test',
  };
  const result = results[selected ?? ''] ?? { kind: null, visible: false, message: '', time: '' };
  const visibleResult = !!results[selected ?? ''];

  return (
    <>
      <div
        data-cockpit-background
        ref={backgroundRef}
        className="contents"
        onClick={(event) => {
          const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
          if (
            anchor &&
            anchor.origin === window.location.origin &&
            !anchor.target &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.shiftKey &&
            !event.altKey
          ) {
            event.preventDefault();
            navigate(`${anchor.pathname}${anchor.search}${anchor.hash}`);
          }
        }}
      >
        <MainNav
          user={user}
          current="settings"
          pageName="Kết nối dịch vụ"
          navigate={navigate}
          onLogout={onLogout}
        />

        {/* NỘI DUNG CHÍNH */}
        <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-8 sm:py-10">
          {/* Tiêu đề trang & Nguyên tắc */}
          <div className="mb-8 sm:mb-10">
            {/* Context Pill */}
            <div className="mb-4 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl border border-[var(--planora-divider)] bg-[var(--planora-paper)] text-xs text-[var(--planora-text)] shadow-xs">
              {workspace.id === 'personal' ? (
                <svg aria-hidden="true" className="w-3.5 h-3.5 text-[var(--planora-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              ) : (
                <svg aria-hidden="true" className="w-3.5 h-3.5 text-[var(--planora-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              )}
              <span className="font-semibold text-[var(--planora-text)]">
                {workspace.id === 'personal'
                  ? 'Đang cấu hình kết nối cho: Không gian Cá nhân'
                  : `Đang cấu hình kết nối cho: ${workspace.name}`}
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 mb-3">
              <h1 className="font-display text-3xl sm:text-4xl font-bold text-[var(--planora-text)] tracking-tight">
                Kết nối dịch vụ
              </h1>
              {hasCatalogue && (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#16A34A]" aria-hidden="true" />
                    <span
                      id="summary-connected-count"
                      className="text-sm sm:text-base font-semibold text-[var(--planora-text)]"
                    >
                      {`${configured.length} / ${totalServices} dịch vụ đã thiết lập · ${okCount} kết nối tốt`}
                    </span>
                  </div>
                  <span
                    data-testid="settings-oauth-summary"
                    className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                  >
                    OAuth 1-Click cá nhân &amp; Tích hợp Workspace
                  </span>
                </div>
              )}
            </div>

            {/* Khung nguyên tắc an toàn dữ liệu */}
            <div className="bg-[var(--planora-paper)] rounded-xl p-4 sm:p-5 border border-[var(--planora-divider)] shadow-xs flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-[var(--planora-primary)]/10 text-[var(--planora-primary)] flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
              </div>
              <div className="text-xs sm:text-sm text-[var(--planora-muted)] leading-relaxed">
                <strong className="text-[var(--planora-text)] font-semibold">
                  Nguyên tắc an toàn của nhóm:
                </strong>
                {' Planora chỉ đọc và ghi ở những nơi bạn chọn bên dưới. Khoá được mã hoá khi lưu và không hiển thị lại.'}
              </div>
            </div>
          </div>

          {loading && (
            <p role="status" className="text-xs text-[var(--planora-muted)]">
              Đang tải dịch vụ...
            </p>
          )}

          {loadError && (
            <div role="alert" className="text-xs text-[var(--planora-error-text,#DC2626)] mb-4">
              {loadError}{' '}
              <button type="button" onClick={() => void refresh()} className="underline font-medium">
                Thử lại
              </button>
            </div>
          )}

          {connectedEmail && (
            <p role="status" className="text-sm font-medium text-[var(--planora-text)] mb-4">
              Đã kết nối {connectedEmail}
            </p>
          )}

          {/* NHÓM 1: CỦA RIÊNG BẠN (OAuth cá nhân 1-click) */}
          <section aria-labelledby="heading-personal-services" className="mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 mb-3.5">
              <h2
                id="heading-personal-services"
                className="text-xs font-bold uppercase tracking-wider text-[var(--planora-muted)]"
              >
                Của riêng bạn
              </h2>
              <span className="text-xs text-[var(--planora-muted)]">
                Tài khoản Cá nhân (OAuth 1-Click) · Chọn tài nguyên trực quan
              </span>
            </div>
            <div className="v3-space-y-4">
              {personal && (
                <PersonalGmail
                  key={`gmail-${user?.id}`}
                  selected={selected}
                  service={personal}
                  refresh={refresh}
                  standalone={false}
                />
              )}
              {personalMyCalendar && (
                <PersonalMyCalendar
                  key={`mycalendar-${user?.id}`}
                  selected={selected}
                  service={personalMyCalendar}
                  refresh={refresh}
                  navigate={navigate}
                  standalone={false}
                />
              )}
              {personalMySheets && (
                <PersonalMySheets
                  key={`mysheets-${user?.id}`}
                  selected={selected}
                  service={personalMySheets}
                  refresh={refresh}
                  navigate={navigate}
                  standalone={false}
                />
              )}
              <TrelloConnection
                key={`trello-${user?.id}`}
                user={user}
                selected={selected}
                refresh={refresh}
                standalone={false}
              />
              <GitHubConnection
                key={`github-${user?.id}`}
                user={user}
                selected={selected}
                refresh={refresh}
                standalone={false}
              />
              <TelegramConnection
                key={`telegram-${user?.id}`}
                user={user}
                selected={selected}
                refresh={refresh}
                navigate={navigate}
                standalone={false}
              />
              <JiraConnection
                key={`jira-${user?.id}`}
                user={user}
                selected={selected}
                refresh={refresh}
                navigate={navigate}
                standalone={false}
              />
            </div>
          </section>

          {/* NHÓM 2 & 3: DỊCH VỤ DÙNG CHUNG CỦA TỔ CHỨC */}
          {hasCatalogue && (
            <div className="v3-space-y-8 sm:v3-space-y-10">
              {/* Nhóm Đã thiết lập */}
              <section aria-labelledby="heading-connected-services">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 mb-3.5">
                  <h2
                    id="heading-connected-services"
                    className="text-xs font-bold uppercase tracking-wider text-[var(--planora-muted)] flex items-center gap-2 whitespace-nowrap"
                  >
                    <span>Đã thiết lập</span>
                    <span
                      id="badge-count-connected"
                      className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                    >
                      {configured.length}
                    </span>
                  </h2>
                  <span className="text-xs text-[var(--planora-muted)]">
                    Bấm vào hàng để xem hoặc đổi nơi được dùng
                  </span>
                </div>
                <div id="list-connected-services" className="v3-space-y-3" role="list">
                  {configured.length === 0 ? (
                    <div
                      role="listitem"
                      className="p-6 text-center text-xs text-[var(--planora-muted)] bg-[var(--planora-paper)] rounded-xl border border-[var(--planora-divider)]"
                    >
                      Chưa có dịch vụ nào được thiết lập.
                    </div>
                  ) : (
                    configured.map((s) => (
                      <div key={s.id} role="listitem">
                        <ServiceRow service={s} onOpen={actions.openServiceDrawer} />
                      </div>
                    ))
                  )}
                </div>
              </section>

              {/* Nhóm Chưa thiết lập */}
              <section aria-labelledby="heading-unconnected-services">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 mb-3.5">
                  <h2
                    id="heading-unconnected-services"
                    className="text-xs font-bold uppercase tracking-wider text-[var(--planora-muted)] flex items-center gap-2 whitespace-nowrap"
                  >
                    <span>Chưa thiết lập</span>
                    <span
                      id="badge-count-unconnected"
                      className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--planora-surface-inset)] text-[var(--planora-muted)] border border-[var(--planora-divider)]"
                    >
                      {unconfigured.length}
                    </span>
                  </h2>
                  <span className="text-xs text-[var(--planora-muted)]">
                    Bấm để thêm khoá truy cập và kích hoạt
                  </span>
                </div>
                <div id="list-unconnected-services" className="v3-space-y-3" role="list">
                  {unconfigured.length === 0 ? (
                    <div
                      role="listitem"
                      className="p-6 text-center text-xs text-[var(--planora-muted)] bg-[var(--planora-paper)] rounded-xl border border-[var(--planora-divider)]"
                    >
                      Tất cả {totalServices} dịch vụ đều đã được thiết lập.
                    </div>
                  ) : (
                    unconfigured.map((s) => (
                      <div key={s.id} role="listitem">
                        <ServiceRow service={s} onOpen={actions.openServiceDrawer} />
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          )}

          {/* Chú thích chân trang */}
          <div className="mt-12 pt-6 border-t border-[var(--planora-divider)] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[var(--planora-muted)]">
            <div>
              <p>Planora — Nền tảng điều phối công việc liên dịch vụ · 2026</p>
              <p className="text-[11px] text-[var(--planora-muted)] mt-0.5">
                {personal
                  ? 'Dịch vụ dùng chung: chỉ quản trị viên cập nhật khoá. OAuth 1-Click cá nhân (Gmail, Calendar, Sheets, Trello, GitHub, Telegram) do mỗi người tự kết nối.'
                  : 'Khoá dịch vụ là tài nguyên dùng chung của cả nhóm · Chỉ quản trị viên có quyền cập nhật'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <a href="/" className="hover:text-[var(--planora-text)] transition-colors">
                Không gian làm việc
              </a>
              <a href="/guide" className="hover:text-[var(--planora-text)] transition-colors">
                Cẩm nang
              </a>
              <a
                href="/privacy"
                className="text-[var(--planora-primary)] hover:underline font-medium transition-colors"
              >
                Chính sách an toàn &amp; Dữ liệu
              </a>
            </div>
          </div>
        </main>
      </div>

      {/* DRAWER DIALOG CHI TIẾT DỊCH VỤ */}
      {drawer && draft && (
        <div
          ref={containerRef}
          tabIndex={-1}
          id="service-drawer-container"
          className="fixed inset-0 z-50 overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="drawer-service-title"
        >
          {/* Backdrop */}
          <div
            id="drawer-backdrop"
            className="drawer-backdrop fixed inset-0 bg-black/40 opacity-100 transition-opacity"
            onClick={() => actions.closeServiceDrawer()}
          />

          <div className="fixed inset-y-0 right-0 max-w-full flex">
            <div
              id="drawer-panel"
              className="drawer-panel w-screen sm:max-w-xl bg-[var(--planora-paper)] shadow-2xl flex flex-col translate-x-0 border-l border-[var(--planora-divider)] transition-transform"
            >
              {/* Header drawer */}
              <div className="px-5 sm:px-6 py-4 border-b border-[var(--planora-divider)] flex items-center justify-between gap-3 bg-[var(--planora-surface-inset)]">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    id="drawer-icon-container"
                    className="w-10 h-10 rounded-xl bg-[var(--planora-paper)] border border-[var(--planora-divider)] flex items-center justify-center flex-shrink-0 shadow-xs"
                  >
                    <ServiceLogo service={drawer.service.id} className="w-6 h-6" />
                  </div>
                  <div className="min-w-0">
                    <h2
                      id="drawer-service-title"
                      className="font-display text-xl font-bold text-[var(--planora-text)] truncate"
                    >
                      {drawer.service.name}
                    </h2>
                    <div id="drawer-header-status-badge" className="mt-0.5">
                      {badge ? <StatusBadge service={badge} /> : null}
                    </div>
                  </div>
                </div>
                <button
                  ref={closeButtonRef}
                  type="button"
                  id="btn-close-drawer"
                  onClick={() => actions.closeServiceDrawer()}
                  className="p-2 text-[var(--planora-muted)] hover:text-[var(--planora-text)] rounded-lg hover:bg-[var(--planora-divider)] transition-colors"
                  aria-label="Đóng ngăn chi tiết"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Cảnh báo thành viên thường */}
              <div
                id="drawer-member-warning"
                className={`${isMemberDrawer ? '' : 'hidden '}px-5 sm:px-6 py-2.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2`}
              >
                <svg
                  className="w-4 h-4 text-amber-600 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <span>
                  {'Chỉ quản trị viên thay đổi được khoá dùng chung của nhóm. Bạn vẫn có thể bấm '}
                  <strong>Kiểm tra kết nối</strong>
                  {' ở mục 3.'}
                </span>
              </div>

              {/* Thân ngăn chi tiết (Cuộn dọc) */}
              <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-6 v3-space-y-8" id="drawer-body">
                {/* PHẦN 1: KHOÁ TRUY CẬP */}
                <section aria-labelledby="section-keys-title" className="v3-space-y-4">
                  <div className="flex items-center justify-between gap-2 border-b border-[var(--planora-divider)] pb-2">
                    <h3
                      id="section-keys-title"
                      className="text-sm font-bold uppercase tracking-wider text-[var(--planora-text)] flex items-center gap-2"
                    >
                      <span className="w-5 h-5 rounded-full bg-[var(--planora-text)] text-[var(--planora-paper)] text-xs flex items-center justify-center font-bold">
                        1
                      </span>
                      <span>Khoá truy cập</span>
                    </h3>
                    <button
                      type="button"
                      id="btn-toggle-key-help"
                      aria-expanded={keyHelpOpen}
                      aria-controls="key-help-box"
                      onClick={() => actions.toggleKeyHelp()}
                      className="text-xs text-[var(--planora-primary)] hover:underline font-medium inline-flex items-center gap-1"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      <span>Lấy khoá ở đâu?</span>
                    </button>
                  </div>

                  {/* Hướng dẫn Lấy khoá */}
                  <div
                    id="key-help-box"
                    className={`${keyHelpOpen ? '' : 'hidden '}bg-[var(--planora-surface-inset)] p-3.5 rounded-xl border border-[var(--planora-divider)] text-xs text-[var(--planora-muted)] leading-relaxed`}
                  >
                    <p id="key-help-text">
                      {drawer ? drawer.service.keyHelp : 'Hướng dẫn lấy khoá...'}
                    </p>
                    <div className="mt-2.5 pt-2 border-t border-[var(--planora-divider)]">
                      <a
                        id="key-help-guide-link"
                        href={drawer.service.guideUrl ?? '/guide'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--planora-primary)] hover:underline"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                          />
                        </svg>
                        <span>Mở hướng dẫn chính thức của dịch vụ →</span>
                      </a>
                    </div>
                  </div>

                  {/* Gợi ý riêng của dịch vụ */}
                  <div
                    id="service-specific-hint"
                    className={`${hint.visible ? '' : 'hidden '}text-xs text-[var(--planora-muted)] italic bg-blue-50/70 dark:bg-blue-950/30 p-2.5 rounded-lg border border-blue-100 dark:border-blue-900 flex items-center gap-2 text-blue-900 dark:text-blue-300`}
                  >
                    <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <span id="service-specific-hint-text">{hint.text}</span>
                  </div>

                  {/* Các ô nhập khoá */}
                  <div id="drawer-key-fields" className="v3-space-y-3.5">
                    {drawer?.service.keyInputs.map((input) => {
                      const needsFormatValidation = !!input.pattern;
                      const fieldInvalid =
                        !!input.pattern &&
                        !!draft.credentials[input.key] &&
                        !new RegExp(input.pattern).test(draft.credentials[input.key]);
                      const placeholder = savedPlaceholder ? SAVED_PLACEHOLDER : input.placeholder;
                      const locked = isMemberDrawer ? ' bg-[var(--planora-surface-inset)] cursor-not-allowed' : '';
                      return (
                        <div key={input.id}>
                          <label
                            htmlFor={input.id}
                            className="block text-xs font-semibold text-[var(--planora-text)] mb-1.5"
                          >
                            {input.label} <span className="text-[var(--planora-primary)]">*</span>
                          </label>
                          {input.type === 'textarea' ? (
                            <textarea
                              id={input.id}
                              aria-label={input.label}
                              rows={3}
                              disabled={isMemberDrawer}
                              value={draft.credentials[input.key] ?? ''}
                              onChange={(event) =>
                                actions.onKeyInputChanged(input.key, event.target.value)
                              }
                              autoComplete="off"
                              spellCheck={false}
                              placeholder={placeholder}
                              className={`key-input-field w-full text-xs font-mono px-3 py-2 bg-[var(--planora-surface-inset)] border border-[var(--planora-border-strong)] rounded-lg text-[var(--planora-text)] focus:bg-[var(--planora-paper)] focus:v3-outline-none focus:border-[var(--planora-primary)] transition-all resize-y${locked}`}
                            />
                          ) : (
                            <input
                              type={input.type}
                              id={input.id}
                              aria-label={input.label}
                              disabled={isMemberDrawer}
                              value={draft.credentials[input.key] ?? ''}
                              onChange={(event) =>
                                actions.onKeyInputChanged(input.key, event.target.value)
                              }
                              autoComplete="off"
                              spellCheck={false}
                              placeholder={placeholder}
                              className={`key-input-field w-full text-xs sm:text-sm px-3 py-2 bg-[var(--planora-surface-inset)] border border-[var(--planora-border-strong)] rounded-lg text-[var(--planora-text)] focus:bg-[var(--planora-paper)] focus:v3-outline-none focus:border-[var(--planora-primary)] transition-all${locked}${
                                needsFormatValidation && fieldInvalid ? ' border-rose-400' : ''
                              }`}
                            />
                          )}
                          {needsFormatValidation ? (
                            <p
                              id={`${input.id}-format-hint`}
                              className={`${
                                fieldInvalid ? '' : 'hidden '
                              }text-[11px] text-[#DC2626] font-medium mt-1`}
                            >
                              {input.formatHint}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* PHẦN 2: NƠI ĐƯỢC PHÉP DÙNG */}
                <section aria-labelledby="section-scope-title" className="v3-space-y-4">
                  <div className="border-b border-[var(--planora-divider)] pb-2">
                    <h3
                      id="section-scope-title"
                      className="text-sm font-bold uppercase tracking-wider text-[var(--planora-text)] flex items-center gap-2"
                    >
                      <span className="w-5 h-5 rounded-full bg-[var(--planora-text)] text-[var(--planora-paper)] text-xs flex items-center justify-center font-bold">
                        2
                      </span>
                      <span>Nơi Planora được phép dùng</span>
                    </h3>
                    <p className="text-xs text-[var(--planora-muted)] mt-1" id="scope-description-text">
                      {`Planora chỉ đọc và ghi ở những ${scopeLabel ?? (scope?.scopeLabel ?? 'tài nguyên')} trong danh sách này.`}
                    </p>
                  </div>

                  <div>
                    <div id="scope-chips-container" className="flex flex-wrap gap-2 mb-3 min-h-[32px]">
                      {scope && scope.items.length === 0 ? (
                        <span className="text-xs text-[var(--planora-muted)] italic py-1">{`Chưa có ${scope.scopeLabel} nào được cấp quyền.`}</span>
                      ) : (
                        scope?.items.map((item, idx) => (
                          <div
                            key={`${idx}-${item}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs bg-[var(--planora-surface-inset)] border border-[var(--planora-divider)] text-[var(--planora-text)] shadow-xs"
                          >
                            <span className="font-mono text-[11px] truncate max-w-[200px] sm:max-w-[260px]">
                              {item}
                            </span>
                            {!scope.isMember ? (
                              <button
                                type="button"
                                onClick={() => actions.removeScopeItem(idx)}
                                className="text-[var(--planora-muted)] hover:text-[#DC2626] transition-colors p-0.5 rounded-full hover:bg-[var(--planora-divider)]"
                                aria-label={`Xoá mục ${item}`}
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>
                    <p
                      id="scope-empty-error"
                      className={`${scopeError.visible ? '' : 'hidden '}text-xs text-[#DC2626] font-medium mb-2`}
                    >
                      {scopeError.text}
                    </p>
                  </div>

                  {/* Form thêm nơi được dùng */}
                  <div id="scope-add-form" className={`${isMemberDrawer ? 'hidden ' : ''}v3-space-y-1.5`}>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <label id="scope-input-label" htmlFor="new-scope-input" className="sr-only">
                          {scopeLabel ? `Thêm ${scopeLabel}` : 'Thêm mục mới'}
                        </label>
                        <input
                          type="text"
                          id="new-scope-input"
                          value={draft.newScope}
                          onChange={(event) => actions.onScopeInputChanged(event.target.value)}
                          disabled={isMemberDrawer}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              actions.addNewScopeItem();
                            }
                          }}
                          placeholder={scopeLabel ? `Nhập ${scopeLabel} mới (ví dụ)...` : 'Nhập ID mới...'}
                          className={`w-full text-xs sm:text-sm px-3 py-2 bg-[var(--planora-surface-inset)] border border-[var(--planora-border-strong)] rounded-lg text-[var(--planora-text)] focus:bg-[var(--planora-paper)] focus:v3-outline-none focus:border-[var(--planora-primary)] transition-all${
                            newScopeInvalid ? ' border-rose-400' : ''
                          }`}
                        />
                      </div>
                      <button
                        type="button"
                        id="btn-add-scope"
                        aria-label="Thêm"
                        onClick={() => actions.addNewScopeItem()}
                        className="px-3.5 py-2 text-xs sm:text-sm font-medium text-[var(--planora-text)] bg-[var(--planora-surface-inset)] hover:bg-[var(--planora-divider)] border border-[var(--planora-border-strong)] rounded-lg transition-colors flex-shrink-0"
                      >
                        {' + Thêm '}
                      </button>
                    </div>
                    <p
                      id="new-scope-format-hint"
                      className={`${newScopeInvalid ? '' : 'hidden '}text-[11px] text-[#DC2626] font-medium`}
                    >
                      {drawer.service.scopeError}
                    </p>
                  </div>
                </section>

                {/* KHỐI LƯU THAY ĐỔI */}
                <div className="bg-[var(--planora-surface-inset)] p-4 rounded-xl border border-[var(--planora-divider)] v3-space-y-3">
                  <p className="text-xs text-[var(--planora-muted)] leading-relaxed">
                    <strong className="text-[var(--planora-text)]">Lưu ý khi cập nhật:</strong>
                    {' Khi đổi khoá, nhập lại đủ các ô khoá bên trên. Chỉ đổi nơi được dùng thì không cần nhập lại khoá.'}
                  </p>
                  <div
                    id="save-validation-error"
                    role="alert"
                    className={`${saveError.visible ? '' : 'hidden '}text-xs text-[#DC2626] font-medium`}
                  >
                    {saveError.text}
                  </div>
                  <button
                    type="button"
                    id="btn-save-service-changes"
                    disabled={isMemberDrawer || !!busy[drawer.service.id]}
                    onClick={() => void actions.saveServiceChanges()}
                    className={`w-full py-2.5 px-4 text-xs sm:text-sm font-semibold text-[var(--planora-on-primary)] bg-[var(--planora-primary)] hover:bg-[var(--planora-primary-hover)] rounded-lg shadow-xs transition-colors flex items-center justify-center gap-2${
                      isMemberDrawer ? ' opacity-50 cursor-not-allowed' : ''
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Lưu thay đổi</span>
                  </button>
                </div>

                {/* PHẦN 3: KIỂM TRA KẾT NỐI */}
                <section aria-labelledby="section-test-title" className="v3-space-y-4 pt-2 border-t border-[var(--planora-divider)]">
                  <div className="border-b border-[var(--planora-divider)] pb-2">
                    <h3
                      id="section-test-title"
                      className="text-sm font-bold uppercase tracking-wider text-[var(--planora-text)] flex items-center gap-2"
                    >
                      <span className="w-5 h-5 rounded-full bg-[var(--planora-text)] text-[var(--planora-paper)] text-xs flex items-center justify-center font-bold">
                        3
                      </span>
                      <span>Kiểm tra kết nối</span>
                    </h3>
                    <p className="text-xs text-[var(--planora-muted)] mt-1">
                      Gửi một tín hiệu kiểm tra tới máy chủ dịch vụ để xác nhận khoá và quyền hạn vẫn hợp lệ.
                    </p>
                  </div>

                  <div>
                    <button
                      type="button"
                      id="btn-run-test-connection"
                      disabled={testButton.disabled}
                      aria-describedby={!drawer.service.configured ? 'test-unconfigured-note' : undefined}
                      onClick={() => void actions.runTestConnection()}
                      className={`w-full py-2.5 px-4 text-xs sm:text-sm font-semibold text-[var(--planora-text)] bg-[var(--planora-paper)] ${
                        testButton.dim ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[var(--planora-surface-inset)]'
                      } border border-[var(--planora-border-strong)] rounded-lg shadow-xs transition-all flex items-center justify-center gap-2`}
                    >
                      <svg
                        id="test-btn-icon"
                        className={`${testButton.spinning ? 'hidden ' : ''}w-4 h-4 text-[var(--planora-primary)]`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <svg
                        id="test-btn-spinner"
                        className={`${testButton.spinning ? '' : 'hidden '}w-4 h-4 animate-spin text-[var(--planora-primary)]`}
                        fill="none"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      <span id="test-btn-text">
                        {testButton.spinning ? 'Đang kiểm tra kết nối...' : 'Kiểm tra kết nối'}
                      </span>
                    </button>
                    <p
                      id="test-unconfigured-note"
                      className={`${testButton.dim ? '' : 'hidden '}text-xs text-[var(--planora-muted)] mt-1.5 leading-relaxed`}
                    >
                      Lưu khoá và ít nhất một nơi được dùng trước, rồi mới kiểm tra được.
                    </p>
                  </div>

                  {/* Kết quả kiểm tra (aria-live="polite") */}
                  <div
                    id="test-result-box"
                    className={`${
                      result.kind ? RESULT[result.kind].box : 'p-3.5 rounded-xl border text-xs leading-relaxed'
                    }${visibleResult ? '' : ' settings-result-empty'}`}
                    aria-live="polite"
                  >
                    <div className="flex items-start gap-2.5">
                      <span id="test-result-icon" className="mt-0.5 flex-shrink-0">
                        {result.kind ? RESULT[result.kind].icon : null}
                      </span>
                      <div className="flex-1">
                        <p id="test-result-message" className="font-medium">
                          {result.message}
                        </p>
                        <p id="test-result-time" className="text-[11px] text-[var(--planora-muted)] mt-0.5">
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
      )}
    </>
  );
}
export default SettingsPage;
