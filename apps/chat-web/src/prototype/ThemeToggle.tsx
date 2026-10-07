// Nút Sáng/Tối của bản mẫu (theme.js, docs/design/prototypes/react/src/app/ThemeToggle.tsx), dùng cơ chế của app
// (use-theme: khoá ati-theme, class dark và data-theme trên <html>, đồng bộ giữa các tab). Bản React gắn nút vào thanh trên
// bằng DOM; trong app, mỗi trang đặt nút đúng chỗ đó trong JSX. Kiểu dáng .ati-theme-toggle nằm trong theme.css.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../hooks/use-theme';

const visuallyHidden: CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' };

export function ThemeToggle({ style }: { style?: CSSProperties }) {
  const { theme, toggleTheme } = useTheme();
  const [announcement, setAnnouncement] = useState('');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const dark = theme === 'dark';
  const label = dark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối';
  const onClick = () => {
    const next = dark ? 'light' : 'dark';
    toggleTheme();
    setAnnouncement('');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAnnouncement(next === 'dark' ? 'Đã chuyển sang giao diện tối' : 'Đã chuyển sang giao diện sáng'), 30);
  };
  return <>
    <button type="button" id="ati-theme-toggle" className="ati-theme-toggle" aria-label={label} title={label} aria-pressed={dark} onClick={onClick} style={style}>
      <svg className="ati-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>
      <svg className="ati-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path strokeLinecap="round" d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41" /></svg>
    </button>
    {createPortal(<span id="ati-theme-live" aria-live="polite" style={visuallyHidden}>{announcement}</span>, document.body)}
  </>;
}
