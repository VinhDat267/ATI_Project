import { ThemeToggle } from '../components/layout/AppShell';
export function ShellPageView({ title, publicPage = false, navigate }: { title: string; publicPage?: boolean; navigate: (path: string) => void }) {
  return <div className="min-h-full bg-bg-page text-text">
    {publicPage && <header className="border-b border-border bg-surface px-4 sm:px-8 py-4"><nav aria-label="Điều hướng" className="flex items-center justify-between"><a href="/" onClick={event => { event.preventDefault(); navigate('/'); }} className="font-display text-2xl">ATI.</a><ThemeToggle /></nav></header>}
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-8"><h1 className="font-display text-3xl">{title}</h1><p className="mt-4 text-text-secondary">Nội dung đang được chuẩn bị.</p><a href="/" onClick={event => { event.preventDefault(); navigate('/'); }} className="mt-6 inline-flex min-h-10 items-center text-primary-text underline">Về trang chính</a></main>
  </div>;
}
