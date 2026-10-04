import type { ReactNode } from 'react';

export interface AuthViewProps {
  navigate: (path: string, replace?: boolean) => void;
  authConfig?: { signupEnabled: boolean; googleEnabled: boolean };
  token?: string;
}
export function AuthFormFrame({ title, description, children, navigate }: {
  title: string; description: string; children: ReactNode; navigate: AuthViewProps['navigate'];
}) {
  return <main className="relative min-h-screen w-full flex flex-col items-center justify-center bg-[#f5f5f7] px-4 py-10">
    <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,_rgba(59,130,246,0.08),_transparent_65%)]" />
    <div className="relative w-full max-w-md bg-white/95 rounded-3xl border border-zinc-200/90 shadow-2xl shadow-blue-900/5 p-7 sm:p-9 flex flex-col gap-5">
      <header className="text-center flex flex-col items-center gap-2">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#0071e3] to-blue-500 text-white flex items-center justify-center font-bold">AI</div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900">{title}</h1>
        <p className="text-sm text-zinc-500">{description}</p>
      </header>
      {children}
      <button type="button" className="text-sm text-[#0071e3] hover:underline" onClick={() => navigate('/login')}>Quay lại đăng nhập</button>
    </div>
  </main>;
}
export const authInputClass = 'w-full px-4 py-2.5 bg-zinc-50/80 border border-zinc-200 rounded-xl text-zinc-900 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-[#0071e3]';
export const authButtonClass = 'w-full py-3 rounded-xl bg-[#0071e3] text-white font-semibold text-sm hover:bg-blue-600 disabled:opacity-60 disabled:cursor-wait';
export function AuthFeedback({ error, message }: { error?: string | null; message?: string | null }) {
  return <>{error && <p role="alert" className="text-sm rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
    {message && <p role="status" className="text-sm rounded-xl bg-blue-50 p-3 text-blue-800">{message}</p>}</>;
}
