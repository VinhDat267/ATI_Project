import { usePrototypePage, type PageMeta } from '../../prototype/usePrototypePage';
import { MainNav } from '../../components/layout/MainNav';
import { avatarInitials } from '../../components/layout/UserNavMenu';
import type { User } from '../../types';
import css from './page.css?inline';
import type { AccountSession } from '../../types';
import { useAccount } from './useAccount';
function EyeIcons({ visible }: { visible: boolean }) {
  return <>
    <svg className={`w-4 h-4 eye-icon-show${visible ? ' hidden' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
    <svg className={`w-4 h-4 eye-icon-hide${visible ? '' : ' hidden'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
    </svg>
  </>;
}

function SessionCard({ card, onRevoke, busy }: { card: AccountSession; busy: boolean; onRevoke: (id: string, name: string) => void }) {
  const lastActive = `Dùng lần cuối: ${new Date(card.lastUsedAt).toLocaleString('vi-VN')}`;
  return (
    <div role="listitem" id={`session-card-${card.id}`} className="py-3.5 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h3 className="font-sans text-sm font-semibold text-[#1a0e08] dark:text-[#F3EEE8]">{card.device}</h3>
        <p className="text-[13px] text-[#6A5F56] dark:text-[#AFA59A] mt-0.5">{lastActive}</p>
      </div>
      <button
        type="button"
        onClick={() => onRevoke(card.id, card.device)}
        className="ps-btn-quiet ps-btn-danger flex-shrink-0"
        title="Đăng xuất thiết bị này"
        disabled={busy}
        aria-label="Đăng xuất phiên này"
      >
        Đăng xuất
      </button>
    </div>
  );
}

export const meta: PageMeta = {
  id: "account",
  title: "Tài khoản — Planora",
  htmlClass: "",
  bodyClass: "min-h-screen flex flex-col bg-[#F8F4EE] text-[#1a0e08]",
  css,
};

export interface AccountPageProps { user: User | null; navigate: (path: string) => void; onLogout: () => void }
export function AccountPage({ user, navigate, onLogout }: AccountPageProps) {
  usePrototypePage(meta);
  const { account, sessions, googleEnabled, name, setName, passwordLength, setPasswordLength, busy, error, notice, modal, shownPasswords, fullNameRef, currentPassRef, newPassRef, confirmPassRef, unlinkPassRef, actions } = useAccount(user);
  const strength = { label: passwordLength ? `${passwordLength}/12 ký tự tối thiểu` : 'Ít nhất 12 ký tự', labelClass: 'text-[13px] font-medium text-[#6A5F56] dark:text-[#AFA59A]', width: `${Math.min(passwordLength / 12, 1) * 100}%`, barClass: 'h-full bg-[#6A5F56] dark:bg-[#AFA59A] transition-all duration-300' };
  const view = { fullName: account?.name ?? '', email: account?.email ?? '', role: account?.role, googleLinked: account?.hasGoogle, hasPassword: account?.hasPassword, googleEmail: account?.googleEmail };
  const cards = sessions.filter(session => !session.current), currentSession = sessions.find(session => session.current), sessionCount = cards.length;
  const initials = avatarInitials(account), isAdmin = view.role === 'admin', roleName = isAdmin ? 'Quản trị viên' : 'Thành viên';
  const googleOnly = !view.hasPassword, unlinkLocked = !view.hasPassword, linking = busy === 'link';
  const passType = (id: string) => shownPasswords.includes(id) ? 'text' : 'password';
  const modalClass = (_id: string) => 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45';
  if (!account) return (
    <>
      <MainNav user={user} current={null} pageName="Tài khoản" navigate={navigate} onLogout={onLogout} />
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
        <p role={error ? 'alert' : 'status'} className="ps-note">{error ?? 'Đang tải thông tin tài khoản...'}</p>
      </main>
    </>
  );
  return (
    <>
      {/* FE-12: thanh điều hướng chung thay thanh trên của bản mẫu. */}
      <MainNav user={user} current={null} pageName="Tài khoản" navigate={navigate} onLogout={onLogout} />
      {/* NỘI DUNG CHÍNH */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8 v3-space-y-6">
        {!modal && error && <p role="alert" className="text-sm text-[#B91C1C] dark:text-[#F87171]">{error}</p>}
        {notice && <p role="status" className="text-sm text-[#047857] dark:text-[#34D399]">{notice}</p>}
        {/* Tiêu đề trang */}
        <div className="ps-pagehead">
          <h1>Tài khoản</h1>
          <p>{`${view.email} · ${roleName}`}</p>
        </div>
        {/* KHỐI TỔNG QUAN TÀI KHOẢN (PROFILE CARD) */}
        <div className="ps-panel p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div id="profile-card-avatar" className="w-12 h-12 rounded-xl bg-[#1A0E08] dark:bg-[#F3EEE8] text-white dark:text-[#1A0E08] flex items-center justify-center font-sans font-semibold text-lg flex-shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 id="profile-card-name" className="font-sans text-lg font-semibold text-[#1a0e08] dark:text-[#F3EEE8]">
                  {view.fullName}
                </h2>
                <span id="profile-card-role-badge" className="ps-status ps-status-neutral">
                  {roleName}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-sm text-[#51463E] dark:text-[#D7CEC4]">
                <span className="break-all">{view.email}</span>
                {user?.emailVerified !== undefined && (
                  <span className={`ps-status ${user.emailVerified ? 'ps-status-connected' : 'ps-status-warning'}`}>
                    {user.emailVerified ? 'Đã xác minh' : 'Chưa xác minh email'}
                  </span>
                )}
              </div>
            </div>
          </div>
          <span id="summary-sessions-text" className="ps-status ps-status-connected flex-shrink-0">
            {`${sessions.length} thiết bị đang hoạt động`}
          </span>
        </div>
        {/* 4 KHỐI THIẾT LẬP */}
        <div className="v3-space-y-6">
          {/* HỌ TÊN */}
          <section id="section-profile" className="ps-panel p-5 sm:p-6 v3-space-y-5" aria-labelledby="heading-profile">
            <div className="ps-sectionhead border-b border-[#E3DACE] dark:border-[#2A231E] pb-3">
              <h2 id="heading-profile">Họ tên</h2>
            </div>
            <form id="form-update-profile" onSubmit={(event) => actions.handleUpdateProfile(event)} className="v3-space-y-4 max-w-xl">
              <div>
                <label htmlFor="input-full-name" className="block text-sm font-semibold text-[#1a0e08] dark:text-[#F3EEE8] mb-1.5">
                  {'Họ và tên '}
                  <span className="text-[#B43E00] dark:text-[#FF8547]">*</span>
                </label>
                <input
                  ref={fullNameRef}
                  type="text"
                  id="input-full-name"
                  name="fullName"
                  value={name}
                  onChange={event => setName(event.target.value)}
                  maxLength={100}
                  autoComplete="name"
                  required
                  className="ps-field w-full"
                  placeholder="Nhập họ và tên đầy đủ"
                />
                <p className="text-[13px] text-[#6A5F56] dark:text-[#AFA59A] mt-1.5">
                  Hiển thị ở góc thanh điều khiển và khi bạn duyệt kế hoạch.
                </p>
              </div>
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <label htmlFor="input-email-readonly" className="block text-sm font-semibold text-[#1a0e08] dark:text-[#F3EEE8]">
                    Địa chỉ email đăng nhập
                  </label>
                  {user?.emailVerified !== undefined && (
                    <span className={`ps-status ${user.emailVerified ? 'ps-status-connected' : 'ps-status-warning'}`}>
                      {user.emailVerified ? 'Xác minh' : 'Chưa xác minh'}
                    </span>
                  )}
                </div>
                <input
                  type="email"
                  id="input-email-readonly"
                  value={view.email}
                  readOnly
                  className="ps-field w-full bg-[#F8F4EE] dark:bg-[#131010] text-[#6A5F56] dark:text-[#AFA59A] cursor-not-allowed"
                />
                <p className="text-[13px] text-[#6A5F56] dark:text-[#AFA59A] mt-1.5">
                  Liên hệ quản trị viên nếu cần đổi email đăng nhập.
                </p>
              </div>
              <p className="text-sm text-[#51463E] dark:text-[#D7CEC4]">
                <span className="font-semibold text-[#1a0e08] dark:text-[#F3EEE8]">Vai trò trong nhóm: </span>
                <span id="profile-role-title" className="font-medium text-[#1a0e08] dark:text-[#F3EEE8]">
                  {roleName}
                </span>
                {' — '}
                <span id="profile-role-description">
                  {isAdmin
                    ? 'kết nối dịch vụ chung, chỉnh phạm vi và duyệt thành viên.'
                    : 'dùng công cụ đã kết nối và kiểm tra kết nối.'}
                </span>
              </p>
              <div className="pt-1">
                <button type="submit" id="btn-save-profile" disabled={busy !== null} className="ps-btn">
                  Lưu thay đổi họ tên
                </button>
              </div>
            </form>
          </section>
          {/* MẬT KHẨU */}
          <section id="section-password" className="ps-panel p-5 sm:p-6 v3-space-y-5" aria-labelledby="heading-password">
            <div className="ps-sectionhead border-b border-[#E3DACE] dark:border-[#2A231E] pb-3">
              <h2 id="heading-password">Mật khẩu</h2>
            </div>
            {!googleOnly && <form noValidate id="form-change-password" onSubmit={(event) => actions.handleChangePassword(event)} className="v3-space-y-4 max-w-xl">
              <div>
                <label htmlFor="input-current-pass" className="block text-sm font-semibold text-[#1a0e08] dark:text-[#F3EEE8] mb-1.5">
                  {'Mật khẩu hiện tại '}
                  <span className="text-[#B43E00] dark:text-[#FF8547]">*</span>
                </label>
                <div className="relative">
                  <input
                    ref={currentPassRef}
                    type={passType('input-current-pass')}
                    id="input-current-pass"
                    required
                    maxLength={128}
                    className="ps-field w-full pr-10"
                    placeholder="Nhập mật khẩu đang dùng"
                  />
                  <button
                    type="button"
                    onClick={() => actions.togglePasswordVisibility('input-current-pass')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 text-[#6A5F56] dark:text-[#AFA59A] hover:text-[#1a0e08] dark:hover:text-[#F3EEE8] p-1.5 rounded-lg"
                    aria-label="Ẩn hoặc hiện mật khẩu hiện tại"
                  >
                    <EyeIcons visible={shownPasswords.includes('input-current-pass')} />
                  </button>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="input-new-pass" className="block text-sm font-semibold text-[#1a0e08] dark:text-[#F3EEE8]">
                    {'Mật khẩu mới '}
                    <span className="text-[#B43E00] dark:text-[#FF8547]">*</span>
                  </label>
                  <span id="pass-strength-indicator" className={strength.labelClass}>
                    {strength.label}
                  </span>
                </div>
                <div className="relative">
                  <input
                    ref={newPassRef}
                    type={passType('input-new-pass')}
                    id="input-new-pass"
                    minLength={12}
                    required
                    onInput={(event) => setPasswordLength(event.currentTarget.value.length)}
                    className="ps-field w-full pr-10"
                    placeholder="Ít nhất 12 ký tự"
                  />
                  <button
                    type="button"
                    onClick={() => actions.togglePasswordVisibility('input-new-pass')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 text-[#6A5F56] dark:text-[#AFA59A] hover:text-[#1a0e08] dark:hover:text-[#F3EEE8] p-1.5 rounded-lg"
                    aria-label="Ẩn hoặc hiện mật khẩu mới"
                  >
                    <EyeIcons visible={shownPasswords.includes('input-new-pass')} />
                  </button>
                </div>
                <div className="w-full bg-[#E3DACE] dark:bg-[#2A231E] h-1.5 rounded-full overflow-hidden mt-2">
                  <div id="pass-strength-bar" className={strength.barClass} style={strength.width === undefined ? undefined : { width: strength.width }} />
                </div>
              </div>
              <div>
                <label htmlFor="input-confirm-pass" className="block text-sm font-semibold text-[#1a0e08] dark:text-[#F3EEE8] mb-1.5">
                  {'Xác nhận mật khẩu mới '}
                  <span className="text-[#B43E00] dark:text-[#FF8547]">*</span>
                </label>
                <div className="relative">
                  <input
                    ref={confirmPassRef}
                    type={passType('input-confirm-pass')}
                    id="input-confirm-pass"
                    minLength={12}
                    required
                    maxLength={128}
                    className="ps-field w-full pr-10"
                    placeholder="Nhập lại đúng mật khẩu mới"
                  />
                  <button
                    type="button"
                    onClick={() => actions.togglePasswordVisibility('input-confirm-pass')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 text-[#6A5F56] dark:text-[#AFA59A] hover:text-[#1a0e08] dark:hover:text-[#F3EEE8] p-1.5 rounded-lg"
                    aria-label="Ẩn hoặc hiện mật khẩu xác nhận"
                  >
                    <EyeIcons visible={shownPasswords.includes('input-confirm-pass')} />
                  </button>
                </div>
              </div>
              <p className="text-[13px] text-[#6A5F56] dark:text-[#AFA59A]">
                Đổi mật khẩu sẽ đăng xuất các thiết bị khác.
              </p>
              <div className="pt-1">
                <button type="submit" id="btn-submit-change-pass" disabled={busy !== null} className="ps-btn-quiet">
                  Cập nhật mật khẩu mới
                </button>
              </div>
            </form>}
            <div id="password-google-only-guide" className={`${googleOnly ? '' : 'hidden '}max-w-xl v3-space-y-3`}>
              <h3 className="font-sans font-semibold text-base text-[#1a0e08] dark:text-[#F3EEE8]">
                Tài khoản này chưa có mật khẩu
              </h3>
              <p className="ps-note">
                Tài khoản này chưa có mật khẩu. Để gỡ Google, hãy đặt mật khẩu trước bằng &apos;Quên mật khẩu&apos;: hệ thống gửi link đặt mật khẩu tới email của bạn.
              </p>
              <div>
                <a
                  href="/forgot-password"
                  onClick={event => { event.preventDefault(); navigate('/forgot-password'); }}
                  className="ps-btn-quiet"
                >
                  Đến trang đăng nhập để dùng &quot;Quên mật khẩu&quot;
                </a>
              </div>
            </div>
          </section>
          {/* PHIÊN ĐĂNG NHẬP */}
          <section id="section-sessions" className="ps-panel p-5 sm:p-6 v3-space-y-4" aria-labelledby="heading-sessions">
            <div className="ps-sectionhead">
              <h2 id="heading-sessions">Phiên đăng nhập</h2>
              <button
                type="button"
                id="btn-revoke-all-others"
                disabled={busy !== null}
                onClick={() => actions.promptRevokeAllOtherSessions()}
                className={`${sessionCount <= 0 ? 'hidden! ' : ''}ps-btn-quiet ps-btn-danger flex-shrink-0`}
              >
                Đăng xuất khỏi mọi thiết bị khác
              </button>
            </div>
            <div role="list" id="sessions-list-container" className="ps-rows border-t border-[#E3DACE] dark:border-[#2A231E]">
              <div role="listitem" id="session-card-current" className="py-3.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h3 className="font-sans text-sm font-semibold text-[#1a0e08] dark:text-[#F3EEE8]">
                      {currentSession?.device}
                    </h3>
                    <span className="ps-status ps-status-connected">Phiên hiện tại</span>
                  </div>
                  <p className="text-[13px] text-[#6A5F56] dark:text-[#AFA59A] mt-0.5">
                    {currentSession ? `Dùng lần cuối: ${new Date(currentSession.lastUsedAt).toLocaleString('vi-VN')}` : ''}
                  </p>
                </div>
                <span className="text-[13px] text-[#6A5F56] dark:text-[#AFA59A] flex-shrink-0">Đang dùng</span>
              </div>
              {cards.map(card => <SessionCard key={card.id} card={card} busy={busy !== null} onRevoke={actions.revokeSingleSession} />)}
              <div id="sessions-empty-state" className={`${sessionCount <= 0 ? '' : 'hidden '}pt-3.5`}>
                <p className="text-[13px] text-[#6A5F56] dark:text-[#AFA59A]">
                  Chỉ còn phiên hiện tại đang hoạt động.
                </p>
              </div>
            </div>
          </section>
          {/* GOOGLE */}
          {googleEnabled && <section id="section-google" className="ps-panel p-5 sm:p-6 v3-space-y-4" aria-labelledby="heading-google">
            <div className="ps-sectionhead border-b border-[#E3DACE] dark:border-[#2A231E] pb-3">
              <h2 id="heading-google">Google</h2>
            </div>
            <div id="google-linked-state" className={`${view.googleLinked ? '' : 'hidden '}flex flex-col sm:flex-row sm:items-center justify-between gap-4`}>
              <div className="flex items-start gap-3 min-w-0">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z" />
                  <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.36 24 12 24z" />
                  <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
                  <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.36 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                </svg>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-sm font-semibold text-[#1a0e08] dark:text-[#F3EEE8]">Tài khoản Google</span>
                    <span className="ps-status ps-status-connected">Đã liên kết</span>
                  </div>
                  <p className="text-sm text-[#51463E] dark:text-[#D7CEC4] mt-0.5 break-all" id="google-linked-email-display">
                    {view.googleEmail}
                  </p>
                  <p className="text-[13px] text-[#6A5F56] dark:text-[#AFA59A] mt-1">
                    Đăng nhập bằng nút &quot;Tiếp tục với Google&quot; trên trang đăng nhập.
                  </p>
                </div>
              </div>
              <button
                type="button"
                id="btn-unlink-google"
                onClick={() => actions.promptUnlinkGoogleModal()}
                disabled={unlinkLocked || busy !== null}
                title={unlinkLocked ? 'Tài khoản chưa có mật khẩu' : undefined}
                aria-describedby={unlinkLocked ? 'google-no-password-notice' : undefined}
                className="ps-btn-quiet ps-btn-danger flex-shrink-0 self-start sm:self-center"
              >
                Gỡ liên kết Google
              </button>
            </div>
            <p id="google-no-password-notice" className={`${googleOnly ? '' : 'hidden '}text-[13px] text-[#B45309] dark:text-[#FBBF24]`}>
              Tài khoản này chưa có mật khẩu. Để gỡ Google, hãy đặt mật khẩu trước bằng &apos;Quên mật khẩu&apos;: hệ thống gửi link đặt mật khẩu tới email của bạn.
            </p>
            <div id="google-unlinked-state" className={`${view.googleLinked ? 'hidden ' : ''}flex flex-col sm:flex-row sm:items-center justify-between gap-4`}>
              <div className="flex items-start gap-3 min-w-0">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5 opacity-60" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z" />
                  <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.36 24 12 24z" />
                  <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
                  <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.36 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                </svg>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-sm font-semibold text-[#1a0e08] dark:text-[#F3EEE8]">Tài khoản Google</span>
                    <span className="ps-status ps-status-neutral">Chưa liên kết</span>
                  </div>
                  <p className="text-[13px] text-[#6A5F56] dark:text-[#AFA59A] mt-0.5">
                    Hiện bạn chưa liên kết tài khoản Google với tài khoản Planora này.
                  </p>
                </div>
              </div>
              <button
                type="button"
                id="btn-link-google"
                disabled={busy !== null}
                onClick={() => actions.triggerLinkGoogleFlow()}
                className="ps-btn-quiet flex-shrink-0 self-start sm:self-center"
              >
                <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z" />
                  <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.36 24 12 24z" />
                  <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
                  <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.36 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                </svg>
                <span id="btn-link-google-text">
                  {linking ? 'Đang kết nối Google…' : 'Liên kết Google'}
                </span>
              </button>
            </div>
          </section>}
        </div>
        <p className="ps-note">
          Trang này không có chức năng xóa tài khoản hay đổi email. Nếu muốn ngừng sử dụng, hãy nhờ quản trị viên khóa tài khoản.
        </p>
      </main>
      {/* MODAL XÁC NHẬN THU HỒI TẤT CẢ PHIÊN KHÁC */}
      {modal === "modal-revoke-all" && <div id="modal-revoke-all" className={modalClass('modal-revoke-all')} role="dialog" aria-modal="true" aria-labelledby="modal-revoke-all-title">
        <div className="ps-panel max-w-md w-full p-6 v3-space-y-4">
          <h3 id="modal-revoke-all-title" className="font-sans text-base sm:text-lg font-semibold text-[#1a0e08] dark:text-[#F3EEE8]">
            Đăng xuất khỏi tất cả phiên khác?
          </h3>
          <p className="ps-note">
            Hành động này sẽ thu hồi quyền truy cập của toàn bộ các thiết bị và trình duyệt khác. Riêng phiên hiện tại trên trình duyệt này vẫn được duy trì.
          </p>
          {error && <p role="alert" className="text-xs text-[#B91C1C] dark:text-[#F87171]">{error}</p>}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button type="button" onClick={() => actions.closeModal('modal-revoke-all')} className="ps-btn-quiet">
              Hủy bỏ
            </button>
            <button type="button" onClick={() => actions.confirmRevokeAllOtherSessions()} disabled={busy !== null} className="ps-btn-quiet ps-btn-danger">
              Xác nhận thu hồi
            </button>
          </div>
        </div>
      </div>}
      {/* MODAL XÁC NHẬN GỠ LIÊN KẾT GOOGLE */}
      {modal === "modal-unlink-google" && <div id="modal-unlink-google" className={modalClass('modal-unlink-google')} role="dialog" aria-modal="true" aria-labelledby="modal-unlink-google-title">
        <div className="ps-panel max-w-md w-full p-6 v3-space-y-4">
          <h3 id="modal-unlink-google-title" className="font-sans text-base sm:text-lg font-semibold text-[#1a0e08] dark:text-[#F3EEE8]">
            Gỡ liên kết tài khoản Google?
          </h3>
          <p className="ps-note">
            Sau khi gỡ liên kết, bạn sẽ cần nhập email và mật khẩu Planora để đăng nhập.
          </p>
          <div className="text-left">
            <label htmlFor="input-unlink-current-pass" className="block text-sm font-semibold text-[#1a0e08] dark:text-[#F3EEE8] mb-1.5">
              {'Mật khẩu hiện tại '}
              <span className="text-[#B43E00] dark:text-[#FF8547]">*</span>
            </label>
            <div className="relative">
              <input
                ref={unlinkPassRef}
                type={passType('input-unlink-current-pass')}
                id="input-unlink-current-pass"
                placeholder="Nhập mật khẩu hiện tại để xác nhận"
                onKeyDown={(event) => { if (event.key === 'Enter') actions.confirmUnlinkGoogle(); }}
                className="ps-field w-full pr-10"
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => actions.togglePasswordVisibility('input-unlink-current-pass')}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-[#6A5F56] dark:text-[#AFA59A] hover:text-[#1a0e08] dark:hover:text-[#F3EEE8] p-1.5 rounded-lg"
                aria-label="Ẩn hoặc hiện mật khẩu"
              >
                <EyeIcons visible={shownPasswords.includes('input-unlink-current-pass')} />
              </button>
            </div>
            <p className="text-[13px] text-[#6A5F56] dark:text-[#AFA59A] mt-1.5">
              Xác thực mật khẩu hiện tại trước khi huỷ liên kết Google.
            </p>
          </div>
          {error && <p role="alert" className="text-xs text-[#B91C1C] dark:text-[#F87171]">{error}</p>}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button type="button" onClick={() => actions.closeModal('modal-unlink-google')} className="ps-btn-quiet">
              Giữ liên kết
            </button>
            <button type="button" onClick={() => actions.confirmUnlinkGoogle()} disabled={busy !== null} className="ps-btn-quiet ps-btn-danger">
              Xác nhận gỡ
            </button>
          </div>
        </div>
      </div>}
    </>
  );
}
