import { useEffect, useRef, useState } from 'react';
type Theme = 'light' | 'dark';
const validTheme = (value: unknown): Theme | null => value === 'light' || value === 'dark' ? value : null;
function storedTheme() { try { return validTheme(localStorage.getItem('ati-theme')); } catch { return null; } }
const systemTheme = (): Theme => window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
export function useTheme() {
  const preference = useRef<Theme | null>(storedTheme());
  const [theme, setTheme] = useState<Theme>(() => preference.current ?? systemTheme());
  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); document.documentElement.setAttribute('data-theme', theme); document.documentElement.style.colorScheme = theme; }, [theme]);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const systemChanged = () => { if (!preference.current) setTheme(systemTheme()); };
    const changed = (value: unknown) => { preference.current = validTheme(value); setTheme(preference.current ?? systemTheme()); };
    const storage = (event: StorageEvent) => { if (event.key === 'ati-theme' || event.key === null) changed(event.newValue); };
    const local = (event: Event) => changed((event as CustomEvent).detail);
    media?.addEventListener('change', systemChanged); window.addEventListener('storage', storage); window.addEventListener('ati:theme', local);
    return () => { media?.removeEventListener('change', systemChanged); window.removeEventListener('storage', storage); window.removeEventListener('ati:theme', local); };
  }, []);
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'; preference.current = next; setTheme(next);
    try { localStorage.setItem('ati-theme', next); } catch { /* Theme remains usable without storage access. */ }
    window.dispatchEvent(new CustomEvent('ati:theme', { detail: next }));
  };
  return { theme, toggleTheme };
}
