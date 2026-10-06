// Chuyển từ docs/design/prototypes/responses.html bằng scripts/html-to-jsx.mjs, sau đó sửa tay.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { usePrototypePage, type PageMeta } from '../../app/usePrototypePage';
import css from './page.css?inline';

type Role = 'admin' | 'member';
type Variant = 'notion_only' | 'notion_and_jira';
type Scenario = 1 | 2 | 3 | 4;
type ServiceRow = { id: string; name: string; connected: boolean; label: string };

// Biểu tượng dịch vụ, chép từ SERVICE_SVGS của responses.html.
const SERVICE_SVGS: Record<string, ReactNode> = {
  trello: <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill="#0079BF" /><rect x="4" y="4" width="6.5" height="13" rx="1.5" fill="white" /><rect x="13.5" y="4" width="6.5" height="8.5" rx="1.5" fill="white" /></svg>,
  slack: <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.528 2.528 0 0 1 2.521-2.52 2.528 2.528 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A" /><path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0" /><path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D" /><path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.528 2.528 0 0 1-2.52-2.523 2.528 2.528 0 0 1 2.52-2.52h6.313A2.528 2.528 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ECB22E" /></svg>,
  github: <svg className="w-5 h-5 flex-shrink-0 text-[#24292E]" fill="currentColor" viewBox="0 0 24 24"><path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" /></svg>,
  sheets: <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" fill="#0F9D58" /><path d="M14 2v6h6l-6-6z" fill="#87CEAB" /><rect x="7" y="11" width="10" height="7" rx="0.5" fill="white" fillOpacity="0.3" /><line x1="7" y1="14" x2="17" y2="14" stroke="white" strokeWidth="1" /><line x1="11" y1="11" x2="11" y2="18" stroke="white" strokeWidth="1" /></svg>,
  notion: <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none"><path fillRule="evenodd" clipRule="evenodd" d="M4.222 3.125l13.774-1.12c1.38-.112 1.954.267 2.502.933l2.808 3.444c.433.533.693 1.155.693 1.777v12.22c0 1.2-.544 1.866-1.843 1.977l-14.88 1.111c-1.378.111-2.04-.333-2.589-1l-2.016-2.555c-.443-.555-.67-1.222-.67-1.778V4.88c0-1.111.66-1.666 2.22-1.755zm14.153 1.867L7.332 5.88c-.328.026-.453.18-.453.373v11.758c0 .24.125.4.375.373l11.043-.88c.328-.027.422-.24.422-.453V5.419c0-.24-.125-.4-.344-.427zM9.47 7.915l3.593-.24 3.03 5.467V7.435l2.25-.16v8.425l-3.375.24-3.25-5.653v5.626l-2.25.16V7.915z" fill="#111827" /></svg>,
  jira: <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none"><path d="M11.53 2C11.53 7.26 7.26 11.53 2 11.53C7.26 11.53 11.53 15.8 11.53 21.06C11.53 15.8 15.8 11.53 21.06 11.53C15.8 11.53 11.53 7.26 11.53 2Z" fill="#0052CC" /><path d="M11.53 2C11.53 4.63 9.4 6.76 6.77 6.76C9.4 6.76 11.53 8.89 11.53 11.52C11.53 8.89 13.66 6.76 16.29 6.76C13.66 6.76 11.53 4.63 11.53 2Z" fill="#2684FF" /></svg>,
};

// Nội dung 4 tình huống, như SCENARIOS_DATA của bản mẫu.
const S1: Record<Variant, { userPrompt: string; reason: string; explanation: string; services: ServiceRow[] }> = {
  notion_only: {
    userPrompt: 'Tạo page Notion ghi biên bản họp sprint và báo lên Slack #ati-test',
    reason: 'Notion chưa được kết nối hoặc chưa có tài nguyên được phép.',
    explanation: 'Vì yêu cầu cần Notion, tôi không làm riêng phần Slack. Cả yêu cầu sẽ chạy được khi Notion đã kết nối.',
    services: [
      { id: 'notion', name: 'Notion', connected: false, label: 'Chưa kết nối' },
      { id: 'slack', name: 'Slack', connected: true, label: 'Đã kết nối' },
    ],
  },
  notion_and_jira: {
    userPrompt: 'Tạo page Notion và issue Jira ghi biên bản sprint rồi báo lên Slack #ati-test',
    reason: 'Notion và Jira chưa được kết nối hoặc chưa có tài nguyên được phép.',
    explanation: 'Vì yêu cầu cần Notion và Jira, tôi không làm riêng phần Slack. Cả yêu cầu sẽ chạy được khi các dịch vụ đã kết nối.',
    services: [
      { id: 'notion', name: 'Notion', connected: false, label: 'Chưa kết nối' },
      { id: 'jira', name: 'Jira', connected: false, label: 'Chưa kết nối' },
      { id: 'slack', name: 'Slack', connected: true, label: 'Đã kết nối' },
    ],
  },
};
const TITLES: Record<Scenario, string> = {
  1: 'Tôi chưa làm được yêu cầu này',
  2: 'Việc này tôi chưa làm được',
  3: 'Bạn muốn làm gì với danh sách issue này?',
  4: 'Tôi không thấy kênh #marketing',
};
const PROMPTS: Record<Exclude<Scenario, 1>, string> = {
  2: 'Xoá hết các card cũ trong bảng To Do',
  3: 'Liệt kê các issue đang mở trong ati-test',
  4: 'Báo kênh #marketing là bản build mới đã lên',
};
const TAB_CURRENT = 'scenario-nav-btn px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-[#111827] text-white shadow-sm transition-all flex-shrink-0';
const TAB_OTHER = 'scenario-nav-btn px-3.5 py-1.5 rounded-lg text-xs font-medium bg-white text-[#4B5563] hover:text-[#111827] hover:bg-neutral-100 border border-[#E7E7E2] transition-all flex-shrink-0';
const ROLE_ON = 'px-2.5 py-1.5 rounded-md text-xs font-semibold text-white bg-[#FF5701] shadow-sm transition-all';
const ROLE_OFF = 'px-2.5 py-1.5 rounded-md text-xs font-medium text-[#4B5563] hover:text-[#111827] transition-all';

export const meta: PageMeta = {
  id: "responses",
  title: "Phản hồi khi chưa lập được kế hoạch — ATI",
  htmlClass: "",
  bodyClass: "min-h-screen flex flex-col bg-[#F8F8F6] text-[#111827]",
  css,
};

export function ResponsesPage() {
  usePrototypePage(meta);
  const [role, setRoleState] = useState<Role>('admin');
  // Bản mẫu chỉ vẽ dòng phụ của tình huống 4 khi đã đổi vai trò ít nhất một lần (lúc mới mở trang ô này trống).
  const [roleChosen, setRoleChosen] = useState(false);
  const [scenario, setScenario] = useState<Scenario>(1);
  const [variant, setVariant] = useState<Variant>('notion_only');
  const [bubble, setBubble] = useState(S1.notion_only.userPrompt);
  const [menuOpen, setMenuOpen] = useState(false);
  const [s3Open, setS3Open] = useState(false);
  const [s3Selected, setS3Selected] = useState('');
  const [focusTick, setFocusTick] = useState(0);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Đổi tình huống (kể cả lúc mở trang) thì đưa focus vào tiêu đề thẻ phản hồi sau 50ms.
  useEffect(() => {
    const timer = window.setTimeout(() => titleRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [focusTick]);
  // Bấm ra ngoài thì đóng menu Kịch bản demo.
  useEffect(() => {
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !menuButtonRef.current?.contains(target)) setMenuOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  // Điền đúng một ô nhập của trang, focus và đặt con trỏ cuối dòng.
  const fillInputAndFocus = (value: string) => {
    const input = inputRef.current;
    if (!input) return;
    input.value = value;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  };
  const currentPrompt = () => (scenario === 1 ? S1[variant].userPrompt : PROMPTS[scenario]);
  const actions = {
    setRole(next: Role) {
      setRoleState(next);
      setRoleChosen(true);
    },
    switchScenario(index: Scenario) {
      setScenario(index);
      setBubble(index === 1 ? S1[variant].userPrompt : PROMPTS[index]);
      if (index === 3) setS3Open(false);
      setFocusTick(tick => tick + 1);
    },
    toggleS1Variant() {
      const next: Variant = variant === 'notion_only' ? 'notion_and_jira' : 'notion_only';
      setVariant(next);
      setBubble(S1[next].userPrompt);
    },
    applySuggestion(text: string) { fillInputAndFocus(text); },
    editRequest() { fillInputAndFocus(currentPrompt()); },
    selectS3Action(name: string) {
      setS3Selected(name);
      setS3Open(true);
    },
    resetS3Selection() { setS3Open(false); },
    cancelS3() {
      setS3Open(false);
      fillInputAndFocus('');
    },
    chooseChannel(channel: string) { fillInputAndFocus(`Báo kênh ${channel} là bản build mới đã lên`); },
    handleChatSubmit(event: FormEvent) {
      event.preventDefault();
      const input = inputRef.current;
      const value = input?.value.trim();
      if (!input || !value) return;
      setBubble(value);
      input.value = '';
    },
  };
  const s1 = S1[variant];
  return (
    <>
      {/* 1. Thanh trên giống cockpit */}
      <header className="sticky top-0 z-40 w-full bg-[#F8F8F6]/90 backdrop-blur-md border-b border-[#E7E7E2] px-4 sm:px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          {/* Cụm Logo & Điều hướng quay lại */}
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
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
          </div>
          {/* Cụm Trạng thái Vai trò & Điều khiển Demo */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {/* Nhãn vai trò hiện tại */}
            <div id="role-pill-badge" className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-white border border-[#E7E7E2] text-[#4B5563] shadow-sm">
              <span className={role === 'admin' ? 'w-2 h-2 rounded-full bg-[#16A34A]' : 'w-2 h-2 rounded-full bg-[#3B82F6]'} id="role-indicator-dot" />
              {' '}
              <span id="role-name-display">
                {role === 'admin' ? 'Quản trị viên' : 'Thành viên'}
              </span>
            </div>
            {/* Nút Kịch bản demo */}
            <div className="relative inline-block text-left">
              {' '}
              <button ref={menuButtonRef} onClick={() => setMenuOpen(open => !open)} id="btn-toggle-demo-menu" type="button" className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] text-xs font-medium text-[#111827] bg-white hover:bg-neutral-100 rounded-lg border border-[#E7E7E2] shadow-sm transition-colors" aria-haspopup="true" aria-expanded={menuOpen ? 'true' : 'false'}>
                <svg className="w-3.5 h-3.5 text-[#FF5701]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>
                  Kịch bản demo
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#FF5701]/10 text-[#FF5701]">
                  DEMO
                </span>
              </button>
              {' '}
              {/* Menu chọn Kịch bản Demo */}
              {' '}
              <div ref={menuRef} id="demo-menu-dropdown" className={`${menuOpen ? '' : 'hidden '}absolute right-0 mt-2 w-64 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-lg border border-[#E7E7E2] p-3 z-50 v3-space-y-2.5`} role="menu">
                <div>
                  <p className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider mb-1.5">
                    Xem giao diện như
                  </p>
                  <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#F8F8F6] rounded-lg border border-[#E7E7E2]">
                    <button type="button" id="demo-role-admin" className={role === 'admin' ? ROLE_ON : ROLE_OFF} onClick={() => actions.setRole('admin')}>
                      Quản trị viên
                    </button>
                    <button type="button" id="demo-role-member" className={role === 'member' ? ROLE_ON : ROLE_OFF} onClick={() => actions.setRole('member')}>
                      Thành viên
                    </button>
                  </div>
                  <p className="text-[11px] text-[#6B7280] mt-1.5 leading-normal" id="demo-role-hint">
                    {role === 'admin' ? 'Quản trị viên có quyền kết nối dịch vụ mới và cấu hình nơi được dùng.' : 'Thành viên không được thêm khoá mới, chỉ có thể nhờ quản trị viên.'}
                  </p>
                </div>
              </div>
              {' '}
            </div>
          </div>
        </div>
      </header>
      {/* 2. Dải chọn tình huống (4 nút có aria-pressed) */}
      <nav className="sticky top-[57px] z-30 w-full bg-[#F8F8F6]/95 backdrop-blur-md border-b border-[#E7E7E2] px-4 sm:px-6 py-2.5" aria-label="Chọn tình huống phản hồi">
        <div className="max-w-4xl mx-auto flex items-center gap-2 overflow-x-auto whitespace-nowrap no-scrollbar">
          <button type="button" id="scenario-tab-1" className={scenario === 1 ? TAB_CURRENT : TAB_OTHER} aria-pressed={scenario === 1 ? 'true' : 'false'} onClick={() => actions.switchScenario(1)}>
            {" 1. Dịch vụ chưa kết nối "}
          </button>
          <button type="button" id="scenario-tab-2" className={scenario === 2 ? TAB_CURRENT : TAB_OTHER} aria-pressed={scenario === 2 ? 'true' : 'false'} onClick={() => actions.switchScenario(2)}>
            {" 2. Việc chưa làm được "}
          </button>
          <button type="button" id="scenario-tab-3" className={scenario === 3 ? TAB_CURRENT : TAB_OTHER} aria-pressed={scenario === 3 ? 'true' : 'false'} onClick={() => actions.switchScenario(3)}>
            {" 3. Yêu cầu chỉ để xem "}
          </button>
          <button type="button" id="scenario-tab-4" className={scenario === 4 ? TAB_CURRENT : TAB_OTHER} aria-pressed={scenario === 4 ? 'true' : 'false'} onClick={() => actions.switchScenario(4)}>
            {" 4. Không thấy nơi cần ghi "}
          </button>
        </div>
      </nav>
      {/* 3. Khu vực đối thoại & phản hồi chính */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-32 v3-space-y-6" id="conversation-container" aria-live="polite">
        {/* Bong bóng yêu cầu của người dùng */}
        <div className="flex items-start justify-end gap-3">
          <div className="max-w-xl bg-white border border-[#E7E7E2] rounded-2xl rounded-tr-sm p-4 sm:p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4 mb-1.5 text-xs text-[#6B7280]">
              <span className="font-semibold text-[#111827]">
                Bạn
              </span>
              <span className="text-[11px] text-[#9CA3AF]">
                Yêu cầu đã gửi
              </span>
            </div>
            <p id="user-request-bubble-text" className="text-sm sm:text-base font-medium text-[#111827] leading-relaxed">
              {bubble}
            </p>
          </div>
          <div className="w-9 h-9 rounded-full bg-[#111827] text-white flex items-center justify-center text-xs font-bold flex-shrink-0 shadow-sm mt-0.5">
            B
          </div>
        </div>
        {/* Thẻ phản hồi của ATI */}
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#FF5701] text-white flex items-center justify-center font-display font-bold text-base shadow-sm flex-shrink-0 mt-0.5">
            A
          </div>
          <div className="flex-1 bg-white border border-[#E7E7E2] rounded-2xl rounded-tl-sm p-5 sm:p-7 shadow-sm v3-space-y-5">
            {/* Header thẻ phản hồi */}
            <div className="flex items-center justify-between text-xs text-[#6B7280] pb-2 border-b border-[#F3F4F6]">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[#111827]">
                  ATI
                </span>
                <span className="text-[#9CA3AF]">
                  ·
                </span>
                <span>
                  Trợ lý điều phối
                </span>
              </div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#F3F4F6] text-[#4B5563]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF]" />
                {" Chưa lập kế hoạch"}
              </span>
            </div>
            {/* Tiêu đề thẻ phản hồi (nhận focus khi đổi tình huống) */}
            <h1 ref={titleRef} id="response-card-title" tabIndex={-1} className="font-display font-bold text-2xl sm:text-3xl text-[#111827] tracking-tight focus:v3-outline-none focus:ring-2 focus:ring-[#FF5701]/20 rounded-lg">
              {TITLES[scenario]}
            </h1>
            {/* VÙNG NỘI DUNG TỪNG TÌNH HUỐNG */}
            {/* TÌNH HUỐNG 1: DỊCH VỤ CHƯA KẾT NỐI */}
            <div id="scenario-content-1" className={`scenario-panel ${scenario === 1 ? '' : 'hidden '}v3-space-y-5`}>
              {/* Lý do hệ thống */}
              <div className="p-3.5 sm:p-4 rounded-xl bg-[#F8F8F6] border border-[#E7E7E2] text-sm text-[#111827] font-medium flex items-start gap-3">
                <svg className="w-5 h-5 text-[#FF5701] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div className="v3-space-y-1">
                  <p id="s1-reason-text" className="text-sm font-semibold text-[#111827]">
                    {s1.reason}
                  </p>
                  <p id="s1-explanation-text" className="text-xs sm:text-sm text-[#4B5563] leading-relaxed">
                    {s1.explanation}
                  </p>
                </div>
              </div>
              {/* Danh sách dịch vụ liên quan */}
              <div>
                <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-2">
                  Trạng thái các dịch vụ trong yêu cầu này
                </p>
                <div id="s1-services-list" className="v3-space-y-2">
                  {s1.services.map(service => (
                    <div key={service.id} className="flex items-center justify-between p-3 rounded-xl bg-white border border-[#E7E7E2] shadow-sm">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-neutral-50 border border-neutral-100 flex items-center justify-center flex-shrink-0">
                          {SERVICE_SVGS[service.id]}
                        </div>
                        <span className="text-xs sm:text-sm font-semibold text-[#111827]">{service.name}</span>
                      </div>
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${service.connected ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-neutral-100 text-neutral-600 border border-neutral-200'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${service.connected ? 'bg-emerald-500' : 'bg-neutral-400'}`} />
                        <span>{service.label}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Nút chuyển đổi biến thể demo (Notion vs Notion+Jira) */}
              <div className="pt-2">
                <button type="button" id="s1-toggle-variant-btn" onClick={() => actions.toggleS1Variant()} className="inline-flex items-center gap-1.5 text-xs text-[#FF5701] hover:text-[#E04D00] font-medium py-1 px-2.5 rounded-lg hover:bg-[#FF5701]/5 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                  <span id="s1-variant-btn-text">
                    {variant === 'notion_only' ? 'Thử biến thể: Cần cả Notion và Jira' : 'Thử biến thể: Chỉ cần Notion'}
                  </span>
                </button>
              </div>
              {/* Khu vực hành động (phân quyền Quản trị viên / Thành viên) */}
              <div className="pt-2 border-t border-[#F3F4F6] flex flex-wrap items-center gap-3" id="s1-action-area">
                {role === 'admin' ? <>
                  <a href={variant === 'notion_only' ? '/settings#notion' : '/settings'} className="px-4 py-2 bg-[#FF5701] hover:bg-[#E04D00] text-white text-xs sm:text-sm font-semibold rounded-xl shadow-sm transition-colors flex items-center gap-1.5">
                    <span>{variant === 'notion_only' ? 'Kết nối Notion' : 'Kết nối dịch vụ'}</span>
                    <span aria-hidden="true">→</span>
                  </a>
                  <button type="button" onClick={() => actions.editRequest()} className="px-4 py-2 bg-white hover:bg-neutral-50 text-[#111827] border border-[#E7E7E2] text-xs sm:text-sm font-medium rounded-xl transition-colors">
                    {" Sửa yêu cầu "}
                  </button>
                </> : (
                  <div className="w-full v3-space-y-2.5">
                    <p className="text-xs sm:text-sm text-[#4B5563] leading-relaxed">
                      {" Chỉ quản trị viên kết nối được dịch vụ mới. Bạn hãy báo quản trị viên của nhóm. "}
                    </p>
                    {' '}
                    <button type="button" onClick={() => actions.editRequest()} className="px-4 py-2 bg-[#FF5701] hover:bg-[#E04D00] text-white text-xs sm:text-sm font-semibold rounded-xl shadow-sm transition-colors">
                      {" Sửa yêu cầu "}
                    </button>
                  </div>
                )}
              </div>
            </div>
            {/* TÌNH HUỐNG 2: VIỆC CHƯA LÀM ĐƯỢC */}
            <div id="scenario-content-2" className={`scenario-panel ${scenario === 2 ? '' : 'hidden '}v3-space-y-5`}>
              {/* Lý do hệ thống */}
              <div className="p-3.5 sm:p-4 rounded-xl bg-[#F8F8F6] border border-[#E7E7E2] text-sm text-[#111827] flex items-start gap-3">
                <svg className="w-5 h-5 text-[#FF5701] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="v3-space-y-1">
                  <p className="text-sm font-semibold text-[#111827]">
                    Tôi chưa có thao tác xoá card trên Trello.
                  </p>
                  <p className="text-xs sm:text-sm text-[#4B5563] leading-relaxed">
                    Bạn có thể lưu trữ các card cũ thay vì xoá.
                  </p>
                </div>
              </div>
              {/* Khối gấp mở: Những việc tôi làm được với Trello */}
              <details className="group border border-[#E7E7E2] rounded-xl bg-white overflow-hidden transition-all">
                <summary className="flex items-center justify-between p-3.5 text-xs sm:text-sm font-medium text-[#111827] cursor-pointer hover:bg-neutral-50 transition-colors list-none">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-[#0079BF]" viewBox="0 0 24 24" fill="none">
                      <rect width="24" height="24" rx="4" fill="#0079BF" />
                      <rect x="4" y="4" width="6.5" height="13" rx="1.5" fill="white" />
                      <rect x="13.5" y="4" width="6.5" height="8.5" rx="1.5" fill="white" />
                    </svg>
                    <span>
                      Những việc tôi làm được với Trello
                    </span>
                  </div>
                  <svg className="w-4 h-4 text-[#6B7280] group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                <div className="p-3.5 pt-0 text-xs sm:text-sm text-[#4B5563] border-t border-[#F3F4F6] bg-[#F8F8F6]/60 leading-relaxed">
                  tìm bảng, danh sách, thành viên, card; tạo card, cập nhật card (kể cả lưu trữ), gán thành viên, thêm checklist.
                </div>
              </details>
              {/* Khu vực hành động */}
              <div className="pt-2 border-t border-[#F3F4F6] flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => actions.applySuggestion('Lưu trữ các card cũ trong bảng To Do')} className="px-4 py-2 bg-[#FF5701] hover:bg-[#E04D00] text-white text-xs sm:text-sm font-semibold rounded-xl shadow-sm transition-colors">
                  {" Thử: lưu trữ card cũ "}
                </button>
                <button type="button" onClick={() => actions.editRequest()} className="px-4 py-2 bg-white hover:bg-neutral-50 text-[#111827] border border-[#E7E7E2] text-xs sm:text-sm font-medium rounded-xl transition-colors">
                  {" Sửa yêu cầu "}
                </button>
              </div>
            </div>
            {/* TÌNH HUỐNG 3: YÊU CẦU CHỈ ĐỂ XEM */}
            <div id="scenario-content-3" className={`scenario-panel ${scenario === 3 ? '' : 'hidden '}v3-space-y-5`}>
              {/* Giải thích */}
              <p className="text-xs sm:text-sm text-[#4B5563] leading-relaxed">
                Tôi làm những việc có thay đổi trên công cụ, như tạo, ghi hoặc gửi. Bạn chọn một việc bên dưới, hoặc tự nhập.
              </p>
              {/* 3 lựa chọn việc cần làm */}
              <div className={`v3-space-y-2${s3Open ? ' opacity-40 pointer-events-none' : ''}`} id="s3-options-group">
                <button type="button" onClick={() => actions.selectS3Action('Gửi danh sách lên Slack #ati-test')} className="w-full text-left p-3.5 rounded-xl border border-[#E7E7E2] hover:border-[#FF5701] hover:bg-[#FF5701]/5 bg-white transition-all flex items-center justify-between group shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                        <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.528 2.528 0 0 1 2.521-2.52 2.528 2.528 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A" />
                        <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0" />
                        <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D" />
                        <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.528 2.528 0 0 1-2.52-2.523 2.528 2.528 0 0 1 2.52-2.52h6.313A2.528 2.528 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ECB22E" />
                      </svg>
                    </div>
                    <span className="text-xs sm:text-sm font-semibold text-[#111827] group-hover:text-[#FF5701] transition-colors">
                      Gửi danh sách lên Slack #ati-test
                    </span>
                  </div>
                  <svg className="w-4 h-4 text-[#9CA3AF] group-hover:text-[#FF5701] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <button type="button" onClick={() => actions.selectS3Action('Ghi danh sách vào Google Sheets')} className="w-full text-left p-3.5 rounded-xl border border-[#E7E7E2] hover:border-[#FF5701] hover:bg-[#FF5701]/5 bg-white transition-all flex items-center justify-between group shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" fill="#0F9D58" />
                        <path d="M14 2v6h6l-6-6z" fill="#87CEAB" />
                        <rect x="7" y="11" width="10" height="7" rx="0.5" fill="white" fillOpacity="0.3" />
                        <line x1="7" y1="14" x2="17" y2="14" stroke="white" strokeWidth="1" />
                        <line x1="11" y1="11" x2="11" y2="18" stroke="white" strokeWidth="1" />
                      </svg>
                    </div>
                    <span className="text-xs sm:text-sm font-semibold text-[#111827] group-hover:text-[#FF5701] transition-colors">
                      Ghi danh sách vào Google Sheets
                    </span>
                  </div>
                  <svg className="w-4 h-4 text-[#9CA3AF] group-hover:text-[#FF5701] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <button type="button" onClick={() => actions.selectS3Action('Tạo một card Trello tổng hợp')} className="w-full text-left p-3.5 rounded-xl border border-[#E7E7E2] hover:border-[#FF5701] hover:bg-[#FF5701]/5 bg-white transition-all flex items-center justify-between group shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                        <rect width="24" height="24" rx="4" fill="#0079BF" />
                        <rect x="4" y="4" width="6.5" height="13" rx="1.5" fill="white" />
                        <rect x="13.5" y="4" width="6.5" height="8.5" rx="1.5" fill="white" />
                      </svg>
                    </div>
                    <span className="text-xs sm:text-sm font-semibold text-[#111827] group-hover:text-[#FF5701] transition-colors">
                      Tạo một card Trello tổng hợp
                    </span>
                  </div>
                  <svg className="w-4 h-4 text-[#9CA3AF] group-hover:text-[#FF5701] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
              {/* Màn phản hồi sau khi bấm một lựa chọn (mô phỏng xác nhận tiến trình) */}
              <div id="s3-confirmation-box" className={`${s3Open ? '' : 'hidden '}v3-space-y-3 pt-2`}>
                {/* Bong bóng trả lời của người dùng */}
                <div className="flex items-start justify-end gap-2.5">
                  <div className="max-w-md bg-white border border-[#E7E7E2] rounded-2xl rounded-tr-sm p-3 shadow-sm text-xs sm:text-sm text-[#111827]">
                    <span className="text-[10px] font-semibold text-[#6B7280] block mb-0.5">
                      Lựa chọn của bạn:
                    </span>
                    <p id="s3-selected-text" className="font-semibold text-[#111827]">{s3Selected}</p>
                  </div>
                  <div className="w-7 h-7 rounded-full bg-[#111827] text-white flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">
                    B
                  </div>
                </div>
                {/* Phản hồi ATI */}
                <div className="p-3.5 sm:p-4 rounded-xl bg-emerald-50 border border-emerald-200 v3-space-y-3">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                    </svg>
                    <p className="text-xs sm:text-sm text-emerald-900 font-semibold">
                      Tôi sẽ lập kế hoạch với câu trả lời này.
                    </p>
                  </div>
                  <div className="pt-1 flex items-center gap-3">
                    <a href="/app-stage" className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#FF5701] hover:bg-[#E04D00] text-white text-xs sm:text-sm font-semibold rounded-xl shadow-sm transition-colors">
                      <span>
                        Xem tiếp trong không gian làm việc
                      </span>
                      <span aria-hidden="true">
                        →
                      </span>
                    </a>
                    <button type="button" onClick={() => actions.resetS3Selection()} className="text-xs text-[#6B7280] hover:text-[#111827] underline">
                      Chọn lại
                    </button>
                  </div>
                </div>
              </div>
              {/* Ghi chú tránh hiểu lầm */}
              <p className="text-[11px] sm:text-xs text-[#6B7280] italic">
                Tôi chưa đọc dữ liệu nào cho tới khi bạn chọn việc cần làm.
              </p>
              {/* Nút phụ & Liên kết bỏ qua */}
              <div className="pt-2 border-t border-[#F3F4F6] flex items-center justify-between gap-3">
                <button type="button" onClick={() => actions.editRequest()} className="px-4 py-2 bg-white hover:bg-neutral-50 text-[#111827] border border-[#E7E7E2] text-xs sm:text-sm font-medium rounded-xl transition-colors">
                  {" Sửa yêu cầu "}
                </button>
                <button type="button" onClick={() => actions.cancelS3()} className="text-xs text-[#6B7280] hover:text-[#111827] py-1 px-2 rounded hover:underline">
                  {" Bỏ qua "}
                </button>
              </div>
            </div>
            {/* TÌNH HUỐNG 4: KHÔNG THẤY NƠI CẦN GHI */}
            <div id="scenario-content-4" className={`scenario-panel ${scenario === 4 ? '' : 'hidden '}v3-space-y-5`}>
              {/* Giải thích */}
              <p className="text-xs sm:text-sm text-[#4B5563] leading-relaxed">
                {"Trong các kênh Slack nhóm cho phép, tôi chỉ thấy "}
                <span className="font-semibold text-[#111827]">
                  #ati-test
                </span>
                . Bạn muốn gửi vào kênh nào?
              </p>
              {/* Lựa chọn kênh khả dụng (Nút chính của thẻ) */}
              <div>
                <p className="text-xs font-semibold text-[#6B7280] uppercase tracking-wider mb-2">
                  Kênh Slack đã được quản trị viên cấp phép
                </p>
                {' '}
                <button type="button" onClick={() => actions.chooseChannel('#ati-test')} className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-[#FF5701] hover:bg-[#E04D00] text-white text-xs sm:text-sm font-semibold shadow-sm transition-all">
                  <div className="w-5 h-5 bg-white rounded p-0.5 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.528 2.528 0 0 1 2.521-2.52 2.528 2.528 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A" />
                      <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0" />
                      <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D" />
                      <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.528 2.528 0 0 1-2.52-2.523 2.528 2.528 0 0 1 2.52-2.52h6.313A2.528 2.528 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ECB22E" />
                    </svg>
                  </div>
                  <span>
                    Gửi vào #ati-test
                  </span>
                </button>
              </div>
              {/* Dòng phụ theo vai trò */}
              <div className="p-3.5 rounded-xl bg-[#F8F8F6] border border-[#E7E7E2] text-xs sm:text-sm text-[#4B5563]" id="s4-role-subline">
                {roleChosen && (role === 'admin' ? (
                  <p>
                    {" Kênh bạn cần chưa có trong danh sách? "}
                    <a href="/settings#slack" className="font-medium text-[#FF5701] hover:underline underline-offset-2">
                      {" Thêm ở Kết nối dịch vụ → Slack → "}
                    </a>
                    {' '}
                  </p>
                ) : (
                  <p>
                    {" Kênh bạn cần chưa có trong danh sách? Hãy báo quản trị viên thêm vào. "}
                  </p>
                ))}
              </div>
              {/* Khu vực hành động */}
              <div className="pt-2 border-t border-[#F3F4F6] flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => actions.editRequest()} className="px-4 py-2 bg-white hover:bg-neutral-50 text-[#111827] border border-[#E7E7E2] text-xs sm:text-sm font-medium rounded-xl transition-colors">
                  {" Sửa yêu cầu "}
                </button>
              </div>
            </div>
            {/* Dòng bảo đảm an toàn bắt buộc có trên mọi thẻ */}
            <div className="mt-4 pt-3 border-t border-[#F3F4F6] flex items-center gap-2 text-xs text-[#6B7280]">
              <svg className="w-4 h-4 text-[#16A34A] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span>
                Chưa có gì được ghi lên công cụ nào.
              </span>
            </div>
          </div>
        </div>
      </main>
      {/* 4. ĐÚNG MỘT ô nhập dưới cùng cho cả trang */}
      <footer className="fixed bottom-0 left-0 right-0 z-30 bg-[#F8F8F6]/95 backdrop-blur-md border-t border-[#E7E7E2] px-4 py-3">
        <div className="max-w-3xl mx-auto">
          <form id="chat-input-form" onSubmit={(event) => actions.handleChatSubmit(event)} className="relative flex items-center gap-2">
            <label htmlFor="chat-prompt-input" className="sr-only">
              Nhắn cho ATI
            </label>
            <input ref={inputRef} type="text" id="chat-prompt-input" name="prompt" placeholder="Nhắn cho ATI…" autoComplete="off" className="w-full bg-white border border-[#E7E7E2] rounded-xl px-4 py-3 pr-24 text-xs sm:text-sm text-[#111827] placeholder-[#9CA3AF] shadow-sm focus:v3-outline-none focus:border-[#FF5701] focus:ring-2 focus:ring-[#FF5701]/20 transition-all" />
            <button type="submit" id="btn-submit-chat" className="absolute right-2 px-3.5 py-1.5 bg-[#FF5701] hover:bg-[#E04D00] text-white text-xs font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-1.5">
              <span>
                Gửi
              </span>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </form>
          <p className="text-[11px] text-[#6B7280] text-center mt-1.5">
            {"ATI chỉ đọc và ghi ở những nơi bạn cho phép. Chưa duyệt thì chưa làm. · "}
            <a href="/privacy" className="text-[#FF5701] hover:underline font-medium">
              Chính sách an toàn &amp; Dữ liệu
            </a>
          </p>
        </div>
      </footer>
      {/* 5. Logic JavaScript điều khiển các kịch bản */}
    </>
  );
}
