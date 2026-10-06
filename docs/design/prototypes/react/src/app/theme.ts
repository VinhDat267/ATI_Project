// Sáng/Tối dùng chung, cùng hành vi với theme.js của bản mẫu:
// lưu ở localStorage "ati-theme"; chưa chọn thì theo hệ điều hành; đổi ở tab khác thì tab này đổi theo.
export type Theme = 'light' | 'dark';
const KEY = 'ati-theme';
const listeners = new Set<() => void>();
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function saved(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'dark' || value === 'light' ? value : null;
  } catch {
    return null;
  }
}
const preferred = (): Theme => saved() ?? (media?.matches ? 'dark' : 'light');

export function currentTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}
function apply(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.setAttribute('data-theme', theme);
  listeners.forEach(listener => listener());
}
export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(KEY, next); } catch { /* vẫn đổi được trong phiên này */ }
  apply(next);
  return next;
}
export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

apply(preferred());
media?.addEventListener('change', event => { if (!saved()) apply(event.matches ? 'dark' : 'light'); });
window.addEventListener('storage', event => { if (event.key === KEY) apply(preferred()); });
