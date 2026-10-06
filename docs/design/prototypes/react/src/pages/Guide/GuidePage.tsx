// Chuyển từ docs/design/prototypes/guide.html bằng scripts/html-to-jsx.mjs, sau đó sửa tay.
import { useEffect, useRef, useState } from 'react';
import { usePrototypePage, type PageMeta } from '../../app/usePrototypePage';
import css from './page.css?inline';
import { CAPABILITIES_DATA, SAMPLE_PROMPTS, SERVICE_GUIDES, SERVICE_SVGS } from './data';

type MainTab = 'keys' | 'prompts' | 'capabilities';
type Toast = { id: number; message: string; fading: boolean };
const TAB_ON = 'main-tab-btn px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all inline-flex items-center gap-2 bg-[#FF5701] text-white shadow-sm';
const TAB_OFF = 'main-tab-btn px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all inline-flex items-center gap-2 bg-[#F8F8F6] text-[#4B5563] hover:bg-neutral-200/70 border border-[#E7E7E2]';
const CAT_ON = 'cat-filter-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#111827] text-white';
const CAT_OFF = 'cat-filter-btn px-3 py-1.5 rounded-lg text-xs font-medium bg-[#F8F8F6] text-[#4B5563] hover:bg-neutral-200/70 border border-[#E7E7E2]';
const ROLE_ON = 'px-2 py-1 text-center font-medium rounded bg-[#FF5701] text-white';
const ROLE_OFF = 'px-2 py-1 text-center font-medium rounded bg-neutral-100 text-[#4B5563] hover:bg-neutral-200';

// ?tab= và ?service= như DOMContentLoaded của guide.html.
function initialTab(): MainTab {
  const tab = new URLSearchParams(window.location.search).get('tab');
  return tab === 'prompts' || tab === 'capabilities' || tab === 'keys' ? tab : 'keys';
}
function initialService() {
  const service = new URLSearchParams(window.location.search).get('service');
  return service && SERVICE_GUIDES[service] ? service : 'trello';
}

// Phân khu 1: chi tiết hướng dẫn lấy khoá của một dịch vụ (renderServiceGuideDetail).
function ServiceGuideDetail({ serviceId }: { serviceId: string }) {
  const s = SERVICE_GUIDES[serviceId];
  return <>
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#E7E7E2]">
      <div className="flex items-center gap-3.5">
        <div className="w-12 h-12 rounded-xl bg-[#F8F8F6] border border-[#E7E7E2] flex items-center justify-center p-2.5 shadow-sm">
          {SERVICE_SVGS[serviceId] || ''}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-xl sm:text-2xl font-bold text-[#111827]">{s.name}</h3>
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">{s.category}</span>
          </div>
          <p className="text-xs sm:text-sm text-[#4B5563] mt-0.5">{s.summary}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <a href={`/settings#${s.id}`} className="px-3.5 py-2 rounded-xl bg-[#FF5701] hover:bg-[#E04D00] text-white text-xs font-semibold shadow-sm transition-all inline-flex items-center gap-1.5" title="Mở trang cài đặt để dán khoá">
          <span>Đi tới Cài đặt khoá →</span>
        </a>
      </div>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="p-3.5 rounded-xl bg-[#F8F8F6] border border-[#E7E7E2]">
        <div className="text-[11px] text-[#6B7280] font-medium">Khoá cần lấy:</div>
        <div className="font-semibold text-xs text-[#111827] mt-1 flex flex-wrap gap-1">
          {s.keys.map(k => <span key={k} className="bg-white px-2 py-0.5 rounded border border-[#E7E7E2] text-neutral-800">{k}</span>)}
        </div>
      </div>
      <div className="p-3.5 rounded-xl bg-[#F8F8F6] border border-[#E7E7E2]">
        <div className="text-[11px] text-[#6B7280] font-medium">Nơi ATI được phép dùng:</div>
        <div className="font-semibold text-xs text-[#111827] mt-1 flex items-center gap-1">
          <span className="bg-white px-2 py-0.5 rounded border border-[#E7E7E2] text-neutral-800">{s.scopeLabel}</span>
          <span className="text-[11px] text-[#6B7280] font-normal truncate">{`(${s.sampleScope})`}</span>
        </div>
      </div>
      <div className="p-3.5 rounded-xl bg-[#F8F8F6] border border-[#E7E7E2]">
        <div className="text-[11px] text-[#6B7280] font-medium">Thời gian hoàn thành:</div>
        <div className="font-semibold text-xs text-emerald-700 mt-1 flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span>{s.timeEstimate}</span>
        </div>
      </div>
    </div>
    <div className="p-4 rounded-xl bg-amber-50/80 border border-amber-200/70 text-xs text-amber-900 flex items-start gap-2.5">
      <svg className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
      <div>
        <span className="font-bold">Lưu ý quan trọng cho người dùng:</span>{` ${s.importantNotice} `}
      </div>
    </div>
    <div className="v3-space-y-4 pt-2">
      <h4 className="text-sm font-bold text-[#111827] uppercase tracking-wider">
        Các bước lấy khoá chi tiết từng thao tác:
      </h4>
      <div className="v3-space-y-3">
        {s.steps.map(st => (
          <div key={st.num} className="p-4 rounded-xl border border-[#E7E7E2] bg-white hover:border-neutral-300 transition-colors flex items-start gap-3.5">
            <div className="w-7 h-7 rounded-full bg-[#111827] text-white flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5">
              {st.num}
            </div>
            <div className="v3-space-y-1.5 flex-1 min-w-0">
              <div className="font-bold text-sm text-[#111827]">{st.title}</div>
              {/* desc có thẻ <a>/<code> viết sẵn trong dữ liệu, chèn như innerHTML của bản mẫu. */}
              <div className="text-xs sm:text-sm text-[#4B5563] leading-relaxed" dangerouslySetInnerHTML={{ __html: st.desc }} />
              {st.tags ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {st.tags.map(t => <span key={t} className="px-2 py-0.5 rounded bg-neutral-100 text-neutral-700 font-mono text-[11px] border border-neutral-200">{t}</span>)}
                </div>
              ) : ''}
              {st.urlSample ? (
                <div className="p-2 rounded-lg bg-[#F8F8F6] border border-[#E7E7E2] text-xs font-mono text-[#111827] select-all break-all">
                  {st.urlSample}
                </div>
              ) : ''}
              {st.callout ? (
                <div className="text-[11px] text-neutral-500 italic flex items-center gap-1 pt-0.5">
                  <svg className="w-3.5 h-3.5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
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

const COPY_ICON = <svg className="w-3.5 h-3.5 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>;

// Phân khu 2: thẻ mẫu câu lệnh (renderPromptsList).
function PromptCard({ p, copied, onCopy }: { p: typeof SAMPLE_PROMPTS[number]; copied: boolean; onCopy: (id: string) => void }) {
  return <div className="bg-white rounded-2xl border border-[#E7E7E2] p-5 shadow-sm hover:border-[#FF5701]/60 transition-all flex flex-col justify-between v3-space-y-4">
    <div className="v3-space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-neutral-100 text-neutral-700 border border-neutral-200">
          {` ${p.categoryLabel} `}
        </span>
        {p.badge ? (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-[#FF5701]">
            {` ★ ${p.badge} `}
          </span>
        ) : ''}
      </div>
      <h4 className="font-bold text-sm sm:text-base text-[#111827] leading-snug">
        {` ${p.title} `}
      </h4>
      <div className="p-3 rounded-xl bg-[#F8F8F6] border border-[#E7E7E2] text-xs sm:text-sm font-medium text-[#111827] leading-relaxed relative group">
        {` "${p.prompt}" `}
      </div>
      <div className="v3-space-y-1.5 pt-1">
        <div className="text-[11px] text-[#6B7280] font-medium">Công cụ tham gia:</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {p.services.map(sid => (
            <span key={sid} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white border border-[#E7E7E2] text-[11px] font-medium text-neutral-700">
              <span className="w-3.5 h-3.5 flex items-center justify-center">{SERVICE_SVGS[sid] || ''}</span>
              <span>{SERVICE_GUIDES[sid]?.name || sid}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="v3-space-y-1 pt-1 border-t border-[#E7E7E2]">
        <div className="text-[11px] text-[#6B7280] font-semibold uppercase tracking-wider">ATI sẽ làm lần lượt sau khi bạn duyệt:</div>
        <ul className="text-xs text-neutral-600 v3-space-y-1 list-disc list-inside">
          {p.workflow.map(w => <li key={w} className="truncate">{w}</li>)}
        </ul>
      </div>
    </div>
    <div className="pt-3 border-t border-[#E7E7E2] flex flex-wrap sm:flex-nowrap items-center justify-between gap-2">
      <button type="button" onClick={() => onCopy(p.id)} id={`copy-btn-${p.id}`} className="px-3 py-2 sm:py-1.5 rounded-lg bg-[#F8F8F6] hover:bg-neutral-200/80 text-xs font-semibold text-[#111827] border border-[#E7E7E2] transition-colors inline-flex items-center gap-1.5 min-h-[36px]">
        {copied ? <>
          <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
          <span className="text-emerald-700">Đã sao chép!</span>
        </> : <>
          {COPY_ICON}
          <span>Sao chép câu lệnh</span>
        </>}
      </button>
      <a href="/app-stage" className="text-xs font-semibold text-[#FF5701] hover:underline inline-flex items-center gap-1 py-1 min-h-[36px]">
        <span>Thử trên sân khấu →</span>
      </a>
    </div>
  </div>;
}

// Phân khu 3: thẻ việc làm được / chưa làm được (renderCapabilitiesGrid).
function CapabilityCard({ c }: { c: typeof CAPABILITIES_DATA[number] }) {
  return <div className="bg-white rounded-2xl border border-[#E7E7E2] p-6 shadow-sm v3-space-y-4">
    <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#E7E7E2]">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-[#F8F8F6] border border-[#E7E7E2] flex items-center justify-center p-1.5">
          {SERVICE_SVGS[c.id] || ''}
        </div>
        <div>
          <h4 className="font-bold text-base text-[#111827]">{c.name}</h4>
          <div className="text-xs text-[#6B7280]">{c.role}</div>
        </div>
      </div>
      <a href={`/settings#${c.id}`} className="text-xs text-[#FF5701] font-medium hover:underline">
        {" Cài đặt khoá "}
      </a>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
      <div className="p-3.5 rounded-xl bg-emerald-50/60 border border-emerald-200/60 v3-space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
          <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
          <span>Việc ATI LÀM ĐƯỢC:</span>
        </div>
        <ul className="text-xs text-emerald-950 v3-space-y-1.5">
          {c.canDo.map(item => (
            <li key={item} className="flex items-start gap-1.5">
              <span className="text-emerald-500 font-bold mt-0.5">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200 v3-space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-700">
          <svg className="w-4 h-4 text-neutral-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          <span>Việc ATI CHƯA LÀM ĐƯỢC:</span>
        </div>
        <ul className="text-xs text-neutral-600 v3-space-y-1.5">
          {c.cannotDo.map(item => (
            <li key={item} className="flex items-start gap-1.5">
              <span className="text-neutral-400 font-bold mt-0.5">•</span>
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
  title: "Cẩm nang kết nối & Mẫu câu lệnh — ATI",
  htmlClass: "h-full",
  bodyClass: "min-h-full flex flex-col antialiased selection:bg-[#FF5701]/10 selection:text-[#FF5701]",
  css,
};

export function GuidePage() {
  usePrototypePage(meta);
  const [tab, setTab] = useState<MainTab>(initialTab);
  const [serviceId, setServiceId] = useState(initialService);
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [role, setRoleState] = useState<'admin' | 'member'>('admin');
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState<Record<string, boolean>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const timers = useRef<number[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const later = (ms: number, run: () => void) => { timers.current.push(window.setTimeout(run, ms)); };
  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);
  // Bấm ngoài menu demo thì đóng.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !menuButtonRef.current?.contains(target)) setMenuOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

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
    toggleDemoDropdown() { setMenuOpen(open => !open); },
    setRole(next: 'admin' | 'member') {
      setRoleState(next);
      showToast(next === 'admin'
        ? 'Đã chuyển xem như Quản trị viên (toàn quyền thêm khoá và cấu hình).'
        : 'Đã chuyển xem như Thành viên (chỉ xem hướng dẫn và sao chép mẫu lệnh).');
      setMenuOpen(open => !open);
    },
    switchMainTab(next: MainTab) { setTab(next); },
    selectServiceGuide(id: string) { if (SERVICE_GUIDES[id]) setServiceId(id); },
    filterPrompts(value: string) { setQuery(value); },
    setPromptCategory(next: string) { setCategory(next); },
    copyPromptText(promptId: string) {
      const p = SAMPLE_PROMPTS.find(item => item.id === promptId);
      if (!p) return;
      navigator.clipboard.writeText(p.prompt).then(() => {
        showToast('Đã sao chép câu lệnh vào bộ nhớ tạm! Dán vào ô nhập của ATI để bắt đầu.');
        setCopied(state => ({ ...state, [promptId]: true }));
        later(2000, () => setCopied(state => ({ ...state, [promptId]: false })));
      }).catch(() => showToast('Không thể sao chép tự động. Bạn hãy bôi đen câu lệnh để chép tay nhé.'));
    },
  };
  const search = query.toLowerCase().trim();
  const prompts = SAMPLE_PROMPTS.filter(p => (category === 'all' || p.category === category) && (!search
    || p.title.toLowerCase().includes(search) || p.prompt.toLowerCase().includes(search)
    || p.categoryLabel.toLowerCase().includes(search) || p.services.some(s => s.toLowerCase().includes(search))));
  const tabProps = (key: MainTab) => ({ className: tab === key ? TAB_ON : TAB_OFF, 'aria-selected': tab === key ? 'true' as const : 'false' as const });
  const catClass = (key: string) => (category === key ? CAT_ON : CAT_OFF);
  return (
    <>
      {/* ==================== HEADER (COCKPIT NAVIGATION) ==================== */}
      <header className="sticky top-0 z-30 w-full bg-[#F8F8F6]/90 backdrop-blur-md border-b border-[#E7E7E2] px-4 sm:px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          {/* Cụm Logo & Điều hướng */}
          <div className="flex items-center gap-2.5 sm:gap-4 min-w-0">
            <a href="/app-stage" className="flex items-center gap-2.5 group flex-shrink-0" title="Về sân khấu điều phối">
              <div className="w-8 h-8 rounded-lg bg-[#FF5701] flex items-center justify-center text-white font-display font-bold text-lg shadow-sm group-hover:scale-105 transition-transform">
                A
              </div>
              <span className="font-display font-bold text-lg tracking-tight text-[#111827]">
                ATI
              </span>
            </a>
            <div className="h-4 w-px bg-[#E7E7E2] flex-shrink-0" />
            <a href="/app-stage" className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title="Quay lại không gian làm việc">
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
            <div className="hidden md:block h-4 w-px bg-[#E7E7E2] flex-shrink-0" />
            {/* Liên kết chéo */}
            <a href="/settings" className="hidden md:inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title="Mở trang Kết nối dịch vụ">
              <svg className="w-4 h-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              {' '}
              <span>
                Kết nối dịch vụ
              </span>
            </a>
            <a href="/history" className="hidden lg:inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title="Mở trang Nhật ký điều phối">
              <svg className="w-4 h-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {' '}
              <span>
                Nhật ký
              </span>
            </a>
            <a href="/users" className="hidden lg:inline-flex items-center gap-1.5 text-xs sm:text-sm font-medium text-[#4B5563] hover:text-[#111827] transition-colors py-1 px-2 rounded-lg hover:bg-black/5" title="Mở trang Quản lý người dùng">
              <svg className="w-4 h-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              {' '}
              <span>
                Người dùng
              </span>
            </a>
          </div>
          {/* Cụm Phải: Vai trò + Kịch bản Demo + Avatar */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {/* Nhãn vai trò */}
            <span id="role-pill-badge" className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-neutral-200/80 text-[#374151] border border-neutral-300/60" title="Vai trò hiện tại của bạn">
              <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
              {' '}
              <span id="current-role-label">
                {role === 'admin' ? 'Quản trị viên' : 'Thành viên'}
              </span>
            </span>
            {/* Nút Kịch bản demo */}
            <div className="relative">
              <button ref={menuButtonRef} type="button" id="btn-demo-menu" onClick={() => actions.toggleDemoDropdown()} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[36px] text-xs font-medium text-[#4B5563] bg-white border border-[#E7E7E2] rounded-lg hover:border-[#FF5701] hover:text-[#FF5701] transition-colors shadow-sm" aria-haspopup="true" aria-expanded={menuOpen ? 'true' : 'false'}>
                <svg className="w-3.5 h-3.5 text-[#FF5701]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                </svg>
                <span className="hidden sm:inline">
                  Kịch bản
                </span>
                <svg className="w-3 h-3 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {' '}
              {/* Dropdown menu kịch bản demo */}
              {' '}
              <div ref={menuRef} id="demo-dropdown" className={`${menuOpen ? '' : 'hidden '}absolute right-0 mt-2 w-64 max-w-[calc(100vw-2rem)] bg-white border border-[#E7E7E2] rounded-xl shadow-lg p-2.5 text-xs z-50 v3-space-y-2`}>
                <div className="font-semibold text-[#111827] px-1 pb-1 border-b border-[#E7E7E2]">
                  Kịch bản kiểm thử
                </div>
                <div className="v3-space-y-1">
                  <div className="text-[11px] text-[#6B7280] font-medium px-1">
                    Xem như:
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <button type="button" onClick={() => actions.setRole('admin')} id="demo-role-admin-btn" className={role === 'admin' ? ROLE_ON : ROLE_OFF}>
                      Quản trị viên
                    </button>
                    <button type="button" onClick={() => actions.setRole('member')} id="demo-role-member-btn" className={role === 'member' ? ROLE_ON : ROLE_OFF}>
                      Thành viên
                    </button>
                  </div>
                </div>
                <div className="pt-2 border-t border-[#E7E7E2] text-[11px] text-[#6B7280] px-1">
                  Chuyển nhanh sang các màn hình liên quan:
                  <div className="mt-1 v3-space-y-1">
                    <a href="/settings" className="block text-[#FF5701] hover:underline font-medium">
                      → Đến Cài đặt dịch vụ
                    </a>
                    <a href="/history" className="block text-[#4B5563] hover:underline">
                      → Đến Nhật ký điều phối
                    </a>
                    <a href="/responses" className="block text-[#4B5563] hover:underline">
                      → Đến Màn phản hồi khi lỗi
                    </a>
                  </div>
                </div>
              </div>
            </div>
            {/* Avatar Người dùng */}
            <a href="/account" className="w-9 h-9 sm:w-8 sm:h-8 rounded-full bg-[#111827] text-white flex items-center justify-center font-medium text-xs shadow-sm hover:ring-2 hover:ring-[#FF5701] hover:ring-offset-2 transition-all flex-shrink-0" title="Tài khoản Lan Nguyễn">
              LN
            </a>
          </div>
        </div>
      </header>
      {/* ==================== MAIN CONTENT ==================== */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 v3-space-y-6">
        {/* HERO / TIÊU ĐỀ TRANG */}
        <section className="bg-white rounded-2xl border border-[#E7E7E2] p-6 sm:p-8 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="v3-space-y-2 max-w-2xl">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#FF5701]/10 text-[#FF5701]">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <span>
                  CẨM NANG &amp; THƯ VIỆN LỆNH
                </span>
              </div>
              {' '}
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold text-[#111827] tracking-tight">
                Cẩm nang kết nối &amp; Mẫu câu lệnh ATI
              </h1>
              <p className="text-sm sm:text-base text-[#4B5563] leading-relaxed">
                Dành cho quản lý dự án, vận hành và người dùng phi kỹ thuật. Hướng dẫn trực quan từng bước lấy khoá cho 8 công cụ, thư viện mẫu câu lệnh tiếng Việt hiệu quả cao, và danh sách rõ ràng những việc ATI làm được và chưa làm được.
              </p>
            </div>
            {/* Thẻ số liệu tóm tắt nhanh */}
            <div className="grid grid-cols-2 gap-2 sm:gap-3 flex-shrink-0">
              <div className="bg-[#F8F8F6] border border-[#E7E7E2] rounded-xl p-2 sm:p-3 text-center">
                <div className="text-lg sm:text-2xl font-bold text-[#FF5701]">
                  8/8
                </div>
                <div className="text-[10px] sm:text-[11px] text-[#6B7280] font-medium mt-0.5 leading-tight">
                  Dịch vụ có hướng dẫn
                </div>
              </div>
              <div className="bg-[#F8F8F6] border border-[#E7E7E2] rounded-xl p-2 sm:p-3 text-center">
                <div className="text-lg sm:text-2xl font-bold text-[#111827]">
                  12+
                </div>
                <div className="text-[10px] sm:text-[11px] text-[#6B7280] font-medium mt-0.5 leading-tight">
                  Mẫu câu lệnh sẵn
                </div>
              </div>
            </div>
          </div>
          {/* 3 Tabs Điều hướng Phân khu chính */}
          <div className="mt-8 pt-4 border-t border-[#E7E7E2]">
            <nav className="flex flex-wrap gap-2" aria-label="Các phân khu cẩm nang">
              <button type="button" onClick={() => actions.switchMainTab('keys')} id="tab-btn-keys" {...tabProps('keys')}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                <span>
                  1. Hướng dẫn lấy khoá (8 dịch vụ)
                </span>
              </button>
              <button type="button" onClick={() => actions.switchMainTab('prompts')} id="tab-btn-prompts" {...tabProps('prompts')}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                <span>
                  2. Thư viện mẫu câu lệnh
                </span>
              </button>
              <button type="button" onClick={() => actions.switchMainTab('capabilities')} id="tab-btn-capabilities" {...tabProps('capabilities')}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>
                  3. Việc làm được &amp; Chưa làm được
                </span>
              </button>
            </nav>
          </div>
        </section>
        {/* ========================================================
         PHÂN KHU 1: HƯỚNG DẪN TỪNG BƯỚC LẤY KHOÁ 8 DỊCH VỤ
         ======================================================== */}
        <section id="section-keys" className={`${tab === 'keys' ? '' : 'hidden '}v3-space-y-6`}>
          {/* Thanh chọn 8 dịch vụ */}
          <div className="bg-white rounded-2xl border border-[#E7E7E2] p-4 shadow-sm">
            <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-3 px-1">
              Chọn công cụ bạn muốn kết nối:
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2" id="service-pills-container">
              {Object.keys(SERVICE_GUIDES).map(id => {
                const isSelected = id === serviceId;
                return (
                  <button key={id} type="button" onClick={() => actions.selectServiceGuide(id)} id={`service-pill-${id}`} className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all text-center group ${isSelected ? 'bg-orange-50/80 border-[#FF5701] ring-1 ring-[#FF5701]' : 'bg-[#F8F8F6] border-[#E7E7E2] hover:bg-white hover:border-neutral-300'}`}>
                    <div className="w-8 h-8 flex items-center justify-center transition-transform group-hover:scale-110">
                      {SERVICE_SVGS[id] || ''}
                    </div>
                    <span className={`text-xs font-semibold mt-1.5 ${isSelected ? 'text-[#FF5701]' : 'text-[#374151]'}`}>{SERVICE_GUIDES[id].name}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {/* Khung chi tiết hướng dẫn của dịch vụ được chọn */}
          <div id="service-guide-detail" className="bg-white rounded-2xl border border-[#E7E7E2] p-6 sm:p-8 shadow-sm v3-space-y-6">
            <ServiceGuideDetail serviceId={serviceId} />
          </div>
        </section>
        {/* ========================================================
         PHÂN KHU 2: THƯ VIỆN CÂU LỆNH MẪU TIẾNG VIỆT HIỆU QUẢ CAO
         ======================================================== */}
        <section id="section-prompts" className={`${tab === 'prompts' ? '' : 'hidden '}v3-space-y-6`}>
          {/* Bộ lọc và tìm kiếm câu lệnh */}
          <div className="bg-white rounded-2xl border border-[#E7E7E2] p-4 sm:p-5 shadow-sm v3-space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              {/* Ô tìm kiếm */}
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#9CA3AF]">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                {' '}
                <input type="text" id="prompt-search-input" onInput={(event) => actions.filterPrompts(event.currentTarget.value)} placeholder="Tìm kiếm mẫu lệnh theo từ khoá (Trello, lỗi, sheets, slack, họp...)" className="w-full pl-9 pr-4 py-2 text-xs sm:text-sm bg-[#F8F8F6] border border-[#E7E7E2] rounded-xl focus:v3-outline-none focus:border-[#FF5701] focus:ring-1 focus:ring-[#FF5701] transition-all" />
              </div>
              {/* Các nút lọc nhóm nghiệp vụ */}
              <div className="flex flex-wrap gap-1.5 sm:gap-2" id="prompt-category-filter">
                <button type="button" onClick={() => actions.setPromptCategory('all')} id="btn-cat-all" className={catClass('all')}>
                  Tất cả (12)
                </button>
                <button type="button" onClick={() => actions.setPromptCategory('sprint-bug')} id="btn-cat-sprint-bug" className={catClass('sprint-bug')}>
                  Lỗi Sprint (4)
                </button>
                <button type="button" onClick={() => actions.setPromptCategory('sheet-sync')} id="btn-cat-sheet-sync" className={catClass('sheet-sync')}>
                  Đồng bộ bảng tính (4)
                </button>
                <button type="button" onClick={() => actions.setPromptCategory('reporting')} id="btn-cat-reporting" className={catClass('reporting')}>
                  Báo cáo &amp; Giao tiếp (4)
                </button>
              </div>
            </div>
          </div>
          {/* Danh sách thẻ câu lệnh mẫu */}
          <div id="prompts-grid" className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {prompts.length === 0 ? (
              <div className="col-span-full p-8 text-center bg-white rounded-2xl border border-[#E7E7E2] text-sm text-[#6B7280]">
                {" Không tìm thấy mẫu câu lệnh phù hợp với từ khoá "}
                <span className="font-bold text-[#111827]">{`"${search}"`}</span>
                {'. Hãy thử tìm từ khoá khác như "Trello", "Slack", "lỗi", "báo cáo". '}
              </div>
            ) : prompts.map(p => <PromptCard key={p.id} p={p} copied={!!copied[p.id]} onCopy={actions.copyPromptText} />)}
          </div>
          {/* 4 Nguyên tắc vàng viết câu lệnh cho ATI */}
          <div className="bg-gradient-to-r from-amber-50/80 via-white to-amber-50/40 rounded-2xl border border-amber-200/80 p-6 shadow-sm v3-space-y-3">
            <div className="flex items-center gap-2 text-amber-900 font-semibold text-sm">
              <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>
                4 kinh nghiệm thực tế để câu lệnh tiếng Việt chạy chính xác nhất
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs text-amber-950">
              <div className="p-3 bg-white/80 rounded-xl border border-amber-200/60 v3-space-y-1">
                <div className="font-bold text-amber-800">
                  1. Dùng động từ hành động rõ
                </div>
                <p className="text-neutral-600">
                  {"Bắt đầu bằng: "}
                  <em>
                    "Tạo card..."
                  </em>
                  {", "}
                  <em>
                    "Ghi vào bảng tính..."
                  </em>
                  {", "}
                  <em>
                    "Gửi tin vào kênh..."
                  </em>
                  {", "}
                  <em>
                    "Gán nhãn..."
                  </em>
                </p>
              </div>
              <div className="p-3 bg-white/80 rounded-xl border border-amber-200/60 v3-space-y-1">
                <div className="font-bold text-amber-800">
                  2. Nêu rõ tên nơi cần làm
                </div>
                <p className="text-neutral-600">
                  {"Chỉ rõ: "}
                  <em>
                    bảng To Do
                  </em>
                  {", "}
                  <em>
                    kênh #ati-test
                  </em>
                  {", "}
                  <em>
                    kho mã ati-test
                  </em>
                  {", "}
                  <em>
                    tab Tasks
                  </em>
                  {" để ATI tìm đúng chỗ."}
                </p>
              </div>
              <div className="p-3 bg-white/80 rounded-xl border border-amber-200/60 v3-space-y-1">
                <div className="font-bold text-amber-800">
                  3. Ghép nhiều việc trong 1 câu
                </div>
                <p className="text-neutral-600">
                  {"Dùng từ nối: "}
                  <em>
                    "đồng thời"
                  </em>
                  {", "}
                  <em>
                    "sau đó"
                  </em>
                  {", "}
                  <em>
                    "và báo kênh..."
                  </em>
                  {" để ATI tự động móc nối các liên kết."}
                </p>
              </div>
              <div className="p-3 bg-white/80 rounded-xl border border-amber-200/60 v3-space-y-1">
                <div className="font-bold text-amber-800">
                  4. Luôn an tâm khi bấm duyệt
                </div>
                <p className="text-neutral-600">
                  ATI luôn cho bạn xem trước nguyên văn nội dung sẽ gửi đi. Không có gì bị ghi khi bạn chưa bấm Duyệt.
                </p>
              </div>
            </div>
          </div>
        </section>
        {/* ========================================================
         PHÂN KHU 3: VIỆC LÀM ĐƯỢC VÀ CHƯA LÀM ĐƯỢC
         ======================================================== */}
        <section id="section-capabilities" className={`${tab === 'capabilities' ? '' : 'hidden '}v3-space-y-6`}>
          {/* Giới thiệu nguyên tắc an toàn */}
          <div className="bg-white rounded-2xl border border-[#E7E7E2] p-5 shadow-sm flex items-start sm:items-center justify-between gap-4">
            <div className="v3-space-y-1">
              <h2 className="text-base sm:text-lg font-bold text-[#111827]">
                Bảng minh bạch năng lực của ATI trên 8 công cụ
              </h2>
              <p className="text-xs sm:text-sm text-[#4B5563]">
                {"ATI tuân thủ nguyên tắc an toàn tối đa: "}
                <span className="font-medium text-[#111827]">
                  không bao giờ tự ý xoá vĩnh viễn dữ liệu cũ
                </span>
                {" và chỉ hoạt động trong đúng phạm vi bảng, kênh, kho mã được quản trị viên cấp phép."}
              </p>
            </div>
            <a href="/settings" className="flex-shrink-0 px-3.5 py-2 rounded-xl bg-[#F8F8F6] border border-[#E7E7E2] text-xs font-semibold text-[#111827] hover:border-[#FF5701] hover:text-[#FF5701] transition-colors inline-flex items-center gap-1.5">
              <span>
                Xem nơi được phép
              </span>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </a>
          </div>
          {/* Lưới 8 công cụ so sánh Làm được vs Chưa làm được */}
          <div id="capabilities-grid" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {CAPABILITIES_DATA.map(c => <CapabilityCard key={c.id} c={c} />)}
          </div>
        </section>
      </main>
      {/* ==================== TOAST NOTIFICATION CONTAINER ==================== */}
      <div id="toast-container" className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none" aria-live="polite">
        {toasts.map(toast => (
          <div key={toast.id} className="pointer-events-auto bg-[#111827] text-white text-xs px-4 py-3 rounded-xl shadow-lg border border-neutral-700 flex items-center gap-2 max-w-sm transition-all transform duration-200" style={toast.fading ? { opacity: '0' } : undefined}>
            <svg className="w-4 h-4 text-[#FF5701] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span className="flex-1">{toast.message}</span>
          </div>
        ))}
      </div>
      {/* ==================== FOOTER ==================== */}
      <footer className="mt-auto border-t border-[#E7E7E2] bg-white py-6 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#6B7280]">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-[#FF5701] text-white flex items-center justify-center font-display font-bold text-[10px]">
              A
            </div>
            <span className="font-semibold text-[#111827]">
              ATI
            </span>
            <span>
              — AI Workflow Automation Platform · 2026
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <a href="/app-stage" className="hover:text-[#111827] transition-colors">
              Không gian làm việc
            </a>
            <a href="/settings" className="hover:text-[#111827] transition-colors">
              Kết nối dịch vụ
            </a>
            <a href="/history" className="hover:text-[#111827] transition-colors">
              Nhật ký điều phối
            </a>
            <a href="/responses" className="hover:text-[#111827] transition-colors">
              Màn phản hồi
            </a>
            <a href="/privacy" className="text-[#FF5701] hover:underline font-medium transition-colors">
              Chính sách an toàn
            </a>
          </div>
        </div>
      </footer>
      {/* ==================== JAVASCRIPT LOGIC ==================== */}
    </>
  );
}
