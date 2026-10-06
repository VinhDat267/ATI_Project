import { useLayoutEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { currentTheme, subscribeTheme, toggleTheme } from './theme';

type Placement = { slot: HTMLElement; style?: CSSProperties };

// Gắn nút Sáng/Tối vào thanh trên đúng như theme.js: đầu cụm bên phải của `header > div`;
// cụm đó bị ẩn (màn hình nhỏ) thì gắn cuối hàng và đẩy sang phải; trang không có thanh trên thì nút nổi góc dưới phải.
// Quyết định một lần khi trang vừa dựng xong, như theme.js chạy lúc DOMContentLoaded.
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [announcement, setAnnouncement] = useState('');

  useLayoutEffect(() => {
    const slot = document.createElement('span');
    slot.setAttribute('data-proto-slot', 'theme-toggle');
    slot.style.display = 'contents';
    const row = document.querySelector('header > div');
    const right = row?.lastElementChild;
    let style: CSSProperties | undefined;
    if (right && getComputedStyle(right).display !== 'none' && right.children.length) {
      right.insertBefore(slot, right.firstElementChild);
    } else if (row) {
      style = { marginLeft: 'auto' };
      row.appendChild(slot);
    } else {
      style = { position: 'fixed', right: 16, bottom: 16, zIndex: 60 };
      document.body.appendChild(slot);
    }
    setPlacement({ slot, style });
    return () => { slot.remove(); setPlacement(null); };
  }, []);

  const dark = theme === 'dark';
  const label = dark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối';
  const onClick = () => {
    const next = toggleTheme();
    setAnnouncement('');
    window.setTimeout(() => setAnnouncement(next === 'dark' ? 'Đã chuyển sang giao diện tối' : 'Đã chuyển sang giao diện sáng'), 30);
  };
  return <>
    {placement && createPortal(
      <button type="button" id="ati-theme-toggle" className="ati-theme-toggle" aria-label={label} title={label} aria-pressed={dark} onClick={onClick} style={placement.style}>
        <svg className="ati-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>
        <svg className="ati-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path strokeLinecap="round" d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41" /></svg>
      </button>,
      placement.slot,
    )}
    {createPortal(
      <span id="ati-theme-live" aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>{announcement}</span>,
      document.body,
    )}
  </>;
}
