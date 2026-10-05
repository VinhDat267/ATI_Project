import { useEffect, useState, type ReactNode } from 'react';
import { History, Moon, Sun } from 'lucide-react';
import { apiClient } from '../../services/api-client';
import { useTheme } from '../../hooks/use-theme';
import type { User } from '../../types';
import { UserNavMenu } from './UserNavMenu';
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return <button type="button" onClick={toggleTheme} aria-label={`Chuyển sang giao diện ${theme === 'dark' ? 'Sáng' : 'Tối'}`} aria-pressed={theme === 'dark'} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border hover:bg-surface-raised">
    {theme === 'dark' ? <Sun aria-hidden="true" size={18} /> : <Moon aria-hidden="true" size={18} />}
  </button>;
}
export function SandboxBanner({ runtimeMode }: { runtimeMode: 'sandbox' | 'live' | null }) {
  const [explain, setExplain] = useState(false);
  if (runtimeMode !== 'sandbox') return null;
  return <div role="status" className="bg-warning-tint text-warning-text border-t border-border text-sm">
    <div className="flex items-center justify-between gap-2 px-4 sm:px-8 py-1">
      <span className="sm:hidden">Thử nghiệm · không gọi dịch vụ thật</span><span className="hidden sm:inline">Chế độ thử nghiệm: kế hoạch mẫu, không gọi dịch vụ thật</span>
      <button type="button" aria-expanded={explain} aria-controls="sandbox-explanation" onClick={() => setExplain(!explain)} className="min-h-10 shrink-0 font-semibold underline">Là gì?</button>
    </div>
    {explain && <p id="sandbox-explanation" className="border-t border-border px-4 sm:px-8 py-2">Máy chủ đang chạy thử: ATI dùng kế hoạch soạn sẵn và không ghi gì lên Trello, Slack hay các công cụ khác. Chế độ do máy chủ quyết định khi khởi động.</p>}
  </div>;
}
export function AppShell({ user, onLogout, navigate, children }: { user: User | null; onLogout: () => void; navigate: (path: string) => void; children: ReactNode }) {
  const [runtimeMode, setRuntimeMode] = useState<'sandbox' | 'live' | null>(null);
  useEffect(() => {
    let current = true;
    apiClient.getRuntime().then(data => { if (current && ['sandbox', 'live'].includes(data?.runtimeMode)) setRuntimeMode(data.runtimeMode); }).catch(() => {});
    return () => { current = false; };
  }, []);
  return <div className="app-shell min-h-dvh bg-bg-page text-text flex flex-col">
    <header className="shrink-0 border-b border-border bg-surface">
      <nav aria-label="Điều hướng chính" className="flex h-16 items-center justify-between gap-4 px-4 sm:px-8">
        <a href="/" onClick={event => { event.preventDefault(); navigate('/'); }} className="font-display text-2xl font-semibold tracking-tight">ATI<span className="text-primary-text">.</span></a>
        <div className="flex items-center gap-2 sm:gap-3">
          <button type="button" aria-label="Nhật ký điều phối" onClick={() => navigate('/history')} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border hover:bg-surface-raised"><History aria-hidden="true" size={18} /></button>
          <ThemeToggle />
          <UserNavMenu user={user} onLogout={onLogout} navigate={navigate} onOpenSettings={() => navigate('/settings')} onOpenAccount={() => navigate('/account')} onManageUsers={() => navigate('/admin/users')} />
        </div>
      </nav>
      <SandboxBanner runtimeMode={runtimeMode} />
    </header>
    <div className="flex-1 min-h-0">{children}</div>
  </div>;
}
