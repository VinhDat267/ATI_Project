import type { ReactNode } from 'react';

export interface AuthViewProps {
  navigate: (path: string, replace?: boolean) => void;
  authConfig?: { signupEnabled: boolean; googleEnabled: boolean };
  token?: string;
}
export function AuthFormFrame({ title, description, children, navigate }: {
  title: string; description: string; children: ReactNode; navigate: AuthViewProps['navigate'];
}) {
  return <main className="relative min-h-screen w-full flex flex-col items-center justify-center bg-surface-inset px-4 py-10">
    <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,_rgba(59,130,246,0.08),_transparent_65%)]" />
    <div className="relative w-full max-w-md bg-surface rounded-3xl border border-border shadow-2xl shadow-blue-900/5 p-7 sm:p-9 flex flex-col gap-5">
      <header className="text-center flex flex-col items-center gap-2">
        <div className="w-10 h-10 rounded-2xl bg-[linear-gradient(to_top_right_in_oklab,var(--primary-tint)_0%,var(--primary-tint)_100%)] text-primary-text flex items-center justify-center font-bold">AI</div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text">{title}</h1>
        <p className="text-sm text-text-muted">{description}</p>
      </header>
      {children}
      <button type="button" className="text-sm text-primary-text hover:underline" onClick={() => navigate('/login')}>Quay lại đăng nhập</button>
    </div>
  </main>;
}
export const authInputClass = 'w-full px-4 py-2.5 bg-surface-inset border border-border rounded-xl text-text text-sm focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-border-strong';
export const authButtonClass = 'w-full py-3 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary disabled:opacity-60 disabled:cursor-wait';
export function AuthFeedback({ error, message }: { error?: string | null; message?: string | null }) {
  return <>{error && <p role="alert" className="text-sm rounded-xl bg-danger-tint p-3 text-danger-text">{error}</p>}
    {message && <p role="status" className="text-sm rounded-xl bg-primary-tint p-3 text-primary-text">{message}</p>}</>;
}
