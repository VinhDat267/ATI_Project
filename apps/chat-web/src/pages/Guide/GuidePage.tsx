// Chuyển từ docs/design/prototypes/guide.html bằng scripts/html-to-jsx.mjs, sau đó sửa tay.
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { MainNav } from '../../components/layout/MainNav';
import { ThemeToggle } from '../../prototype/ThemeToggle';
import { PlanoraMark } from '../../components/PlanoraMark';
import { usePrototypePage, type PageMeta } from '../../prototype/usePrototypePage';
import { ServiceLogo } from '../../components/ServiceLogo';
import { WorkflowFlowCanvas } from '../../components/WorkflowFlowCanvas';
import type { User } from '../../types';
import css from './page.css?inline';
import { useGmailEnabled, useMyCalendarEnabled, useMySheetsEnabled } from '../../hooks/use-gmail-enabled';
import { useSchedulesEnabled } from '../../hooks/use-schedules';
import { GMAIL_GUIDE, GMAIL_PROMPTS, GMAIL_CAPABILITY } from './gmail-data';
import { MYSHEETS_GUIDE, MYSHEETS_PROMPTS, MYSHEETS_SCHEDULE_PROMPT, MYSHEETS_CAPABILITY } from './mysheets-data';
import { CAPABILITIES_DATA as BASE_CAPABILITIES, GITHUB_OAUTH_PROMPTS, MYCALENDAR_PROMPTS, capabilitiesForRuntime, SAMPLE_PROMPTS as BASE_PROMPTS, SERVICE_GUIDES as BASE_GUIDES, SERVICE_SVGS, GUIDE_HERO_FLOW_SERVICES, GUIDE_OAUTH_SHOWCASE_CARDS, type ServiceGuide } from './data';

const SERVICE_GUIDES = BASE_GUIDES, SAMPLE_PROMPTS = BASE_PROMPTS, CAPABILITIES_DATA = BASE_CAPABILITIES;
type MainTab = 'keys' | 'prompts' | 'capabilities';
type Toast = { id: number; message: string; fading: boolean };
const TAB_CLS = 'main-tab-btn inline-flex items-center gap-2 whitespace-nowrap';
const CAT_CLS = 'cat-filter-btn whitespace-nowrap';

type Navigate = (path: string) => void;
function appLink(navigate: Navigate, path: string) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(path);
  };
}

// ?tab= và ?service= như DOMContentLoaded của guide.html.
function initialTab(): MainTab {
  const tab = new URLSearchParams(window.location.search).get('tab');
  return tab === 'prompts' || tab === 'capabilities' || tab === 'keys' ? tab : 'keys';
}
const DEFAULT_SERVICE = Object.keys(SERVICE_GUIDES)[0]!;
function initialService() {
  const service = new URLSearchParams(window.location.search).get('service');
  return service && SERVICE_GUIDES[service] ? service : DEFAULT_SERVICE;
}

// Phân khu 1: chi tiết hướng dẫn lấy khoá của một dịch vụ (renderServiceGuideDetail).
function ServiceGuideDetail({ serviceId, navigate, guides = SERVICE_GUIDES }: { serviceId: string; navigate: Navigate; guides?: typeof SERVICE_GUIDES }) {
  const s = guides[serviceId];
  return <>
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[var(--ps-edge)]">
      <div className="flex items-center gap-3.5 min-w-0">
        <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
          {SERVICE_SVGS[serviceId] || <ServiceLogo service={serviceId} className="w-6 h-6" />}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="font-sans text-xl font-semibold text-[var(--ps-ink)]">{s.name}</h3>
            <span className="ps-status ps-status-neutral">{s.category}</span>
          </div>
          <p className="text-sm text-[var(--ps-muted)] mt-0.5 max-w-[70ch]">{s.summary}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <a href={`/settings#${s.id}`} onClick={appLink(navigate, `/settings#${s.id}`)} className="ps-btn-quiet" title={`Kết nối ${s.name}`}>
          <span>{s.id === 'mysheets' ? 'Kết nối Google Sheets →' : `Kết nối ${s.name} →`}</span>
        </a>
      </div>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="p-3.5 rounded-xl bg-[var(--ps-sheet)] border border-[var(--ps-edge)]">
        <div className="text-[13px] text-[var(--ps-faint)] font-medium">Phương thức kết nối:</div>
        <div className="font-medium text-sm text-[var(--ps-ink)] mt-1 flex flex-wrap items-center gap-1.5">
          {['gmail', 'mysheets'].includes(s.id) && <span>Google OAuth · không nhập khoá</span>}
          {s.keys.map(k => <span key={k} className="bg-[var(--ps-panel)] px-2 py-0.5 rounded border border-[var(--ps-edge)] text-[13px] text-[var(--ps-ink)]">{k}</span>)}
        </div>
      </div>
      <div className="p-3.5 rounded-xl bg-[var(--ps-sheet)] border border-[var(--ps-edge)] min-w-0">
        <div className="text-[13px] text-[var(--ps-faint)] font-medium">Nơi Planora được phép dùng</div>
        <div className="font-medium text-sm text-[var(--ps-ink)] mt-1 flex flex-wrap items-center gap-1.5 min-w-0">
          <span className="bg-[var(--ps-panel)] px-2 py-0.5 rounded border border-[var(--ps-edge)] text-[13px] text-[var(--ps-ink)]">{s.scopeLabel}</span>
          <span className="text-[13px] text-[var(--ps-faint)] font-normal truncate">{`(${s.sampleScope})`}</span>
        </div>
      </div>
      <div className="p-3.5 rounded-xl bg-[var(--ps-sheet)] border border-[var(--ps-edge)]">
        <div className="text-[13px] text-[var(--ps-faint)] font-medium">Thời gian hoàn thành</div>
        <div className="mt-1">
          <span className="ps-status ps-status-connected">{s.timeEstimate}</span>
        </div>
      </div>
    </div>
    <div className="p-4 rounded-xl bg-[var(--ps-sheet)] border border-[var(--ps-edge)] text-sm text-[var(--ps-muted)] flex items-start gap-2.5">
      <svg className="w-4 h-4 text-[var(--ps-accent-text)] flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
      <div className="max-w-[70ch]">
        <span className="font-semibold text-[var(--ps-ink)]">Lưu ý quan trọng cho người dùng:</span>{` ${s.importantNotice} `}
      </div>
    </div>
    <div className="v3-space-y-4 pt-2">
      <h4 className="text-sm font-semibold text-[var(--ps-ink)]">
        Các bước kết nối &amp; chọn phạm vi dữ liệu
      </h4>
      <div className="v3-space-y-3">
        {s.steps.map(st => (
          <div key={st.num} className="p-4 rounded-xl border border-[var(--ps-edge)] bg-[var(--ps-sheet)] flex items-start gap-3.5">
            <span className="w-6 h-6 rounded-full border border-[var(--ps-edge)] bg-[var(--ps-panel)] text-[var(--ps-ink)] flex items-center justify-center font-semibold text-xs flex-shrink-0 mt-0.5 tabular-nums">
              {st.num}
            </span>
            <div className="v3-space-y-1.5 flex-1 min-w-0 max-w-[70ch]">
              <div className="font-semibold text-sm text-[var(--ps-ink)]">{st.title}</div>
              {/* desc có thẻ <a>/<code> viết sẵn trong dữ liệu, chèn như innerHTML của bản mẫu. */}
              <div className="text-sm text-[var(--ps-muted)] leading-relaxed break-words" dangerouslySetInnerHTML={{ __html: st.desc }} />
              {st.tags ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {st.tags.map(t => <span key={t} className="px-2 py-0.5 rounded bg-[var(--ps-panel)] text-[var(--ps-muted)] font-mono text-xs border border-[var(--ps-edge)]">{t}</span>)}
                </div>
              ) : ''}
              {st.urlSample ? (
                <div className="p-2 rounded-lg bg-[var(--ps-panel)] border border-[var(--ps-edge)] text-[13px] font-mono text-[var(--ps-ink)] select-all break-all">
                  {st.urlSample}
                </div>
              ) : ''}
              {st.callout ? (
                <div className="text-[13px] text-[var(--ps-faint)] flex items-start gap-1.5 pt-0.5">
                  <svg className="w-3.5 h-3.5 text-[var(--ps-faint)] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <span>{st.callout}</span>
                </div>
              ) : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  </>;
}

const COPY_ICON = <svg className="w-3.5 h-3.5 text-[var(--ps-faint)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>;

// Phân khu 2: thẻ mẫu câu lệnh (renderPromptsList).
function PromptCard({ p, copied, onCopy, navigate }: { p: typeof SAMPLE_PROMPTS[number]; copied: boolean; onCopy: (id: string) => void; navigate: Navigate }) {
  const handleTryPrompt = () => {
    try {
      sessionStorage.setItem('ati_prefill_prompt', p.prompt);
    } catch {
      // ignore storage errors
    }
    if (typeof navigator.clipboard?.writeText === 'function') {
      onCopy(p.id);
    }
    navigate('/');
  };
  return <div className="ps-panel p-5 flex flex-col justify-between v3-space-y-4">
    <div className="v3-space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="ps-status ps-status-neutral">
          {p.categoryLabel}
        </span>
        {p.badge ? (
          <span className="text-[13px] font-medium text-[var(--ps-accent-text)]">
            {p.badge}
          </span>
        ) : ''}
      </div>
      <h4 className="font-sans font-semibold text-base text-[var(--ps-ink)] leading-snug">
        {` ${p.title} `}
      </h4>
      {p.services.length >= 2 && (
        <WorkflowFlowCanvas services={p.services} mode="preview" compact />
      )}
      <div className="p-3 rounded-xl bg-[var(--ps-sheet)] border border-[var(--ps-edge)] text-sm font-medium text-[var(--ps-ink)] leading-relaxed break-words">
        {` "${p.prompt}" `}
      </div>
      <div className="v3-space-y-1.5 pt-1">
        <div className="text-[13px] text-[var(--ps-faint)] font-medium">Công cụ tham gia</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-[var(--ps-muted)]">
          {p.services.map(sid => (
            <span key={sid} className="inline-flex items-center gap-1.5">
              <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">{SERVICE_SVGS[sid] || <ServiceLogo service={sid} className="w-4 h-4" />}</span>
              <span>{sid === 'gmail' ? 'Gmail' : sid === 'mysheets' ? 'Google Sheets' : SERVICE_GUIDES[sid]?.name || sid}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="v3-space-y-1 pt-2 border-t border-[var(--ps-edge)]">
        <div className="text-[13px] text-[var(--ps-faint)] font-semibold">Planora sẽ làm lần lượt sau khi bạn duyệt</div>
        <ul className="text-[13px] text-[var(--ps-muted)] v3-space-y-1 list-disc list-inside">
          {p.workflow.map(w => <li key={w} className="truncate">{w}</li>)}
        </ul>
      </div>
    </div>
    <div className="pt-3 border-t border-[var(--ps-edge)] flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={handleTryPrompt} className="ps-btn-quiet">
          <span>Dùng thử mẫu lệnh này →</span>
        </button>
        <button type="button" onClick={() => onCopy(p.id)} id={`copy-btn-${p.id}`} className="ps-btn-quiet">
          {copied ? <>
            <svg className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
            <span className="text-emerald-700 dark:text-emerald-400">Đã sao chép</span>
          </> : <>
            {COPY_ICON}
            <span>Sao chép câu lệnh</span>
          </>}
        </button>
      </div>
      <a
        href="/"
        onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          handleTryPrompt();
        }}
        className="text-[13px] font-semibold text-[var(--ps-accent-text)] hover:underline inline-flex items-center gap-1 py-1 min-h-[36px]"
      >
        <span>Thử trên sân khấu →</span>
      </a>
    </div>
  </div>;
}

// Phân khu 3: thẻ việc làm được / chưa làm được (renderCapabilitiesGrid).
function CapabilityCard({ c, navigate }: { c: typeof CAPABILITIES_DATA[number]; navigate: Navigate }) {
  return <div className="ps-panel p-5 sm:p-6 v3-space-y-4">
    <div className="flex items-center justify-between gap-3 pb-3 border-b border-[var(--ps-edge)]">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
          {SERVICE_SVGS[c.id] || <ServiceLogo service={c.id} className="w-6 h-6" />}
        </div>
        <div className="min-w-0">
          <h4 className="font-semibold text-base text-[var(--ps-ink)]">{c.name}</h4>
          <div className="text-[13px] text-[var(--ps-faint)] truncate">{c.role}</div>
        </div>
      </div>
      <a href={`/settings#${c.id}`} onClick={appLink(navigate, `/settings#${c.id}`)} className="text-[13px] text-[var(--ps-accent-text)] font-semibold hover:underline flex-shrink-0">
        {"Thiết lập kết nối"}
      </a>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
      <div className="p-3.5 rounded-xl bg-[var(--ps-sheet)] border border-[var(--ps-edge)] v3-space-y-2">
        <div className="ps-status ps-status-connected">
          <span>Làm được</span>
        </div>
        <ul className="text-[13px] text-[var(--ps-ink)] v3-space-y-1.5">
          {c.canDo.map(item => (
            <li key={item} className="flex items-start gap-1.5">
              <span className="text-emerald-600 dark:text-emerald-400 font-bold mt-0.5">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="p-3.5 rounded-xl bg-[var(--ps-sheet)] border border-[var(--ps-edge)] v3-space-y-2">
        <div className="ps-status ps-status-neutral">
          <span>Chưa làm được</span>
        </div>
        <ul className="text-[13px] text-[var(--ps-muted)] v3-space-y-1.5">
          {c.cannotDo.map(item => (
            <li key={item} className="flex items-start gap-1.5">
              <span className="text-[var(--ps-faint)] font-bold mt-0.5">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  </div>;
}

export const meta: PageMeta = {
  id: "guide",
  title: "Cẩm nang kết nối & Mẫu câu lệnh — Planora",
  htmlClass: "h-full",
  bodyClass: "min-h-full flex flex-col bg-[#F8F4EE] text-[#1a0e08] antialiased selection:bg-[#FF5701]/10 selection:text-[#FF5701]",
  css,
};

export function GuidePage({ navigate, user = null, onLogout = () => navigate('/') }: { navigate: Navigate; user?: User | null; onLogout?: () => void }) {
  usePrototypePage(meta);
  const gmailEnabled = useGmailEnabled();
  const mycalendarEnabled = useMyCalendarEnabled();
  const mysheetsEnabled = useMySheetsEnabled();
  const schedulesEnabled = useSchedulesEnabled();
  const SERVICE_GUIDES: Record<string, ServiceGuide> = {
    ...BASE_GUIDES,
    ...(gmailEnabled ? { gmail: GMAIL_GUIDE } : {}),
    ...(mysheetsEnabled ? { mysheets: MYSHEETS_GUIDE } : {}),
  };
  const mysheetsPrompts = schedulesEnabled ? [...MYSHEETS_PROMPTS, MYSHEETS_SCHEDULE_PROMPT] : MYSHEETS_PROMPTS;
  const SAMPLE_PROMPTS = [
    ...BASE_PROMPTS,
    ...GITHUB_OAUTH_PROMPTS,
    ...(mycalendarEnabled ? MYCALENDAR_PROMPTS : []),
    ...(gmailEnabled ? GMAIL_PROMPTS : []),
    ...(mysheetsEnabled ? mysheetsPrompts : []),
  ];
  const CAPABILITIES_DATA = [
    ...capabilitiesForRuntime(mycalendarEnabled),
    ...(gmailEnabled ? [GMAIL_CAPABILITY] : []),
    ...(mysheetsEnabled ? [MYSHEETS_CAPABILITY] : []),
  ];
  useEffect(() => {
    const serviceParam = new URLSearchParams(window.location.search).get('service');
    if (gmailEnabled && serviceParam === 'gmail') setServiceId('gmail');
    else if (mysheetsEnabled && serviceParam === 'mysheets') setServiceId('mysheets');
  }, [gmailEnabled, mysheetsEnabled]);
  const [tab, setTab] = useState<MainTab>(initialTab);
  const [serviceId, setServiceId] = useState(initialService);
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState<Record<string, boolean>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const timers = useRef<number[]>([]);
  const later = (ms: number, run: () => void) => { timers.current.push(window.setTimeout(run, ms)); };
  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);
  // Toast mờ dần sau 3,5 giây rồi biến mất, như showToast của bản mẫu.
  const showToast = (message: string) => {
    const id = ++toastId.current;
    setToasts(list => [...list, { id, message, fading: false }]);
    later(3500, () => {
      setToasts(list => list.map(t => (t.id === id ? { ...t, fading: true } : t)));
      later(250, () => setToasts(list => list.filter(t => t.id !== id)));
    });
  };
  const actions = {
    switchMainTab(next: MainTab) { setTab(next); },
    selectServiceGuide(id: string) { if (SERVICE_GUIDES[id]) setServiceId(id); },
    filterPrompts(value: string) { setQuery(value); },
    setPromptCategory(next: string) { setCategory(next); },
    copyPromptText(promptId: string) {
      const p = SAMPLE_PROMPTS.find(item => item.id === promptId);
      if (!p) return;
      if (typeof navigator.clipboard?.writeText !== 'function') {
        showToast('Không thể sao chép tự động. Bạn hãy bôi đen câu lệnh để chép tay nhé.');
        return;
      }
      navigator.clipboard.writeText(p.prompt).then(() => {
        showToast('Đã sao chép câu lệnh vào bộ nhớ tạm! Dán vào ô nhập của Planora để bắt đầu.');
        setCopied(state => ({ ...state, [promptId]: true }));
        later(2000, () => setCopied(state => ({ ...state, [promptId]: false })));
      }).catch(() => showToast('Không thể sao chép tự động. Bạn hãy bôi đen câu lệnh để chép tay nhé.'));
    },
  };
  const search = query.toLowerCase().trim();
  const prompts = SAMPLE_PROMPTS.filter(p => (category === 'all' || p.category === category) && (!search
    || p.title.toLowerCase().includes(search) || p.prompt.toLowerCase().includes(search)
    || p.categoryLabel.toLowerCase().includes(search) || p.services.some(s => s.toLowerCase().includes(search))));
  const tabProps = (key: MainTab) => ({ className: TAB_CLS, 'aria-selected': tab === key ? 'true' as const : 'false' as const });
  const catProps = (key: string) => ({ className: CAT_CLS, 'aria-pressed': category === key ? 'true' as const : 'false' as const });
  return (
    <>
      {/* FE-12: đã đăng nhập thì dùng thanh điều hướng chung; chưa đăng nhập giữ thanh của bản mẫu. */}
      {user ? <MainNav user={user} current="guide" pageName="Cẩm nang" navigate={navigate} onLogout={onLogout} /> : (
        <header className="sticky top-0 z-30 w-full bg-[#F8F4EE] border-b border-[#E6DED3] px-4 sm:px-6 py-3">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
            {/* Cụm Logo & Điều hướng */}
            <div className="flex items-center gap-2.5 sm:gap-4 min-w-0">
              <a href="/" onClick={appLink(navigate, '/')} className="flex items-center gap-2.5 group flex-shrink-0" title="Về không gian làm việc">
                <PlanoraMark className="w-7 h-7 text-[#1a0e08] dark:text-[#F3EEE8] flex-shrink-0 group-hover:scale-105 transition-transform" />
                <span className="font-sans font-bold text-lg tracking-tight text-[#1a0e08]">
                  Planora
                </span>
              </a>
              <div className="h-4 w-px bg-[#E6DED3] flex-shrink-0" />
              <a href="/" onClick={appLink(navigate, '/')} className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#51463E] hover:text-[#1a0e08] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title="Quay lại không gian làm việc">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span className="hidden sm:inline">
                  Về không gian làm việc
                </span>
                <span className="sm:hidden">
                  Quay lại
                </span>
              </a>
              <div className="hidden md:block h-4 w-px bg-[#E6DED3] flex-shrink-0" />
              {/* Liên kết chéo */}
              <a href="/settings" onClick={appLink(navigate, '/settings')} className="hidden md:inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#51463E] hover:text-[#1a0e08] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title="Mở trang Kết nối dịch vụ">
                <svg className="w-4 h-4 text-[#6A5F56]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
                {' '}
                <span>
                  Kết nối dịch vụ
                </span>
              </a>
              <a href="/history" onClick={appLink(navigate, '/history')} className="hidden lg:inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#51463E] hover:text-[#1a0e08] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title="Mở trang Nhật ký điều phối">
                <svg className="w-4 h-4 text-[#6A5F56]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {' '}
                <span>
                  Nhật ký
                </span>
              </a>
            </div>
            {/* Cụm phải dùng trạng thái thật của app; bỏ menu kịch bản và vai trò giả của bản mẫu. */}
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              <ThemeToggle />
              <a href="/login" onClick={appLink(navigate, '/login')} className="px-3 py-1.5 min-h-[36px] rounded-xl bg-white hover:bg-neutral-50 text-[#1a0e08] font-medium border border-[#E6DED3] shadow-2xs transition-all inline-flex items-center">Đăng nhập</a>
            </div>
          </div>
        </header>
      )}
      {/* ==================== MAIN CONTENT ==================== */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 v3-space-y-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="ps-pagehead">
            <h1>
              Cẩm nang kết nối &amp; Mẫu câu lệnh Planora
            </h1>
            <p className="max-w-[70ch]">
              Hướng dẫn liên kết tài khoản không cần cấu hình kỹ thuật, trực quan hoá luồng công việc đa dịch vụ và thư viện mẫu câu lệnh tiếng Việt.
            </p>
            <div className="flex flex-wrap items-center gap-2.5 pt-4">
              <a href="/settings" onClick={appLink(navigate, '/settings')} className="ps-btn">
                <span>Mở Cài đặt dịch vụ →</span>
              </a>
              <a href="/" onClick={appLink(navigate, '/')} className="ps-btn-quiet">
                <span>Quay lại trò chuyện</span>
              </a>
            </div>
          </div>
          <div className="ps-panel grid grid-cols-2 divide-x divide-[var(--ps-edge)] flex-shrink-0 overflow-hidden">
            <div className="px-4 py-3 text-left">
              <div className="text-[13px] text-[var(--ps-faint)]">Dịch vụ có hướng dẫn</div>
              <div className="font-display text-xl font-semibold tabular-nums text-[var(--ps-ink)] mt-0.5">8/8</div>
            </div>
            <div className="px-4 py-3 text-left">
              <div className="text-[13px] text-[var(--ps-faint)]">Mẫu câu lệnh sẵn</div>
              <div className="font-display text-xl font-semibold tabular-nums text-[var(--ps-ink)] mt-0.5">12+</div>
            </div>
          </div>
        </div>

        {/* Bắt đầu sử dụng Planora + Make.com Orbital Pipeline Showcase */}
        <section className="ps-panel p-5 v3-space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="font-sans text-base sm:text-lg font-semibold text-[var(--ps-ink)]">
                Bắt đầu sử dụng Planora
              </h2>
              <p className="text-sm text-[var(--ps-muted)] max-w-[70ch]">
                Mọi yêu cầu phức tạp đều được Planora lập thành sơ đồ luồng công việc trực quan và chờ bạn duyệt trước khi thực hiện.
              </p>
            </div>
            <span className="ps-status ps-status-connected self-start sm:self-center">
              Liên kết trực tiếp · An toàn
            </span>
          </div>
          <WorkflowFlowCanvas services={GUIDE_HERO_FLOW_SERVICES} mode="preview" />
        </section>

        {/* Cài đặt dịch vụ 1-Click OAuth Showcase */}
        <section className="ps-panel px-4 py-3.5 v3-space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="font-sans text-sm font-semibold text-[var(--ps-ink)]">
                Cài đặt dịch vụ
              </h2>
              <span className="text-[13px] text-[var(--ps-faint)] hidden sm:inline">
                · Kết nối tài khoản trực tiếp tại trang Cài đặt, dưới đây là hướng dẫn sử dụng và mẫu câu lệnh.
              </span>
            </div>
            <a href="/settings" onClick={appLink(navigate, '/settings')} className="text-[13px] font-semibold text-[var(--ps-accent-text)] hover:underline">
              Mở Cài đặt dịch vụ →
            </a>
          </div>
          <details className="group">
            <summary className="cursor-pointer list-none inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--ps-muted)] hover:text-[var(--ps-ink)]">
              <span>Xem tóm tắt nhanh 7 dịch vụ hỗ trợ liên kết trực tiếp</span>
              <svg className="w-3.5 h-3.5 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3">
              {GUIDE_OAUTH_SHOWCASE_CARDS.map(card => (
                <div key={card.service} className="p-3.5 rounded-xl bg-[var(--ps-sheet)] border border-[var(--ps-edge)] flex flex-col justify-between gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <ServiceLogo service={card.service} className={`${card.iconClassName} flex-shrink-0`} />
                      <span className="text-sm font-semibold text-[var(--ps-ink)] truncate">{card.title}</span>
                    </div>
                    <span className={card.badgeStyle === 'oauth' ? 'ps-status ps-status-connected' : 'ps-status ps-status-neutral'}>{card.badge}</span>
                  </div>
                  <p className="text-[13px] text-[var(--ps-muted)]">{card.description}</p>
                </div>
              ))}
            </div>
          </details>
        </section>

        {/* Tabs Điều hướng Phân khu chính */}
        <div>
          <nav className="ps-segmented" aria-label="Các phân khu cẩm nang" role="tablist">
            <button type="button" role="tab" aria-controls="section-keys" onClick={() => actions.switchMainTab('keys')} id="tab-btn-keys" {...tabProps('keys')}>
              <span>Hướng dẫn lấy khoá &amp; kết nối</span>
            </button>
            <button type="button" role="tab" aria-controls="section-prompts" onClick={() => actions.switchMainTab('prompts')} id="tab-btn-prompts" {...tabProps('prompts')}>
              <span>Thư viện mẫu câu lệnh</span>
            </button>
            <button type="button" role="tab" aria-controls="section-capabilities" onClick={() => actions.switchMainTab('capabilities')} id="tab-btn-capabilities" {...tabProps('capabilities')}>
              <span>Việc làm được &amp; Chưa làm được</span>
            </button>
          </nav>
        </div>

        {/* ========================================================
         PHÂN KHU 1: HƯỚNG DẪN TỪNG BƯỚC LẤY KHOÁ DỊCH VỤ
         ======================================================== */}
        <section id="section-keys" role="tabpanel" aria-labelledby="tab-btn-keys" className={`${tab === 'keys' ? '' : 'hidden '}v3-space-y-6`}>
          <div className="ps-panel p-4">
            <div className="text-[13px] font-medium text-[var(--ps-faint)] mb-3 px-1">
              Chọn công cụ bạn muốn kết nối:
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2" id="service-pills-container">
              {Object.keys(SERVICE_GUIDES).map(id => {
                const isSelected = id === serviceId;
                return (
                  <button key={id} type="button" onClick={() => actions.selectServiceGuide(id)} id={`service-pill-${id}`} className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-colors text-center group ${isSelected ? 'bg-[var(--ps-panel)] border-[var(--ps-ink)] ring-1 ring-[var(--ps-ink)]' : 'bg-[var(--ps-sheet)] border-[var(--ps-edge)] hover:bg-[var(--ps-hover)]'}`}>
                    <div className="w-7 h-7 flex items-center justify-center">
                      {SERVICE_SVGS[id] || <ServiceLogo service={id} className="w-5 h-5" />}
                    </div>
                    <span className={`text-[13px] font-medium mt-1.5 ${isSelected ? 'text-[var(--ps-ink)] font-semibold' : 'text-[var(--ps-muted)]'}`}>{SERVICE_GUIDES[id].name}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div id="service-guide-detail" className="ps-panel p-5 sm:p-7 v3-space-y-6">
            <ServiceGuideDetail serviceId={SERVICE_GUIDES[serviceId] ? serviceId : DEFAULT_SERVICE} guides={SERVICE_GUIDES} navigate={navigate} />
          </div>
          <details data-testid="workspace-admin-advanced-drawer" className="ps-panel p-5 sm:p-6">
            <summary className="cursor-pointer font-semibold text-sm sm:text-base text-[var(--ps-ink)] flex flex-wrap items-center justify-between gap-2">
              <span>Dành cho Quản trị viên Workspace (Nâng cao)</span>
              <span className="text-[13px] font-medium text-[var(--ps-faint)]">Quản lý quyền truy cập &amp; phạm vi dữ liệu nhóm</span>
            </summary>
            <div className="mt-4 pt-4 border-t border-[var(--ps-edge)] text-sm text-[var(--ps-muted)] v3-space-y-2 leading-relaxed max-w-[70ch]">
              <p>
                Tất cả các công cụ ({gmailEnabled ? 'Gmail, ' : ''}Google Calendar, Google Sheets, Trello, Slack, GitHub, Notion, Telegram, Atlassian Jira) đều hỗ trợ <strong>liên kết trực tiếp</strong> trong trang <a href="/settings" onClick={appLink(navigate, '/settings')} className="text-[var(--ps-accent-text)] font-semibold underline">Kết nối dịch vụ</a> mà người dùng không cần tự tạo hay dán khoá kỹ thuật thủ công.
              </p>
              <p>
                Quản trị viên Không gian làm việc có thể kiểm soát danh sách bảng Trello, kho mã GitHub, bảng dữ liệu Notion và dự án Jira được phép sử dụng chung cho từng nhóm làm việc.
              </p>
            </div>
          </details>
        </section>

        {/* ========================================================
         PHÂN KHU 2: THƯ VIỆN CÂU LỆNH MẪU TIẾNG VIỆT HIỆU QUẢ CAO
         ======================================================== */}
        <section id="section-prompts" role="tabpanel" aria-labelledby="tab-btn-prompts" className={`${tab === 'prompts' ? '' : 'hidden '}v3-space-y-6`}>
          <div className="ps-panel p-4 sm:p-5 v3-space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="relative flex-1 min-w-0">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[var(--ps-faint)]">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input type="text" id="prompt-search-input" onInput={(event) => actions.filterPrompts(event.currentTarget.value)} placeholder="Tìm kiếm mẫu lệnh theo từ khoá (Trello, lỗi, sheets, slack, họp...)" className="ps-field w-full pl-9" />
              </div>
              <div className="ps-segmented" id="prompt-category-filter" role="group" aria-label="Nhóm mẫu câu lệnh">
                {gmailEnabled && <button type="button" {...catProps('email')} onClick={() => actions.setPromptCategory('email')}>Email ({GMAIL_PROMPTS.length})</button>}
                {mysheetsEnabled && <button type="button" {...catProps('mysheets')} onClick={() => actions.setPromptCategory('mysheets')}>Bảng tính ({mysheetsPrompts.length})</button>}
                <button type="button" onClick={() => actions.setPromptCategory('all')} id="btn-cat-all" {...catProps('all')}>
                  {`Tất cả (${SAMPLE_PROMPTS.length})`}
                </button>
                <button type="button" onClick={() => actions.setPromptCategory('sprint-bug')} id="btn-cat-sprint-bug" {...catProps('sprint-bug')}>
                  Lỗi Sprint (4)
                </button>
                <button type="button" onClick={() => actions.setPromptCategory('sheet-sync')} id="btn-cat-sheet-sync" {...catProps('sheet-sync')}>
                  Đồng bộ bảng tính (4)
                </button>
                <button type="button" onClick={() => actions.setPromptCategory('reporting')} id="btn-cat-reporting" {...catProps('reporting')}>
                  Báo cáo &amp; Giao tiếp (4)
                </button>
              </div>
            </div>
          </div>
          <div id="prompts-grid" className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {prompts.length === 0 ? (
              <div className="ps-panel col-span-full p-8 text-center text-sm text-[var(--ps-muted)]">
                {"Không tìm thấy mẫu câu lệnh phù hợp với từ khoá "}
                <span className="font-semibold text-[var(--ps-ink)]">{`"${search}"`}</span>
                {'. Hãy thử tìm từ khoá khác như "Trello", "Slack", "lỗi", "báo cáo".'}
              </div>
            ) : prompts.map(p => <PromptCard key={p.id} p={p} copied={!!copied[p.id]} onCopy={actions.copyPromptText} navigate={navigate} />)}
          </div>
          <div className="ps-panel p-5 sm:p-6 v3-space-y-3">
            <div className="text-sm font-semibold text-[var(--ps-ink)]">
              Kinh nghiệm thực tế để câu lệnh tiếng Việt chạy chính xác nhất
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-[13px] text-[var(--ps-ink)]">
              <div className="p-3.5 bg-[var(--ps-sheet)] rounded-xl border border-[var(--ps-edge)] v3-space-y-1">
                <div className="font-semibold text-[var(--ps-ink)]">
                  Dùng động từ hành động rõ
                </div>
                <p className="text-[var(--ps-muted)]">
                  {"Bắt đầu bằng: "}
                  <em>"Tạo card..."</em>{", "}<em>"Ghi vào bảng tính..."</em>{", "}<em>"Gửi tin vào kênh..."</em>{", "}<em>"Gán nhãn..."</em>
                </p>
              </div>
              <div className="p-3.5 bg-[var(--ps-sheet)] rounded-xl border border-[var(--ps-edge)] v3-space-y-1">
                <div className="font-semibold text-[var(--ps-ink)]">
                  Nêu rõ tên nơi cần làm
                </div>
                <p className="text-[var(--ps-muted)]">
                  {"Chỉ rõ: "}
                  <em>bảng To Do</em>{", "}<em>kênh #ati-test</em>{", "}<em>kho mã ati-test</em>{", "}<em>tab Tasks</em>
                  {" để Planora tìm đúng chỗ."}
                </p>
              </div>
              <div className="p-3.5 bg-[var(--ps-sheet)] rounded-xl border border-[var(--ps-edge)] v3-space-y-1">
                <div className="font-semibold text-[var(--ps-ink)]">
                  Ghép nhiều việc trong 1 câu
                </div>
                <p className="text-[var(--ps-muted)]">
                  {"Dùng từ nối: "}
                  <em>"đồng thời"</em>{", "}<em>"sau đó"</em>{", "}<em>"và báo kênh..."</em>
                  {" để Planora tự động móc nối các liên kết."}
                </p>
              </div>
              <div className="p-3.5 bg-[var(--ps-sheet)] rounded-xl border border-[var(--ps-edge)] v3-space-y-1">
                <div className="font-semibold text-[var(--ps-ink)]">
                  Luôn an tâm khi bấm duyệt
                </div>
                <p className="text-[var(--ps-muted)]">
                  Planora luôn cho bạn xem trước nguyên văn nội dung sẽ gửi đi. Không có gì bị ghi khi bạn chưa bấm Duyệt.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ========================================================
         PHÂN KHU 3: VIỆC LÀM ĐƯỢC VÀ CHƯA LÀM ĐƯỢC
         ======================================================== */}
        <section id="section-capabilities" role="tabpanel" aria-labelledby="tab-btn-capabilities" className={`${tab === 'capabilities' ? '' : 'hidden '}v3-space-y-6`}>
          <div className="ps-panel p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="v3-space-y-1 max-w-[70ch]">
              <h2 className="font-sans text-base sm:text-lg font-semibold text-[var(--ps-ink)]">
                Năng lực của Planora theo từng công cụ
              </h2>
              <p className="text-sm text-[var(--ps-muted)]">
                {"Planora "}
                <span className="font-medium text-[var(--ps-ink)]">
                  không bao giờ tự ý xoá vĩnh viễn dữ liệu cũ
                </span>
                {" và chỉ hoạt động trong đúng phạm vi bảng, kênh, kho mã được quản trị viên cấp phép."}
              </p>
            </div>
            <a href="/settings" onClick={appLink(navigate, '/settings')} className="ps-btn-quiet flex-shrink-0 self-start sm:self-center">
              <span>Xem nơi được phép →</span>
            </a>
          </div>
          <div id="capabilities-grid" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {CAPABILITIES_DATA.map(c => <CapabilityCard key={c.id} c={c} navigate={navigate} />)}
          </div>
        </section>
      </main>
      {/* ==================== TOAST NOTIFICATION CONTAINER ==================== */}
      <div id="toast-container" className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none" aria-live="polite">
        {toasts.map(toast => (
          <div key={toast.id} className="pointer-events-auto bg-[var(--ps-ink)] text-[var(--ps-sheet)] text-[13px] px-4 py-3 rounded-xl border border-[var(--ps-edge)] flex items-center gap-2 max-w-sm transition-all v3-transform duration-200" style={toast.fading ? { opacity: '0' } : undefined}>
            <svg className="w-4 h-4 text-[var(--ps-accent)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span className="flex-1">{toast.message}</span>
          </div>
        ))}
      </div>
      {!user && (
        <footer className="mt-auto border-t border-[var(--ps-edge)] bg-[var(--ps-sheet)] py-6 px-4 sm:px-6">
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-[13px] text-[var(--ps-faint)]">
            <div className="flex items-center gap-2">
              <span className="font-sans font-semibold text-[var(--ps-ink)]">
                Planora
              </span>
              <span>
                — AI Workflow Automation Platform · 2026
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <a href="/" onClick={appLink(navigate, '/')} className="hover:text-[var(--ps-ink)] transition-colors">
                Không gian làm việc
              </a>
              <a href="/settings" onClick={appLink(navigate, '/settings')} className="hover:text-[var(--ps-ink)] transition-colors">
                Kết nối dịch vụ
              </a>
              <a href="/history" onClick={appLink(navigate, '/history')} className="hover:text-[var(--ps-ink)] transition-colors">
                Nhật ký điều phối
              </a>
              <a href="/privacy" onClick={appLink(navigate, '/privacy')} className="text-[var(--ps-accent-text)] hover:underline font-medium transition-colors">
                Chính sách an toàn
              </a>
            </div>
          </div>
        </footer>
      )}
      {/* ==================== JAVASCRIPT LOGIC ==================== */}
    </>
  );
}
